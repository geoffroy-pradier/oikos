-- Némésis : stock incendié, atelier déserté, navire perdu (docs/specs/07-dieux-faveur-evenements.md, 7.2 ;
-- 04-systemes-gestion.md, 4.3 et 4.6 ; 05-economie.md, 5.5 ; 12-modele-donnees.md ; ticket 735).
-- Ce qu'une sanction détruit passe par le journal des stocks, vers l'extrémité système `nemesis`, puits à sens unique
-- rattaché à son présage (migration 200) : la part d'un stock que l'incendie détruit, dans la transaction de la sanction ;
-- la cargaison d'un voyage perdu, toute, à l'arrivée du voyage, au lieu d'être déchargée. Un atelier déserté s'arrête
-- dans la transaction de la sanction et ne repart pas avant l'instant que le présage fixe (la clôture suivante).
-- Rejouable (`if not exists`, contraintes posées ou relâchées sous condition, `create or replace` aux signatures
-- inchangées, déclencheurs recréés). Compatible avec le code précédent : il n'écrit ni cette colonne ni cette extrémité ;
-- un voyage ou un atelier frappé ne l'est que par le code nouveau.

-- Journal des stocks : un mouvement vers `nemesis` est rattaché à son présage, et rien n'en revient. C'est, avec la perte
-- en mer (migration 9960), le seul mouvement admis qui ne touche aucun stock : la cargaison perdue d'un voyage, de
-- `in_transit` à `nemesis`. `not valid` : aucune ligne antérieure ne touche cette extrémité ; le journal n'est pas relu.
alter table game.stock_ledger add column if not exists nemesis_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_nemesis_same_world') then
    alter table game.stock_ledger add constraint stock_ledger_nemesis_same_world
      foreign key (nemesis_id, world_id) references game.nemesis_omens (id, world_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_nemesis_one_way') then
    alter table game.stock_ledger add constraint stock_ledger_nemesis_one_way
      check (from_system is distinct from 'nemesis'
             and coalesce(to_system = 'nemesis', false) = (nemesis_id is not null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_touches_inventory'
                   and pg_get_constraintdef(oid) like '%nemesis%') then
    alter table game.stock_ledger drop constraint if exists stock_ledger_touches_inventory;
    alter table game.stock_ledger add constraint stock_ledger_touches_inventory
      check (num_nonnulls(from_inventory_id, to_inventory_id) >= 1
             or (from_system is not distinct from 'in_transit' and to_system in ('lost_at_sea', 'nemesis'))) not valid;
  end if;
end $$;
-- Un bien au plus par présage : l'incendie d'un stock, ou chaque bien de la cargaison d'un voyage, une fois.
create unique index if not exists stock_ledger_nemesis_good_idx on game.stock_ledger (nemesis_id, good_id)
  where nemesis_id is not null;

-- Un mouvement vers `nemesis` est celui de son présage frappé : un incendie part du stock que nomme le présage, pour la
-- quantité qu'il porte, dans la transaction de la sanction ; un navire perdu part de `in_transit`, pour le voyage que
-- nomme le présage (contrôlé aussi par `check_voyage_stock_movement`, qui exige l'arrivée).
create or replace function game.check_nemesis_stock_movement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  omen game.nemesis_omens;
begin
  select * into omen from game.nemesis_omens o where o.id = new.nemesis_id;
  if omen.outcome is distinct from 'struck'
     or (omen.model = 'warehouse_fire'
         and (new.from_inventory_id is distinct from omen.inventory_id or new.quantity <> omen.quantity
              or omen.settled_at <> now()))
     or (omen.model = 'ship_lost'
         and (new.from_system is distinct from 'in_transit' or new.voyage_id is distinct from omen.voyage_id))
     or omen.model not in ('warehouse_fire', 'ship_lost') then
    raise exception 'goods go to nemesis only as its struck sanction takes them' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.check_nemesis_stock_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists stock_ledger_nemesis_guard on game.stock_ledger;
create trigger stock_ledger_nemesis_guard before insert on game.stock_ledger
  for each row when (new.nemesis_id is not null) execute function game.check_nemesis_stock_movement();

-- Mouvement rattaché à un voyage (migrations 81 et 9960), cargaison perdue à Némésis comprise : une fois arrivé, un
-- voyage que Némésis a frappé ne décharge rien ni ne se perd en mer ; toute sa cargaison va à `nemesis`, et seulement la
-- sienne. Le reste est inchangé.
create or replace function game.check_voyage_stock_movement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  voyage record;
  stock record;
  struck boolean;
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
    struck := exists (select 1 from game.nemesis_omens o where o.voyage_id = voyage.id and o.outcome = 'struck');
    if struck is distinct from (new.to_system is not distinct from 'nemesis') then
      raise exception 'a ship struck by Nemesis loses all its cargo to it, and no other does'
        using errcode = 'restrict_violation';
    end if;
    if new.to_system = 'lost_at_sea' then
      if voyage.loss_risk_bps = 0 then
        raise exception 'a voyage loses its cargo only on a risky crossing' using errcode = 'restrict_violation';
      end if;
    elsif new.to_system is distinct from 'nemesis'
          and (stock.house_id, stock.city_id) is distinct from (voyage.house_id, voyage.to_city_id) then
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

-- À la validation, une sanction frappée a pris ce que porte son présage : l'incendie, son mouvement du stock vers
-- `nemesis` ; la désertion, l'arrêt de son atelier dans la même transaction. Le navire perdu ne prend sa cargaison qu'à
-- l'arrivée, que `check_voyage_settled` (migration 81) exige toute sortie de `in_transit`, donc vers `nemesis`.
create or replace function game.check_nemesis_omen_effects() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  omen game.nemesis_omens;
begin
  select * into omen from game.nemesis_omens o where o.id = new.id;
  if omen.inventory_id is not null and not exists (
       select 1 from game.stock_ledger l where l.nemesis_id = omen.id and l.from_inventory_id = omen.inventory_id
         and l.quantity = omen.quantity) then
    raise exception 'a fire destroys its share of the stock' using errcode = 'restrict_violation';
  end if;
  if omen.site_id is not null and not exists (
       select 1 from game.sites s where s.id = omen.site_id and s.halted_at >= omen.settled_at) then
    raise exception 'a deserted workshop halts with its sanction' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_nemesis_omen_effects() from public, anon, authenticated, oikos_service;
drop trigger if exists nemesis_omens_effects on game.nemesis_omens;
create constraint trigger nemesis_omens_effects after update on game.nemesis_omens
  deferrable initially deferred for each row when (new.inventory_id is not null or new.site_id is not null)
  execute function game.check_nemesis_omen_effects();

-- Un atelier déserté ne repart pas avant l'instant de reprise de son présage, quel que soit le rôle (relance, clôture) :
-- la relance d'un joueur est refusée (`sites_nemesis_deserted`), la clôture suivante le fait repartir s'il est payé.
create or replace function game.guard_nemesis_desertion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.sites'::regclass then
    raise exception '% only runs on game.sites', tg_name using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from game.nemesis_omens o where o.site_id = new.id and o.outcome = 'struck'
               and o.resumes_at > now()) then
    raise exception 'a deserted workshop waits for the next close'
      using errcode = 'check_violation', constraint = 'sites_nemesis_deserted';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_nemesis_desertion() from public, anon, authenticated, oikos_service;
drop trigger if exists sites_nemesis_desertion on game.sites;
create trigger sites_nemesis_desertion before update of halted_at on game.sites
  for each row when (old.halted_at is not null and new.halted_at is null)
  execute function game.guard_nemesis_desertion();

