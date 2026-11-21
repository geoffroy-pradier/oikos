-- Banques de joueurs : fondation et coffre (docs/specs/05-economie.md, 5.4 et 5.5 ; 12-modele-donnees.md ; ticket 726).
-- Une banque (trapeza) appartient à une maison de joueur, une au plus par maison, dans la cité de sa citoyenneté. Sa
-- monnaie est un compte du grand livre à part, son coffre, que la base ouvre à la fondation : un compte de cité
-- (`kind = 'treasury'`) marqué de sa banque, comme la bourse des PNJ (migration 1100) — une nature de compte nouvelle
-- casserait le rejeu de la migration 20 (ADR 0004). Il n'est jamais débiteur (`accounts_owner`) ; la migration 9941
-- tient les écritures qui le mouvementent, et le droit de fondation, détruit par le puits `sink_bank_charter`.
-- Rejouable (`if not exists`, `create or replace`, ajouts conditionnels, déclencheurs et règles recréés) ; compatible
-- avec le code précédent, à qui la règle par ligne du service cache les coffres comme les bourses : il trouve toujours
-- un seul trésor par cité.

insert into game.system_account_kinds (key, allow_negative) values ('sink_bank_charter', false)
on conflict do nothing;

create table if not exists game.banks (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  house_id uuid not null,
  -- Comme le nom d'une maison : 3 à 24 caractères, lettres, espaces, apostrophes, tirets ; unique dans le monde.
  name text not null check (name ~ '^[[:alpha:]][[:alpha:] ''-]{1,22}[[:alpha:]]$'),
  name_key text generated always as (lower(name)) stored,
  -- Taux annuels affichés, en points de base : `bank.setRates` (#727) les changera dans les bornes du monde.
  deposit_rate_bps integer not null check (deposit_rate_bps between 0 and 1000000),
  loan_rate_bps integer not null check (loan_rate_bps between 0 and 1000000),
  -- Droit de fondation payé, en oboles ; nul, la fondation n'a pas d'écriture de droit.
  charter_fee bigint not null check (charter_fee between 0 and 9007199254740991),
  founded_at timestamptz not null default now(),
  constraint banks_id_world_unique unique (id, world_id),
  constraint banks_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint banks_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint banks_one_per_house unique (house_id),
  constraint banks_name_unique unique (world_id, name_key)
);

-- Coffre : la marque de sa banque, dans le monde de la banque, sur un compte de cité qui n'est pas une bourse.
alter table game.accounts add column if not exists bank_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_bank_vault' and conrelid = 'game.accounts'::regclass) then
    alter table game.accounts add constraint accounts_bank_vault
      foreign key (bank_id, world_id) references game.banks (id, world_id);
    alter table game.accounts add constraint accounts_bank_vault_of_city
      check (bank_id is null or (kind = 'treasury' and not npc_purse));
    alter table game.accounts add constraint accounts_one_per_bank unique (bank_id);
  end if;
  -- Un trésor et une bourse par cité, et autant de coffres que de banques. Même nom que la contrainte des migrations 20
  -- et 1100, qui ne la reposent donc pas ; l'index partiel garde le trésor et la bourse uniques.
  if exists (select 1 from pg_constraint where conname = 'accounts_one_per_city' and conrelid = 'game.accounts'::regclass
               and pg_get_constraintdef(oid) = 'UNIQUE (city_id, npc_purse)') then
    alter table game.accounts drop constraint accounts_one_per_city;
    alter table game.accounts add constraint accounts_one_per_city unique (city_id, npc_purse, bank_id);
  end if;
end $$;
create unique index if not exists accounts_city_treasury_once on game.accounts (city_id, npc_purse)
  where city_id is not null and bank_id is null;

-- La banque d'un coffre fait partie de l'identité du compte, immuable comme le reste (migration 1100).
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
  if (new.id, new.world_id, new.kind, new.house_id, new.system_key, new.city_id, new.npc_purse, new.bank_id,
      new.allow_negative, new.created_at)
     is distinct from (old.id, old.world_id, old.kind, old.house_id, old.system_key, old.city_id, old.npc_purse,
      old.bank_id, old.allow_negative, old.created_at) then
    raise exception 'account identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.balance is distinct from old.balance and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'account balance changes only through ledger lines' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Une banque naît maintenant, pour une maison de joueur, dans la cité de sa citoyenneté ; seuls ses taux affichés
-- changeront (#727).
create or replace function game.guard_bank() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.founded_at is distinct from now() then
      raise exception 'a bank is founded now' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.houses h join game.citizenships c on c.house_id = h.id
                   where h.id = new.house_id and h.kind = 'player' and c.city_id = new.city_id) then
      raise exception 'a bank belongs to a player house, in its city' using errcode = 'check_violation',
        constraint = 'banks_house_city';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.city_id, new.house_id, new.name, new.charter_fee, new.founded_at)
     is distinct from (old.id, old.world_id, old.city_id, old.house_id, old.name, old.charter_fee, old.founded_at) then
    raise exception 'a bank keeps its identity' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
