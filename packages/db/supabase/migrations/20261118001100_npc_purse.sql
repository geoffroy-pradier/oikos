-- Bourse des PNJ de chaque cité (docs/specs/05-economie.md, 5.2 et 5.5 ; 12-modele-donnees.md ; ticket 632).
-- Un compte du grand livre par cité, qui reçoit ce que les maisons versent aux PNJ et paiera leurs achats. Ce n'est
-- pas un compte système : il compte dans la masse monétaire, comme le trésor de la cité, et n'est jamais débiteur.
--
-- Décision : la bourse est un compte de cité (`kind = 'treasury'`), marqué `npc_purse`. Une nature de compte
-- nouvelle casserait le rejeu de la migration 20, qui repose sans condition la liste des natures et la règle de
-- leur propriétaire (ADR 0004 : rejouabilité exigée, migration publiée immuable).
-- Compatibilité : le code précédent cherche le trésor d'une cité par sa seule cité. La règle par ligne du service
-- lui cache donc les bourses ; le code les lit et les verrouille par deux fonctions au nom du propriétaire.
-- Rejouable (`if not exists`, `create or replace`, ajouts conditionnels).

alter table game.accounts add column if not exists npc_purse boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_npc_purse_of_city' and conrelid = 'game.accounts'::regclass) then
    alter table game.accounts add constraint accounts_npc_purse_of_city check (not npc_purse or kind = 'treasury');
  end if;
  -- Un trésor et une bourse par cité. Même nom que la contrainte de la migration 20, qui ne la repose donc pas.
  if exists (select 1 from pg_constraint where conname = 'accounts_one_per_city' and conrelid = 'game.accounts'::regclass
               and pg_get_constraintdef(oid) = 'UNIQUE (city_id)') then
    alter table game.accounts drop constraint accounts_one_per_city;
    alter table game.accounts add constraint accounts_one_per_city unique (city_id, npc_purse);
  end if;
end $$;

-- La marque de la bourse fait partie de l'identité du compte, immuable comme le reste (migration 20).
create or replace function game.guard_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.balance <> 0 then
      raise exception 'an account starts with a zero balance' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.kind, new.house_id, new.system_key, new.city_id, new.npc_purse, new.allow_negative, new.created_at)
     is distinct from (old.id, old.world_id, old.kind, old.house_id, old.system_key, old.city_id, old.npc_purse, old.allow_negative, old.created_at) then
    raise exception 'account identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.balance is distinct from old.balance and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'account balance changes only through ledger lines' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- La bourse naît avec la cité, comme son trésor ; la garde des trésors (migration 20) refuse tout autre auteur.
create or replace function game.create_city_npc_purse() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.cities'::regclass then
    raise exception '% only runs on game.cities', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.accounts (world_id, kind, city_id, npc_purse) values (new.world_id, 'treasury', new.id, true)
    on conflict do nothing;
  return null;
end;
$$;
revoke execute on function game.create_city_npc_purse() from public, anon, authenticated, oikos_service;
drop trigger if exists cities_npc_purse on game.cities;
create trigger cities_npc_purse after insert on game.cities
  for each row execute function game.create_city_npc_purse();
-- Cités existantes.
insert into game.accounts (world_id, kind, city_id, npc_purse)
select c.world_id, 'treasury', c.id, true from game.cities c
on conflict do nothing;

