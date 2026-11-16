-- Offrandes (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; docs/specs/12-modele-donnees.md ; ticket 265).
-- Une offrande (`temple.makeOffering`) détruit des oboles (puits `sink_offerings`, écriture `temple.offering`)
-- et envoie des biens du stock libre de la maison dans sa cité vers l'extrémité système `offering` du journal
-- des stocks ; sa Charis entre au journal de la Charis (migration 180), qui admet désormais cette nature.
-- Rejouable (`if not exists`, `create or replace`, contraintes posées si absentes, déclencheurs et règles
-- recréés) ; le code précédent n'écrit ni ne lit cette table, ces colonnes ni cette extrémité.

create table if not exists game.offerings (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  -- Cité de la maison : les biens viennent de son stock libre dans cette cité.
  city_id uuid not null,
  god_id text not null check (god_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  oboles bigint not null check (oboles >= 0),
  -- Charis gagnée, calculée par l'API au taux du dieu en vigueur (`offeringCharis`, packages/sim).
  charis bigint not null check (charis > 0),
  -- Écriture `temple.offering` des oboles ; nulle pour une offrande de biens seuls.
  ledger_entry_id uuid unique,
  created_at timestamptz not null default now(),
  constraint offerings_id_world_unique unique (id, world_id),
  constraint offerings_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint offerings_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint offerings_entry_same_world foreign key (ledger_entry_id, world_id)
    references game.ledger_entries (id, world_id),
  constraint offerings_money_entry check ((oboles > 0) = (ledger_entry_id is not null))
);
create index if not exists offerings_house_idx on game.offerings (house_id);

-- Journal de la Charis : une ligne `offering` est rattachée à son offrande, une fois.
alter table game.favor_ledger add column if not exists offering_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'favor_ledger_offering_same_world') then
    alter table game.favor_ledger add constraint favor_ledger_offering_same_world
      foreign key (offering_id, world_id) references game.offerings (id, world_id);
  end if;
end $$;
create unique index if not exists favor_ledger_offering_once on game.favor_ledger (offering_id)
  where offering_id is not null;

-- Journal des stocks : un mouvement vers l'extrémité `offering` est rattaché à son offrande, et rien n'en
-- revient. `not valid` : aucune ligne antérieure n'a d'offrande ni ne touche cette extrémité.
alter table game.stock_ledger add column if not exists offering_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_offering_same_world') then
    alter table game.stock_ledger add constraint stock_ledger_offering_same_world
      foreign key (offering_id, world_id) references game.offerings (id, world_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_offering_one_way') then
    alter table game.stock_ledger add constraint stock_ledger_offering_one_way
      check (from_system is distinct from 'offering'
             and coalesce(to_system = 'offering', false) = (offering_id is not null)) not valid;
  end if;
end $$;
create unique index if not exists stock_ledger_offering_good_idx on game.stock_ledger (offering_id, good_id)
  where offering_id is not null;

-- Une offrande naît maintenant, de la cité de sa maison, et ne change plus.
create or replace function game.guard_offering() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'an offering is made now' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from game.citizenships c where c.house_id = new.house_id and c.city_id = new.city_id) then
    raise exception 'an offering is made in the city of its house' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_offering() from public, anon, authenticated, oikos_service;
drop trigger if exists offerings_guard on game.offerings;
create trigger offerings_guard before insert on game.offerings
  for each row execute function game.guard_offering();
drop trigger if exists offerings_immutable on game.offerings;
create trigger offerings_immutable before update or delete on game.offerings
  for each row execute function game.forbid_change();
drop trigger if exists offerings_no_truncate on game.offerings;
create trigger offerings_no_truncate before truncate on game.offerings
  for each statement execute function game.forbid_change();

