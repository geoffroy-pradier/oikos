-- File des règles des sites des maisons PNJ de secours (docs/specs/08-ia.md, 8.3 ; 04-systemes-gestion.md, 4.4 ;
-- ticket 716). Le moteur mène les règles d'un site d'une maison PNJ, écrites dans la configuration de sa filière, au
-- pas des intendants (#279) : au plus `stewards.operationsPerTick` opérations par tick, chacune dans sa transaction.
-- Une maison PNJ n'a pas de compte, donc ni journal des commandes ni intendant : cette ligne, une par site, tient la
-- dernière opération menée, qui est à la fois la clé d'idempotence (tick et rang) et la position de la file.
-- Rejouable (`if not exists`, `create or replace`, règles recréées) ; le code précédent ne lit ni n'écrit la table.

-- Dernière opération d'un site d'une maison PNJ : son tick et son rang, la version de configuration dont elle a mené
-- les règles et la position de la règle menée, son refus éventuel (`error_code`), et le dernier tick de refus de
-- chaque règle de cette version (`refused`, position → tick), d'où se compte le repos d'une règle refusée (#621).
create table if not exists game.npc_site_queues (
  site_id uuid primary key,
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  house_kind text not null default 'npc' check (house_kind = 'npc'),
  config_version_id uuid not null,
  tick_index bigint not null check (tick_index >= 0),
  rank smallint not null check (rank between 0 and 19),
  rule_position smallint not null check (rule_position between 0 and 19),
  error_code text check (error_code ~ '^[A-Z][A-Z_]{1,63}$'),
  refused jsonb not null default '{}' check (jsonb_typeof(refused) = 'object'),
  updated_at timestamptz not null default now(),
  constraint npc_site_queues_site foreign key (site_id, house_id, world_id)
    references game.sites (id, house_id, world_id),
  constraint npc_site_queues_house_is_npc foreign key (house_id, world_id, house_kind)
    references game.houses (id, world_id, kind)
);

-- Une opération suit la précédente : tick et rang croissent strictement, et l'identité du site ne change pas. Deux
-- moteurs sur le même tick ne mènent donc pas deux fois le même rang, même hors du verrou que prend le moteur.
create or replace function game.guard_npc_site_queue() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.site_id, new.world_id, new.house_id, new.house_kind)
       is distinct from (old.site_id, old.world_id, old.house_id, old.house_kind) then
      raise exception 'an NPC site queue keeps its site' using errcode = 'restrict_violation';
    end if;
    if (new.tick_index, new.rank) <= (old.tick_index, old.rank) then
      raise exception 'an NPC site operation follows the previous one' using errcode = 'restrict_violation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function game.guard_npc_site_queue() from public, anon, authenticated, oikos_service;
drop trigger if exists npc_site_queues_guard on game.npc_site_queues;
create trigger npc_site_queues_guard before insert or update on game.npc_site_queues
  for each row execute function game.guard_npc_site_queue();
drop trigger if exists npc_site_queues_no_delete on game.npc_site_queues;
create trigger npc_site_queues_no_delete before delete on game.npc_site_queues
  for each row execute function game.forbid_change();
drop trigger if exists npc_site_queues_no_truncate on game.npc_site_queues;
create trigger npc_site_queues_no_truncate before truncate on game.npc_site_queues
  for each statement execute function game.forbid_change();

-- Seul le moteur, sous le rôle de service, lit et écrit la file ; aucun joueur ne la lit (rien d'exposé au client).
alter table game.npc_site_queues enable row level security;
revoke all on game.npc_site_queues from public, anon, authenticated, oikos_service;
grant select on game.npc_site_queues to oikos_service;
grant insert (site_id, world_id, house_id, config_version_id, tick_index, rank, rule_position, error_code, refused)
  on game.npc_site_queues to oikos_service;
grant update (config_version_id, tick_index, rank, rule_position, error_code, refused)
  on game.npc_site_queues to oikos_service;
drop policy if exists service_all on game.npc_site_queues;
create policy service_all on game.npc_site_queues for all to oikos_service using (true) with check (true);
