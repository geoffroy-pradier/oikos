begin;
select plan(61);

-- Jeu d'essai : Alice (100 blés) et Bob (acheteur), une écriture de monnaie équilibrée pour régler les échanges.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1');
insert into game.ledger_entries (id, world_id, kind) values ('00000000-0000-7000-8000-0000000000e1', '01900000-0000-7000-8000-000000000001', 'test');
insert into game.ledger_lines (entry_id, account_id, amount) values
  ('00000000-0000-7000-8000-0000000000e1', (select id from game.accounts where system_key = 'faucet_npc_purchases' and world_id = '01900000-0000-7000-8000-000000000001'), -500),
  ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000aa', 500);
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000001a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-0000000001a1', 'site.collect');

create function pg_temp.place(order_id text, house text, side text, price bigint, quantity bigint, good text default 'wheat') returns void
language sql as $$
  insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining)
  values (('00000000-0000-7000-8000-0000000003' || order_id)::uuid, '01900000-0000-7000-8000-000000000001',
          '01900000-0000-7000-8000-000000000101', ('00000000-0000-7000-8000-0000000000' || house)::uuid, good, side, price, quantity, quantity)
$$;
create function pg_temp.trade(sell text, price bigint, quantity bigint, buy text default null) returns void
language sql as $$
  insert into game.trades (world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id)
  values ('01900000-0000-7000-8000-000000000001', ('00000000-0000-7000-8000-0000000003' || sell)::uuid,
          ('00000000-0000-7000-8000-0000000003' || buy)::uuid, price, quantity, '00000000-0000-7000-8000-0000000000e1')
$$;
create function pg_temp.stock() returns text language sql as
  $$select quantity || '/' || reserved from game.inventories where id = '00000000-0000-7000-8000-0000000001a1'$$;
create function pg_temp.state(order_id text) returns text language sql as
  $$select remaining || ' ' || status from game.orders where id = ('00000000-0000-7000-8000-0000000003' || order_id)::uuid$$;

-- Réservation du stock par les ordres de vente.
select lives_ok($$select pg_temp.place('01', 'a1', 'sell', 6, 60)$$, 'ordre de vente accepté');
select is(pg_temp.stock(), '100/60', 'le stock proposé est réservé');
select throws_ok($$select pg_temp.place('02', 'a1', 'sell', 7, 41)$$, '23514', null, 'pas de vente au-delà du stock libre');
select throws_ok($$select pg_temp.place('02', 'a1', 'sell', 7, 5, 'bread')$$, '23514', null, 'pas de vente sans stock du bien');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind) values ('01900000-0000-7000-8000-000000000001', 'wheat', 41, '00000000-0000-7000-8000-0000000001a1', 'consumption', 'test')$$, '23514', null, 'le stock réservé ne sort pas par un autre chemin');
select throws_ok($$update game.inventories set reserved = 0$$, '23001', null, 'la réservation ne se modifie pas à la main');
select throws_ok($$insert into game.inventories (world_id, house_id, city_id, good_id, reserved) values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'wheat', 5)$$, '23001', null, 'un stock naît sans réservation');

