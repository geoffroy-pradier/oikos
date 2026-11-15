-- Voyages des navires (docs/specs/04-systemes-gestion.md, 4.6 ; docs/specs/12-modele-donnees.md ; ticket 252).
-- Un navire part d'une cité vers une autre avec une cargaison ; l'arrivée (#253) le met à quai dans la cité
-- d'arrivée. La migration 81 rattache la cargaison au journal des stocks et ouvre la lecture aux joueurs.
-- Rejouable (`if not exists`, `create or replace`, règles recréées) ; le code précédent ignore ces tables.

-- Un voyage désigne son navire avec sa maison et son monde : une seule clé étrangère les lie.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ships_id_house_world_unique') then
    alter table game.ships add constraint ships_id_house_world_unique unique (id, house_id, world_id);
  end if;
end $$;

create table if not exists game.voyages (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  ship_id uuid not null,
  from_city_id uuid not null,
  to_city_id uuid not null,
  departed_at timestamptz not null default now(),
  -- Arrivée prévue : le départ plus la durée du trajet, calculée par la commande depuis la configuration.
  arrives_at timestamptz not null,
  -- Instant de l'arrivée, posé par le moteur (#253) ; nul tant que le navire est en mer.
  arrived_at timestamptz,
  constraint voyages_id_world_unique unique (id, world_id),
  constraint voyages_ship foreign key (ship_id, house_id, world_id) references game.ships (id, house_id, world_id),
  constraint voyages_from_city_same_world foreign key (from_city_id, world_id) references game.cities (id, world_id),
  constraint voyages_to_city_same_world foreign key (to_city_id, world_id) references game.cities (id, world_id),
  constraint voyages_two_cities check (from_city_id <> to_city_id),
  constraint voyages_arrives_after_departure check (arrives_at > departed_at),
  constraint voyages_arrived_when_due check (arrived_at is null or arrived_at >= arrives_at)
);
-- Un navire n'a qu'un voyage en mer à la fois : deux départs concurrents, un seul est validé.
create unique index if not exists voyages_one_at_sea_idx on game.voyages (ship_id) where arrived_at is null;

-- Cargaison d'un voyage : une ligne par bien, écrite au départ et jamais modifiée.
create table if not exists game.voyage_cargo (
  voyage_id uuid not null,
  world_id uuid not null,
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  quantity bigint not null check (quantity > 0),
  primary key (voyage_id, good_id),
  constraint voyage_cargo_voyage_same_world foreign key (voyage_id, world_id) references game.voyages (id, world_id)
);

-- Un voyage part maintenant, en mer, de la cité où son navire armé est à quai. Ensuite, seule son arrivée
-- s'écrit, une fois, ni avant l'échéance ni dans le futur. Au nom du propriétaire, comme les contrôles suivants.
create or replace function game.guard_voyage() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ship record;
begin
  if tg_op = 'INSERT' then
    if new.departed_at is distinct from now() then
      raise exception 'a voyage departs now' using errcode = 'restrict_violation';
    end if;
    if new.arrived_at is not null then
      raise exception 'a voyage departs at sea' using errcode = 'restrict_violation';
    end if;
    select s.docked_city_id, s.laid_up_at into ship from game.ships s where s.id = new.ship_id for update;
    if found and ship.docked_city_id is distinct from new.from_city_id then
      raise exception 'a voyage departs from the city where its ship is docked' using errcode = 'restrict_violation';
    end if;
    if found and ship.laid_up_at is not null then
      raise exception 'a laid-up ship does not sail' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.house_id, new.ship_id, new.from_city_id, new.to_city_id, new.departed_at, new.arrives_at)
     is distinct from (old.id, old.world_id, old.house_id, old.ship_id, old.from_city_id, old.to_city_id, old.departed_at, old.arrives_at) then
    raise exception 'voyage identity is immutable' using errcode = 'restrict_violation';
  end if;
  if old.arrived_at is not null and new.arrived_at is distinct from old.arrived_at then
    raise exception 'an arrival is final' using errcode = 'restrict_violation';
  end if;
  if new.arrived_at > clock_timestamp() then
    raise exception 'a voyage does not arrive in the future' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_voyage() from public, anon, authenticated, oikos_service;
drop trigger if exists voyages_guard on game.voyages;
create trigger voyages_guard before insert or update on game.voyages
  for each row execute function game.guard_voyage();
drop trigger if exists voyages_no_delete on game.voyages;
create trigger voyages_no_delete before delete on game.voyages
  for each row execute function game.forbid_change();
drop trigger if exists voyages_no_truncate on game.voyages;
create trigger voyages_no_truncate before truncate on game.voyages
  for each statement execute function game.forbid_change();

-- À la validation, un voyage est cohérent avec son navire : en mer, le navire n'est à quai nulle part ;
-- arrivé, il est à quai dans la cité d'arrivée, ou en est déjà reparti. La migration 81 y ajoute la
-- cargaison, chargée au départ et déchargée à l'arrivée.
create or replace function game.check_voyage_settled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  voyage record;
  docked uuid;
