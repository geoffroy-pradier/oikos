-- Opérations des intendants (docs/specs/04-systemes-gestion.md, 4.4 ; 13 ; ticket 279) : le moteur mène les règles
-- d'un intendant actif, au plus `stewards.operationsPerTick` opérations par tick, chacune dans sa transaction.
-- Rejouable (`if not exists`, `create or replace`, règles recréées) ; le code précédent n'écrit pas la colonne
-- nouvelle du journal, ne lit ni n'écrit la table ni la vue.

-- Acteur d'une commande du journal : l'intendant qui l'a menée au nom de la maison du compte (`user_id`), nul pour
-- une commande du joueur. Pas de clé étrangère : le journal est un constat (comme `config_version_id`).
alter table game.command_log add column if not exists steward_id uuid;

-- Clé d'idempotence d'une opération d'intendant : `steward:<intendant>:<tick>:<rang>`, réservée aux lignes qui
-- nomment leur intendant. Le deux-points est refusé aux clés du joueur (`idempotencyKeySchema`) : un joueur ne peut
-- pas prendre d'avance, par l'API, la clé d'une opération de son intendant. Les clés du code précédent restent
-- admises. Recréée à l'identique au rejeu.
alter table game.command_log drop constraint if exists command_log_idempotency_key_check;
alter table game.command_log add constraint command_log_idempotency_key_check check (
  idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'
  or (steward_id is not null and idempotency_key ~ '^steward:[0-9a-f-]{36}:[0-9]{1,19}:[0-9]{1,2}$'));

-- Une opération par intendant, tick et rang : la clé d'idempotence de l'opération. Elle désigne la règle menée
-- (révision et position) ; son issue (`ok`, ou `rejected` avec un code d'erreur métier) et son résumé (`summary`,
-- `stewardOperationSummarySchema`) sont ceux de la ligne du journal des commandes qu'elle nomme (`command_id`,
-- sans clé étrangère : le journal se purge à 90 jours, ADR 0002, pas cette trace). Une opération en panne n'a pas de
-- ligne : elle sera retentée sous le même rang.
create table if not exists game.steward_operations (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  steward_id uuid not null,
  tick_index bigint not null check (tick_index >= 0),
  rank smallint not null check (rank between 0 and 19),
  rules_revision integer not null,
  rule_position smallint not null,
  status text not null check (status in ('ok', 'rejected')),
  error_code text check (error_code ~ '^[A-Z][A-Z_]{1,63}$'),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  command_id uuid not null,
  created_at timestamptz not null default now(),
  constraint steward_operations_once unique (steward_id, tick_index, rank),
  constraint steward_operations_rule foreign key (steward_id, rules_revision, rule_position)
    references game.steward_rules (steward_id, revision, position),
  constraint steward_operations_error_code check ((status = 'ok') = (error_code is null))
);
create index if not exists steward_operations_refused_idx on game.steward_operations (steward_id, tick_index desc, rank desc)
  where status = 'rejected';

-- Une opération s'inscrit maintenant, pour un intendant en poste et payé (actif), dans sa révision en vigueur et son monde ; elle
-- ne change plus ensuite.
create or replace function game.guard_steward_operation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
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
drop trigger if exists steward_operations_guard on game.steward_operations;
create trigger steward_operations_guard before insert or update or delete on game.steward_operations
  for each row execute function game.guard_steward_operation();
drop trigger if exists steward_operations_no_truncate on game.steward_operations;
create trigger steward_operations_no_truncate before truncate on game.steward_operations
  for each statement execute function game.forbid_change();

-- Le service lit et inscrit une opération, sans choisir ni l'identifiant ni la date ; il n'en change ni n'en
-- efface aucune. Un joueur lit les opérations de ses propres intendants, colonnes accordées une à une.
alter table game.steward_operations enable row level security;
revoke all on game.steward_operations from public, anon, authenticated, oikos_service;
grant select on game.steward_operations to oikos_service;
grant insert (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status, error_code, summary, command_id)
  on game.steward_operations to oikos_service;
drop policy if exists service_all on game.steward_operations;
create policy service_all on game.steward_operations for all to oikos_service using (true) with check (true);
drop policy if exists steward_operations_read_own on game.steward_operations;
create policy steward_operations_read_own on game.steward_operations for select to authenticated
  using (steward_id in (select s.id from game.stewards s where s.house_id in (select game.current_house_ids())));
grant select (steward_id, tick_index, rank, rules_revision, rule_position, status, error_code, summary, created_at)
  on game.steward_operations to authenticated;

-- Vue de la maison pour la fiche de site : les cinq dernières opérations de chacun de ses intendants en poste, et
-- son dernier refus, avec la règle menée. Créée sous condition (ADR 0006) : rejouée, cette migration ne la recrée pas.
do $$
begin
  if to_regclass('public.my_steward_operations') is null then
    create view public.my_steward_operations with (security_invoker = true) as
      select s.id as steward_id, s.site_id, o.tick_index, o.rank, o.created_at, o.status, o.error_code, o.summary,
             r.kind, r.good_id
      from game.stewards s
      cross join lateral (
        (select o.tick_index, o.rank, o.rules_revision, o.rule_position, o.created_at, o.status, o.error_code, o.summary
         from game.steward_operations o where o.steward_id = s.id order by o.tick_index desc, o.rank desc limit 5)
        union
        (select o.tick_index, o.rank, o.rules_revision, o.rule_position, o.created_at, o.status, o.error_code, o.summary
         from game.steward_operations o where o.steward_id = s.id and o.status = 'rejected'
         order by o.tick_index desc, o.rank desc limit 1)
      ) o
      join game.steward_rules r
        on r.steward_id = s.id and r.revision = o.rules_revision and r.position = o.rule_position
      where s.dismissed_at is null;
  end if;
end $$;
revoke all on public.my_steward_operations from public, anon, authenticated;
grant select on public.my_steward_operations to authenticated;
