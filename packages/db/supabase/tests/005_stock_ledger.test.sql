begin;
select plan(21);

-- Jeu d'essai : deux maisons de la cité de test, un stock de blé chacune, un stock de pain.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000001a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'wheat'),
  ('00000000-0000-7000-8000-0000000001b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'wheat'),
  ('00000000-0000-7000-8000-0000000001b2', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'bread');

-- Stocks : production (source système), transfert, consommation (puits système).
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 40, 'production', '00000000-0000-7000-8000-0000000001a1', 'test');
insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 15, '00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-0000000001b1', 'test');
insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 5, '00000000-0000-7000-8000-0000000001b1', 'npc_consumption', 'test');
select results_eq(
  $$select quantity from game.inventories where good_id = 'wheat' order by id$$,
  $$values (25::bigint), (10::bigint)$$, 'quantités après production, transfert et consommation');
select is((select count(*) from game.inventory_quantity_check where not ok), 0::bigint, 'vue de contrôle : quantité = entrées - sorties');

select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 26, '00000000-0000-7000-8000-0000000001a1', 'npc_consumption', 'test')$$, '23514', null, 'stock négatif refusé');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, '00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-0000000001b2', 'test')$$, '23514', null, 'pas de blé dans un stock de pain');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_system, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, 'production', 'npc_consumption', 'test')$$, '23514', null, 'mouvement sans stock réel refusé');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 0, 'production', '00000000-0000-7000-8000-0000000001a1', 'test')$$, '23514', null, 'quantité nulle refusée');
select throws_ok('update game.inventories set quantity = 999', '23001', null, 'quantité non modifiable directement');
select throws_ok('delete from game.stock_ledger', '23001', null, 'journal des stocks en ajout seul');

-- Un contrôle, un test.
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, '00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-0000000001a1', 'test')$$, '23514', null, 'pas de mouvement d''un stock vers lui-même');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, '00000000-0000-7000-8000-0000000001a1', 'production', '00000000-0000-7000-8000-0000000001b1', 'test')$$, '23514', null, 'une seule origine');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, '00000000-0000-7000-8000-0000000001a1', 'test')$$, '23514', null, 'une destination est obligatoire');
-- Un mouvement écarté par ON CONFLICT DO NOTHING ne touche aucun stock.
insert into game.stock_ledger (id, world_id, good_id, quantity, from_system, to_inventory_id, kind)
  select id, '01900000-0000-7000-8000-000000000001', 'wheat', 5000, 'production', '00000000-0000-7000-8000-0000000001a1', 'test' from game.stock_ledger limit 1
  on conflict do nothing;
select is((select quantity from game.inventories where id = '00000000-0000-7000-8000-0000000001a1'), 25::bigint, 'ON CONFLICT DO NOTHING ne crée pas de stock');
select throws_ok($$insert into game.inventories (world_id, house_id, city_id, good_id, quantity)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'silver', 999)$$, '23001', null, 'un stock naît vide');
select throws_ok($$update game.inventories set good_id = 'silver' where id = '00000000-0000-7000-8000-0000000001a1'$$, '23001', null, 'pas de transmutation d''un stock');
select throws_ok($$update game.inventories set house_id = '00000000-0000-7000-8000-0000000000b1' where id = '00000000-0000-7000-8000-0000000001a1'$$, '23001', null, 'pas de transfert sans mouvement');
-- Cohérence des mondes.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
select throws_ok($$insert into game.inventories (world_id, house_id, city_id, good_id)
  values ('01900000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'salt')$$, '23503', null, 'stock d''un autre monde que sa maison refusé');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000002', 'wheat', 1, 'production', '00000000-0000-7000-8000-0000000001a1', 'test')$$, '23503', null, 'mouvement d''un autre monde que le stock refusé');
select throws_ok('truncate game.stock_ledger', '23001', null, 'journal des stocks non vidable');
select is(
  (select count(*) from pg_class where relnamespace = 'game'::regnamespace and relrowsecurity and relname in ('inventories', 'stock_ledger')),
  2::bigint, 'règles par ligne actives sur les deux tables');
select is(
  (select count(*) from information_schema.columns where table_schema = 'game' and column_name = 'quantity'
     and table_name in ('inventories', 'stock_ledger') and data_type = 'bigint'),
  2::bigint, 'quantités en entiers (bigint)');
select is(
  (select count(*) from pg_class c, unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
   where c.relnamespace = 'game'::regnamespace and c.relname in ('inventories', 'stock_ledger', 'inventory_quantity_check')
     and has_table_privilege(r, c.oid, p)),
  0::bigint, 'aucun droit client sur les stocks');

select * from finish();
rollback;
