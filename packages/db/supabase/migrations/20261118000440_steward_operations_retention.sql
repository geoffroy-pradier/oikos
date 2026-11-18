-- Conservation des opérations d'intendant (docs/specs/04-systemes-gestion.md, 4.4 ; ADR 0002 ; ticket 561). Un refus
-- durable inscrit une opération par tick : le moteur supprime celles d'avant la conservation de la configuration
-- (`stewards.operationsRetentionDays`), par la fonction du propriétaire ci-dessous, seule à pouvoir le faire.
-- Rejouable (`create or replace`, `if not exists`, droits redonnés) ; le code précédent n'appelle pas la purge, et
-- la garde lui refuse les mêmes écritures qu'avant.

-- La purge ne parcourt que les opérations échues.
create index if not exists steward_operations_purge_idx on game.steward_operations (created_at);

-- La garde de la migration 340, et une seule ouverture : la suppression d'une opération de plus d'un jour, pendant la
-- purge (réglage local posé par sa fonction). Toute autre suppression, une modification ou un vidage restent refusés,
-- au service comme au propriétaire.
create or replace function game.guard_steward_operation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_catalog.current_setting('oikos.steward_operation_purge', true) = 'on'
     and old.created_at < pg_catalog.clock_timestamp() - interval '1 day' then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'a steward operation does not change' using errcode = 'restrict_violation';
  end if;
  if new.created_at is distinct from now() then
    raise exception 'a steward operation is recorded now' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from game.stewards s
                 where s.id = new.steward_id and s.world_id = new.world_id
                   and s.rules_revision = new.rules_revision and s.dismissed_at is null
                   and s.unpaid_since is null) then
    raise exception 'an operation follows the current rules of a paid steward in post' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_steward_operation() from public, anon, authenticated, oikos_service;

-- Supprime les opérations inscrites avant `before` et rend leur nombre. Jamais une opération de moins d'un jour, comme
-- pour les messages (migration 92). Deux opérations restent quel que soit leur âge :
-- la dernière de chaque intendant (dans l'ordre du tick puis du rang), d'où repart la file de ses règles (4.4) ;
-- celles du dernier tick de son monde, que le moteur relit pour ne mener aucun rang deux fois (clé d'idempotence).
-- Le réglage local n'ouvre la garde que le temps de la suppression.
create or replace function game.purge_steward_operations(before timestamptz) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged bigint;
begin
  if before is null or before > pg_catalog.clock_timestamp() - interval '1 day' then
    raise exception 'steward operations younger than one day cannot be purged'
      using errcode = 'check_violation', constraint = 'steward_operations_purge_keeps_one_day';
  end if;
  perform pg_catalog.set_config('oikos.steward_operation_purge', 'on', true);
  delete from game.steward_operations o
  where o.created_at < before
    and exists (select 1 from game.steward_operations n
                where n.steward_id = o.steward_id and (n.tick_index, n.rank) > (o.tick_index, o.rank))
    and o.tick_index < (select max(t.index) from game.ticks t where t.world_id = o.world_id);
  get diagnostics purged = row_count;
  perform pg_catalog.set_config('oikos.steward_operation_purge', 'off', true);
  return purged;
end;
$$;
revoke execute on function game.purge_steward_operations(timestamptz) from public, anon, authenticated;
grant execute on function game.purge_steward_operations(timestamptz) to oikos_service;
