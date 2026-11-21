-- Pertes en mer (docs/specs/04-systemes-gestion.md, 4.6 ; docs/specs/12-modele-donnees.md ; ticket 730).
-- Un voyage garde le risque de perte fixé à son départ (`loss_risk_bps`). À l'arrivée, une cargaison perdue
-- passe de l'extrémité `in_transit` à l'extrémité système `lost_at_sea`, sans toucher aucun stock, et le
-- navire accoste à vide. La base garantit qu'une perte ne vient que d'un voyage arrivé, à risque non nul,
-- qu'elle emporte exactement ce qui a été chargé, une fois, et toute la cargaison ou rien.
-- Rejouable (`if not exists`, contraintes posées ou relâchées sous condition, `create or replace` aux
-- signatures inchangées, déclencheurs recréés). Compatible avec le code précédent : il n'écrit pas la colonne
-- (défaut nul, aucun risque) et ne décharge que vers un stock, ce qui reste admis.

-- Risque de perte du voyage, en points de base, fixé au départ et jamais modifié (garde ci-dessous).
alter table game.voyages add column if not exists loss_risk_bps integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'voyages_loss_risk_bps_range') then
    alter table game.voyages add constraint voyages_loss_risk_bps_range check (loss_risk_bps between 0 and 10000);
  end if;
end $$;

-- Journal des stocks : `lost_at_sea` est un puits à sens unique, alimenté depuis `in_transit` seulement (la
-- contrainte `stock_ledger_in_transit_voyage` le rattache donc à un voyage). Un tel mouvement, purement
-- système, est le seul qui ne touche aucun stock réel. `not valid` : aucune ligne antérieure ne touche cette
-- extrémité, et la contrainte relâchée admet tout ce que la précédente admettait ; le journal n'est pas relu.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_lost_at_sea_from_transit') then
    alter table game.stock_ledger add constraint stock_ledger_lost_at_sea_from_transit
      check (from_system is distinct from 'lost_at_sea'
             and (to_system is distinct from 'lost_at_sea' or from_system is not distinct from 'in_transit')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_touches_inventory'
                   and pg_get_constraintdef(oid) like '%lost_at_sea%') then
    alter table game.stock_ledger drop constraint if exists stock_ledger_touches_inventory;
    alter table game.stock_ledger add constraint stock_ledger_touches_inventory
      check (num_nonnulls(from_inventory_id, to_inventory_id) >= 1
             or (from_system is not distinct from 'in_transit' and to_system is not distinct from 'lost_at_sea')) not valid;
  end if;
end $$;

-- Mouvement rattaché à un voyage (migration 81), perte comprise. Chargement : au départ, depuis le stock de
-- sa maison dans la cité de départ, exactement sa cargaison. Déchargement ou perte : une fois arrivé,
-- exactement ce qui a été chargé ; un déchargement va au stock de sa maison dans la cité d'arrivée, une perte
-- au puits `lost_at_sea`, et seulement pour un voyage à risque non nul. Les index uniques de la migration 81
-- (`stock_ledger_voyage_unloaded_idx`) font qu'un bien ne sort qu'une fois de `in_transit`, perdu ou déchargé.
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
    if new.to_system = 'lost_at_sea' then
      if voyage.loss_risk_bps = 0 then
        raise exception 'a voyage loses its cargo only on a risky crossing' using errcode = 'restrict_violation';
      end if;
    elsif (stock.house_id, stock.city_id) is distinct from (voyage.house_id, voyage.to_city_id) then
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

-- À la validation, chaque ligne perdue (contrôle différé, ligne par ligne : une perte écrite dans une autre
-- transaction que l'arrivée y passe aussi) : son voyage est arrivé, à risque non nul, et n'a rien déchargé
-- vers un stock. Une cargaison se perd en entier ou pas du tout, quel que soit l'ordre des écritures.
create or replace function game.check_voyage_loss() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  voyage record;
begin
  select v.arrived_at, v.loss_risk_bps into voyage from game.voyages v where v.id = new.voyage_id;
  if not found or voyage.arrived_at is null or voyage.loss_risk_bps = 0 then
    raise exception 'a voyage loses its cargo only on arrival of a risky crossing' using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from game.stock_ledger l where l.voyage_id = new.voyage_id
               and l.from_system = 'in_transit' and l.to_inventory_id is not null) then
    raise exception 'a voyage loses all its cargo or none' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_voyage_loss() from public, anon, authenticated, oikos_service;
drop trigger if exists stock_ledger_voyage_loss on game.stock_ledger;
create constraint trigger stock_ledger_voyage_loss after insert on game.stock_ledger
  deferrable initially deferred for each row when (new.to_system = 'lost_at_sea')
  execute function game.check_voyage_loss();

-- Voyages (migration 80) : le risque de perte fait partie de l'identité du voyage, écrite au départ.
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
  if (new.id, new.world_id, new.house_id, new.ship_id, new.from_city_id, new.to_city_id, new.departed_at, new.arrives_at,
      new.loss_risk_bps)
     is distinct from (old.id, old.world_id, old.house_id, old.ship_id, old.from_city_id, old.to_city_id, old.departed_at,
      old.arrives_at, old.loss_risk_bps) then
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

-- Droits : le service écrit le risque au départ, jamais ensuite ; un joueur lit celui de ses voyages (règle
-- `voyages_read_own`, migration 81).
grant insert (loss_risk_bps) on game.voyages to oikos_service;
grant select (loss_risk_bps) on game.voyages to authenticated;