begin
  select v.* into voyage from game.voyages v where v.id = new.id;
  select s.docked_city_id into docked from game.ships s where s.id = voyage.ship_id;
  if voyage.arrived_at is null then
    if docked is not null then
      raise exception 'a ship at sea is docked nowhere' using errcode = 'restrict_violation';
    end if;
    return null;
  end if;
  if docked is distinct from voyage.to_city_id and (docked is not null or not exists (
       select 1 from game.voyages v where v.ship_id = voyage.ship_id and v.arrived_at is null
         and v.from_city_id = voyage.to_city_id)) then
    raise exception 'an arrived ship is docked in the arrival city' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_voyage_settled() from public, anon, authenticated, oikos_service;
drop trigger if exists voyages_settled on game.voyages;
create constraint trigger voyages_settled after insert or update on game.voyages
  deferrable initially deferred
  for each row execute function game.check_voyage_settled();

-- La cargaison s'écrit dans la transaction du départ, puis ne change plus.
create or replace function game.guard_voyage_cargo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from game.voyages v where v.id = new.voyage_id and v.departed_at = now() and v.arrived_at is null) then
    raise exception 'a voyage is loaded when it departs' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_voyage_cargo() from public, anon, authenticated, oikos_service;
drop trigger if exists voyage_cargo_guard on game.voyage_cargo;
create trigger voyage_cargo_guard before insert on game.voyage_cargo
  for each row execute function game.guard_voyage_cargo();
drop trigger if exists voyage_cargo_immutable on game.voyage_cargo;
create trigger voyage_cargo_immutable before update or delete on game.voyage_cargo
  for each row execute function game.forbid_change();
drop trigger if exists voyage_cargo_no_truncate on game.voyage_cargo;
create trigger voyage_cargo_no_truncate before truncate on game.voyage_cargo
  for each statement execute function game.forbid_change();

-- Navires : la migration 51, plus le quai et le désarmement. Un navire quitte le quai par un voyage qui part
-- dans la transaction, n'accoste qu'au terme de son voyage, dans la cité d'arrivée, et ne passe jamais d'un
-- quai à un autre. Le désarmement est daté de la transaction qui l'écrit et ne change plus ; il se lève
-- quand une clôture paie l'entretien (la base ne relie pas la levée à un paiement : la clôture le garantit).
create or replace function game.guard_ship() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() then
      raise exception 'a ship is commissioned now' using errcode = 'restrict_violation';
    end if;
    if new.docked_city_id is null then
      raise exception 'a ship is commissioned docked in a city' using errcode = 'restrict_violation';
    end if;
    if new.laid_up_at is not null then
      raise exception 'a ship is commissioned in service' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.house_id, new.class_id, new.created_at)
     is distinct from (old.id, old.world_id, old.house_id, old.class_id, old.created_at) then
    raise exception 'ship identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.docked_city_id is distinct from old.docked_city_id then
    if old.docked_city_id is not null and new.docked_city_id is not null then
      raise exception 'a ship moves only by sea' using errcode = 'restrict_violation';
    elsif new.docked_city_id is null and not exists (
        select 1 from game.voyages v where v.ship_id = new.id and v.arrived_at is null
          and v.from_city_id = old.docked_city_id and v.departed_at = now()) then
      raise exception 'a ship puts to sea on a departing voyage' using errcode = 'restrict_violation';
    elsif new.docked_city_id is not null and (
        exists (select 1 from game.voyages v where v.ship_id = new.id and v.arrived_at is null)
        or (select v.to_city_id from game.voyages v where v.ship_id = new.id order by v.departed_at desc limit 1)
             is distinct from new.docked_city_id) then
      raise exception 'a ship docks where its voyage arrived' using errcode = 'restrict_violation';
    end if;
  end if;
  if new.laid_up_at is distinct from old.laid_up_at and new.laid_up_at is not null then
    if old.laid_up_at is not null then
      raise exception 'a lay-up date does not change' using errcode = 'restrict_violation';
    end if;
    if new.laid_up_at < now() or new.laid_up_at > clock_timestamp() then
      raise exception 'a ship is laid up by the transaction that writes it' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_ship() from public, anon, authenticated, oikos_service;

-- Droits. Le service fait partir un voyage et écrit sa cargaison, sans choisir ni l'identifiant ni la date
-- de départ ; il n'écrit ensuite que l'arrivée. Il met un navire en mer ou à quai, le désarme ou le réarme.
-- Les joueurs ne lisent les voyages qu'à partir de la migration 81 (`my_voyages`).
grant update (docked_city_id, laid_up_at) on game.ships to oikos_service;
alter table game.voyages enable row level security;
alter table game.voyage_cargo enable row level security;
revoke all on game.voyages, game.voyage_cargo from public, anon, authenticated, oikos_service;
grant select on game.voyages, game.voyage_cargo to oikos_service;
grant insert (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at) on game.voyages to oikos_service;
grant update (arrived_at) on game.voyages to oikos_service;
grant insert (voyage_id, world_id, good_id, quantity) on game.voyage_cargo to oikos_service;
drop policy if exists service_all on game.voyages;
create policy service_all on game.voyages for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.voyage_cargo;
create policy service_all on game.voyage_cargo for all to oikos_service using (true) with check (true);
