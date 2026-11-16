begin;
select plan(20);

-- Jeu d'essai : Alice a deux navires à Kallistè (101) et 100 blés à Kallistè, aucun stock à Elaia (103) ;
-- Bob a une maison, sans navire. L'arrivée est écrite ici comme l'étape du moteur l'écrit (#253).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000daa', 'arrivees-alice@example.test'),
  ('00000000-0000-4000-8000-000000000dab', 'arrivees-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-000000000da1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000000daa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-000000000db1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000000dab', 'Philaïdes', '{}');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id) values
  ('00000000-0000-7000-8000-000000000da5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000da1', 'coaster', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-000000000da6', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000da1', 'coaster', '01900000-0000-7000-8000-000000000101');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-000000000dc1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000da1', '01900000-0000-7000-8000-000000000101', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-000000000dc1', 'test');

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
-- L'étape ne parcourt que les voyages en mer, par monde et par échéance.
select is(pg_get_indexdef('game.voyages_due_idx'::regclass),
  'CREATE INDEX voyages_due_idx ON game.voyages USING btree (world_id, arrives_at) WHERE (arrived_at IS NULL)',
  'un index partiel porte les voyages en mer par échéance');
-- Plan d'une recherche dans les voyages du monde, parcours séquentiel et bitmap écartés : sur une table
-- presque vide, ils seraient moins chers, et l'on veut lire l'accès que l'index permet.
create function pg_temp.plan(predicate text) returns text language plpgsql as $$
declare
  line text;
  plan text := '';
begin
  set local enable_seqscan = off;
  set local enable_bitmapscan = off;
  for line in execute format($q$explain select id from game.voyages where world_id = '01900000-0000-7000-8000-000000000001'
    and %s order by arrives_at, id for update skip locked$q$, predicate) loop
    plan := plan || line || ' ';
  end loop;
  reset enable_seqscan;
  reset enable_bitmapscan;
  return plan;
end $$;
select matches(pg_temp.plan('arrived_at is null and arrives_at <= now()'), 'voyages_due_idx',
  'la recherche des voyages échus passe par cet index');
select doesnt_match(pg_temp.plan('arrived_at is not null and arrives_at <= now()'), 'voyages_due_idx',
  'il ne porte que les voyages en mer : la recherche des voyages arrivés ne peut pas s''en servir');

-- Départ d'Alice vers Elaia : 30 blés, un trajet d'une milliseconde ; son second navire part pour une heure, sur lest.
select lives_ok($$select pg_temp.settled($s$select pg_temp.as_service($q$
  insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
  select '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000da1', id,
         '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103',
         now() + case when id = '00000000-0000-7000-8000-000000000da5' then interval '1 millisecond' else interval '1 hour' end
  from game.ships where house_id = '00000000-0000-7000-8000-000000000da1';
  insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
  select id, world_id, 'wheat', 30 from game.voyages where ship_id = '00000000-0000-7000-8000-000000000da5';
  insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, voyage_id)
  select world_id, 'wheat', 30, '00000000-0000-7000-8000-000000000dc1', 'in_transit', 'voyage.departure', id
  from game.voyages where ship_id = '00000000-0000-7000-8000-000000000da5';
  update game.ships set docked_city_id = null where house_id = '00000000-0000-7000-8000-000000000da1'$q$)$s$)$$,
  'deux navires d''Alice prennent la mer');
do $$ begin perform pg_sleep(0.01); end $$;

-- Arrivée dans une transaction du moteur : datée d'un instant de tick passé, au plus tôt l'échéance, le navire
-- à quai à Elaia, le stock d'Alice à Elaia ouvert puis rempli de ce qui a été chargé.
select lives_ok($$select pg_temp.settled($s$select pg_temp.as_service($q$
  update game.voyages set arrived_at = arrives_at where ship_id = '00000000-0000-7000-8000-000000000da5';
  update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103' where id = '00000000-0000-7000-8000-000000000da5';
  insert into game.inventories (id, world_id, house_id, city_id, good_id) values ('00000000-0000-7000-8000-000000000de1',
    '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000da1', '01900000-0000-7000-8000-000000000103', 'wheat');
  insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind, voyage_id)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 30, 'in_transit', '00000000-0000-7000-8000-000000000de1',
          'voyage.arrival', (select id from game.voyages where ship_id = '00000000-0000-7000-8000-000000000da5'))$q$)$s$)$$,
  'arrivée, accostage et déchargement vers un stock ouvert dans la même transaction : cohérents à la validation');