-- Le service ne voit pas les bourses (voir l'en-tête) : il ne les lit et ne les verrouille que par les fonctions
-- ci-dessous, et les crédite ou les débite par les journaux, comme tout compte.
drop policy if exists service_all on game.accounts;
create policy service_all on game.accounts for all to oikos_service
  using (not npc_purse) with check (kind in ('house', 'escrow'));

-- L'équilibre d'une écriture se contrôle au nom du propriétaire, qui voit tous les comptes : une ligne d'une bourse
-- d'un autre monde serait sinon invisible au contrôle des comptes étrangers (migration 4).
create or replace function game.check_entry_balanced() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_entry uuid;
  total numeric;
  line_count integer;
  foreign_count integer;
begin
  if tg_table_name = 'ledger_entries' then
    checked_entry := new.id;
  else
    checked_entry := new.entry_id;
  end if;
  select coalesce(sum(l.amount), 0), count(l.id), count(*) filter (where a.world_id <> e.world_id)
    into total, line_count, foreign_count
  from game.ledger_entries e
  left join game.ledger_lines l on l.entry_id = e.id
  left join game.accounts a on a.id = l.account_id
  where e.id = checked_entry
  group by e.id;
  if line_count < 2 or total <> 0 or foreign_count > 0 then
    raise exception 'ledger entry % is not balanced (lines: %, sum: %, foreign accounts: %)',
      checked_entry, line_count, total, foreign_count using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_entry_balanced() from public, anon, authenticated, oikos_service;

-- Bourses de tous les mondes, pour le tableau de bord (5.5) : lecture seule, sans verrou.
create or replace function game.npc_purses()
returns table (world_id uuid, city_id uuid, account_id uuid, balance bigint)
language sql stable security definer
set search_path = ''
as $$
  select a.world_id, a.city_id, a.id, a.balance from game.accounts a where a.npc_purse order by a.world_id, a.city_id;
$$;
-- Bourses d'un monde (ou de l'une de ses cités), verrouillées par cité : les étapes qui les mouvementent les prennent
-- après les puits de l'entretien et avant toute trésorerie de maison (5.5, ordre des verrous).
create or replace function game.lock_npc_purses(p_world uuid, p_city uuid default null)
returns table (city_id uuid, account_id uuid, balance bigint)
language sql volatile security definer
set search_path = ''
as $$
  select a.city_id, a.id, a.balance from game.accounts a
  where a.npc_purse and a.world_id = p_world and (p_city is null or a.city_id = p_city)
  order by a.city_id
  for update;
$$;
revoke all on function game.npc_purses(), game.lock_npc_purses(uuid, uuid) from public, anon, authenticated;
grant execute on function game.npc_purses(), game.lock_npc_purses(uuid, uuid) to oikos_service;

-- Comptes publics du trésor (migration 171) : la bourse n'en fait pas partie.
create or replace function game.city_treasuries()
returns table (city_id uuid, balance bigint)
language sql stable security definer
set search_path = ''
as $$
  select a.city_id, a.balance from game.accounts a where a.kind = 'treasury' and not a.npc_purse;
$$;
create or replace function game.city_treasury_flows()
returns table (city_id uuid, game_day integer, nature text, amount bigint)
language sql stable security definer
set search_path = ''
as $$
  select a.city_id,
         ((e.created_at at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
           - date '1970-01-01',
         case
           when e.kind in ('market.trade', 'npc.purchase', 'property.sale') then 'market_tax'
           when e.kind = 'voyage.departure' then 'port_dues'
           when e.kind = 'city.public_works' then 'public_works'
           when e.kind = 'city.festival' then 'festival'
           else 'other'
         end,
         sum(l.amount)::bigint
  from game.accounts a
  join game.ledger_lines l on l.account_id = a.id
  join game.ledger_entries e on e.id = l.entry_id
  left join game.clock_rules() c on true
  where a.kind = 'treasury' and not a.npc_purse
  group by 1, 2, 3
  having sum(l.amount) <> 0;
$$;
revoke all on function game.city_treasuries(), game.city_treasury_flows() from public, anon, oikos_service;
grant execute on function game.city_treasuries(), game.city_treasury_flows() to authenticated;

-- Robinet du revenu public des PNJ (5.5), crédité chaque jour à la bourse de chaque cité.
insert into game.system_account_kinds (key, allow_negative) values ('faucet_npc_public_income', true)
on conflict do nothing;
