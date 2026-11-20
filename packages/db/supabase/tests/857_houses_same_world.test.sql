begin;
select plan(26);

-- Jeu d'essai : deux mondes, une cité chacun. Alice et Bob ont une maison dans le premier, Carole dans le second,
-- sous le même nom que celle de Bob (les noms ne sont uniques que par monde). Damien n'a pas de maison. Éloi a hérité
-- d'une maison dans chaque monde, d'avant la règle d'une maison par compte (#604) : le déclencheur est levé pour
-- l'écrire. Chaque maison a une citoyenneté ; aucune n'a de Timè, si bien que `house_honor` les rend à zéro.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000857f1', 'monde-un-857', 'Monde un'),
  ('01900000-0000-7000-8000-0000000857f2', 'monde-deux-857', 'Monde deux');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000857c1', '01900000-0000-7000-8000-0000000857f1', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000857c2', '01900000-0000-7000-8000-0000000857f2', 'eretria', 'Érétrie');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000857a' || n)::uuid, 'houses-857-' || n || '@example.test'
from unnest(array['a', 'b', 'c', 'd', 'e']) n;
alter table game.houses disable trigger houses_one_per_account;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-000000085' || h)::uuid, ('01900000-0000-7000-8000-0000000857f' || w)::uuid,
       ('00000000-0000-4000-8000-0000000857a' || u)::uuid, name, '{}'
from (values ('7a1', '1', 'a', 'Alcméonides'), ('7b1', '1', 'b', 'Philaïdes'), ('7c2', '2', 'c', 'Philaïdes'),
             ('7e1', '1', 'e', 'Bacchiades'), ('7e2', '2', 'e', 'Cypsélides')) v (h, w, u, name);
alter table game.houses enable trigger houses_one_per_account;
insert into game.citizenships (house_id, city_id)
select id, ('01900000-0000-7000-8000-0000000857c' || right(world_id::text, 1))::uuid
from game.houses where id::text like '00000000-0000-7000-8000-000000085%';
create function pg_temp.as_player(account text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    format('{"sub": "00000000-0000-4000-8000-0000000857a%s", "role": "authenticated"}', account), true);
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Maisons du jeu d'essai lues par `public.houses`, triées : nom, puis monde (1 ou 2).
create function pg_temp.seen() returns text language sql as $$
  select coalesce(string_agg(name || '@' || right(world_id::text, 1), ' ' order by name, world_id), '')
  from public.houses where id::text like '00000000-0000-7000-8000-000000085%'
$$;

grant execute on function pg_temp.as_owner(), pg_temp.seen() to authenticated;

-- Règle et fonction : restrictive, pour le seul rôle des joueurs connectés ; la fonction ne s'exécute pas sans compte.
select is(
  (select permissive || ' ' || cmd || ' ' || array_to_string(roles, ',') from pg_policies
   where schemaname = 'game' and tablename = 'houses' and policyname = 'houses_same_world'),
  'RESTRICTIVE SELECT authenticated', 'la règle du monde est restrictive, en lecture, pour les joueurs connectés');
select ok(not has_function_privilege('anon', 'game.current_world_ids()', 'execute'),
  'un visiteur anonyme n''exécute pas current_world_ids');
select ok(not has_function_privilege('oikos_service', 'game.current_world_ids()', 'execute'),
  'le service n''en a pas besoin');

-- Visiteur anonyme : aucune lecture, ni par la vue ni en direct.
set local role anon;
select throws_ok('select * from public.houses', '42501', null, 'anon ne lit pas public.houses');
select throws_ok('select id from game.houses', '42501', null, 'anon ne lit pas game.houses');
select throws_ok('select * from public.house_honor', '42501', null, 'anon ne lit pas la Timè');
reset role;

-- Alice : les maisons de son monde, la sienne comprise, et aucune de l'autre.
select pg_temp.as_player('a');
select is(pg_temp.seen(), 'Alcméonides@1 Bacchiades@1 Philaïdes@1', 'Alice lit les maisons de son monde, et elles seules');
select is((select count(*) from public.houses where id = '00000000-0000-7000-8000-0000000857c2'), 0::bigint,
  'la maison d''un autre monde est invisible, même désignée par son identifiant');
select is((select count(*) from public.houses where world_id = '01900000-0000-7000-8000-0000000857f2'), 0::bigint,
  'rien d''un autre monde, même filtré sur ce monde');
