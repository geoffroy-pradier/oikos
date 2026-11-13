begin;
select plan(11);

select lives_ok($$insert into game.npc_demand_carry (world_id, city_id, good_id, carry)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'wheat', 0.86)$$,
  'un report de moins d''une unité est accepté');
select throws_ok($$insert into game.npc_demand_carry (world_id, city_id, good_id, carry)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'wheat', 0.1)$$,
  '23505', null, 'un seul report par cité et par bien');
select lives_ok($$update game.npc_demand_carry set carry = 0 where good_id = 'wheat'$$, 'le report se met à jour');
select throws_ok($$update game.npc_demand_carry set carry = 1 where good_id = 'wheat'$$,
  '23514', null, 'une unité entière ne se reporte pas');
select throws_ok($$update game.npc_demand_carry set carry = -0.1 where good_id = 'wheat'$$,
  '23514', null, 'pas de report négatif');
select throws_ok($$insert into game.npc_demand_carry (world_id, city_id, good_id, carry)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'Wheat', 0)$$,
  '23514', null, 'identifiant de bien mal formé refusé');
select throws_ok($$insert into game.npc_demand_carry (world_id, city_id, good_id, carry)
  values ('01900000-0000-7000-8000-000000000001', game.uuid_v7(), 'fish', 0)$$,
  '23503', null, 'cité inconnue refusée');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
select throws_ok($$insert into game.npc_demand_carry (world_id, city_id, good_id, carry)
  values ('01900000-0000-7000-8000-000000000002', '01900000-0000-7000-8000-000000000101', 'fish', 0)$$,
  '23503', null, 'la cité doit être du même monde');

-- Non exposé : règles par ligne actives, et aucun droit pour les clients.
select ok((select relrowsecurity from pg_class where oid = 'game.npc_demand_carry'::regclass), 'règles par ligne actives');
select ok(not has_table_privilege('authenticated', 'game.npc_demand_carry', 'select, insert, update, delete'),
  'aucun droit pour un joueur connecté');
select ok(not has_table_privilege('anon', 'game.npc_demand_carry', 'select, insert, update, delete'),
  'aucun droit pour un visiteur');

select * from finish();
rollback;
