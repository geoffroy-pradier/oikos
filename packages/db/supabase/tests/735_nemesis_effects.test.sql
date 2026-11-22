begin;
select plan(27);

-- Jeu d'essai : un monde à lui, Kallistè (k) et Elaia (l). Alice (a) a 100 blés et 40 huiles à Kallistè, un atelier
-- et un navire à quai ; Bob (b) a un navire. Les présages sont adressés au jour 300 et frappent au jour 303 ; les
-- mouvements sont écrits comme le moteur les écrit (#735).
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000735e0', 'nemesis-e-735', 'Némésis');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000735e1', '01900000-0000-7000-8000-0000000735e0', 'k735e', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000735e2', '01900000-0000-7000-8000-0000000735e0', 'l735e', 'Elaia');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000735e' || n || n)::uuid, 'nemesis-e-735-' || n || '@example.test' from unnest(array['a', 'b']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-000000735e' || n || '1')::uuid, '01900000-0000-7000-8000-0000000735e0',
       ('00000000-0000-4000-8000-000000735e' || n || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes')) h (n, name);
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-000000735ec1', '01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735ea1', '01900000-0000-7000-8000-0000000735e1', 'wheat'),
  ('00000000-0000-7000-8000-000000735ec2', '01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735ea1', '01900000-0000-7000-8000-0000000735e1', 'oil'),
  ('00000000-0000-7000-8000-000000735ec3', '01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735ea1', '01900000-0000-7000-8000-0000000735e2', 'wheat'),
  ('00000000-0000-7000-8000-000000735ec4', '01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735eb1', '01900000-0000-7000-8000-0000000735e1', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-0000000735e0', 'wheat', 100, 'production', '00000000-0000-7000-8000-000000735ec1', 'test'),
  ('01900000-0000-7000-8000-0000000735e0', 'oil', 40, 'production', '00000000-0000-7000-8000-000000735ec2', 'test'),
  ('01900000-0000-7000-8000-0000000735e0', 'wheat', 20, 'production', '00000000-0000-7000-8000-000000735ec4', 'test');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-000000735ed1', '01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735ea1', '01900000-0000-7000-8000-0000000735e1', 'grow_wheat');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id) values
  ('00000000-0000-7000-8000-000000735ef1', '01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735ea1', 'coaster', '01900000-0000-7000-8000-0000000735e1'),
  ('00000000-0000-7000-8000-000000735ef2', '01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735eb1', 'coaster', '01900000-0000-7000-8000-0000000735e1');
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000e735', '{}');

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
create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-000000735e' || n || '1')::uuid
$$;
create function pg_temp.omen_id(n text) returns uuid language sql as $$
  select id from game.nemesis_omens where house_id = pg_temp.house(n)
$$;
create function pg_temp.voyage(n text) returns uuid language sql as $$
  select id from game.voyages where house_id = pg_temp.house(n)
$$;
create function pg_temp.close(day int) returns void language sql as $$
  insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-0000000735e0', day, now() - interval '1 hour', '00000000-0000-7000-8000-00000000e735')
$$;
-- Sanction de `n` au jour 303 : la jauge redescend de 10, et `fields` complète l'issue.
create function pg_temp.strike(n text, fields text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.hubris_ledger (world_id, house_id, amount, cause, game_day) values (%L, %L, 50, ''wealth'', 303), (%L, %L, -10, ''nemesis'', 303);
     update game.nemesis_omens set outcome = ''struck'', settled_day = 303, relief = 10, %s where id = %L',
    '01900000-0000-7000-8000-0000000735e0', pg_temp.house(n), '01900000-0000-7000-8000-0000000735e0', pg_temp.house(n),
    fields, pg_temp.omen_id(n)))
$$;
-- Mouvement vers `nemesis`, au nom du service : depuis le stock `stock`, ou depuis `in_transit` pour le voyage de `n`.
create function pg_temp.burn(n text, good text, quantity int, stock text = null) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, from_system, to_system, kind, voyage_id, nemesis_id)
     values (%L, %L, %s, %L, %L, ''nemesis'', %L, %L, %L)', '01900000-0000-7000-8000-0000000735e0', good, quantity,
    stock::uuid, case when stock is null then 'in_transit' end,
    case when stock is null then 'nemesis.ship_lost' else 'nemesis.fire' end,
    case when stock is null then pg_temp.voyage(n) end, pg_temp.omen_id(n)))
$$;

