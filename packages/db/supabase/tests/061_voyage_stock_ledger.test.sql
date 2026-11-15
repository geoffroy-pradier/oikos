begin;
select plan(45);

-- Jeu d'essai : Alice a deux navires à Kallistè (101) et des stocks à Kallistè, Elaia (103) et Ampelos
-- (104) ; Bob a un navire à Elaia et des stocks à Kallistè et Elaia ; Chloé n'a pas de maison.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000007aa', 'cargaison-alice@example.test'),
  ('00000000-0000-4000-8000-0000000007ab', 'cargaison-bob@example.test'),
  ('00000000-0000-4000-8000-0000000007ac', 'cargaison-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000007a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000007aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000007b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000007ab', 'Philaïdes', '{}');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id) values
  ('00000000-0000-7000-8000-0000000007a5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007a1', 'coaster', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000007a6', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007a1', 'coaster', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000007b5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007b1', 'coaster', '01900000-0000-7000-8000-000000000103');
-- Stocks : 7x1 blé, 7x2 huile ; x = c (Alice, Kallistè), e (Alice, Elaia), d (Alice, Ampelos), b (Bob, Kallistè), f (Bob, Elaia).
insert into game.inventories (id, world_id, house_id, city_id, good_id)
select ('00000000-0000-7000-8000-0000000007' || place || good)::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-7000-8000-0000000007' || house)::uuid, ('01900000-0000-7000-8000-000000000' || city)::uuid,
       case good when '1' then 'wheat' else 'oil' end
from (values ('c', 'a1', '101'), ('e', 'a1', '103'), ('d', 'a1', '104'), ('b', 'b1', '101'), ('f', 'b1', '103')) p (place, house, city),
     (values ('1'), ('2')) g (good);
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-0000000007c1', 'test'),
  ('01900000-0000-7000-8000-000000000001', 'oil', 50, 'production', '00000000-0000-7000-8000-0000000007c2', 'test'),
  ('01900000-0000-7000-8000-000000000001', 'wheat', 40, 'production', '00000000-0000-7000-8000-0000000007b1', 'test');

-- Une version en vigueur avec une route et un droit de port, que les joueurs lisent par `ship_rules`.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c7a1',
  '{"ships": {"classes": [], "routes": [{"cities": ["kalliste", "elaia"], "hours": 4, "provisionsOboles": {}}],
    "portDues": {"byClassOboles": {}, "burnShareBps": 5000, "cityCoefficientBps": {"elaia": 12500}}}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c7a1', now());

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
-- Voyage en mer d'un navire d'Alice : son identifiant.
create function pg_temp.voyage(ship text) returns uuid language sql as
  $$select id from game.voyages where ship_id = ('00000000-0000-7000-8000-0000000007' || ship)::uuid$$;
-- Mouvement de stock d'un voyage, sous le rôle de service. `stock` : le stock touché ; `loading` : vers
-- l'extrémité `in_transit` (sinon depuis elle).
create function pg_temp.move(ship text, good text, quantity integer, stock text, loading boolean) returns text
language sql as $$
  select format($s$select pg_temp.as_service($q$insert into game.stock_ledger
    (world_id, good_id, quantity, from_inventory_id, from_system, to_inventory_id, to_system, kind, voyage_id)
    values ('01900000-0000-7000-8000-000000000001', %L, %s, %L, %L, %L, %L, 'voyage.test', %L)$q$)$s$,
    good, quantity, case when loading then '00000000-0000-7000-8000-0000000007' || stock end,
    case when loading then null else 'in_transit' end,
    case when loading then null else '00000000-0000-7000-8000-0000000007' || stock end,
    case when loading then 'in_transit' end, pg_temp.voyage(ship))
$$;
create function pg_temp.quantity(stock text) returns bigint language sql as
  $$select quantity from game.inventories where id = ('00000000-0000-7000-8000-0000000007' || stock)::uuid$$;
-- Départ d'un navire d'Alice : le voyage, sa cargaison, puis le navire quitte le quai.
create function pg_temp.depart(ship text, to_city text, due interval, cargo text) returns void language plpgsql as $$
begin
  perform pg_temp.as_service(format($q$
    insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
    values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007a1', '00000000-0000-7000-8000-0000000007%s',
            '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000%s', now() + %L::interval);
    insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
    select v.id, v.world_id, c.good, c.quantity from game.voyages v, (values %s) c (good, quantity)
    where v.ship_id = '00000000-0000-7000-8000-0000000007%s';
    update game.ships set docked_city_id = null where id = '00000000-0000-7000-8000-0000000007%s'$q$,
    ship, to_city, due, cargo, ship, ship));
end $$;

-- Le second navire d'Alice part avec 10 blés et charge `quantity` unités de `good` depuis le stock `stock`.
create function pg_temp.departs_loading(good text, quantity integer, stock text) returns void language plpgsql as $$
begin
  perform pg_temp.depart('a6', '103', '4 hours', $c$('wheat', 10)$c$);
  execute pg_temp.move('a6', good, quantity, stock, true);
end $$;