-- Intégrité des ordres.
select throws_ok($$insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining) values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-0000000000a1', 'wheat', 'sell', 6, 10, 4)$$, '23001', null, 'un ordre naît entier');
select throws_ok($$select pg_temp.place('02', 'a1', 'sell', 0, 5)$$, '23514', null, 'prix nul refusé');
select throws_ok($$update game.orders set remaining = 1 where id = '00000000-0000-7000-8000-000000000301'$$, '23001', null, 'le reste ne se modifie pas à la main');
select throws_ok($$update game.orders set status = 'filled', remaining = 0 where id = '00000000-0000-7000-8000-000000000301'$$, '23001', null, 'un ordre ne se déclare pas servi');
select throws_ok($$update game.orders set price = 600 where id = '00000000-0000-7000-8000-000000000301'$$, '23001', null, 'le prix d''un ordre ne change pas');
select throws_ok(format($$update game.orders set status = 'cancelled', %s where id = '00000000-0000-7000-8000-000000000301'$$, change), '23001', 'order identity is immutable', 'identité immuable, même à l''annulation : ' || change)
from unnest(array['price = 600', $$house_id = '00000000-0000-7000-8000-0000000000b1'$$, $$side = 'buy'$$, 'quantity = 61', 'city_id = gen_random_uuid()', $$good_id = 'bread'$$, $$world_id = '01900000-0000-7000-8000-000000000002'$$, $$created_at = now() - interval '1 day'$$]) change;
select throws_ok($$update game.orders set status = 'cancelled', remaining = 1 where id = '00000000-0000-7000-8000-000000000301'$$, '23001', 'an order is only filled by a trade or cancelled', 'une annulation ne change pas le reste');
select throws_ok($$insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining, status) values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-0000000000a1', 'wheat', 'sell', 6, 10, 10, 'cancelled')$$, '23001', 'an order starts open and whole', 'un ordre naît ouvert');
select throws_ok($$select pg_temp.place('02', 'a1', 'hold', 6, 5)$$, '23514', null, 'côté inconnu refusé');
select throws_ok('truncate game.orders cascade', '23001', 'game.orders is append-only', 'les ordres ne se vident pas');
select throws_ok($$delete from game.orders$$, '23001', null, 'un ordre ne se supprime pas');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
insert into game.cities (id, world_id, slug, name) values ('01900000-0000-7000-8000-000000000201', '01900000-0000-7000-8000-000000000002', 'ailleurs', 'Ailleurs'), ('01900000-0000-7000-8000-000000000102', '01900000-0000-7000-8000-000000000001', 'voisine', 'Voisine');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000d', 'dion@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values ('00000000-0000-7000-8000-0000000000d1', '01900000-0000-7000-8000-000000000002', '00000000-0000-4000-8000-00000000000d', 'Étéoboutades', '{}');
create function pg_temp.order_in(order_id text, world uuid, city uuid, house uuid, side text) returns void language sql as $$
  insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining)
  values (('00000000-0000-7000-8000-0000000003' || order_id)::uuid, world, city, house, 'wheat', side, 9, 5, 5)
$$;
select throws_ok($$select pg_temp.order_in('02', '01900000-0000-7000-8000-000000000002', '01900000-0000-7000-8000-000000000201', '00000000-0000-7000-8000-0000000000a1', 'buy')$$, '23503', 'insert or update on table "orders" violates foreign key constraint "orders_house_same_world"', 'ordre d''un autre monde que sa maison refusé');
select throws_ok($$select pg_temp.order_in('02', '01900000-0000-7000-8000-000000000002', '01900000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-0000000000d1', 'buy')$$, '23503', 'insert or update on table "orders" violates foreign key constraint "orders_city_same_world"', 'ordre d''un autre monde que sa cité refusé');

