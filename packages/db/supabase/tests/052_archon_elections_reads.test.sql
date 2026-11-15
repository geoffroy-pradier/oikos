begin;
select plan(18);

-- Lectures des joueurs. Jeu d'essai du test 051, monde de test. Kallistè vote (élection K) ; Elaia reçoit
-- les candidatures (élection E) ; Halos a fini de voter (élection H), Ampelos n'a pas d'élection. Alice et Bob sont citoyens de Kallistè,
-- Chloé y est métèque, Dion est citoyen d'Elaia, Hélène et Ion citoyens de Halos.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000051aa', 'arch-alice@example.test'),
  ('00000000-0000-4000-8000-0000000051ab', 'arch-bob@example.test'),
  ('00000000-0000-4000-8000-0000000051ac', 'arch-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000051ad', 'arch-dion@example.test'),
  ('00000000-0000-4000-8000-0000000051ae', 'arch-helene@example.test'),
  ('00000000-0000-4000-8000-0000000051af', 'arch-ion@example.test');
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000051' || h)::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-4000-8000-0000000051a' || u)::uuid, n, '{}'
from (values ('a1', 'a', 'Alcméonides'), ('b1', 'b', 'Philaïdes'), ('c1', 'c', 'Bouzyges'),
             ('d1', 'd', 'Étéoboutades'), ('e1', 'e', 'Kérykes'), ('f1', 'f', 'Eumolpides')) as v (h, u, n);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000000051' || h)::uuid, ('01900000-0000-7000-8000-000000000' || c)::uuid
from (values ('a1', '101'), ('b1', '101'), ('c1', '101'), ('d1', '103'), ('e1', '105'), ('f1', '105')) as v (h, c);
update game.citizenships set status = 'citizen', since = now()
where house_id <> '00000000-0000-7000-8000-0000000051c1' and house_id::text like '00000000-0000-7000-8000-0000000051%';
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at) values
  ('00000000-0000-7000-8000-00000000510a', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
   now() - interval '3 days', now() - interval '1 hour', now() + interval '1 day', now() + interval '29 days'),
  ('00000000-0000-7000-8000-00000000510e', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000103', 'archon',
   now() - interval '1 hour', now() + interval '1 day', now() + interval '2 days', now() + interval '30 days'),
  ('00000000-0000-7000-8000-00000000510f', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000105', 'archon',
   now() - interval '5 days', now() - interval '3 days', now() - interval '1 hour', now() + interval '27 days');
-- Candidatures et bulletins déposés aux jours passés : garde levée le temps de les antidater. Hélène s'est
-- présentée avant Ion ; chacun a voté pour l'autre (égalité). À Kallistè, Bob est candidat, Alice s'est retirée.
alter table game.candidacies disable trigger candidacies_guard;
alter table game.ballots disable trigger ballots_guard;
insert into game.candidacies (id, election_id, house_id, created_at, withdrawn_at) values
  ('00000000-0000-7000-8000-0000000051e2', '00000000-0000-7000-8000-00000000510f', '00000000-0000-7000-8000-0000000051e1', now() - interval '5 days', null),
  ('00000000-0000-7000-8000-0000000051f2', '00000000-0000-7000-8000-00000000510f', '00000000-0000-7000-8000-0000000051f1', now() - interval '4 days', null),
  ('00000000-0000-7000-8000-0000000051b2', '00000000-0000-7000-8000-00000000510a', '00000000-0000-7000-8000-0000000051b1', now() - interval '2 days', null),
  ('00000000-0000-7000-8000-0000000051a2', '00000000-0000-7000-8000-00000000510a', '00000000-0000-7000-8000-0000000051a1', now() - interval '2 days', now() - interval '1 day');
insert into game.ballots (election_id, house_id, candidacy_id, cast_at) values
  ('00000000-0000-7000-8000-00000000510f', '00000000-0000-7000-8000-0000000051e1', '00000000-0000-7000-8000-0000000051f2', now() - interval '2 days'),
  ('00000000-0000-7000-8000-00000000510f', '00000000-0000-7000-8000-0000000051f1', '00000000-0000-7000-8000-0000000051e2', now() - interval '2 days');
alter table game.candidacies enable trigger candidacies_guard;
alter table game.ballots enable trigger ballots_guard;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c51a',
  '{"politics": {"meticDays": 3, "archon": {"termDays": 28, "candidacyDays": 4, "votingDays": 3, "maxConsecutiveTerms": 2}}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c51a', now());

