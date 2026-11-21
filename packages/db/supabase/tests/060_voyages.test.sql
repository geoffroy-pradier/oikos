begin;
select plan(39);

-- Jeu d'essai : Alice a trois navires à Kallistè (101), Bob un navire à Elaia (103). La cargaison entre
-- au journal des stocks, et les joueurs lisent leurs voyages, avec la migration 81 (test 061).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000006aa', 'voyages-alice@example.test'),
  ('00000000-0000-4000-8000-0000000006ab', 'voyages-bob@example.test');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000006f0', 'voyages-ailleurs', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000006f1', '01900000-0000-7000-8000-0000000006f0', 'ailleurs', 'Ailleurs');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000006a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000006aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000006b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000006ab', 'Philaïdes', '{}');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id) values
  ('00000000-0000-7000-8000-0000000006a5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', 'coaster', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000006a6', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', 'coaster', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000006a7', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', 'round_ship', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000006b5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006b1', 'coaster', '01900000-0000-7000-8000-000000000103');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Exécute une instruction puis valide les contrôles différés ; un refus annule l'instruction avec lui.
create function pg_temp.settled(statement text) returns void language plpgsql as $$
begin
  execute statement;
  set constraints all immediate;
  set constraints all deferred;
end $$;
-- Départ d'un navire d'Alice, sous le rôle de service : le voyage, puis le navire quitte le quai.
create function pg_temp.depart(ship text, from_city text, to_city text, due interval) returns text
language sql as $$
  select format($s$select pg_temp.as_service($q$
    insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
    values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', %L, %L, %L, now() + %L::interval);
    update game.ships set docked_city_id = null where id = %L$q$)$s$, ship, from_city, to_city, due, ship)
$$;

-- Droits, lus dans le catalogue.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('game.voyages'::regclass, 'game.voyage_cargo'::regclass)),
  'règles par ligne actives sur les voyages et leur cargaison');
select is(
  (select count(*) from pg_policies where schemaname = 'game' and tablename in ('voyages', 'voyage_cargo')
     and (cmd <> 'SELECT' or 'oikos_service' = any (roles)) and policyname <> 'service_all'),
  0::bigint, 'aucune règle d''écriture, sauf celle du service');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('voyages', 'voyage_cargo') and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'voyage_cargo.good_id:INSERT voyage_cargo.quantity:INSERT voyage_cargo.voyage_id:INSERT voyage_cargo.world_id:INSERT '
    || 'voyages.arrived_at:UPDATE voyages.arrives_at:INSERT voyages.from_city_id:INSERT voyages.house_id:INSERT voyages.loss_risk_bps:INSERT '
    || 'voyages.ship_id:INSERT voyages.to_city_id:INSERT voyages.world_id:INSERT',
  'le service fait partir un voyage sans en choisir ni l''identifiant ni la date, puis n''écrit que son arrivée : liste figée');
select ok(not has_table_privilege('oikos_service', 'game.voyages', 'delete')
  and not has_table_privilege('oikos_service', 'game.voyage_cargo', 'delete')
  and not has_any_column_privilege('oikos_service', 'game.voyage_cargo', 'update'), 'ni suppression, ni cargaison modifiée');
