-- Grand livre en partie double et journal des stocks (docs/specs/05-economie.md, 12-modele-donnees.md ; ticket 5).
-- Les soldes ne sont que des cumuls vérifiables des journaux, qui sont en ajout seul.

create or replace function game.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'game.% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;

-- ---------------------------------------------------------------- Monnaie (montants en oboles entières)

create table if not exists game.accounts (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  kind text not null check (kind in ('house', 'system')),
  house_id uuid references game.houses (id),
  -- Compte système : un par robinet et par puits (5.5), nommé.
  system_key text check (system_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  -- Seuls les comptes système peuvent être débiteurs : un robinet crée de la monnaie en passant en négatif.
  allow_negative boolean not null default false,
  balance bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint accounts_owner check (
    (kind = 'house' and house_id is not null and system_key is null and not allow_negative)
    or (kind = 'system' and house_id is null and system_key is not null)
  ),
  constraint accounts_no_overdraft check (balance >= 0 or allow_negative),
  constraint accounts_one_per_house unique (house_id),
  constraint accounts_system_key_unique unique (world_id, system_key)
);

create table if not exists game.ledger_entries (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  -- Nature de l'écriture (code stable, par exemple `npc_purchase`, `market_trade`).
  kind text not null check (kind ~ '^[a-z][a-z0-9_.]{1,47}$'),
  meta jsonb not null default '{}' check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists game.ledger_lines (
  id uuid primary key default game.uuid_v7(),
  entry_id uuid not null references game.ledger_entries (id),
  account_id uuid not null references game.accounts (id),
  -- Positif : crédit du compte. Négatif : débit. Jamais nul, jamais de flottant.
  amount bigint not null check (amount <> 0)
);
create index if not exists ledger_lines_entry_id_idx on game.ledger_lines (entry_id);
create index if not exists ledger_lines_account_id_idx on game.ledger_lines (account_id);

-- Une écriture est équilibrée : au moins deux lignes, somme nulle, comptes du même monde.
-- Contrôlé à la validation de la transaction, à la création de l'écriture comme à l'ajout de toute ligne :
-- une ligne ajoutée après coup à une écriture existante est donc soumise au même contrôle.
create or replace function game.check_entry_balanced() returns trigger
language plpgsql
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

drop trigger if exists ledger_entries_balanced on game.ledger_entries;
create constraint trigger ledger_entries_balanced after insert on game.ledger_entries
  deferrable initially deferred for each row execute function game.check_entry_balanced();
drop trigger if exists ledger_lines_balanced on game.ledger_lines;
create constraint trigger ledger_lines_balanced after insert on game.ledger_lines
  deferrable initially deferred for each row execute function game.check_entry_balanced();

-- Chaque ligne met à jour le solde de son compte, dans la même transaction.
create or replace function game.apply_ledger_line() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update game.accounts set balance = balance + new.amount where id = new.account_id;
  return new;
end;
$$;

drop trigger if exists ledger_lines_apply on game.ledger_lines;
create trigger ledger_lines_apply before insert on game.ledger_lines
  for each row execute function game.apply_ledger_line();

-- Le solde ne se modifie que par une ligne d'écriture.
create or replace function game.guard_account_balance() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() < 2 and new.balance is distinct from old.balance then
    raise exception 'account balance changes only through ledger lines' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_guard_balance on game.accounts;
create trigger accounts_guard_balance before update on game.accounts
  for each row execute function game.guard_account_balance();

drop trigger if exists ledger_entries_immutable on game.ledger_entries;
create trigger ledger_entries_immutable before update or delete on game.ledger_entries
  for each row execute function game.forbid_change();
drop trigger if exists ledger_lines_immutable on game.ledger_lines;
create trigger ledger_lines_immutable before update or delete on game.ledger_lines
  for each row execute function game.forbid_change();

-- Vue de contrôle : pour tout compte, solde = cumul des lignes.
create or replace view game.account_balance_check with (security_invoker = true) as
  select a.id as account_id, a.world_id, a.balance, coalesce(sum(l.amount), 0)::bigint as lines_total,
         a.balance = coalesce(sum(l.amount), 0) as ok
  from game.accounts a
  left join game.ledger_lines l on l.account_id = a.id
  group by a.id;

alter table game.accounts enable row level security;
alter table game.ledger_entries enable row level security;
alter table game.ledger_lines enable row level security;

-- ---------------------------------------------------------------- Stocks

create table if not exists game.inventories (
  id uuid primary key default game.uuid_v7(),
  house_id uuid not null references game.houses (id),
  city_id uuid not null references game.cities (id),
  -- Identifiant du bien dans la configuration (`packages/config`).
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  quantity bigint not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  constraint inventories_unique unique (house_id, city_id, good_id)
);

-- Journal des stocks : chaque mouvement a une origine et une destination. Une extrémité est soit un
-- stock de joueur, soit une source ou un puits système nommé (production, consommation des PNJ...).
create table if not exists game.stock_ledger (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  quantity bigint not null check (quantity > 0),
  from_inventory_id uuid references game.inventories (id),
  from_system text check (from_system ~ '^[a-z][a-z0-9_]{1,47}$'),
  to_inventory_id uuid references game.inventories (id),
  to_system text check (to_system ~ '^[a-z][a-z0-9_]{1,47}$'),
  kind text not null check (kind ~ '^[a-z][a-z0-9_.]{1,47}$'),
  -- Écriture de monnaie liée (vente, achat), le cas échéant.
  ledger_entry_id uuid references game.ledger_entries (id),
  created_at timestamptz not null default now(),
  constraint stock_ledger_one_origin check (num_nonnulls(from_inventory_id, from_system) = 1),
  constraint stock_ledger_one_destination check (num_nonnulls(to_inventory_id, to_system) = 1),
  constraint stock_ledger_distinct_ends check (from_inventory_id is distinct from to_inventory_id or from_inventory_id is null),
  -- Un mouvement purement système ne déplace aucun stock réel.
  constraint stock_ledger_touches_inventory check (num_nonnulls(from_inventory_id, to_inventory_id) >= 1)
);
create index if not exists stock_ledger_from_idx on game.stock_ledger (from_inventory_id);
create index if not exists stock_ledger_to_idx on game.stock_ledger (to_inventory_id);

-- Chaque mouvement met à jour les stocks concernés ; le bien doit être celui du stock.
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
  return new;
end;
$$;

drop trigger if exists stock_ledger_apply on game.stock_ledger;
create trigger stock_ledger_apply before insert on game.stock_ledger
  for each row execute function game.apply_stock_movement();

create or replace function game.guard_inventory_quantity() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() < 2 and new.quantity is distinct from old.quantity then
    raise exception 'inventory quantity changes only through the stock ledger' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists inventories_guard_quantity on game.inventories;
create trigger inventories_guard_quantity before update on game.inventories
  for each row execute function game.guard_inventory_quantity();
drop trigger if exists stock_ledger_immutable on game.stock_ledger;
create trigger stock_ledger_immutable before update or delete on game.stock_ledger
  for each row execute function game.forbid_change();

-- Vue de contrôle : pour tout stock, quantité = entrées - sorties.
create or replace view game.inventory_quantity_check with (security_invoker = true) as
  select i.id as inventory_id, i.quantity,
         (coalesce((select sum(m.quantity) from game.stock_ledger m where m.to_inventory_id = i.id), 0)
          - coalesce((select sum(m.quantity) from game.stock_ledger m where m.from_inventory_id = i.id), 0))::bigint as movements_total
  from game.inventories i;

alter table game.inventories enable row level security;
alter table game.stock_ledger enable row level security;