-- Droits et puits.
select ok(not exists (select 1 from pg_roles r where has_function_privilege(r.oid, 'game.check_voyage_stock_movement()', 'execute')
  and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')), 'personne n''exécute la garde du chargement');
select is(
  (select count(*) from game.worlds w, unnest(array['sink_voyage_provisions', 'sink_port_dues', 'sink_ship_upkeep']) k
   where not exists (select 1 from game.accounts a where a.world_id = w.id and a.system_key = k and not a.allow_negative)),
  0::bigint, 'chaque monde a ses puits de provisions, de droit de port et d''entretien des navires, jamais débiteurs');
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('voyages', 'voyage_cargo')),
  'voyage_cargo:service_all:ALL:oikos_service voyage_cargo:voyage_cargo_read_own:SELECT:authenticated '
    || 'voyages:service_all:ALL:oikos_service voyages:voyages_read_own:SELECT:authenticated',
  'une règle de lecture pour les joueurs, aucune d''écriture');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'my_voyages' and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'vue en lecture seule, rien pour un visiteur anonyme');

-- Chargement : le stock libre d'Alice à Kallistè sort vers l'extrémité `in_transit`, rattachée au voyage.
select pg_temp.depart('a5', '103', '4 hours', $$('wheat', 30), ('oil', 20)$$);
select lives_ok(pg_temp.move('a5', 'wheat', 30, 'c1', true), 'le service charge le blé de la cargaison');
select lives_ok(pg_temp.move('a5', 'oil', 20, 'c2', true), 'puis l''huile');
select is(array[pg_temp.quantity('c1'), pg_temp.quantity('c2')], array[70, 30]::bigint[], 'les stocks de Kallistè ont diminué d''autant');
select lives_ok('set constraints all immediate', 'toute la cargaison est chargée : le voyage est cohérent à la validation');
set constraints all deferred;
select throws_ok(pg_temp.move('a5', 'wheat', 30, 'c1', true), '23505', null, 'un bien ne se charge qu''une fois');
select throws_ok($$select pg_temp.settled($s$select pg_temp.depart('a6', '103', '4 hours', $c$('wheat', 10)$c$)$s$)$$,
  '23001', 'a voyage loads all its cargo', 'une cargaison non chargée est refusée à la validation');
select throws_ok($$select pg_temp.departs_loading('wheat', 9, 'c1')$$,
  '23001', 'a voyage loads exactly its cargo', 'ni plus ni moins que sa cargaison');
select throws_ok($$select pg_temp.departs_loading('oil', 10, 'c2')$$,
  '23001', 'a voyage loads exactly its cargo', 'ni un bien hors de sa cargaison');
select throws_ok($$select pg_temp.departs_loading('wheat', 10, 'b1')$$,
  '23001', 'a voyage loads from its house stock in its departure city', 'ni depuis le stock d''une autre maison');
select throws_ok($$select pg_temp.departs_loading('wheat', 10, 'e1')$$,
  '23001', 'a voyage loads from its house stock in its departure city', 'ni depuis son stock d''une autre cité');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, '00000000-0000-7000-8000-0000000007c1', 'in_transit', 'voyage.test')$$,
  '23514', null, 'l''extrémité in_transit n''existe pas hors d''un voyage');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind, voyage_id)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, 'production', '00000000-0000-7000-8000-0000000007c1', 'test', pg_temp.voyage('a5'))$$,
  '23514', null, 'et un voyage ne se rattache qu''à un mouvement de cette extrémité');
select throws_ok(pg_temp.move('a5', 'wheat', 30, 'e1', false), '23001', 'a voyage unloads once arrived', 'en mer, rien ne se décharge');
select throws_ok($$update game.voyage_cargo set quantity = 31$$, '23001', 'game.voyage_cargo is append-only', 'une cargaison ne change pas');

-- Le stock en mer n'est dans aucun stock de la maison : rien ne peut le réserver ni le vendre.
select is((select sum(quantity) from game.inventories where house_id = '00000000-0000-7000-8000-0000000007a1' and good_id = 'wheat'),
  70::numeric, 'le blé en mer n''est dans aucun stock d''Alice');
select throws_ok($$insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-0000000007a1',
          'wheat', 'sell', 5, 71, 71)$$, '23514', null, 'une vente ne réserve pas plus que le stock à quai');

