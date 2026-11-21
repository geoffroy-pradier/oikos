begin;
select plan(30);

-- Jeu d'essai : Alice a trois navires à Kallistè (101), 100 blés et 50 huiles à Kallistè, un stock de blé à
-- Elaia (103) ; Bob a une maison, sans navire. Départs et arrivées sont écrits ici comme l'API et le moteur
-- les écrivent (#730) : un voyage à risque de 2 500 points de base perd tout, un voyage sans risque ne perd
-- rien, un troisième, à risque, tente de perdre une partie seulement.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000730aaa', 'pertes-alice@example.test'),
  ('00000000-0000-4000-8000-000000730aab', 'pertes-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-000000730a01', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000730aaa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-000000730b01', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000730aab', 'Philaïdes', '{}');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id)
select ('00000000-0000-7000-8000-000000730a0' || n)::uuid, '01900000-0000-7000-8000-000000000001',
       '00000000-0000-7000-8000-000000730a01', 'coaster', '01900000-0000-7000-8000-000000000101'
from generate_series(5, 7) n;
-- Stocks : c1 blé et c2 huile à Kallistè, e1 blé et e2 huile à Elaia.
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-000000730c01', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000730a01', '01900000-0000-7000-8000-000000000101', 'wheat'),
  ('00000000-0000-7000-8000-000000730c02', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000730a01', '01900000-0000-7000-8000-000000000101', 'oil'),
  ('00000000-0000-7000-8000-000000730e01', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000730a01', '01900000-0000-7000-8000-000000000103', 'wheat'),
  ('00000000-0000-7000-8000-000000730e02', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000730a01', '01900000-0000-7000-8000-000000000103', 'oil');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-000000730c01', 'test'),
  ('01900000-0000-7000-8000-000000000001', 'oil', 50, 'production', '00000000-0000-7000-8000-000000730c02', 'test');

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
  $$select id from game.voyages where ship_id = ('00000000-0000-7000-8000-000000730a0' || ship)::uuid$$;
-- Sortie de `in_transit` d'un bien d'un voyage, sous le rôle de service : vers `lost_at_sea`, ou vers le stock donné.
create function pg_temp.out_of_transit(ship integer, good text, quantity integer, stock text default null) returns text
language sql as $$
  select format($s$select pg_temp.as_service($q$insert into game.stock_ledger
    (world_id, good_id, quantity, from_system, to_inventory_id, to_system, kind, voyage_id)
    values ('01900000-0000-7000-8000-000000000001', %L, %s, 'in_transit', %L, %L, %L, %L)$q$)$s$,
    good, quantity, stock::uuid, case when stock is null then 'lost_at_sea' end,
    case when stock is null then 'voyage.loss' else 'voyage.arrival' end, pg_temp.voyage(ship))
$$;
-- Arrivée d'un voyage à son échéance, navire à quai à Elaia, puis les mouvements donnés.
create function pg_temp.arrival(ship integer, movements text) returns text language sql as $$
  select format($s$select pg_temp.as_service($q$
    update game.voyages set arrived_at = arrives_at where id = %L;
    update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103' where id = %L$q$); %s$s$,
    pg_temp.voyage(ship), ('00000000-0000-7000-8000-000000730a0' || ship)::uuid, movements)
$$;

-- Le risque est une colonne du voyage, nulle par défaut (un départ du code précédent ne la donne pas), bornée.
select col_default_is('game', 'voyages', 'loss_risk_bps', '0', 'un voyage est sans risque par défaut');
select is((select tgdeferrable and tginitdeferred from pg_trigger where tgname = 'stock_ledger_voyage_loss'), true,
  'une perte est contrôlée à la validation, ligne par ligne');
select throws_ok($$select pg_temp.as_service($q$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at, loss_risk_bps)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000730a01', '00000000-0000-7000-8000-000000730a05',
          '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103', now() + interval '1 hour', 10001)$q$)$$,
  '23514', null, 'un risque dépasse au plus 10 000 points de base');

-- Départs : 5 (risque 2 500, 30 blés et 10 huiles), 6 (sans risque, 20 blés), 7 (risque 10 000, 10 blés et 5 huiles).
select lives_ok($$select pg_temp.settled($s$select pg_temp.as_service($q$
  insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at, loss_risk_bps)
  select '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000730a01', s.id,
         '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103', now() + interval '1 millisecond', r.risk
  from game.ships s join (values (5, 2500), (6, 0), (7, 10000)) r (ship, risk)
    on s.id = ('00000000-0000-7000-8000-000000730a0' || r.ship)::uuid;
  insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
  select v.id, v.world_id, c.good, c.quantity from game.voyages v
  join (values (5, 'wheat', 30), (5, 'oil', 10), (6, 'wheat', 20), (7, 'wheat', 10), (7, 'oil', 5)) c (ship, good, quantity)
    on v.ship_id = ('00000000-0000-7000-8000-000000730a0' || c.ship)::uuid;
  insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, voyage_id)
  select c.world_id, c.good_id, c.quantity,
         case c.good_id when 'wheat' then '00000000-0000-7000-8000-000000730c01'::uuid else '00000000-0000-7000-8000-000000730c02'::uuid end,
         'in_transit', 'voyage.departure', c.voyage_id
  from game.voyage_cargo c join game.voyages v on v.id = c.voyage_id where v.house_id = '00000000-0000-7000-8000-000000730a01';
  update game.ships set docked_city_id = null where house_id = '00000000-0000-7000-8000-000000730a01'$q$)$s$)$$,
  'trois navires d''Alice prennent la mer, chacun avec son risque');