-- Bob prend la mer avec 20 blés, pour une arrivée imminente.
select lives_ok($$select pg_temp.settled($s$select pg_temp.as_service($q$
  insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
  values ('01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735eb1', '00000000-0000-7000-8000-000000735ef2',
          '01900000-0000-7000-8000-0000000735e1', '01900000-0000-7000-8000-0000000735e2', now() + interval '1 millisecond');
  insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
  select id, world_id, 'wheat', 20 from game.voyages where house_id = '00000000-0000-7000-8000-000000735eb1';
  insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, voyage_id)
  select world_id, 'wheat', 20, '00000000-0000-7000-8000-000000735ec4', 'in_transit', 'voyage.departure', id
  from game.voyages where house_id = '00000000-0000-7000-8000-000000735eb1';
  update game.ships set docked_city_id = null where id = '00000000-0000-7000-8000-000000735ef2'$q$)$s$)$$,
  'Bob prend la mer avec 20 blés');
-- Présages du jour 300 : incendie pour Alice, navire perdu pour Bob.
select lives_ok($$select pg_temp.as_service($q$
  insert into game.nemesis_omens (world_id, house_id, model, text_fr, text_en, omen_day, due_day)
  values ('01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735ea1', 'warehouse_fire', 'Fumée', 'Smoke', 300, 303),
         ('01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735eb1', 'ship_lost', 'Écume', 'Foam', 300, 303)$q$)$$,
  'deux présages, adressés par la clôture du jour 300');
select pg_temp.close(300);

-- Le puits à sens unique : rien n'en revient, rien n'y va sans présage frappé.
select throws_ok($$select pg_temp.as_service($q$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind)
  values ('01900000-0000-7000-8000-0000000735e0', 'wheat', 1, '00000000-0000-7000-8000-000000735ec1', 'nemesis', 'nemesis.fire')$q$)$$,
  '23514', null, 'un mouvement vers nemesis nomme son présage');
select throws_ok($$select pg_temp.as_service($q$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-0000000735e0', 'wheat', 1, 'nemesis', '00000000-0000-7000-8000-000000735ec1', 'test')$q$)$$,
  '23514', null, 'rien ne revient de nemesis');
select throws_ok(pg_temp.burn('a', 'wheat', 10, '00000000-0000-7000-8000-000000735ec1'), '23001',
  'goods go to nemesis only as its struck sanction takes them', 'un présage en attente ne prend rien');

-- Incendie d'Alice : 30 blés de son stock de Kallistè.
select throws_ok(pg_temp.strike('a', 'magnitude_bps = 3000, quantity = 30, inventory_id = ''00000000-0000-7000-8000-000000735ec4'''),
  '23001', 'a fire burns a stock of its house', 'l''incendie ne brûle que le stock de sa maison');
select lives_ok(pg_temp.strike('a', 'magnitude_bps = 3000, quantity = 30, inventory_id = ''00000000-0000-7000-8000-000000735ec1'''),
  'l''incendie d''Alice frappe');
select throws_ok(pg_temp.burn('a', 'wheat', 29, '00000000-0000-7000-8000-000000735ec1'), '23001',
  'goods go to nemesis only as its struck sanction takes them', 'il détruit exactement la quantité du présage');
select throws_ok(pg_temp.burn('a', 'oil', 30, '00000000-0000-7000-8000-000000735ec2'), '23001',
  'goods go to nemesis only as its struck sanction takes them', 'et du stock que nomme le présage');
select throws_ok('set constraints game.nemesis_omens_effects immediate', '23001', 'a fire destroys its share of the stock',
  'à la validation, un incendie frappé a détruit sa part');
select lives_ok(pg_temp.burn('a', 'wheat', 30, '00000000-0000-7000-8000-000000735ec1'), 'les 30 blés partent à nemesis');
select throws_ok(pg_temp.burn('a', 'wheat', 30, '00000000-0000-7000-8000-000000735ec1'), '23505', null, 'une fois');

-- Navire perdu de Bob : frappé en mer, sa cargaison part à nemesis à l'arrivée, et nulle part ailleurs.
select lives_ok(pg_temp.strike('b', 'voyage_id = ' || quote_literal(pg_temp.voyage('b'))), 'le navire de Bob est perdu');
select pg_temp.close(303);
select lives_ok('set constraints all immediate', 'à la validation : clôture, jauges, incendie, voyage frappé en mer');
set constraints all deferred;
select is((select quantity from game.inventories where id = '00000000-0000-7000-8000-000000735ec1'), 70::bigint,
  'le stock de blé d''Alice tombe de 100 à 70');
select throws_ok(pg_temp.burn('b', 'wheat', 20), '23001', 'a voyage unloads once arrived',
  'la cargaison reste en mer jusqu''à l''arrivée');
do $$ begin perform pg_sleep(0.01); end $$;
create function pg_temp.arrive(movement text) returns text language sql as $$
  select format('select pg_temp.settled(%L)', format($s$select pg_temp.as_service($q$
    update game.voyages set arrived_at = arrives_at where id = %L;
    update game.ships set docked_city_id = '01900000-0000-7000-8000-0000000735e2' where id = '00000000-0000-7000-8000-000000735ef2'$q$); %s$s$,
    pg_temp.voyage('b'), movement))
$$;
select throws_ok(pg_temp.arrive(format($s$select pg_temp.as_service($q$insert into game.stock_ledger
    (world_id, good_id, quantity, from_system, to_inventory_id, kind, voyage_id)
    values ('01900000-0000-7000-8000-0000000735e0', 'wheat', 20, 'in_transit', '00000000-0000-7000-8000-000000735ec4', 'voyage.arrival', %L)$q$)$s$,
    pg_temp.voyage('b'))), '23001', 'a ship struck by Nemesis loses all its cargo to it, and no other does',
  'un navire frappé ne décharge rien');
select throws_ok(pg_temp.arrive(replace(pg_temp.burn('b', 'wheat', 20), '20,', '19,')), '23001',
  'a voyage unloads exactly what it loaded', 'il perd exactement ce qu''il a chargé');
select lives_ok(pg_temp.arrive(pg_temp.burn('b', 'wheat', 20)), 'à l''arrivée, ses 20 blés partent à nemesis : cohérent');
select is((select coalesce(sum(quantity) filter (where to_system = 'in_transit'), 0)
                  - coalesce(sum(quantity) filter (where from_system = 'in_transit'), 0)
           from game.stock_ledger where voyage_id = pg_temp.voyage('b')), 0::numeric, 'plus rien n''est en transit');
select is((select bool_and(ok) from game.inventory_quantity_check where world_id = '01900000-0000-7000-8000-0000000735e0'),
  true, 'chaque stock égale toujours ses entrées moins ses sorties');

-- Désertion : un nouveau présage pour Alice au jour 304, qui frappe son atelier au jour 307 jusqu'à la clôture suivante.
select lives_ok($$select pg_temp.as_service($q$
  insert into game.nemesis_omens (world_id, house_id, model, text_fr, text_en, omen_day, due_day)
  values ('01900000-0000-7000-8000-0000000735e0', '00000000-0000-7000-8000-000000735ea1', 'artisan_desertion', 'Outils', 'Tools', 304, 307)$q$)$$,
  'un présage de désertion pour Alice');
select pg_temp.close(304);
create function pg_temp.desert(halt boolean) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.hubris_ledger (world_id, house_id, amount, cause, game_day) values (%L, %L, -5, ''nemesis'', 307);
     update game.nemesis_omens set outcome = ''struck'', settled_day = 307, relief = 5, site_id = %L,
       resumes_at = now() + interval ''1 day'' where id = (select id from game.nemesis_omens
       where world_id = ''01900000-0000-7000-8000-0000000735e0'' and model = ''artisan_desertion'');
     %s', '01900000-0000-7000-8000-0000000735e0', pg_temp.house('a'), '00000000-0000-7000-8000-000000735ed1',
    case when halt then 'update game.sites set halted_at = now() where id = ''00000000-0000-7000-8000-000000735ed1''' else '' end))