-- Arrivée et déchargement, vers le stock d'Alice dans la cité d'arrivée, exactement ce qui a été chargé.
select pg_temp.depart('a6', '103', '1 millisecond', $$('wheat', 10)$$);
select lives_ok(pg_temp.move('a6', 'wheat', 10, 'c1', true), 'un second navire charge du blé pour un trajet très court');
do $$ begin perform pg_sleep(0.01); end $$;
select lives_ok($$select pg_temp.as_service($s$update game.voyages set arrived_at = clock_timestamp() where ship_id = '00000000-0000-7000-8000-0000000007a6';
  update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103' where id = '00000000-0000-7000-8000-0000000007a6'$s$)$$,
  'il arrive à Elaia et y est à quai');
select throws_ok('set constraints all immediate', '23001', 'an arrived voyage unloads all its cargo',
  'arrivé, un voyage doit avoir déchargé toute sa cargaison à la validation');
set constraints all deferred;
select throws_ok(pg_temp.move('a6', 'wheat', 10, 'd1', false), '23001', 'a voyage unloads into its house stock in its arrival city',
  'rien ne se décharge dans une autre cité');
select throws_ok(pg_temp.move('a6', 'wheat', 10, 'f1', false), '23001', 'a voyage unloads into its house stock in its arrival city',
  'ni dans le stock d''une autre maison');
select throws_ok(pg_temp.move('a6', 'wheat', 11, 'e1', false), '23001', 'a voyage unloads exactly what it loaded',
  'ni plus que ce qui a été chargé');
select throws_ok(pg_temp.move('a6', 'oil', 10, 'e2', false), '23001', 'a voyage unloads exactly what it loaded',
  'ni un bien qui n''a pas été chargé');
select lives_ok(pg_temp.move('a6', 'wheat', 10, 'e1', false), 'le service décharge le blé à Elaia');
select throws_ok(pg_temp.move('a6', 'wheat', 10, 'e1', false), '23505', null, 'une seule fois');
select is(pg_temp.quantity('e1'), 10::bigint, 'le stock d''Alice à Elaia a reçu la cargaison');
select lives_ok('set constraints all immediate', 'arrivé, à quai et déchargé : le voyage est cohérent à la validation');
set constraints all deferred;
select throws_ok(pg_temp.move('a6', 'wheat', 10, 'c1', true), '23001', 'a voyage is loaded when it departs',
  'un voyage arrivé ne charge plus rien');
select is((select bool_and(ok) from game.inventory_quantity_check where world_id = '01900000-0000-7000-8000-000000000001'),
  true, 'chaque stock égale toujours ses entrées moins ses sorties');

-- Bob fait partir son navire sur lest, sans cargaison.
select lives_ok($$select pg_temp.settled($s$select pg_temp.as_service($q$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007b1', '00000000-0000-7000-8000-0000000007b5',
          '01900000-0000-7000-8000-000000000103', '01900000-0000-7000-8000-000000000104', now() + interval '5 hours');
  update game.ships set docked_city_id = null where id = '00000000-0000-7000-8000-0000000007b5'$q$)$s$)$$, 'un navire part sur lest');

-- Lecture : chacun ses voyages, cargaison comprise, par la vue.
set local role anon;
select throws_ok('select * from public.my_voyages', '42501', null, 'anon ne lit aucun voyage');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000007aa", "role": "authenticated"}';
select results_eq($$select ship_id, from_city_id, to_city_id, arrived_at is not null, cargo from public.my_voyages order by ship_id$$,
  $$values ('00000000-0000-7000-8000-0000000007a5'::uuid, '01900000-0000-7000-8000-000000000101'::uuid, '01900000-0000-7000-8000-000000000103'::uuid, false,
            '[{"goodId": "oil", "quantity": 20}, {"goodId": "wheat", "quantity": 30}]'::jsonb),
           ('00000000-0000-7000-8000-0000000007a6'::uuid, '01900000-0000-7000-8000-000000000101'::uuid, '01900000-0000-7000-8000-000000000103'::uuid, true,
            '[{"goodId": "wheat", "quantity": 10}]'::jsonb)$$,
  'Alice lit ses deux voyages et leur cargaison');
select results_eq($$select ships -> 'routes', ships -> 'portDues' from public.ship_rules$$,
  $$values ('[{"cities": ["kalliste", "elaia"], "hours": 4, "provisionsOboles": {}}]'::jsonb,
            '{"byClassOboles": {}, "burnShareBps": 5000, "cityCoefficientBps": {"elaia": 12500}}'::jsonb)$$,
  'règles publiques : routes et tarifs du transport, dans la section des navires de ship_rules');
select is((select count(*) from game.voyages where house_id = '00000000-0000-7000-8000-0000000007b1'), 0::bigint,
  'pas le voyage de Bob, même en interrogeant game');
select throws_ok('select world_id from game.voyages', '42501', null, 'colonnes internes illisibles');
select throws_ok('select voyage_id from game.stock_ledger', '42501', null, 'ni le journal des stocks');
select throws_ok($$update public.my_voyages set arrived_at = now()$$, '42501', null, 'pas d''arrivée écrite par la vue');
select throws_ok($$insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
  select id, '01900000-0000-7000-8000-000000000001', 'gold', 1 from game.voyages$$, '42501', null, 'ni de cargaison ajoutée');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000007ab", "role": "authenticated"}';
select results_eq('select ship_id, cargo from public.my_voyages',
  $$values ('00000000-0000-7000-8000-0000000007b5'::uuid, '[]'::jsonb)$$, 'Bob ne lit que son voyage sur lest');
select is((select count(*) from game.voyage_cargo), 0::bigint, 'et aucune cargaison d''Alice');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000007ac", "role": "authenticated"}';
select is((select count(*) from public.my_voyages), 0::bigint, 'un compte sans maison ne voit aucun voyage');
reset role;

select * from finish();
rollback;
