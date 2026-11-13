-- Agora : ordres à cours limité et échanges (docs/specs/05-economie.md, 5.3 ; ticket 9).
-- Un ordre de vente ouvert réserve le stock qu'il propose ; un échange diminue l'ordre qu'il sert.
-- La base garantit donc : stock vendable = quantité - réservé, et quantité servie = somme des échanges.

-- Part du stock engagée dans des ordres de vente ouverts.
alter table game.inventories add column if not exists reserved bigint not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventories_reserved_within_quantity') then
    alter table game.inventories add constraint inventories_reserved_within_quantity
      check (reserved >= 0 and reserved <= quantity);
  end if;
end $$;

-- Garde des stocks (migration 5), étendue : la réservation ne change que par les ordres.
-- Limite connue de `pg_trigger_depth()` : la garde distingue une écriture directe d'une écriture faite par
-- un déclencheur, pas l'auteur du déclencheur. Un rôle capable de créer son propre déclencheur (table
-- temporaire) la franchirait délibérément. Aucun client n'a ce chemin ; le rôle de service non
-- propriétaire prévu en phase 1 devra perdre le droit TEMPORARY ou ces gardes vérifier le propriétaire.
create or replace function game.guard_inventory() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 0 or new.reserved <> 0 then
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
  if pg_trigger_depth() < 2 and new.reserved is distinct from old.reserved then
    raise exception 'inventory reservation changes only through orders' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create table if not exists game.orders (
  id uuid primary key default game.uuid_v7(),
  -- Ancienneté : à prix égal, l'ordre le plus ancien est servi d'abord.
  seq bigint generated always as identity,
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  house_id uuid not null,
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  side text not null check (side in ('buy', 'sell')),
  -- Prix limite par unité, en oboles.
  price bigint not null check (price > 0),
  quantity bigint not null check (quantity > 0),
  remaining bigint not null,
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint orders_id_world_unique unique (id, world_id),
  constraint orders_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint orders_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint orders_remaining_bounds check (remaining >= 0 and remaining <= quantity),
  constraint orders_filled_iff_nothing_remains check ((status = 'filled') = (remaining = 0))
);
create index if not exists orders_book_idx on game.orders (city_id, good_id, price, seq) where status = 'open';
create index if not exists orders_house_id_idx on game.orders (house_id);

-- Un ordre ne change que de deux façons : servi par un échange (déclencheur), ou annulé tel quel.
create or replace function game.guard_order() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.remaining <> new.quantity or new.status <> 'open' then
      raise exception 'an order starts open and whole' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.seq, new.world_id, new.city_id, new.house_id, new.good_id, new.side, new.price, new.quantity, new.created_at)
     is distinct from (old.id, old.seq, old.world_id, old.city_id, old.house_id, old.good_id, old.side, old.price, old.quantity, old.created_at) then
    raise exception 'order identity is immutable' using errcode = 'restrict_violation';
  end if;
  if old.status <> 'open' then
    raise exception 'a closed order does not change' using errcode = 'restrict_violation';
  end if;
  if pg_trigger_depth() < 2 and (new.remaining <> old.remaining or new.status <> 'cancelled') then
    raise exception 'an order is only filled by a trade or cancelled' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Réservation : ce qu'un ordre de vente ouvert propose est retenu sur le stock de la maison.
create or replace function game.apply_order_reservation() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  delta bigint := case when new.side = 'sell' and new.status = 'open' then new.remaining else 0 end;
  touched integer;
begin
  if tg_op = 'UPDATE' then
    delta := delta - case when old.side = 'sell' and old.status = 'open' then old.remaining else 0 end;
  end if;
  if delta = 0 then
    return null;
  end if;
  update game.inventories set reserved = reserved + delta
    where house_id = new.house_id and city_id = new.city_id and good_id = new.good_id;
  get diagnostics touched = row_count;
  if touched = 0 then
    raise exception 'no inventory of % to sell from', new.good_id using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists orders_guard on game.orders;
create trigger orders_guard before insert or update on game.orders
  for each row execute function game.guard_order();
drop trigger if exists orders_reservation on game.orders;
create trigger orders_reservation after insert or update on game.orders
  for each row execute function game.apply_order_reservation();

-- Version 0 : un ordre d'achat s'exécute à l'arrivée et son reste est annulé dans la même transaction ;
-- seul un ordre de vente attend dans le carnet (pas de monnaie mise sous séquestre). Contrôlé à la validation.
create or replace function game.forbid_resting_buy_order() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from game.orders where id = new.id and status = 'open') then
    raise exception 'a buy order does not rest in the book' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
