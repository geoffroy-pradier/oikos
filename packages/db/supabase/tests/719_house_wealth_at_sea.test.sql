begin;
select plan(5);

-- Marchandises en mer (#719) : Alice a 100 blés à Kallistè (101, prix 8) et un navire ; Elaia (103) paie le blé 9 et n'a
-- jamais échangé d'olives. Elle part pour Elaia avec 30 blés et 4 olives, puis arrive.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000719aa', 'mer-alice@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000719a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000719aa', 'Alcméonides', '{}');
insert into game.accounts (world_id, kind, house_id) values
  ('01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000719a1');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id) values
  ('00000000-0000-7000-8000-0000000719a5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000719a1', 'coaster', '01900000-0000-7000-8000-000000000101');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000719c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000719a1', '01900000-0000-7000-8000-000000000101', 'wheat'),
  ('00000000-0000-7000-8000-0000000719c2', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000719a1', '01900000-0000-7000-8000-000000000101', 'olives');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-0000000719c1', 'test'),
  ('01900000-0000-7000-8000-000000000001', 'olives', 4, 'production', '00000000-0000-7000-8000-0000000719c2', 'test');
delete from game.observed_prices where world_id = '01900000-0000-7000-8000-000000000001';
insert into game.observed_prices (world_id, city_id, good_id, price, volume, window_seconds, observed_at) values
  ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'wheat', 8, 20, 86400, now()),
  ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'olives', 20, 20, 86400, now()),
  ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000103', 'wheat', 9, 20, 86400, now());

create function pg_temp.as_service(statement text) returns setof text language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  return query execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.settled(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
  set constraints all immediate;
  set constraints all deferred;
end $$;
-- Fortune d'Alice : valeur des stocks, stocks sans prix, fortune.
create function pg_temp.alice() returns text language sql as $$
  select string_agg(r, ' ') from pg_temp.as_service($q$select concat_ws(':', stock_value, unpriced_stocks, wealth)
    from game.house_wealth('01900000-0000-7000-8000-000000000001') where house_id = '00000000-0000-7000-8000-0000000719a1'$q$) r
$$;

select is(pg_temp.alice(), '880:0:880', 'à quai : 100 blés à 8 et 4 olives à 20 à Kallistè');
select lives_ok($$select pg_temp.settled($s$
  insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at) values
    ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000719a1', '00000000-0000-7000-8000-0000000719a5',
     '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103', now() + interval '1 millisecond');
  insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
  select v.id, v.world_id, g.good, g.quantity from game.voyages v, (values ('wheat', 30), ('olives', 4)) g (good, quantity)
  where v.ship_id = '00000000-0000-7000-8000-0000000719a5';
  insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, voyage_id)
  select v.world_id, g.good, g.quantity, g.inventory, 'in_transit', 'voyage.departure', v.id
  from game.voyages v, (values ('wheat', 30, '00000000-0000-7000-8000-0000000719c1'::uuid),
                               ('olives', 4, '00000000-0000-7000-8000-0000000719c2'::uuid)) g (good, quantity, inventory)
  where v.ship_id = '00000000-0000-7000-8000-0000000719a5';
  update game.ships set docked_city_id = null where id = '00000000-0000-7000-8000-0000000719a5'$s$)$$,
  'Alice prend la mer avec 30 blés et 4 olives');
-- En mer : la cargaison compte au prix de la cité d'arrivée (30 × 9), les olives sans prix à Elaia comptées à part ;
-- son départ ne fait donc pas tomber la fortune sous un plancher de liturgie.
select is(pg_temp.alice(), '830:1:830', 'en mer : 70 blés à 8 à quai, 30 blés à 9 d''Elaia en mer, olives sans prix à Elaia');
do $$ begin perform pg_sleep(0.01); end $$;
select lives_ok($$select pg_temp.settled($s$
  update game.voyages set arrived_at = arrives_at where ship_id = '00000000-0000-7000-8000-0000000719a5';
  update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103' where id = '00000000-0000-7000-8000-0000000719a5';
  insert into game.inventories (id, world_id, house_id, city_id, good_id) values
    ('00000000-0000-7000-8000-0000000719d1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000719a1', '01900000-0000-7000-8000-000000000103', 'wheat'),
    ('00000000-0000-7000-8000-0000000719d2', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000719a1', '01900000-0000-7000-8000-000000000103', 'olives');
  insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind, voyage_id)
  select v.world_id, g.good, g.quantity, 'in_transit', g.inventory, 'voyage.arrival', v.id
  from game.voyages v, (values ('wheat', 30, '00000000-0000-7000-8000-0000000719d1'::uuid),
                               ('olives', 4, '00000000-0000-7000-8000-0000000719d2'::uuid)) g (good, quantity, inventory)
  where v.ship_id = '00000000-0000-7000-8000-0000000719a5'$s$)$$,
  'Alice arrive à Elaia et décharge');
-- Arrivée : la cargaison ne compte plus en mer, une seule fois au stock d'Elaia, et la fortune redevient le bilan.
select is(pg_temp.alice() || ' ' || (select concat_ws(':', stock_value, unpriced_stocks) from public.my_balance_sheet
    where house_id = '00000000-0000-7000-8000-0000000719a1'),
  '830:1:830 830:1', 'arrivée : la cargaison au stock d''Elaia, comptée une fois ; fortune et bilan égaux');

select * from finish();
rollback;
