begin;
select plan(20);

-- Jeu d'essai : Alice et Bob ont chacun une maison, un site et un intendant en poste (Nikias, Kléon) ; Chloé n'a
-- pas de maison. Les ordres sont des achats, qui n'engagent aucun stock : le séquestre, contrôlé à la validation,
-- ne l'est jamais ici (la transaction est annulée).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000042aa', 'steward-orders-alice@example.test'),
  ('00000000-0000-4000-8000-0000000042ab', 'steward-orders-bob@example.test'),
  ('00000000-0000-4000-8000-0000000042ac', 'steward-orders-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000042a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000042aa', 'Bacchiades', '{}'),
  ('00000000-0000-7000-8000-0000000042b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000042ab', 'Cypsélides', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000042a3', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000042a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000042b3', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000042b1', '01900000-0000-7000-8000-000000000101', 'grow_wheat');
insert into game.stewards (id, world_id, house_id, site_id, name) values
  ('00000000-0000-7000-8000-0000000042a5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000042a1', '00000000-0000-7000-8000-0000000042a3', 'Nikias'),
  ('00000000-0000-7000-8000-0000000042b5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000042b1', '00000000-0000-7000-8000-0000000042b3', 'Kléon');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Un achat de blé de la maison donnée (suffixe), posé par l'intendant donné, sous le rôle de service.
create function pg_temp.buy(order_id text, house text, steward text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining, steward_id)
     values (%L, %L, %L, %L, %L, %L, 4, 10, 10, %L)',
    '00000000-0000-7000-8000-00000000420' || order_id, '01900000-0000-7000-8000-000000000001',
    '01900000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-0000000042' || house, 'wheat', 'buy',
    case when steward is null then null else '00000000-0000-7000-8000-0000000042' || steward end));
$$;

-- Droits, lus dans le catalogue.
select has_column('game', 'orders', 'steward_id', 'un ordre nomme l''intendant qui l''a posé');
select ok(has_column_privilege('oikos_service', 'game.orders', 'steward_id', 'insert')
  and not has_column_privilege('oikos_service', 'game.orders', 'steward_id', 'update'),
  'le service le nomme à la pose, sans jamais le changer');
select ok(not has_table_privilege('authenticated', 'game.orders', 'insert')
  and not has_column_privilege('authenticated', 'game.orders', 'steward_id', 'update')
  and has_column_privilege('authenticated', 'game.orders', 'steward_id', 'select'),
  'un joueur le lit sans l''écrire');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'my_steward_orders' and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'la vue en lecture seule, rien pour un visiteur anonyme');

-- Intégrité, sous le rôle de service.
select lives_ok(pg_temp.buy('1', 'b1', 'b5'), 'Kléon pose un achat pour la maison de Bob');
select lives_ok(pg_temp.buy('2', 'b1', null), 'Bob pose un achat lui-même');
select lives_ok(pg_temp.buy('3', 'a1', 'a5'), 'Nikias pose un achat pour la maison d''Alice');
select lives_ok(pg_temp.buy('4', 'b1', 'b5'), 'Kléon pose un second achat');
select throws_ok(pg_temp.buy('5', 'a1', 'b5'), '23503', null, 'l''intendant de Bob ne pose rien au nom d''Alice');
update game.stewards set dismissed_at = now() where id = '00000000-0000-7000-8000-0000000042a5';
select throws_ok(pg_temp.buy('6', 'a1', 'a5'), '23001', 'an order is placed by a steward in post',
  'un intendant renvoyé ne pose plus d''ordre');
select throws_ok($$update game.orders set steward_id = null where id = '00000000-0000-7000-8000-000000004201'$$,
  '23001', 'order identity is immutable', 'l''intendant d''un ordre ne change pas, même pour le propriétaire');
select lives_ok($$select pg_temp.as_service('update game.orders set status = ''cancelled'' where id = ''00000000-0000-7000-8000-000000004204''')$$,
  'un ordre d''intendant s''annule comme un autre');

-- Lectures des joueurs.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000042ab", "role": "authenticated"}';
select results_eq(
  $$select id::text, steward_id::text, site_id::text, side, price, remaining from public.my_steward_orders$$,
  $$values ('00000000-0000-7000-8000-000000004201', '00000000-0000-7000-8000-0000000042b5',
            '00000000-0000-7000-8000-0000000042b3', 'buy', 4::bigint, 10::bigint)$$,
  'Bob lit l''ordre ouvert de Kléon avec son site, ni le sien ni l''ordre annulé');
select is((select string_agg(coalesce(steward_id::text, '-'), ' ' order by id) from game.orders),
  '00000000-0000-7000-8000-0000000042b5 - 00000000-0000-7000-8000-0000000042b5',
  'et l''intendant de chacun de ses ordres');
select throws_ok($$update game.orders set steward_id = null$$, '42501', null, 'sans pouvoir le changer');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000042aa", "role": "authenticated"}';
select is((select count(*)::int from game.orders where house_id = '00000000-0000-7000-8000-0000000042b1')
  + (select count(*)::int from public.my_steward_orders where steward_id = '00000000-0000-7000-8000-0000000042b5'), 0,
  'Alice ne lit pas les ordres de l''intendant de Bob');
select is((select count(*)::int from game.orders where steward_id = '00000000-0000-7000-8000-0000000042a5'), 1,
  'elle lit l''ordre resté ouvert de Nikias, renvoyé');
select is((select count(*)::int from public.my_steward_orders), 0, 'mais la fiche ne montre que ceux d''un intendant en poste');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000042ac", "role": "authenticated"}';
select is((select count(*)::int from public.my_steward_orders), 0, 'Chloé, sans maison, ne lit rien');
reset role;
set local role anon;
select throws_ok($$select 1 from public.my_steward_orders$$, '42501', null, 'un visiteur ne lit pas la vue');
reset role;

select * from finish();
rollback;