-- Le coffre naît avec la banque, au nom du propriétaire ; la garde des comptes de cité (migration 20) refuse tout autre
-- auteur.
create or replace function game.create_bank_vault() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.banks'::regclass then
    raise exception '% only runs on game.banks', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.accounts (world_id, kind, city_id, bank_id) values (new.world_id, 'treasury', new.city_id, new.id);
  return null;
end;
$$;
-- Comptes publics du trésor (migration 1100) : ni la bourse ni les coffres.
create or replace function game.city_treasuries()
returns table (city_id uuid, balance bigint)
language sql stable security definer
set search_path = ''
as $$
  select a.city_id, a.balance from game.accounts a where a.kind = 'treasury' and not a.npc_purse and a.bank_id is null;
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
  where a.kind = 'treasury' and not a.npc_purse and a.bank_id is null
  group by 1, 2, 3
  having sum(l.amount) <> 0;
$$;
-- Coffre d'une banque, verrouillé : les commandes qui le mouvementent le prennent après la trésorerie de la maison.
create or replace function game.lock_bank_vault(p_bank uuid)
returns table (account_id uuid, balance bigint)
language sql volatile security definer
set search_path = ''
as $$
  select a.id, a.balance from game.accounts a where a.bank_id = p_bank for update;
$$;
revoke execute on function game.guard_bank(), game.create_bank_vault() from public, anon, authenticated, oikos_service;
revoke all on function game.city_treasuries(), game.city_treasury_flows() from public, anon, oikos_service;
grant execute on function game.city_treasuries(), game.city_treasury_flows() to authenticated;
revoke all on function game.lock_bank_vault(uuid) from public, anon, authenticated;
grant execute on function game.lock_bank_vault(uuid) to oikos_service;

drop trigger if exists banks_guard on game.banks;
create trigger banks_guard before insert or update on game.banks
  for each row execute function game.guard_bank();
drop trigger if exists banks_vault on game.banks;
create trigger banks_vault after insert on game.banks
  for each row execute function game.create_bank_vault();
drop trigger if exists banks_no_delete on game.banks;
create trigger banks_no_delete before delete on game.banks
  for each row execute function game.forbid_change();
drop trigger if exists banks_no_truncate on game.banks;
create trigger banks_no_truncate before truncate on game.banks
  for each statement execute function game.forbid_change();
-- Le service fonde une banque sans choisir ni l'identifiant ni la date ; il ne la modifie ni ne la supprime. Les
-- coffres lui sont cachés comme les bourses : il les verrouille par `game.lock_bank_vault`. Les lectures des joueurs
-- viennent avec la migration 9942.
alter table game.banks enable row level security;
revoke all on game.banks from public, anon, authenticated, oikos_service;
grant select on game.banks to oikos_service;
grant insert (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee) on game.banks
  to oikos_service;
drop policy if exists service_all on game.banks;
create policy service_all on game.banks for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.accounts;
create policy service_all on game.accounts for all to oikos_service
  using (not npc_purse and bank_id is null) with check (kind in ('house', 'escrow'));
