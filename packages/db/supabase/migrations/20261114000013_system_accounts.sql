-- Comptes système créés avec le monde (docs/specs/05-economie.md, 5.5 ; ticket 64).
-- Un monde sans son robinet ou son puits faisait échouer la première commande qui en avait besoin.
-- Le catalogue ci-dessous nomme chaque robinet et chaque puits ; tout monde reçoit les siens à sa
-- création, et tout ajout au catalogue les crée dans les mondes existants.

create table if not exists game.system_account_kinds (
  key text primary key check (key ~ '^(faucet|sink)_[a-z0-9_]{1,40}$'),
  -- Un robinet crée de la monnaie en devenant débiteur ; un puits ne fait que recevoir.
  allow_negative boolean not null,
  constraint system_account_kinds_faucets_only_go_negative check (allow_negative = (key like 'faucet\_%'))
);
alter table game.system_account_kinds enable row level security;
revoke all on game.system_account_kinds from public, anon, authenticated;
grant select on game.system_account_kinds to oikos_service;
drop policy if exists service_all on game.system_account_kinds;
create policy service_all on game.system_account_kinds for all to oikos_service using (true) with check (true);

create or replace function game.create_world_system_accounts() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.worlds'::regclass then
    raise exception '% only runs on game.worlds', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.accounts (world_id, kind, system_key, allow_negative)
    select new.id, 'system', k.key, k.allow_negative from game.system_account_kinds k
    on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists worlds_system_accounts on game.worlds;
create trigger worlds_system_accounts after insert on game.worlds
  for each row execute function game.create_world_system_accounts();

create or replace function game.create_kind_system_accounts() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.system_account_kinds'::regclass then
    raise exception '% only runs on game.system_account_kinds', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.accounts (world_id, kind, system_key, allow_negative)
    select w.id, 'system', new.key, new.allow_negative from game.worlds w
    on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists system_account_kinds_accounts on game.system_account_kinds;
create trigger system_account_kinds_accounts after insert on game.system_account_kinds
  for each row execute function game.create_kind_system_accounts();
-- Un compte système ne disparaît pas et ne change pas de nature : le catalogue ne fait que grandir.
drop trigger if exists system_account_kinds_immutable on game.system_account_kinds;
create trigger system_account_kinds_immutable before update or delete on game.system_account_kinds
  for each row execute function game.forbid_change();
drop trigger if exists system_account_kinds_no_truncate on game.system_account_kinds;
create trigger system_account_kinds_no_truncate before truncate on game.system_account_kinds
  for each statement execute function game.forbid_change();

-- Comme les fonctions des journaux (migration 12) : exécutées au nom du propriétaire, fermées au service.
-- Note pour un partitionnement futur : sur une table partitionnée, `tg_relid` désigne la partition ; les
-- contrôles `tg_relid` de ces fonctions et de celles de la migration 12 devront alors remonter à la
-- racine (`pg_partition_root`). D'ici là ils refuseraient toute écriture : échec fermé, pas une faille.
revoke execute on function game.create_world_system_accounts(), game.create_kind_system_accounts()
  from public, anon, authenticated, oikos_service;

-- Catalogue de départ ; le déclencheur crée les comptes manquants dans les mondes existants.
insert into game.system_account_kinds (key, allow_negative)
select key, key like 'faucet\_%'
from unnest(array[
  'faucet_npc_purchases', 'faucet_temple_loans', 'faucet_rewards', 'faucet_starting_grant',
  'sink_npc_wages', 'sink_upkeep', 'sink_market_tax', 'sink_offerings', 'sink_temple_interest', 'sink_public_works'
]) as key
on conflict do nothing;
-- Rejeu de la migration sur une base où le catalogue existait déjà : même garantie.
insert into game.accounts (world_id, kind, system_key, allow_negative)
select w.id, 'system', k.key, k.allow_negative from game.worlds w cross join game.system_account_kinds k
on conflict do nothing;

-- Le service ouvre les comptes des maisons, jamais un compte système : un robinet de plus serait
-- une planche à billets.
drop policy if exists service_all on game.accounts;
create policy service_all on game.accounts for all to oikos_service using (true) with check (kind = 'house');

-- La règle ci-dessus est recréée, plus large, si la migration 12 est rejouée seule. La garde suivante ne
-- dépend d'aucune règle : un compte système n'est créé qu'au nom du propriétaire de la table (les deux
-- déclencheurs ci-dessus, ou le propriétaire lui-même).
create or replace function game.guard_system_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then
    raise exception 'system accounts are created with their world' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_system_account() from public, anon, authenticated, oikos_service;
drop trigger if exists accounts_system_guard on game.accounts;
create trigger accounts_system_guard before insert on game.accounts
  for each row when (new.kind = 'system') execute function game.guard_system_account();

-- Base existante : un compte système hors catalogue, ou dont la nature diffère du catalogue, aurait été
-- laissé tel quel par les insertions ci-dessus. Mieux vaut arrêter la migration que le garder en silence.
do $$
declare
  odd text;
begin
  select string_agg(a.world_id || ':' || a.system_key, ', ') into odd
  from game.accounts a left join game.system_account_kinds k on k.key = a.system_key
  where a.kind = 'system' and (k.key is null or k.allow_negative <> a.allow_negative);
  if odd is not null then
    raise exception 'system accounts out of catalogue: %', odd using errcode = 'check_violation';
  end if;
end $$;