select results_eq(
  $$select id from public.houses where name ilike 'philaïdes'$$,
  $$values ('00000000-0000-7000-8000-0000000857b1'::uuid)$$,
  'un nom porté dans deux mondes ne désigne que la maison de son monde');
select results_eq(
  $$select id::text from game.houses where id::text like '00000000-0000-7000-8000-000000085%' order by id$$,
  $$values ('00000000-0000-7000-8000-0000000857a1'), ('00000000-0000-7000-8000-0000000857b1'),
           ('00000000-0000-7000-8000-0000000857e1')$$,
  'la règle vaut aussi en lecture directe de game.houses');
select results_eq(
  $$select name, citizenship_status, city_id from public.houses where is_mine$$,
  $$values ('Alcméonides'::text, 'metic'::text, '01900000-0000-7000-8000-0000000857c1'::uuid)$$,
  'sa propre maison reste lisible, avec sa cité et son statut');
select is(
  (select string_agg(right(house_id::text, 3) || ':' || honor, ' ' order by house_id) from public.house_honor
   where house_id::text like '00000000-0000-7000-8000-000000085%'),
  '7a1:0 7b1:0 7e1:0', 'la Timè d''une maison d''un autre monde ne sort pas non plus');
select is((select count(*) from game.current_world_ids()), 1::bigint, 'Alice n''a qu''un monde');
select throws_ok($$update game.houses set name = 'Volée'$$, '42501', null, 'toujours aucune écriture');
select pg_temp.as_owner();

-- Bob, même monde : il lit la maison d'Alice.
select pg_temp.as_player('b');
select is((select name from public.houses where id = '00000000-0000-7000-8000-0000000857a1'), 'Alcméonides',
  'une maison du même monde est visible');
select is((select count(*) from public.houses where is_mine), 1::bigint, 'Bob n''a qu''une maison à lui');
select pg_temp.as_owner();

-- Carole, l'autre monde : la symétrique.
select pg_temp.as_player('c');
select is(pg_temp.seen(), 'Cypsélides@2 Philaïdes@2', 'Carole ne lit que les maisons du sien');
select is((select count(*) from public.houses where id = '00000000-0000-7000-8000-0000000857a1'), 0::bigint,
  'la maison d''Alice lui est invisible');
select is(
  (select string_agg(right(house_id::text, 3) || ':' || honor, ' ' order by house_id) from public.house_honor
   where house_id::text like '00000000-0000-7000-8000-000000085%'),
  '7c2:0 7e2:0', 'elle lit la Timè des maisons de son monde');
select pg_temp.as_owner();

-- Damien, connecté sans maison : rien.
select pg_temp.as_player('d');
select is(pg_temp.seen(), '', 'un compte sans maison ne lit aucune maison');
select is((select count(*) from game.current_world_ids()), 0::bigint, 'ni aucun monde');
select pg_temp.as_owner();

-- Éloi, deux maisons héritées dans deux mondes : les maisons de chacun.
select pg_temp.as_player('e');
select is(pg_temp.seen(), 'Alcméonides@1 Bacchiades@1 Cypsélides@2 Philaïdes@1 Philaïdes@2',
  'un compte de plusieurs mondes lit les maisons de chacun');
select is((select count(*) from public.houses where is_mine), 2::bigint, 'ses deux maisons sont à lui');
select pg_temp.as_owner();

-- Rejeu de la migration 2 : elle recrée `houses_read` sans condition ; la règle restrictive tient.
drop policy if exists houses_read on game.houses;
create policy houses_read on game.houses for select to authenticated using (true);
select pg_temp.as_player('a');
select is(pg_temp.seen(), 'Alcméonides@1 Bacchiades@1 Philaïdes@1', 'après le rejeu de la migration 2, Alice ne lit que son monde');
select pg_temp.as_owner();

-- Le service lit toujours toutes les maisons. Le compte se fait sous `oikos_service`, qui ne voit pas pgTAP ;
-- l'assertion, au propriétaire.
set local role oikos_service;
select set_config('oikos_test.service_houses_857',
  (select count(*) from game.houses where id::text like '00000000-0000-7000-8000-000000085%')::text, true);
reset role;
select is(current_setting('oikos_test.service_houses_857')::bigint, 5::bigint,
  'le service lit les maisons de tous les mondes');

select * from finish();
rollback;