select is(array(select quantity from game.inventories where house_id = '00000000-0000-7000-8000-000000000da1' order by city_id),
  array[70, 30]::bigint[], '70 blés restent à Kallistè, 30 sont arrivés à Elaia');
select is((select bool_and(ok) from game.inventory_quantity_check where world_id = '01900000-0000-7000-8000-000000000001'),
  true, 'chaque stock égale toujours ses entrées moins ses sorties');
select throws_ok($$select pg_temp.as_service($q$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind, voyage_id)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 30, 'in_transit', '00000000-0000-7000-8000-000000000de1', 'voyage.arrival',
          (select id from game.voyages where ship_id = '00000000-0000-7000-8000-000000000da5'))$q$)$$,
  '23505', null, 'la cargaison ne se décharge qu''une fois');
select throws_ok($$select pg_temp.as_service($q$update game.voyages set arrived_at = clock_timestamp() where ship_id = '00000000-0000-7000-8000-000000000da5'$q$)$$,
  '23001', 'an arrival is final', 'l''arrivée ne se redate pas');

-- Lecture : Alice voit son voyage arrivé, son navire à quai à Elaia et son nouveau stock ; Bob, rien de tout cela.
set local role anon;
select throws_ok('select * from public.my_inventories', '42501', null, 'anon ne lit aucun stock');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-000000000daa", "role": "authenticated"}';
select results_eq($$select ship_id, arrived_at = arrives_at from public.my_voyages order by ship_id$$,
  $$values ('00000000-0000-7000-8000-000000000da5'::uuid, true), ('00000000-0000-7000-8000-000000000da6'::uuid, null)$$,
  'Alice lit son arrivée, datée de son échéance, et son voyage encore en mer');
select results_eq($$select id, docked_city_id from public.my_ships order by id$$,
  $$values ('00000000-0000-7000-8000-000000000da5'::uuid, '01900000-0000-7000-8000-000000000103'::uuid),
           ('00000000-0000-7000-8000-000000000da6'::uuid, null::uuid)$$, 'son navire arrivé est à quai à Elaia');
select results_eq($$select city_id, quantity, reserved from public.my_inventories where city_id = '01900000-0000-7000-8000-000000000103'$$,
  $$values ('01900000-0000-7000-8000-000000000103'::uuid, 30::bigint, 0::bigint)$$, 'et son stock d''Elaia, libre');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-000000000dab", "role": "authenticated"}';
select is((select count(*) from public.my_voyages), 0::bigint, 'Bob ne lit pas le voyage d''Alice');
select is((select count(*) from public.my_inventories where house_id = '00000000-0000-7000-8000-000000000da1'), 0::bigint,
  'ni le stock qu''elle a reçu à Elaia');
select is((select count(*) from game.inventories), 0::bigint, 'même en interrogeant game');
select throws_ok($$update game.voyages set arrived_at = now() where ship_id = '00000000-0000-7000-8000-000000000da6'$$,
  '42501', null, 'Bob ne fait arriver aucun voyage');
select throws_ok($$update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103'$$,
  '42501', null, 'n''amarre aucun navire');
select throws_ok($$insert into game.inventories (world_id, house_id, city_id, good_id) values ('01900000-0000-7000-8000-000000000001',
  '00000000-0000-7000-8000-000000000db1', '01900000-0000-7000-8000-000000000103', 'wheat')$$, '42501', null, 'n''ouvre aucun stock');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind, voyage_id)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 30, 'in_transit', '00000000-0000-7000-8000-000000000de1', 'voyage.arrival',
          '00000000-0000-7000-8000-000000000000')$$, '42501', null, 'et ne décharge rien');
reset role;

select * from finish();
rollback;
