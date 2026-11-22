begin;
select plan(16);

-- Lectures des ligues (6.5, #737). Alice a sa maison dans le monde de test, où Kallistè (101) a fondé la ligue L,
-- qu'Elaia (103) a quittée ; Zénon a la sienne dans un autre monde, où Érétrie a fondé Z. Tout est posé garde levée.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000007370f2', 'monde-737', 'Autre monde');
insert into game.cities (id, world_id, slug, name)
values ('01900000-0000-7000-8000-0000007370c9', '01900000-0000-7000-8000-0000007370f2', 'eretria-737', 'Érétrie');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000007370aa', 'league-reads-a@example.test'),
  ('00000000-0000-4000-8000-0000007370af', 'league-reads-f@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000007370a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000007370aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000007370f1', '01900000-0000-7000-8000-0000007370f2', '00000000-0000-4000-8000-0000007370af', 'Zénonides', '{}');
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
alter table game.decrees disable trigger decrees_guard;
alter table game.leagues disable trigger leagues_guard;
alter table game.league_members disable trigger league_members_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values ('00000000-0000-7000-8000-00000073700a', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
  now() - interval '8 days', now() - interval '4 days', now() - interval '1 day', now() + interval '27 days', now());
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select id, world_id, city_id, office, '00000000-0000-7000-8000-0000007370a1', id, voting_closes_at, term_ends_at
from game.elections where id = '00000000-0000-7000-8000-00000073700a';
insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at, quorum_bps,
  status, tallied_at, electorate, votes_for, votes_against, applied_at)
select md5(k)::uuid, w::uuid, c::uuid, m, '{}', '00000000-0000-7000-8000-00000073700a', h::uuid, now() - interval '6 days',
       now() - interval '4 days', 0, 'applied', now() - interval '4 days', 0, 0, 0, now()
from (values ('L', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'league_found', '00000000-0000-7000-8000-0000007370a1'),
  ('A', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'league_admit', '00000000-0000-7000-8000-0000007370a1'),
  ('Q', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000103', 'league_leave', '00000000-0000-7000-8000-0000007370a1'),
  ('Z', '01900000-0000-7000-8000-0000007370f2', '01900000-0000-7000-8000-0000007370c9', 'league_found', '00000000-0000-7000-8000-0000007370f1'))
  as v (k, w, c, m, h);
insert into game.leagues (id, world_id, name, hegemon_city_id, founding_decree_id) values
  ('00000000-0000-7000-8000-0000007370e1', '01900000-0000-7000-8000-000000000001', 'Ligue de Délos', '01900000-0000-7000-8000-000000000101', md5('L')::uuid),
  ('00000000-0000-7000-8000-0000007370e9', '01900000-0000-7000-8000-0000007370f2', 'Ligue d''Eubée', '01900000-0000-7000-8000-0000007370c9', md5('Z')::uuid);
insert into game.league_members (league_id, world_id, city_id, entry_decree_id, left_at, exit_reason, exit_decree_id) values
  ('00000000-0000-7000-8000-0000007370e1', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', md5('L')::uuid, null, null, null),
  ('00000000-0000-7000-8000-0000007370e1', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000103', md5('A')::uuid, now(), 'left', md5('Q')::uuid),
  ('00000000-0000-7000-8000-0000007370e9', '01900000-0000-7000-8000-0000007370f2', '01900000-0000-7000-8000-0000007370c9', md5('Z')::uuid, null, null, null);
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;
alter table game.decrees enable trigger decrees_guard;
alter table game.leagues enable trigger leagues_guard;
alter table game.league_members enable trigger league_members_guard;

select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('leagues', 'league_members')),
  'league_members:league_members_read:SELECT:authenticated league_members:service_all:ALL:oikos_service '
    || 'leagues:leagues_read:SELECT:authenticated leagues:service_all:ALL:oikos_service',
  'ligues et membres du monde du joueur en lecture ; aucune écriture pour les joueurs');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name in ('leagues', 'league_members')),
  'league_members:authenticated:SELECT leagues:authenticated:SELECT', 'vues en lecture seule, rien pour un visiteur anonyme');

-- Alice.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000007370aa", "role": "authenticated"}';
select is((select string_agg(name || ':' || right(hegemon_city_id::text, 3) || ':' || (dissolved_at is null), ' ')
   from public.leagues where id::text like '00000000-0000-7000-8000-0000007370%'),
  'Ligue de Délos:101:true', 'Alice lit la ligue de son monde, son hégémon et qu''elle est en activité');
select is((select string_agg(right(city_id::text, 3) || ':' || coalesce(exit_reason, 'member'), ' ' order by city_id)
   from public.league_members where league_id = '00000000-0000-7000-8000-0000007370e1'),
  '101:member 103:left', 'et ses membres, présents et passés');
select is((select count(*) from game.leagues where id = '00000000-0000-7000-8000-0000007370e9'), 0::bigint,
  'une ligue d''un autre monde est invisible, même dans la table');
select is((select count(*) from public.league_members where world_id = '01900000-0000-7000-8000-0000007370f2'), 0::bigint,
  'et ses membres aussi');
select throws_ok($$insert into game.leagues (world_id, name, hegemon_city_id, founding_decree_id) values
  ('01900000-0000-7000-8000-000000000001', 'Ligue de Paros', '01900000-0000-7000-8000-000000000103', md5('A')::uuid)$$,
  '42501', null, 'un joueur ne fonde pas de ligue sans décret');
select throws_ok($$update game.leagues set hegemon_city_id = '01900000-0000-7000-8000-000000000103'$$, '42501', null,
  'ni ne change l''hégémon');
select throws_ok($$update game.league_members set left_at = now(), exit_reason = 'dissolved'$$, '42501', null, 'ni ne fait sortir une cité');
select throws_ok($$delete from game.league_members$$, '42501', null, 'ni n''efface un membre');
select throws_ok($$update public.leagues set name = 'Ligue de Paros'$$, '42501', null, 'ni n''écrit par la vue');

-- Zénon, puis un visiteur anonyme.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000007370af", "role": "authenticated"}';
select is((select string_agg(name, ' ') from public.leagues where id::text like '00000000-0000-7000-8000-0000007370%'),
  'Ligue d''Eubée', 'Zénon, d''un autre monde, ne lit que la ligue du sien');
select is((select string_agg(right(city_id::text, 3), ' ') from public.league_members
   where league_id::text like '00000000-0000-7000-8000-0000007370%'), '0c9', 'et ses membres seulement');
reset role;
set local role anon;
select throws_ok('select * from public.leagues', '42501', null, 'un visiteur anonyme ne lit aucune ligue');
select throws_ok('select * from public.league_members', '42501', null, 'ni aucun membre');
reset role;
select ok(not has_function_privilege('authenticated', 'game.guard_league_member()', 'execute')
  and not has_function_privilege('authenticated', 'game.guard_league()', 'execute'), 'aucune garde exécutable par un joueur');

select * from finish();
rollback;