select ok(not exists (select 1 from pg_roles r, unnest(array['game.guard_voyage()', 'game.guard_voyage_cargo()', 'game.check_voyage_settled()', 'game.guard_ship()']) f
  where has_function_privilege(r.oid, f, 'execute') and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')),
  'personne n''exécute les gardes des voyages et des navires');

-- Départ, sous le rôle de service : le voyage part maintenant, le navire quitte le quai.
select lives_ok(pg_temp.depart('00000000-0000-7000-8000-0000000006a5', '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000103', '4 hours'), 'le service fait partir un navire de la cité où il est à quai');
select is((select departed_at = now() and arrived_at is null and arrives_at = now() + interval '4 hours'
           from game.voyages where ship_id = '00000000-0000-7000-8000-0000000006a5'), true, 'parti maintenant, en mer');
select lives_ok('set constraints all immediate', 'navire en mer, voyage en mer : cohérents à la validation');
set constraints all deferred;

-- Ce qu'un départ ne peut pas être.
select throws_ok(pg_temp.depart('00000000-0000-7000-8000-0000000006a5', '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000104', '4 hours'), '23001', 'a voyage departs from the city where its ship is docked',
  'un navire en mer ne repart pas');
select throws_ok($$select pg_temp.as_service($s$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at) values
  ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', '00000000-0000-7000-8000-0000000006a6', '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103', now() + interval '1 hour'),
  ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', '00000000-0000-7000-8000-0000000006a6', '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000104', now() + interval '1 hour')$s$)$$,
  '23505', null, 'deux voyages en mer du même navire : le second est refusé par la base');
select throws_ok(pg_temp.depart('00000000-0000-7000-8000-0000000006a6', '01900000-0000-7000-8000-000000000103',
  '01900000-0000-7000-8000-000000000101', '4 hours'), '23001', 'a voyage departs from the city where its ship is docked',
  'ni d''une autre cité que celle où il est à quai');
select throws_ok(pg_temp.depart('00000000-0000-7000-8000-0000000006a6', '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000101', '4 hours'), '23514', null, 'ni vers la cité d''où il part');
select throws_ok(pg_temp.depart('00000000-0000-7000-8000-0000000006a6', '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-0000000006f1', '4 hours'), '23503', null, 'ni vers une cité d''un autre monde');
select throws_ok($$select pg_temp.as_service($s$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', '00000000-0000-7000-8000-0000000006b5',
          '01900000-0000-7000-8000-000000000103', '01900000-0000-7000-8000-000000000101', now() + interval '1 hour')$s$)$$,
  '23503', null, 'ni avec le navire d''une autre maison');
select throws_ok($$select pg_temp.as_service($s$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at, departed_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', '00000000-0000-7000-8000-0000000006a6',
          '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103', now() + interval '1 hour', now() - interval '1 hour')$s$)$$,
  '42501', null, 'le service n''antidate pas un départ');
select throws_ok($$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at, departed_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', '00000000-0000-7000-8000-0000000006a6',
          '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103', now() + interval '1 hour', now() - interval '1 hour')$$,
  '23001', 'a voyage departs now', 'même le propriétaire de la table n''antidate pas un départ');
select throws_ok($$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at, arrived_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', '00000000-0000-7000-8000-0000000006a6',
          '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103', now() + interval '1 hour', now() + interval '1 hour')$$,
  '23001', 'a voyage departs at sea', 'ni ne le fait naître arrivé');
select throws_ok($$select pg_temp.settled($s$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006a1', '00000000-0000-7000-8000-0000000006a6',
          '01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103', now() + interval '1 hour')$s$)$$,
  '23001', 'a ship at sea is docked nowhere', 'un voyage dont le navire reste à quai est refusé à la validation');

-- Navire : désarmé par la transaction qui l'écrit, il ne part pas ; il ne change de quai que par la mer.
select lives_ok($$select pg_temp.as_service($s$update game.ships set laid_up_at = now() where id = '00000000-0000-7000-8000-0000000006a6'$s$)$$,
  'le service désarme un navire, daté de sa transaction');
select throws_ok(pg_temp.depart('00000000-0000-7000-8000-0000000006a6', '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000103', '4 hours'), '23001', 'a laid-up ship does not sail', 'un navire désarmé ne part pas');
select throws_ok($$update game.ships set laid_up_at = clock_timestamp() where id = '00000000-0000-7000-8000-0000000006a6'$$,
  '23001', 'a lay-up date does not change', 'la date du désarmement ne change plus');
select lives_ok($$select pg_temp.as_service($s$update game.ships set laid_up_at = null where id = '00000000-0000-7000-8000-0000000006a6'$s$)$$,
  'le service réarme un navire');