-- Échanges : achat par les PNJ (sans ordre d'achat).
select throws_ok($$select pg_temp.trade('01', 5, 10)$$, '23514', null, 'échange à un autre prix que l''ordre refusé');
select throws_ok($$select pg_temp.trade('01', 6, 61)$$, '23514', null, 'échange au-delà du reste refusé');
select lives_ok($$select pg_temp.trade('01', 6, 25)$$, 'échange partiel');
select is(pg_temp.state('01') || ' ' || pg_temp.stock(), '35 open 100/35', 'l''ordre est servi et la réservation libérée d''autant');
select throws_ok($$update game.trades set quantity = 1$$, '23001', null, 'un échange ne se modifie pas');
select throws_ok($$truncate game.trades$$, '23001', null, 'les échanges ne se vident pas');
select throws_ok($$select pg_temp.trade('01', 6, 0)$$, '23514', null, 'échange de quantité nulle refusé');
select throws_ok($$insert into game.trades (world_id, sell_order_id, price, quantity) values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000301', 6, 1)$$, '23502', null, 'pas d''échange sans écriture de monnaie');
select throws_ok($$delete from game.trades$$, '23001', null, 'un échange ne se supprime pas');
-- Cohérence des mondes : une écriture équilibrée et un ordre d'achat dans un second monde.
insert into game.accounts (id, world_id, kind, system_key, allow_negative) values ('00000000-0000-7000-8000-0000000000f1', '01900000-0000-7000-8000-000000000002', 'system', 'faucet_test', true), ('00000000-0000-7000-8000-0000000000f2', '01900000-0000-7000-8000-000000000002', 'system', 'sink_test', false);
insert into game.ledger_entries (id, world_id, kind) values ('00000000-0000-7000-8000-0000000000e2', '01900000-0000-7000-8000-000000000002', 'test');
insert into game.ledger_lines (entry_id, account_id, amount) values ('00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-0000000000f1', -1), ('00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-0000000000f2', 1);
select pg_temp.order_in('09', '01900000-0000-7000-8000-000000000002', '01900000-0000-7000-8000-000000000201', '00000000-0000-7000-8000-0000000000d1', 'buy');
select throws_ok($$insert into game.trades (world_id, sell_order_id, price, quantity, ledger_entry_id) values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000301', 6, 1, '00000000-0000-7000-8000-0000000000e2')$$, '23503', 'insert or update on table "trades" violates foreign key constraint "trades_entry_same_world"', 'écriture de monnaie d''un autre monde refusée');
select throws_ok($$insert into game.trades (world_id, sell_order_id, price, quantity, ledger_entry_id) values ('01900000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000301', 6, 1, '00000000-0000-7000-8000-0000000000e2')$$, '23503', 'insert or update on table "trades" violates foreign key constraint "trades_sell_order_same_world"', 'échange d''un autre monde que l''ordre de vente refusé');
select throws_ok($$insert into game.trades (world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id) values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000309', 6, 1, '00000000-0000-7000-8000-0000000000e1')$$, '23503', 'insert or update on table "trades" violates foreign key constraint "trades_buy_order_same_world"', 'ordre d''achat d''un autre monde refusé');

-- Ordre d'achat d'un joueur : servi à l'arrivée, jamais en attente.
select pg_temp.place('10', 'b1', 'buy', 7, 40);
select throws_ok($$select pg_temp.trade('10', 7, 1)$$, '23514', 'trade does not match an open sell order', 'un ordre d''achat ne sert pas de vendeur');
select throws_ok($$select pg_temp.trade('01', 6, 5, '01')$$, '23514', null, 'un ordre de vente ne sert pas d''acheteur');
select pg_temp.place('11', 'a1', 'buy', 9, 5);
select throws_ok($$select pg_temp.trade('01', 6, 5, '11')$$, '23514', null, 'pas d''échange d''une maison avec elle-même');
select lives_ok($$select pg_temp.trade('01', 6, 35, '10')$$, 'échange entre deux joueurs');
select is(pg_temp.state('01') || ', ' || pg_temp.state('10') || ', ' || pg_temp.stock(), '0 filled, 5 open, 100/0', 'les deux ordres sont servis');
select throws_ok($$select pg_temp.trade('01', 6, 1)$$, '23514', null, 'un ordre servi ne s''échange plus');
select throws_ok('set constraints all immediate', '23514', null, 'un ordre d''achat ne reste pas dans le carnet');
update game.orders set status = 'cancelled' where side = 'buy' and status = 'open';
select lives_ok('set constraints all immediate', 'reste d''achat annulé : transaction valide');
set constraints all deferred;
select pg_temp.place('03', 'a1', 'sell', 8, 30);
select pg_temp.place('04', 'a1', 'sell', 8, 20);
update game.orders set status = 'cancelled' where id = '00000000-0000-7000-8000-000000000304';
select is(pg_temp.state('04') || ' ' || pg_temp.stock(), '20 cancelled 100/30', 'l''annulation libère la réservation');
-- Chaque condition d'un échange, une par une. Bob reçoit du blé pour pouvoir vendre.
insert into game.inventories (id, world_id, house_id, city_id, good_id) values ('00000000-0000-7000-8000-0000000001b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values ('01900000-0000-7000-8000-000000000001', 'wheat', 10, 'production', '00000000-0000-7000-8000-0000000001b1', 'site.collect');
select pg_temp.place('20', 'b1', 'sell', 8, 10);
select pg_temp.place('12', 'b1', 'buy', 9, 5);
update game.orders set status = 'cancelled' where id = '00000000-0000-7000-8000-000000000312';
select pg_temp.place('13', 'b1', 'buy', 7, 5);
select pg_temp.place('14', 'b1', 'buy', 9, 5, 'bread');
select pg_temp.order_in('15', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000102', '00000000-0000-7000-8000-0000000000b1', 'buy');
select throws_ok($$select pg_temp.trade('04', 8, 1)$$, '23514', 'trade does not match an open sell order', 'un ordre de vente annulé ne s''échange plus');
select throws_ok($$select pg_temp.trade('20', 8, 1, '03')$$, '23514', 'trade does not match its buy order', 'un ordre de vente d''une autre maison ne sert pas d''acheteur');
select throws_ok($$select pg_temp.trade('03', 8, 1, '12')$$, '23514', 'trade does not match its buy order', 'un ordre d''achat annulé n''achète plus');
select throws_ok($$select pg_temp.trade('03', 8, 1, '13')$$, '23514', 'trade does not match its buy order', 'pas d''échange au-dessus du prix limite de l''acheteur');
select throws_ok($$select pg_temp.trade('03', 8, 1, '14')$$, '23514', 'trade does not match its buy order', 'pas d''échange entre deux biens');
select throws_ok($$select pg_temp.trade('03', 8, 1, '15')$$, '23514', 'trade does not match its buy order', 'pas d''échange entre deux cités');
update game.orders set status = 'cancelled' where status = 'open' and (side = 'buy' or id = '00000000-0000-7000-8000-000000000320');

-- Contrôle d'accès.
-- (La liste figée des colonnes lisibles de `game` est dans 002_world_houses.test.sql.)
select ok(not has_function_privilege('anon', 'game.order_book()', 'execute'), 'anon n''appelle pas order_book');
select is(
  (select count(*) from pg_class c, unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update', 'delete', 'truncate']) p
   where c.relnamespace = 'game'::regnamespace and c.relkind in ('r', 'p') and has_table_privilege(r, c.oid, p))
  + (select count(*) from pg_policies where schemaname = 'game' and tablename in ('orders', 'trades') and cmd <> 'SELECT')
  + (select count(*) from pg_class where oid in ('game.orders'::regclass, 'game.trades'::regclass) and not relrowsecurity),
  0::bigint, 'règles par ligne actives, aucune écriture client');
set local role anon;
select throws_ok('select * from public.order_book', '42501', null, 'anon ne lit pas le carnet');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq($$select side, price, quantity from public.order_book where city_id = '01900000-0000-7000-8000-000000000101'$$, $$values ('sell', 8::bigint, 30::bigint)$$, 'Bob lit le carnet agrégé');
select is((select count(*) from public.my_orders where house_id <> '00000000-0000-7000-8000-0000000000b1') + (select count(*) from game.orders where house_id = '00000000-0000-7000-8000-0000000000a1'),
  0::bigint, 'mais aucun ordre d''Alice, ni par la vue ni en direct');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.my_orders where house_id = '00000000-0000-7000-8000-0000000000a1'), 4::bigint, 'Alice lit ses propres ordres');
select results_eq('select quantity, reserved from public.my_inventories', $$values (100::bigint, 30::bigint)$$, 'et la part réservée de son stock');
reset role;
select * from finish();
rollback;