$$;
select throws_ok(pg_temp.desert(false) || '; select pg_temp.close(307); set constraints all immediate', '23001',
  'a deserted workshop halts with its sanction', 'à la validation, un atelier déserté s''est arrêté avec la sanction');
select lives_ok(pg_temp.desert(true) || '; select pg_temp.close(307); set constraints all immediate',
  'l''atelier d''Alice s''arrête avec la sanction');
set constraints all deferred;
select throws_ok($$select pg_temp.as_service(format($q$insert into game.stock_ledger
    (world_id, good_id, quantity, from_inventory_id, to_system, kind, nemesis_id)
  values ('01900000-0000-7000-8000-0000000735e0', 'oil', 1, '00000000-0000-7000-8000-000000735ec2', 'nemesis', 'nemesis.fire', %L)$q$,
  (select id from game.nemesis_omens where world_id = '01900000-0000-7000-8000-0000000735e0' and model = 'artisan_desertion')))$$,
  '23001', 'goods go to nemesis only as its struck sanction takes them',
  'une sanction frappée qui ne brûle ni ne perd de navire n''envoie aucun bien à nemesis');
select throws_ok($$select pg_temp.as_service('update game.sites set halted_at = null where id = ''00000000-0000-7000-8000-000000735ed1''')$$,
  '23514', 'a deserted workshop waits for the next close', 'il ne repart pas avant l''instant de reprise, même relancé');
select throws_ok($$update game.sites set halted_at = null where id = '00000000-0000-7000-8000-000000735ed1'$$,
  '23514', 'a deserted workshop waits for the next close', 'quel que soit le rôle');

select * from finish();
rollback;