select throws_ok($$update game.ships set laid_up_at = now() - interval '1 day' where id = '00000000-0000-7000-8000-0000000006a6'$$,
  '23001', 'a ship is laid up by the transaction that writes it', 'un désarmement ne s''antidate pas');
select throws_ok($$update game.ships set laid_up_at = clock_timestamp() + interval '1 hour' where id = '00000000-0000-7000-8000-0000000006a6'$$,
  '23001', 'a ship is laid up by the transaction that writes it', 'ni ne se postdate');
select throws_ok($$update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103' where id = '00000000-0000-7000-8000-0000000006a6'$$,
  '23001', 'a ship moves only by sea', 'un navire ne passe pas d''un quai à un autre');
select throws_ok($$update game.ships set docked_city_id = null where id = '00000000-0000-7000-8000-0000000006a6'$$,
  '23001', 'a ship puts to sea on a departing voyage', 'ni ne prend la mer sans voyage');
select throws_ok($$update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103' where id = '00000000-0000-7000-8000-0000000006a5'$$,
  '23001', 'a ship docks where its voyage arrived', 'ni n''accoste avant l''arrivée de son voyage');

-- Arrivée : un voyage court (une milliseconde), écrit une fois, à l'échéance au plus tôt.
select lives_ok(pg_temp.depart('00000000-0000-7000-8000-0000000006a7', '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000103', '1 millisecond'), 'un navire rond part pour un trajet très court');
do $$ begin perform pg_sleep(0.01); end $$;
select throws_ok($$select pg_temp.as_service($s$update game.voyages set arrived_at = clock_timestamp() where ship_id = '00000000-0000-7000-8000-0000000006a5'$s$)$$,
  '23514', null, 'un voyage n''arrive pas avant son échéance');
select throws_ok($$update game.voyages set arrived_at = clock_timestamp() + interval '1 hour' where ship_id = '00000000-0000-7000-8000-0000000006a7'$$,
  '23001', 'a voyage does not arrive in the future', 'ni dans le futur');
select lives_ok($$select pg_temp.as_service($s$update game.voyages set arrived_at = clock_timestamp() where ship_id = '00000000-0000-7000-8000-0000000006a7'$s$)$$,
  'le service écrit l''arrivée d''un voyage échu');
select throws_ok('set constraints all immediate', '23001', 'an arrived ship is docked in the arrival city',
  'arrivé, le navire doit être à quai à la validation');
set constraints all deferred;
select throws_ok($$update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000104' where id = '00000000-0000-7000-8000-0000000006a7'$$,
  '23001', 'a ship docks where its voyage arrived', 'dans la cité d''arrivée, pas ailleurs');
select lives_ok($$select pg_temp.as_service($s$update game.ships set docked_city_id = '01900000-0000-7000-8000-000000000103' where id = '00000000-0000-7000-8000-0000000006a7'$s$)$$,
  'le service met le navire à quai dans la cité d''arrivée');
select lives_ok('set constraints all immediate', 'arrivé et à quai : cohérents à la validation');
set constraints all deferred;
select throws_ok($$update game.voyages set arrived_at = clock_timestamp() where ship_id = '00000000-0000-7000-8000-0000000006a7'$$,
  '23001', 'an arrival is final', 'une arrivée ne se réécrit pas');
select throws_ok($$update game.voyages set to_city_id = '01900000-0000-7000-8000-000000000104' where ship_id = '00000000-0000-7000-8000-0000000006a7'$$,
  '23001', 'voyage identity is immutable', 'ni sa destination');
select throws_ok($$select pg_temp.as_service($s$insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
  select id, world_id, 'oil', 5 from game.voyages where ship_id = '00000000-0000-7000-8000-0000000006a7'$s$)$$,
  '23001', 'a voyage is loaded when it departs', 'un voyage arrivé ne charge plus rien');
select throws_ok($$delete from game.voyages$$, '23001', 'game.voyages is append-only', 'un voyage ne s''efface pas');

select * from finish();
rollback;
