begin;
select plan(21);

-- Jeu d'essai, monde de test, Kallistè (101). Alice est archonte en charge (charge A) ; Bob et Chloé sont citoyens.
-- Décret d'ostracisme adopté et son vote X, clos depuis une heure : Bob et Chloé ont nommé Alice. Élection E du
-- mandat suivant, close depuis une heure : Alice, candidate la première, a deux bulletins, Bob un. Élection F au
-- dépôt des candidatures. Tout est posé garde levée.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000007230a' || u)::uuid, 'ostracism-office-' || u || '@example.test'
from unnest(array['a', 'b', 'c']) u;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000007230' || u || '1')::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-4000-8000-0000007230a' || u)::uuid, n, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Bouzyges')) as v (u, n);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000007230' || u || '1')::uuid, '01900000-0000-7000-8000-000000000101'
from unnest(array['a', 'b', 'c']) u;
alter table game.citizenships disable trigger citizenships_guard;
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
alter table game.candidacies disable trigger candidacies_guard;
alter table game.ballots disable trigger ballots_guard;
alter table game.decrees disable trigger decrees_guard;
alter table game.ostracisms disable trigger ostracisms_guard;
alter table game.ostraca disable trigger ostraca_guard;
update game.citizenships set status = 'citizen', since = now() - interval '10 days'
where house_id::text like '00000000-0000-7000-8000-0000007230%';
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values
  ('00000000-0000-7000-8000-0000007230e0', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
   now() - interval '9 days', now() - interval '6 days', now() - interval '2 days', now() + interval '26 days', now() - interval '2 days'),
  ('00000000-0000-7000-8000-0000007230e1', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
   now() - interval '8 days', now() - interval '5 days', now() - interval '1 hour', now() + interval '27 days', null);
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select '00000000-0000-7000-8000-0000007230f0', world_id, city_id, office, '00000000-0000-7000-8000-0000007230a1', id, voting_closes_at, term_ends_at
from game.elections where id = '00000000-0000-7000-8000-0000007230e0';
insert into game.candidacies (id, election_id, house_id, created_at)
values ('00000000-0000-7000-8000-0000007230ca', '00000000-0000-7000-8000-0000007230e1', '00000000-0000-7000-8000-0000007230a1', now() - interval '7 days'),
       ('00000000-0000-7000-8000-0000007230cb', '00000000-0000-7000-8000-0000007230e1', '00000000-0000-7000-8000-0000007230b1', now() - interval '6 days');
insert into game.ballots (election_id, house_id, candidacy_id, cast_at)
select '00000000-0000-7000-8000-0000007230e1', ('00000000-0000-7000-8000-0000007230' || h || '1')::uuid,
       ('00000000-0000-7000-8000-0000007230c' || c)::uuid, now() - interval '2 days'
from (values ('a', 'a'), ('c', 'a'), ('b', 'b')) as v (h, c);
insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at, quorum_bps,
  status, tallied_at, electorate, votes_for, votes_against)
values ('00000000-0000-7000-8000-0000007230d0', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
  'ostracism', '{}', '00000000-0000-7000-8000-0000007230f0', '00000000-0000-7000-8000-0000007230a1', now() - interval '6 days',
  now() - interval '4 days', 0, 'adopted', now() - interval '4 days', 3, 3, 0);
insert into game.ostracisms (id, world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days)
values ('00000000-0000-7000-8000-0000007230b0', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
  '00000000-0000-7000-8000-0000007230d0', now() - interval '3 days', now() - interval '1 hour', 0, 7);
insert into game.ostraca (ostracism_id, house_id, target_house_id, cast_at)
select '00000000-0000-7000-8000-0000007230b0', ('00000000-0000-7000-8000-0000007230' || h || '1')::uuid,
       '00000000-0000-7000-8000-0000007230a1', now() - interval '2 days'
from unnest(array['b', 'c']) h;
alter table game.citizenships enable trigger citizenships_guard;
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;
alter table game.candidacies enable trigger candidacies_guard;
alter table game.ballots enable trigger ballots_guard;
alter table game.decrees enable trigger decrees_guard;
alter table game.ostracisms enable trigger ostracisms_guard;
alter table game.ostraca enable trigger ostraca_guard;

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.propose() returns text language sql as $$
  select $q$select pg_temp.as_service('insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by, voting_closes_at, quorum_bps)
    values (''01900000-0000-7000-8000-000000000001'', ''01900000-0000-7000-8000-000000000101'', ''public_works'', ''{"amountOboles": 600}'',
    ''00000000-0000-7000-8000-0000007230f0'', ''00000000-0000-7000-8000-0000007230a1'', now() + interval ''2 days'', 0)')$q$
$$;
create function pg_temp.vacate(at text default 'now()') returns text language sql as $$
  select format('select pg_temp.as_service(%L)',
    format('update game.offices set vacated_at = %s where id = ''00000000-0000-7000-8000-0000007230f0''', at))
$$;
create function pg_temp.fill(house text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.offices (world_id, city_id, office, house_id, election_id, starts_at, ends_at) '
    'select world_id, city_id, office, %L, id, voting_closes_at, term_ends_at from game.elections where id = %L',
    '00000000-0000-7000-8000-0000007230' || house || '1', '00000000-0000-7000-8000-0000007230e1'))