select is(array(select loss_risk_bps from game.voyages where house_id = '00000000-0000-7000-8000-000000730a01' order by ship_id),
  array[2500, 0, 10000], 'chaque voyage garde le risque fixé à son départ');
select throws_ok($$update game.voyages set loss_risk_bps = 0 where id = pg_temp.voyage(5)$$,
  '23001', 'voyage identity is immutable', 'le risque ne change plus, même écrit par le propriétaire');
select throws_ok($$select pg_temp.as_service($q$update game.voyages set loss_risk_bps = 0 where id = pg_temp.voyage(5)$q$)$$,
  '42501', null, 'et le service n''a pas le droit de le récrire');
select throws_ok(pg_temp.out_of_transit(5, 'wheat', 30), '23001', 'a voyage unloads once arrived',
  'une cargaison ne se perd pas en mer, avant l''arrivée');
do $$ begin perform pg_sleep(0.01); end $$;

-- Gardes de l'extrémité : un puits à sens unique, alimenté par `in_transit` seulement ; un mouvement purement
-- système n'est admis que pour une perte.
select throws_ok($$select pg_temp.as_service($q$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, '00000000-0000-7000-8000-000000730c01', 'lost_at_sea', 'voyage.loss')$q$)$$,
  '23514', null, 'un stock ne se perd pas en mer sans voyage');
select throws_ok($$select pg_temp.as_service($q$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, 'lost_at_sea', '00000000-0000-7000-8000-000000730e01', 'voyage.test')$q$)$$,
  '23514', null, 'rien ne revient de lost_at_sea');
select throws_ok($$select pg_temp.as_service($q$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_system, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, 'production', 'consumption', 'test')$q$)$$,
  '23514', 'new row for relation "stock_ledger" violates check constraint "stock_ledger_touches_inventory"',
  'la perte reste le seul mouvement purement système');

-- Voyage sans risque : il ne perd rien, il décharge.
select throws_ok(pg_temp.arrival(6, pg_temp.out_of_transit(6, 'wheat', 20)), '23001',
  'a voyage loses its cargo only on a risky crossing', 'un voyage sans risque ne perd pas sa cargaison');
select lives_ok($$select pg_temp.settled(pg_temp.arrival(6, pg_temp.out_of_transit(6, 'wheat', 20, '00000000-0000-7000-8000-000000730e01')))$$,
  'il la décharge à Elaia');

-- Voyage à risque : toute la cargaison ou rien.
select throws_ok($$select pg_temp.settled(pg_temp.arrival(7, pg_temp.out_of_transit(7, 'wheat', 10) || ';'
  || pg_temp.out_of_transit(7, 'oil', 5, '00000000-0000-7000-8000-000000730e02')))$$, '23001', 'a voyage loses all its cargo or none',
  'une cargaison ne se perd pas à moitié : l''huile ne se décharge pas à côté du blé perdu');
