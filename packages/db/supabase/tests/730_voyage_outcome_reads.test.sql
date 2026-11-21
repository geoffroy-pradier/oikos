begin;
select plan(16);

-- Jeu d'essai : Alice a trois navires à Kallistè (101) et 100 blés ; Bob a une maison, sans navire. Le voyage 5
-- (risque plein, 30 blés) perd sa cargaison, le voyage 6 (sans risque, 20 blés) la décharge à Elaia (103), le
-- voyage 7 (risque plein, 10 blés) reste en mer. Écrits comme l'API et le moteur les écrivent (#730).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000731aaa', 'issues-alice@example.test'),
  ('00000000-0000-4000-8000-000000731aab', 'issues-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-000000731a01', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000731aaa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-000000731b01', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000731aab', 'Philaïdes', '{}');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id)
select ('00000000-0000-7000-8000-000000731a0' || n)::uuid, '01900000-0000-7000-8000-000000000001',
       '00000000-0000-7000-8000-000000731a01', 'coaster', '01900000-0000-7000-8000-000000000101'
from generate_series(5, 7) n;
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-000000731c01', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000731a01', '01900000-0000-7000-8000-000000000101', 'wheat'),
  ('00000000-0000-7000-8000-000000731e01', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000731a01', '01900000-0000-7000-8000-000000000103', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-000000731c01', 'test');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.settled(statement text) returns void language plpgsql as $$
begin
  execute statement;
  set constraints all immediate;
  set constraints all deferred;
end $$;
create function pg_temp.voyage(ship integer) returns uuid language sql as
  $$select id from game.voyages where ship_id = ('00000000-0000-7000-8000-000000731a0' || ship)::uuid$$;
create function pg_temp.as_player(who text, query text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  execute query into result;
  perform set_config('role', 'none', true);
  return result;
end $$;

select is((select column_name::text from information_schema.columns
           where table_schema = 'public' and table_name = 'my_voyages' order by ordinal_position desc limit 1),
  'cargo_lost', 'l''issue est la dernière colonne de my_voyages : les colonnes précédentes ne changent pas (ADR 0006)');

select lives_ok($$select pg_temp.settled($s$select pg_temp.as_service($q$
  insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at, loss_risk_bps)
  select '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000731a01', s.id,
         '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103',
         now() + case when r.ship = 7 then interval '1 hour' else interval '1 millisecond' end, r.risk
  from game.ships s join (values (5, 10000), (6, 0), (7, 10000)) r (ship, risk)
    on s.id = ('00000000-0000-7000-8000-000000731a0' || r.ship)::uuid;
  insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
  select v.id, v.world_id, 'wheat', c.quantity from game.voyages v
  join (values (5, 30), (6, 20), (7, 10)) c (ship, quantity) on v.ship_id = ('00000000-0000-7000-8000-000000731a0' || c.ship)::uuid;
  insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, voyage_id)
  select c.world_id, 'wheat', c.quantity, '00000000-0000-7000-8000-000000731c01', 'in_transit', 'voyage.departure', c.voyage_id
  from game.voyage_cargo c join game.voyages v on v.id = c.voyage_id where v.house_id = '00000000-0000-7000-8000-000000731a01';
  update game.ships set docked_city_id = null where house_id = '00000000-0000-7000-8000-000000731a01'$q$)$s$)$$,
  'trois navires d''Alice prennent la mer');
select is(pg_temp.as_player('00000000-0000-4000-8000-000000731aaa', 'select array(select cargo_lost from public.my_voyages order by ship_id)::text'), '{NULL,NULL,NULL}',
  'en mer, l''issue n''est pas lisible, même à risque plein : rien du tirage ne paraît avant l''arrivée');
do $$ begin perform pg_sleep(0.01); end $$;

-- Arrivées : 5 perd sa cargaison, 6 la décharge à Elaia ; 7 reste en mer.
select lives_ok($$select pg_temp.settled($s$select pg_temp.as_service($q$
  update game.voyages set arrived_at = arrives_at where ship_id in ('00000000-0000-7000-8000-000000731a05', '00000000-0000-7000-8000-000000731a06');
  update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103'
    where id in ('00000000-0000-7000-8000-000000731a05', '00000000-0000-7000-8000-000000731a06');
  insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_system, kind, voyage_id)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 30, 'in_transit', 'lost_at_sea', 'voyage.loss', (select id from game.voyages where ship_id = '00000000-0000-7000-8000-000000731a05'));
  insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind, voyage_id)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 20, 'in_transit', '00000000-0000-7000-8000-000000731e01',
          'voyage.arrival', (select id from game.voyages where ship_id = '00000000-0000-7000-8000-000000731a06'))$q$)$s$)$$,
  'arrivée du voyage perdu et du voyage déchargé');
select is(pg_temp.as_player('00000000-0000-4000-8000-000000731aaa', 'select array(select cargo_lost from public.my_voyages order by ship_id)::text'), '{t,f,NULL}',
  'Alice lit l''issue de ses voyages arrivés : perdu, déchargé ; celui en mer reste muet');
select is(pg_temp.as_player('00000000-0000-4000-8000-000000731aaa',
  $$select cargo::text from public.my_voyages where ship_id = '00000000-0000-7000-8000-000000731a05'$$),
  '[{"goodId": "wheat", "quantity": 30}]', 'la cargaison chargée reste dite : l''issue dit qu''elle est perdue');
select is(pg_temp.as_player('00000000-0000-4000-8000-000000731aaa',
  format('select game.voyage_cargo_lost(%L)::text', pg_temp.voyage(5))), 'true', 'la fonction rend la même issue');

-- Un autre joueur ne lit rien de ces issues, ni par la vue, ni par la fonction, ni par le journal des stocks.
select is(pg_temp.as_player('00000000-0000-4000-8000-000000731aab', 'select count(*)::text from public.my_voyages'), '0',
  'Bob ne lit aucun voyage d''Alice');
select is(pg_temp.as_player('00000000-0000-4000-8000-000000731aab',
  format('select coalesce(game.voyage_cargo_lost(%L)::text, %L)', pg_temp.voyage(5), 'rien')), 'rien',
  'ni l''issue du voyage perdu par la fonction');
select is(pg_temp.as_player('00000000-0000-4000-8000-000000731aab',
  format('select coalesce(game.voyage_cargo_lost(%L)::text, %L)', pg_temp.voyage(6), 'rien')), 'rien',
  'ni celle du voyage déchargé : perdu ou non, la réponse est la même');
select throws_ok($$select pg_temp.as_player('00000000-0000-4000-8000-000000731aab', 'select count(*)::text from game.stock_ledger')$$,
  '42501', null, 'ni le journal des stocks');
select throws_ok($$select pg_temp.as_player('00000000-0000-4000-8000-000000731aab',
  'update game.voyages set arrived_at = now() returning 1')$$, '42501', null, 'et n''écrit aucune issue');
set local role anon;
select throws_ok('select cargo_lost from public.my_voyages', '42501', null, 'anon ne lit pas my_voyages');
reset role;
-- Droits de la fonction lus dans le catalogue : sans le `revoke` de la migration, ces deux tests échouent.
select ok(not has_function_privilege('anon', 'game.voyage_cargo_lost(uuid)', 'execute'),
  'anon n''a pas le droit d''appeler la fonction');
select ok(not has_function_privilege('public', 'game.voyage_cargo_lost(uuid)', 'execute'),
  'public non plus : seul authenticated l''appelle');
select ok(has_function_privilege('authenticated', 'game.voyage_cargo_lost(uuid)', 'execute'),
  'authenticated l''appelle');

select * from finish();
rollback;