$$;
create function pg_temp.stand(house text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format('insert into game.candidacies (election_id, house_id) values (%L, %L)',
    '00000000-0000-7000-8000-0000007230e2', '00000000-0000-7000-8000-0000007230' || house || '1'))
$$;

-- Avant le dépouillement.
select ok(not game.house_ostracized('00000000-0000-7000-8000-0000007230a1', now()), 'Alice n''est pas encore ostracisée');
select throws_ok(pg_temp.vacate(), '23001', null, 'une charge ne se quitte pas sans ostracisme de son titulaire');
select lives_ok(pg_temp.propose(), 'l''archonte en charge propose');
select throws_ok(
  $$select pg_temp.as_service('update game.offices set ends_at = now() + interval ''1 day''')$$,
  '42501', null, 'le service ne change que la vacance d''une charge');

-- Dépouillement de X : Alice ostracisée sept jours.
select lives_ok(
  $$select pg_temp.as_service('update game.ostracisms set tallied_at = now(), electorate = 3, ballots = 2, outcome = ''ostracized'',
    ostracized_house_id = ''00000000-0000-7000-8000-0000007230a1'', ends_at = now() + interval ''7 days''
    where id = ''00000000-0000-7000-8000-0000007230b0''')$$,
  'Alice est ostracisée');
select is(
  (select array[game.house_ostracized(house, now() - interval '1 second'), game.house_ostracized(house, now()),
     game.house_ostracized(house, now() + interval '7 days' - interval '1 second'), game.house_ostracized(house, now() + interval '7 days')]
   from (values ('00000000-0000-7000-8000-0000007230a1'::uuid)) as v (house)),
  array[false, true, true, false], 'du dépouillement inclus à la fin exclue');
select ok(not game.house_ostracized('00000000-0000-7000-8000-0000007230b1', now()), 'Bob ne l''est pas');
select throws_ok(pg_temp.propose(), '23514', 'an ostracized house proposes no decree', 'une maison ostracisée ne propose aucun décret');

-- Vacance de la charge d'Alice.
select throws_ok(pg_temp.vacate('now() + interval ''1 hour'''), '23001', null, 'une charge se quitte maintenant');
select lives_ok(pg_temp.vacate(), 'l''archonte ostracisée quitte sa charge');
select throws_ok(pg_temp.vacate(), '23001', null, 'une fois');
select is((select in_office from public.offices where id = '00000000-0000-7000-8000-0000007230f0'), false,
  'la charge n''est plus en cours : vacante jusqu''au mandat suivant');
select throws_ok(pg_temp.propose(), '23514', 'only the archon in office proposes', 'une charge quittée ne propose plus');

-- Élections : l'ostracisée ne se présente pas, et n'est pas élue malgré ses bulletins.
select lives_ok($$select pg_temp.as_service('update game.elections set tallied_at = now() where id = ''00000000-0000-7000-8000-0000007230e1''')$$,
  'l''élection du mandat suivant est dépouillée');
select throws_ok(pg_temp.fill('a'), '23001', null, 'l''ostracisée n''est pas élue, malgré ses deux bulletins');
select lives_ok(pg_temp.fill('b'), 'la charge va à la candidature suivante');
select is((select vacated_at is null from game.offices where election_id = '00000000-0000-7000-8000-0000007230e1'), true,
  'pourvue, non quittée');
alter table game.elections disable trigger elections_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
values ('00000000-0000-7000-8000-0000007230e2', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
  now() - interval '1 day', now() + interval '3 days', now() + interval '6 days', now() + interval '34 days');
alter table game.elections enable trigger elections_guard;
select throws_ok(pg_temp.stand('a'), '23514', 'an ostracized house stands for no election', 'une maison ostracisée ne se présente pas');
select lives_ok(pg_temp.stand('b'), 'une autre, si');
select throws_ok(
  $$select pg_temp.as_service('insert into game.offices (world_id, city_id, office, house_id, election_id, starts_at, ends_at, vacated_at)
    values (''01900000-0000-7000-8000-000000000001'', ''01900000-0000-7000-8000-000000000101'', ''archon'',
    ''00000000-0000-7000-8000-0000007230b1'', ''00000000-0000-7000-8000-0000007230e0'', now(), now() + interval ''1 day'', now())')$$,
  '42501', null, 'le service ne crée pas une charge déjà quittée');
select ok(not has_function_privilege('authenticated', 'game.house_ostracized(uuid, timestamptz)', 'execute'),
  'la fonction n''est pas exposée aux joueurs');

select * from finish();
rollback;
