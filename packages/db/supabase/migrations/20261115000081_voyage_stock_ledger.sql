-- Cargaison des voyages dans le journal des stocks (docs/specs/04-systemes-gestion.md, 4.6 ;
-- docs/specs/12-modele-donnees.md ; ticket 252). Au départ, la cargaison sort du stock de la maison vers
-- l'extrémité système `in_transit`, rattachée au voyage ; à l'arrivée (#253), elle en sort vers le stock de
-- la maison dans la cité d'arrivée. La base garantit qu'un voyage ne décharge que ce qu'il a chargé, une
-- seule fois, et vers la cité d'arrivée de sa maison.
-- Les joueurs lisent leurs voyages et leur cargaison (`my_voyages`). Trois puits : provisions, part
-- détruite du droit de port, entretien des navires.
-- Rejouable (`if not exists`, `create or replace`, contraintes posées si absentes, règles recréées) ; le
-- code précédent n'écrit aucun mouvement rattaché à un voyage, ni cette extrémité, ni ces puits.

-- Journal des stocks : l'extrémité système `in_transit` est rattachée à un voyage, et un mouvement
-- rattaché à un voyage part de cette extrémité ou y va. `not valid` : aucune ligne antérieure n'a de
-- voyage ni ne touche cette extrémité, qu'aucun code n'écrivait ; le journal n'est pas relu.
alter table game.stock_ledger add column if not exists voyage_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_voyage_same_world') then
    alter table game.stock_ledger add constraint stock_ledger_voyage_same_world
      foreign key (voyage_id, world_id) references game.voyages (id, world_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_in_transit_voyage') then
    alter table game.stock_ledger add constraint stock_ledger_in_transit_voyage
      check ((coalesce(from_system = 'in_transit', false) or coalesce(to_system = 'in_transit', false))
             = (voyage_id is not null)) not valid;
  end if;
end $$;
-- Chaque bien d'un voyage est chargé une fois et déchargé une fois.
create unique index if not exists stock_ledger_voyage_loaded_idx on game.stock_ledger (voyage_id, good_id)
  where to_system = 'in_transit';
create unique index if not exists stock_ledger_voyage_unloaded_idx on game.stock_ledger (voyage_id, good_id)
  where from_system = 'in_transit';

-- Mouvement rattaché à un voyage. Chargement : au départ, depuis le stock de sa maison dans la cité de
-- départ, exactement la quantité de sa cargaison. Déchargement : une fois arrivé, vers le stock de sa
-- maison dans la cité d'arrivée, exactement ce qui a été chargé. Les index uniques ci-dessus font le reste :
-- une fois chacun.
create or replace function game.check_voyage_stock_movement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  voyage record;
  stock record;
begin
  select v.* into voyage from game.voyages v where v.id = new.voyage_id;
  -- Un voyage inconnu est laissé à la clé étrangère, un mouvement sans `in_transit` à la contrainte.
  if not found or (new.to_system is distinct from 'in_transit' and new.from_system is distinct from 'in_transit') then
    return new;
  end if;
  select i.house_id, i.city_id into stock from game.inventories i
  where i.id = coalesce(new.from_inventory_id, new.to_inventory_id);
  if new.to_system = 'in_transit' then
    if voyage.departed_at <> now() or voyage.arrived_at is not null then
      raise exception 'a voyage is loaded when it departs' using errcode = 'restrict_violation';
    end if;
    if (stock.house_id, stock.city_id) is distinct from (voyage.house_id, voyage.from_city_id) then
      raise exception 'a voyage loads from its house stock in its departure city' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.voyage_cargo c
                   where c.voyage_id = voyage.id and c.good_id = new.good_id and c.quantity = new.quantity) then
      raise exception 'a voyage loads exactly its cargo' using errcode = 'restrict_violation';
    end if;
  else
    if voyage.arrived_at is null then
      raise exception 'a voyage unloads once arrived' using errcode = 'restrict_violation';
    end if;
    if (stock.house_id, stock.city_id) is distinct from (voyage.house_id, voyage.to_city_id) then
      raise exception 'a voyage unloads into its house stock in its arrival city' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.stock_ledger l where l.voyage_id = voyage.id and l.good_id = new.good_id
                     and l.to_system = 'in_transit' and l.quantity = new.quantity) then
      raise exception 'a voyage unloads exactly what it loaded' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function game.check_voyage_stock_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists stock_ledger_voyage_guard on game.stock_ledger;
create trigger stock_ledger_voyage_guard before insert on game.stock_ledger
  for each row when (new.voyage_id is not null) execute function game.check_voyage_stock_movement();

-- Contrôle des voyages à la validation (migration 80), cargaison comprise : en mer, le navire n'est à quai
-- nulle part et toute la cargaison est chargée ; arrivé, le navire est à quai dans la cité d'arrivée (ou
-- en est déjà reparti) et toute la cargaison est déchargée. Le déclencheur de la migration 80 reste.
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
  if exists (select 1 from game.voyage_cargo c where c.voyage_id = voyage.id and not exists (
               select 1 from game.stock_ledger l
               where l.voyage_id = voyage.id and l.good_id = c.good_id and l.to_system = 'in_transit')) then
    raise exception 'a voyage loads all its cargo' using errcode = 'restrict_violation';
  end if;
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
  if exists (select 1 from game.voyage_cargo c where c.voyage_id = voyage.id and not exists (
               select 1 from game.stock_ledger l
               where l.voyage_id = voyage.id and l.good_id = c.good_id and l.from_system = 'in_transit')) then
    raise exception 'an arrived voyage unloads all its cargo' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_voyage_settled() from public, anon, authenticated, oikos_service;

-- Lecture : un joueur lit ses propres voyages et leur cargaison, colonnes accordées une à une.
create index if not exists voyages_house_id_idx on game.voyages (house_id);
drop policy if exists voyages_read_own on game.voyages;
create policy voyages_read_own on game.voyages for select to authenticated
  using (house_id in (select game.current_house_ids()));
drop policy if exists voyage_cargo_read_own on game.voyage_cargo;
create policy voyage_cargo_read_own on game.voyage_cargo for select to authenticated
  using (voyage_id in (select v.id from game.voyages v where v.house_id in (select game.current_house_ids())));
grant select (id, house_id, ship_id, from_city_id, to_city_id, departed_at, arrives_at, arrived_at)
  on game.voyages to authenticated;
grant select (voyage_id, good_id, quantity) on game.voyage_cargo to authenticated;

-- Voyages de la maison, cargaison comprise (un tableau `jsonb` de biens et de quantités). Créée sous
-- condition : rejouée, cette migration ne la recrée pas, et une colonne pourra s'y ajouter (ADR 0006).
do $$
begin
  if to_regclass('public.my_voyages') is null then
    create view public.my_voyages with (security_invoker = true) as
      select v.id, v.house_id, v.ship_id, v.from_city_id, v.to_city_id, v.departed_at, v.arrives_at, v.arrived_at,
             coalesce((select jsonb_agg(jsonb_build_object('goodId', c.good_id, 'quantity', c.quantity)
                                        order by c.good_id collate "C")
                       from game.voyage_cargo c where c.voyage_id = v.id), '[]'::jsonb) as cargo
      from game.voyages v;
  end if;
end $$;
grant select on public.my_voyages to authenticated;

-- Puits de monnaie : provisions d'un voyage, part détruite du droit de port, entretien des navires. Le
-- catalogue crée leurs comptes dans chaque monde.
insert into game.system_account_kinds (key, allow_negative)
values ('sink_voyage_provisions', false), ('sink_port_dues', false), ('sink_ship_upkeep', false)
on conflict do nothing;
