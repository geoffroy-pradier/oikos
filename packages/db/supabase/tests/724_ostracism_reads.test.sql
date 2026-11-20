begin;
select plan(19);

-- Lectures des joueurs. Monde de test : Alice et Bob, citoyens de Kallistè ; Dion, citoyen d'Elaia. Zénon a sa maison
-- dans un autre monde. Vote O de Kallistè au vote (Alice et Bob ont nommé Bob) ; vote T d'Elaia dépouillé (Dion s'est
-- nommé, il est ostracisé). Décrets et votes posés garde levée.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000007240f2', 'monde-724', 'Autre monde');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000007240a' || u)::uuid, 'ostracism-reads-' || u || '@example.test'
from unnest(array['a', 'b', 'd', 'f']) u;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000007240' || u || '1')::uuid, w::uuid, ('00000000-0000-4000-8000-0000007240a' || u)::uuid, n, '{}'
from (values ('a', 'Alcméonides', '01900000-0000-7000-8000-000000000001'), ('b', 'Philaïdes', '01900000-0000-7000-8000-000000000001'),
  ('d', 'Étéoboutades', '01900000-0000-7000-8000-000000000001'), ('f', 'Zénonides', '01900000-0000-7000-8000-0000007240f2')) as v (u, n, w);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000007240' || u || '1')::uuid, ('01900000-0000-7000-8000-000000000' || c)::uuid
from (values ('a', '101'), ('b', '101'), ('d', '103')) as v (u, c);
update game.citizenships set status = 'citizen', since = now() where house_id::text like '00000000-0000-7000-8000-0000007240%';
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
alter table game.decrees disable trigger decrees_guard;
alter table game.decrees disable trigger decrees_guard_ostracism;
alter table game.ostracisms disable trigger ostracisms_guard;
alter table game.ostraca disable trigger ostraca_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values ('00000000-0000-7000-8000-00000072400a', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
  now() - interval '8 days', now() - interval '4 days', now() - interval '1 day', now() + interval '27 days', now());
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select id, world_id, city_id, office, '00000000-0000-7000-8000-0000007240a1', id, voting_closes_at, term_ends_at
from game.elections where id = '00000000-0000-7000-8000-00000072400a';
insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at, quorum_bps,
  status, tallied_at, electorate, votes_for, votes_against)
select ('00000000-0000-7000-8000-0000007240c' || right(c, 1))::uuid, '01900000-0000-7000-8000-000000000001', ('01900000-0000-7000-8000-000000000' || c)::uuid,
       'ostracism', '{}', '00000000-0000-7000-8000-00000072400a', '00000000-0000-7000-8000-0000007240a1',
       now() - interval '9 days', now() - interval '7 days', 0, 'adopted', now() - interval '7 days', 1, 1, 0
from unnest(array['101', '103']) c;
insert into game.ostracisms (id, world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days,
  tallied_at, electorate, ballots, outcome, ostracized_house_id, ends_at)
values
  ('00000000-0000-7000-8000-0000007240e0', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
   '00000000-0000-7000-8000-0000007240c1', now() - interval '1 day', now() + interval '2 days', 0, 7, null, null, null, null, null, null),
  ('00000000-0000-7000-8000-0000007240e7', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000103',
   '00000000-0000-7000-8000-0000007240c3', now() - interval '6 days', now() - interval '3 days', 0, 7,
   now() - interval '3 days', 1, 1, 'ostracized', '00000000-0000-7000-8000-0000007240d1', now() + interval '4 days');
insert into game.ostraca (ostracism_id, house_id, target_house_id)
values ('00000000-0000-7000-8000-0000007240e0', '00000000-0000-7000-8000-0000007240a1', '00000000-0000-7000-8000-0000007240b1'),
       ('00000000-0000-7000-8000-0000007240e0', '00000000-0000-7000-8000-0000007240b1', '00000000-0000-7000-8000-0000007240b1'),
       ('00000000-0000-7000-8000-0000007240e7', '00000000-0000-7000-8000-0000007240d1', '00000000-0000-7000-8000-0000007240d1');
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;
alter table game.decrees enable trigger decrees_guard;
alter table game.decrees enable trigger decrees_guard_ostracism;
alter table game.ostracisms enable trigger ostracisms_guard;
alter table game.ostraca enable trigger ostraca_guard;

