-- Journal des stocks (docs/specs/05-economie.md, 12-modele-donnees.md ; ticket 5).
-- Les quantités ne sont que des cumuls vérifiables du journal, qui est en ajout seul.

create table if not exists game.inventories (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  city_id uuid not null,
  -- Identifiant du bien dans la configuration (`packages/config`).
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  quantity bigint not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  constraint inventories_unique unique (house_id, city_id, good_id),
  constraint inventories_id_world_unique unique (id, world_id),
  constraint inventories_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint inventories_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id)
);

-- Journal des stocks : chaque mouvement a une origine et une destination. Une extrémité est soit un
-- stock de joueur, soit une source ou un puits système nommé (production, consommation des PNJ...).
create table if not exists game.stock_ledger (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  quantity bigint not null check (quantity > 0),
  from_inventory_id uuid,
  from_system text check (from_system ~ '^[a-z][a-z0-9_]{1,47}$'),
  to_inventory_id uuid,
  to_system text check (to_system ~ '^[a-z][a-z0-9_]{1,47}$'),
  kind text not null check (kind ~ '^[a-z][a-z0-9_.]{1,47}$'),
  -- Écriture de monnaie liée (vente, achat), le cas échéant.
  ledger_entry_id uuid references game.ledger_entries (id),
  created_at timestamptz not null default now(),
  constraint stock_ledger_from_same_world foreign key (from_inventory_id, world_id) references game.inventories (id, world_id),
  constraint stock_ledger_to_same_world foreign key (to_inventory_id, world_id) references game.inventories (id, world_id),
  constraint stock_ledger_one_origin check (num_nonnulls(from_inventory_id, from_system) = 1),
  constraint stock_ledger_one_destination check (num_nonnulls(to_inventory_id, to_system) = 1),
  constraint stock_ledger_distinct_ends check (from_inventory_id is distinct from to_inventory_id or from_inventory_id is null),
  -- Un mouvement purement système ne déplace aucun stock réel.
  constraint stock_ledger_touches_inventory check (num_nonnulls(from_inventory_id, to_inventory_id) >= 1)
);
create index if not exists stock_ledger_from_idx on game.stock_ledger (from_inventory_id);
create index if not exists stock_ledger_to_idx on game.stock_ledger (to_inventory_id);

-- Chaque mouvement inséré met à jour les stocks concernés ; le bien doit être celui du stock.
-- Déclencheur placé APRÈS l'insertion : un mouvement écarté (ON CONFLICT DO NOTHING) ne touche aucun stock.
create or replace function game.apply_stock_movement() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  touched integer;
begin
  update game.inventories set quantity = quantity - new.quantity
    where id = new.from_inventory_id and good_id = new.good_id;
  get diagnostics touched = row_count;
  if new.from_inventory_id is not null and touched = 0 then
    raise exception 'stock movement good % does not match origin inventory', new.good_id using errcode = 'check_violation';
  end if;
  update game.inventories set quantity = quantity + new.quantity
    where id = new.to_inventory_id and good_id = new.good_id;
  get diagnostics touched = row_count;
  if new.to_inventory_id is not null and touched = 0 then
    raise exception 'stock movement good % does not match destination inventory', new.good_id using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists stock_ledger_apply on game.stock_ledger;
create trigger stock_ledger_apply after insert on game.stock_ledger
  for each row execute function game.apply_stock_movement();

-- Un stock naît vide, son identité ne change jamais, et sa quantité ne se modifie que par le journal.
create or replace function game.guard_inventory() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 0 then
      raise exception 'an inventory starts empty' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.house_id, new.city_id, new.good_id, new.created_at)
     is distinct from (old.id, old.world_id, old.house_id, old.city_id, old.good_id, old.created_at) then
    raise exception 'inventory identity is immutable' using errcode = 'restrict_violation';
  end if;
  if pg_trigger_depth() < 2 and new.quantity is distinct from old.quantity then
    raise exception 'inventory quantity changes only through the stock ledger' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists inventories_guard on game.inventories;
create trigger inventories_guard before insert or update on game.inventories
  for each row execute function game.guard_inventory();
drop trigger if exists stock_ledger_immutable on game.stock_ledger;
create trigger stock_ledger_immutable before update or delete on game.stock_ledger
  for each row execute function game.forbid_change();
drop trigger if exists stock_ledger_no_truncate on game.stock_ledger;
create trigger stock_ledger_no_truncate before truncate on game.stock_ledger
  for each statement execute function game.forbid_change();

-- Vue de contrôle : pour tout stock, quantité = entrées - sorties.
create or replace view game.inventory_quantity_check with (security_invoker = true) as
  select i.id as inventory_id, i.world_id, i.quantity, m.movements_total, i.quantity = m.movements_total as ok
  from game.inventories i
  cross join lateral (
    select (coalesce(sum(s.quantity) filter (where s.to_inventory_id = i.id), 0)
            - coalesce(sum(s.quantity) filter (where s.from_inventory_id = i.id), 0))::bigint as movements_total
    from game.stock_ledger s
    where i.id in (s.to_inventory_id, s.from_inventory_id)
  ) m;

alter table game.inventories enable row level security;
alter table game.stock_ledger enable row level security;