drop trigger if exists orders_no_resting_buy on game.orders;
create constraint trigger orders_no_resting_buy after insert on game.orders
  deferrable initially deferred
  for each row when (new.side = 'buy') execute function game.forbid_resting_buy_order();

drop trigger if exists orders_no_delete on game.orders;
create trigger orders_no_delete before delete on game.orders
  for each row execute function game.forbid_change();
drop trigger if exists orders_no_truncate on game.orders;
create trigger orders_no_truncate before truncate on game.orders
  for each statement execute function game.forbid_change();

-- Échanges : toujours contre un ordre de vente en attente, au prix de cet ordre.
-- L'acheteur est un ordre d'achat d'un joueur, ou les PNJ de la cité (`buy_order_id` nul).
create table if not exists game.trades (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  sell_order_id uuid not null,
  buy_order_id uuid,
  price bigint not null check (price > 0),
  quantity bigint not null check (quantity > 0),
  -- Écriture de monnaie qui règle l'échange : pas d'échange sans paiement.
  ledger_entry_id uuid not null,
  created_at timestamptz not null default now(),
  constraint trades_sell_order_same_world foreign key (sell_order_id, world_id) references game.orders (id, world_id),
  constraint trades_buy_order_same_world foreign key (buy_order_id, world_id) references game.orders (id, world_id),
  constraint trades_entry_same_world foreign key (ledger_entry_id, world_id) references game.ledger_entries (id, world_id)
);
create index if not exists trades_sell_order_idx on game.trades (sell_order_id);
create index if not exists trades_buy_order_idx on game.trades (buy_order_id);

-- Chaque échange inséré sert les ordres concernés ; un ordre fermé, d'un autre marché, du mauvais
-- côté ou à un autre prix est refusé. Placé APRÈS l'insertion, comme pour les journaux.
create or replace function game.apply_trade() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sell game.orders;
begin
  update game.orders set remaining = remaining - new.quantity,
                         status = case when remaining = new.quantity then 'filled' else 'open' end
    where id = new.sell_order_id and side = 'sell' and status = 'open' and price = new.price
      and remaining >= new.quantity
    returning * into sell;
  if not found then
    raise exception 'trade does not match an open sell order' using errcode = 'check_violation';
  end if;
  if new.buy_order_id is not null then
    update game.orders set remaining = remaining - new.quantity,
                           status = case when remaining = new.quantity then 'filled' else 'open' end
      where id = new.buy_order_id and side = 'buy' and status = 'open' and price >= new.price
        and remaining >= new.quantity
        and city_id = sell.city_id and good_id = sell.good_id and house_id <> sell.house_id;
    if not found then
      raise exception 'trade does not match its buy order' using errcode = 'check_violation';
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trades_apply on game.trades;
create trigger trades_apply after insert on game.trades
  for each row execute function game.apply_trade();
drop trigger if exists trades_immutable on game.trades;
create trigger trades_immutable before update or delete on game.trades
  for each row execute function game.forbid_change();
drop trigger if exists trades_no_truncate on game.trades;
create trigger trades_no_truncate before truncate on game.trades
  for each statement execute function game.forbid_change();

alter table game.orders enable row level security;
alter table game.trades enable row level security;

-- Un joueur lit ses propres ordres ; le carnet des autres n'est visible qu'agrégé, sans identité.
drop policy if exists orders_read_own on game.orders;
create policy orders_read_own on game.orders for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, house_id, city_id, good_id, side, price, quantity, remaining, status, created_at)
  on game.orders to authenticated;
grant select (reserved) on game.inventories to authenticated;

create or replace view public.my_orders with (security_invoker = true) as
  select id, house_id, city_id, good_id, side, price, quantity, remaining, status, created_at from game.orders;

create or replace view public.my_inventories with (security_invoker = true) as
  select id, house_id, city_id, good_id, quantity, reserved from game.inventories;

-- Carnet public : quantité offerte par niveau de prix. Lit tous les ordres ouverts avec les droits
-- du propriétaire, mais ne rend ni maison ni ordre individuel.
create or replace function game.order_book()
returns table (city_id uuid, good_id text, side text, price bigint, quantity bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.city_id, o.good_id, o.side, o.price, sum(o.remaining)::bigint
  from game.orders o
  where o.status = 'open'
  group by o.city_id, o.good_id, o.side, o.price
$$;
revoke all on function game.order_book() from public;
grant execute on function game.order_book() to authenticated;

create or replace view public.order_book with (security_invoker = true) as
  select city_id, good_id, side, price, quantity from game.order_book();

grant select on public.my_orders, public.order_book to authenticated;