select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('ostracisms', 'ostraca')),
  'ostraca:ostraca_read_own:SELECT:authenticated ostraca:service_all:ALL:oikos_service '
    || 'ostracisms:ostracisms_read:SELECT:authenticated ostracisms:service_all:ALL:oikos_service',
  'votes du monde du joueur, bulletins : seulement ceux de sa maison ; aucune écriture pour les joueurs');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name in ('ostracisms', 'ostracism_results', 'my_ostraca')),
  'my_ostraca:authenticated:SELECT ostracism_results:authenticated:SELECT ostracisms:authenticated:SELECT',
  'vues en lecture seule, rien pour un visiteur anonyme');

-- Alice.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000007240aa", "role": "authenticated"}';
select is((select string_agg(right(ostracism_id::text, 2) || ':' || right(house_id::text, 2), ' ') from public.my_ostraca),
  'e0:a1', 'Alice lit qu''elle a voté');
select throws_ok('select target_house_id from game.ostraca', '42501', null, 'mais pas le nom inscrit');
select is(
  (select string_agg(right(id::text, 2) || ':' || coalesce(outcome || '/' || ballots || '/' || electorate, 'secret')
     || ':' || coalesce(right(ostracized_house_id::text, 2), '-') || ':' || in_force, ' ' order by id)
   from public.ostracisms where id::text like '00000000-0000-7000-8000-0000007240%'),
  'e0:secret:-:false e7:ostracized/1/1:d1:true', 'les votes du monde sont publics, le décompte seulement après le dépouillement');
select is((select string_agg(right(ostracism_id::text, 2) || ':' || right(house_id::text, 2) || ':' || ostraca, ' ')
   from public.ostracism_results where ostracism_id::text like '00000000-0000-7000-8000-0000007240%'),
  'e7:d1:1', 'les voix de chaque nom après le dépouillement, aucune avant');
select is((select count(*) from game.ostracism_results() where ostracism_id = '00000000-0000-7000-8000-0000007240e0'), 0::bigint,
  'ni par la fonction');

-- Bob, Dion, puis Zénon.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000007240ab", "role": "authenticated"}';
select is((select string_agg(right(house_id::text, 2), ' ') from public.my_ostraca), 'b1', 'Bob ne lit que son bulletin');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000007240ad", "role": "authenticated"}';
select is((select string_agg(right(ostracism_id::text, 2), ' ') from public.my_ostraca), 'e7', 'Dion ne lit aucun bulletin de Kallistè');
select is((select count(*) from game.ostraca where ostracism_id = '00000000-0000-7000-8000-0000007240e0'), 0::bigint, 'ni dans la table');
select is((select count(*) from public.ostracisms where id::text like '00000000-0000-7000-8000-0000007240%'), 2::bigint,
  'mais il lit les votes d''une autre cité de son monde');
select throws_ok(
  $$insert into game.ostraca (ostracism_id, house_id, target_house_id) values ('00000000-0000-7000-8000-0000007240e0',
    '00000000-0000-7000-8000-0000007240d1', '00000000-0000-7000-8000-0000007240a1')$$,
  '42501', null, 'un joueur ne vote pas sans l''API');
select throws_ok($$update game.ostracisms set outcome = 'tie'$$, '42501', null, 'ni ne dépouille');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000007240af", "role": "authenticated"}';
select is((select count(*) from public.ostracisms where id::text like '00000000-0000-7000-8000-0000007240%'), 0::bigint,
  'Zénon, d''un autre monde, ne lit aucun de ces votes');
select is((select count(*) from public.ostracism_results where ostracism_id::text like '00000000-0000-7000-8000-0000007240%'), 0::bigint,
  'ni leurs décomptes');
reset role;
set local role anon;
select throws_ok('select * from public.ostracisms', '42501', null, 'un visiteur anonyme ne lit rien');
select throws_ok('select * from public.my_ostraca', '42501', null, 'ni les bulletins');
select throws_ok('select * from game.ostracism_results()', '42501', null, 'ni les décomptes par la fonction');
reset role;
select ok(not has_function_privilege('authenticated', 'game.guard_ostracon()', 'execute'), 'aucune garde exécutable par un joueur');

select * from finish();
rollback;