-- Dépouillement de Halos : à égalité, la candidature la plus ancienne (Hélène) l'emporte ; Alice a voté à
-- Kallistè.
update game.elections set tallied_at = now() where id = '00000000-0000-7000-8000-00000000510f';
insert into game.offices (world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select world_id, city_id, office, '00000000-0000-7000-8000-0000000051e1', id, voting_closes_at, term_ends_at
from game.elections where id = '00000000-0000-7000-8000-00000000510f';
insert into game.ballots (election_id, house_id, candidacy_id)
values ('00000000-0000-7000-8000-00000000510a', '00000000-0000-7000-8000-0000000051a1', '00000000-0000-7000-8000-0000000051b2');

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('elections', 'candidacies', 'ballots', 'offices')),
  'ballots:ballots_read_own:SELECT:authenticated ballots:service_all:ALL:oikos_service '
    || 'candidacies:candidacies_read:SELECT:authenticated candidacies:service_all:ALL:oikos_service '
    || 'elections:elections_read:SELECT:authenticated elections:service_all:ALL:oikos_service '
    || 'offices:offices_read:SELECT:authenticated offices:service_all:ALL:oikos_service',
  'lecture publique, sauf les bulletins : seulement ceux de sa maison ; aucune écriture pour les joueurs');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in ('elections', 'election_candidates', 'election_results', 'offices', 'my_ballots', 'politics_rules')),
  'election_candidates:authenticated:SELECT election_results:authenticated:SELECT elections:authenticated:SELECT '
    || 'my_ballots:authenticated:SELECT offices:authenticated:SELECT politics_rules:authenticated:SELECT',
  'vues en lecture seule, rien pour un visiteur anonyme');
select ok(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'),
  format('%s : exécutable par un joueur connecté, pas par un visiteur anonyme', f))
from unnest(array['game.election_results()', 'game.politics_rules()']) f;

-- Joueurs.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000051aa", "role": "authenticated"}';
select is((select string_agg(house_id::text, ' ') from public.my_ballots), '00000000-0000-7000-8000-0000000051a1',
  'Alice lit qu''elle a voté');
select throws_ok('select candidacy_id from game.ballots', '42501', null, 'mais pas pour qui, pas même son propre bulletin');
select is(
  (select string_agg(right(c.id::text, 2) || ':' || coalesce(right(c.withdrawn_at::text, 0), 'maintenue'), ' ' order by c.id)
   from public.election_candidates c where c.election_id = '00000000-0000-7000-8000-00000000510a'),
  'a2: b2:maintenue', 'les candidatures et les retraits sont publics');
select is((select count(*) from public.election_results where election_id = '00000000-0000-7000-8000-00000000510a'), 0::bigint,
  'aucun résultat avant le dépouillement');
select is(
  (select string_agg(right(house_id::text, 2) || ':' || votes || ':' || elected, ' ' order by house_id)
   from public.election_results where election_id = '00000000-0000-7000-8000-00000000510f'),
  'e1:1:true f1:1:false', 'résultats publics après le dépouillement, élu compris');
select is(
  (select string_agg(right(house_id::text, 2) || ':' || in_office, ' ') from public.offices where city_id = '01900000-0000-7000-8000-000000000105'),
  'e1:true', 'magistrat en charge');
select is((select count(*) from public.elections where world_id = '01900000-0000-7000-8000-000000000001'), 3::bigint,
  'le calendrier électoral de chaque cité est public');
select is((select politics -> 'archon' ->> 'termDays' from public.politics_rules), '28', 'durée du mandat en vigueur');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000051ab", "role": "authenticated"}';
select is((select count(*) from public.my_ballots), 0::bigint, 'Bob ne lit pas le bulletin d''Alice');
select is((select count(*) from game.ballots), 0::bigint, 'ni dans la table');
select throws_ok(
  $$insert into game.ballots (election_id, house_id, candidacy_id) values ('00000000-0000-7000-8000-00000000510a',
    '00000000-0000-7000-8000-0000000051b1', '00000000-0000-7000-8000-0000000051b2')$$,
  '42501', null, 'un joueur ne vote pas sans l''API');
reset role;
set local role anon;
select throws_ok('select * from public.elections', '42501', null, 'un visiteur anonyme ne lit rien');
select throws_ok('select * from game.election_results()', '42501', null, 'ni les résultats par la fonction');
select throws_ok('select * from game.politics_rules()', '42501', null, 'ni les règles par la fonction');
reset role;

select * from finish();
rollback;