select throws_ok($$select pg_temp.settled(pg_temp.arrival(7, pg_temp.out_of_transit(7, 'wheat', 10, '00000000-0000-7000-8000-000000730e01') || ';'
  || pg_temp.out_of_transit(7, 'oil', 5)))$$, '23001', 'a voyage loses all its cargo or none',
  'ni le blé déchargé à côté de l''huile perdue, quel que soit l''ordre');
select throws_ok($$select pg_temp.settled(pg_temp.arrival(7, pg_temp.out_of_transit(7, 'wheat', 10)))$$, '23001',
  'an arrived voyage unloads all its cargo', 'ni le blé perdu seul, l''huile restée en mer');
select throws_ok($$select pg_temp.settled(pg_temp.arrival(7, pg_temp.out_of_transit(7, 'wheat', 9) || ';' || pg_temp.out_of_transit(7, 'oil', 5)))$$,
  '23001', 'a voyage unloads exactly what it loaded', 'une perte emporte exactement ce qui a été chargé');

-- Perte entière du voyage 5 : rien ne touche les stocks d'Alice, le journal reste équilibré.
select lives_ok($$select pg_temp.settled(pg_temp.arrival(5, pg_temp.out_of_transit(5, 'wheat', 30) || ';' || pg_temp.out_of_transit(5, 'oil', 10)))$$,
  'arrivée du voyage 5, le navire à quai à Elaia, sa cargaison perdue : cohérent à la validation');
select is(array(select quantity from game.inventories where house_id = '00000000-0000-7000-8000-000000730a01' order by id),
  array[40, 35, 20, 0]::bigint[], 'Kallistè a chargé les trois voyages, Elaia n''a reçu que celui sans risque');
select is((select docked_city_id from game.ships where id = '00000000-0000-7000-8000-000000730a05'),
  '01900000-0000-7000-8000-000000000103'::uuid, 'le navire accoste à vide');
select is((select coalesce(sum(quantity) filter (where to_system = 'in_transit'), 0) - coalesce(sum(quantity) filter (where from_system = 'in_transit'), 0)
           from game.stock_ledger where voyage_id in (pg_temp.voyage(5), pg_temp.voyage(6))), 0::numeric,
  'plus rien n''est en transit pour les voyages arrivés : chaque unité chargée est déchargée ou perdue');
select is((select bool_and(ok) from game.inventory_quantity_check where world_id = '01900000-0000-7000-8000-000000000001'),
  true, 'chaque stock égale toujours ses entrées moins ses sorties');
select throws_ok(pg_temp.out_of_transit(5, 'wheat', 30), '23505', null, 'une cargaison ne se perd qu''une fois');
select throws_ok(pg_temp.out_of_transit(5, 'oil', 10, '00000000-0000-7000-8000-000000730e02'), '23505', null,
  'et ne se décharge plus après sa perte, même plus tard');

-- Lecture et écriture : Alice lit le risque de ses voyages, Bob ne lit ni n'écrit rien de tout cela.
set local role anon;
select throws_ok('select loss_risk_bps from game.voyages', '42501', null, 'anon ne lit aucun risque');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-000000730aaa", "role": "authenticated"}';
select results_eq($$select loss_risk_bps from game.voyages order by ship_id$$, $$values (2500), (0), (10000)$$,
  'Alice lit le risque de ses voyages');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-000000730aab", "role": "authenticated"}';
select is((select count(*) from game.voyages), 0::bigint, 'Bob ne lit le risque d''aucun voyage d''Alice');
select throws_ok('select voyage_id from game.stock_ledger', '42501', null, 'ni ses pertes au journal des stocks');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_system, kind, voyage_id)
  values ('01900000-0000-7000-8000-000000000001', 'oil', 5, 'in_transit', 'lost_at_sea', 'voyage.loss', '00000000-0000-7000-8000-000000000000')$$,
  '42501', null, 'il ne fait perdre aucune cargaison');
select throws_ok($$update game.voyages set loss_risk_bps = 10000$$, '42501', null, 'et ne change aucun risque');
reset role;

select * from finish();
rollback;