-- À la validation, une offrande est réglée : ses oboles, s'il y en a, passent de la trésorerie de sa maison
-- au puits `sink_offerings` de son monde par une écriture `temple.offering` de sa transaction, en deux lignes
-- exactement ; une offrande sans oboles donne des biens ; et sa Charis est entrée au journal. Au nom du
-- propriétaire, comme le contrôle des voyages (migration 81).
create or replace function game.check_offering_settled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid record;
begin
  if new.oboles > 0 then
    select e.kind, e.created_at, count(*) as lines,
           coalesce(sum(l.amount) filter (where a.kind = 'house' and a.house_id = new.house_id), 0) as debit,
           coalesce(sum(l.amount) filter (where a.world_id = new.world_id and a.system_key = 'sink_offerings'), 0) as credit
      into paid
      from game.ledger_entries e
      join game.ledger_lines l on l.entry_id = e.id
      join game.accounts a on a.id = l.account_id
      where e.id = new.ledger_entry_id
      group by e.kind, e.created_at;
    if (paid.kind, paid.created_at, paid.lines, paid.debit, paid.credit)
       is distinct from ('temple.offering', new.created_at, 2::bigint, -new.oboles, new.oboles) then
      raise exception 'an offering pays its oboles to sink_offerings' using errcode = 'restrict_violation';
    end if;
  elsif not exists (select 1 from game.stock_ledger s where s.offering_id = new.id) then
    raise exception 'an offering gives oboles or goods' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from game.favor_ledger f where f.offering_id = new.id) then
    raise exception 'an offering adds its Charis' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_offering_settled() from public, anon, authenticated, oikos_service;
drop trigger if exists offerings_settled on game.offerings;
create constraint trigger offerings_settled after insert on game.offerings
  deferrable initially deferred
  for each row execute function game.check_offering_settled();

-- Un bien offert sort, dans la transaction de son offrande, du stock de sa maison dans sa cité.
create or replace function game.check_offering_stock_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind <> 'temple.offering' or new.from_inventory_id is null or not exists (
       select 1 from game.offerings o join game.inventories i on i.id = new.from_inventory_id
       where o.id = new.offering_id and o.created_at = now()
         and i.house_id = o.house_id and i.city_id = o.city_id) then
    raise exception 'an offering takes goods from its house stock in its city, when it is made'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.check_offering_stock_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists stock_ledger_offering_guard on game.stock_ledger;
create trigger stock_ledger_offering_guard before insert on game.stock_ledger
  for each row when (new.offering_id is not null) execute function game.check_offering_stock_movement();

-- Garde du journal de la Charis (migration 180), plus la nature `offering` : la Charis d'une offrande faite
-- dans la même transaction, par la même maison, au même dieu, exactement. Une ligne d'une autre nature n'a
-- pas d'offrande. Une autre maison ne reçoit rien d'une offrande qui n'est pas la sienne.
create or replace function game.guard_favor_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Charis movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.kind = 'offering' then
    if new.game_day is not null or not exists (
         select 1 from game.offerings o
         where o.id = new.offering_id and o.created_at = now()
           and (o.world_id, o.house_id, o.god_id, o.charis) = (new.world_id, new.house_id, new.god_id, new.amount)) then
      raise exception 'an offering adds its own Charis, when it is made' using errcode = 'restrict_violation';
    end if;
  elsif new.offering_id is not null then
    raise exception 'only an offering movement names an offering' using errcode = 'restrict_violation';
  elsif new.kind = 'decay' then
    if new.amount > 0 or new.game_day is null then
      raise exception 'a decay removes Charis on a game day' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
      raise exception 'a decay is written before its close is recorded' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Charis movement' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_favor_movement() from public, anon, authenticated, oikos_service;

-- Le service lit, crée une offrande sans en choisir ni l'identifiant ni la date, et rattache un mouvement de
-- stock et une ligne de Charis à son offrande. Aucun accès client : les joueurs lisent leurs comptes et leur
-- Charis par des vues (migration 182).
alter table game.offerings enable row level security;
revoke all on game.offerings from public, anon, authenticated, oikos_service;
grant select on game.offerings to oikos_service;
grant insert (world_id, house_id, city_id, god_id, oboles, charis, ledger_entry_id) on game.offerings to oikos_service;
grant insert (offering_id) on game.favor_ledger to oikos_service;
drop policy if exists service_all on game.offerings;
create policy service_all on game.offerings for all to oikos_service using (true) with check (true);
