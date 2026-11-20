begin;
select plan(35);

-- Jeu d'essai, monde de test. Kallistè vote (élection K) ; Elaia reçoit les candidatures (élection E) ;
-- Halos a fini de voter (élection H), Ampelos n'a pas d'élection. Alice et Bob sont citoyens de Kallistè,
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
-- Antidatés, garde levée : Hélène avant Ion, chacun vote pour l'autre ; Bob candidat, Alice retirée.
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

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.vote(house text, election text, candidacy text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.ballots (election_id, house_id, candidacy_id) values (%L, %L, %L)',
    '00000000-0000-7000-8000-00000000510' || election, '00000000-0000-7000-8000-0000000051' || house,
    '00000000-0000-7000-8000-0000000051' || candidacy))
$$;
create function pg_temp.stand(house text, election text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.candidacies (election_id, house_id) values (%L, %L)',
    '00000000-0000-7000-8000-00000000510' || election, '00000000-0000-7000-8000-0000000051' || house))
$$;

select ok(relrowsecurity, format('règles par ligne actives sur game.%s', relname))
from pg_class where oid in ('game.elections'::regclass, 'game.candidacies'::regclass, 'game.ballots'::regclass, 'game.offices'::regclass)
order by relname;
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('elections', 'candidacies', 'ballots', 'offices')
     and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'ballots.candidacy_id:INSERT ballots.election_id:INSERT ballots.house_id:INSERT '
    || 'candidacies.election_id:INSERT candidacies.house_id:INSERT candidacies.withdrawn_at:UPDATE '
    || 'elections.candidacy_opens_at:INSERT elections.city_id:INSERT elections.office:INSERT elections.tallied_at:UPDATE '
    || 'elections.term_ends_at:INSERT elections.voting_closes_at:INSERT elections.voting_opens_at:INSERT elections.world_id:INSERT '
    || 'offices.city_id:INSERT offices.election_id:INSERT offices.ends_at:INSERT offices.house_id:INSERT '
    || 'offices.office:INSERT offices.starts_at:INSERT offices.vacated_at:UPDATE offices.world_id:INSERT',
  'le service ne choisit ni identifiant ni date fixée par la garde : liste figée');
-- Bulletins.
select lives_ok(pg_temp.vote('a1', 'a', 'b2'), 'une citoyenne vote pendant le vote, pour une candidature maintenue');
select throws_ok(pg_temp.vote('a1', 'a', 'b2'), '23505', null, 'un seul bulletin par maison et par élection');
select throws_ok(pg_temp.vote('c1', 'a', 'b2'), '23514', 'only citizens of the city vote', 'un métèque ne vote pas');
select throws_ok(pg_temp.vote('d1', 'a', 'b2'), '23514', 'only citizens of the city vote', 'ni le citoyen d''une autre cité');
select throws_ok(pg_temp.vote('b1', 'a', 'a2'), '23514', 'the candidacy was withdrawn', 'pas de bulletin pour une candidature retirée');
select throws_ok(pg_temp.vote('b1', 'a', 'e2'), '23503', null, 'ni pour la candidature d''une autre élection');
select throws_ok(pg_temp.vote('d1', 'e', 'b2'), '23514', 'outside the voting period', 'pas de bulletin pendant le dépôt des candidatures');
select throws_ok(pg_temp.vote('e1', 'f', 'f2'), '23514', 'outside the voting period', 'pas de bulletin après la fin du vote');
select throws_ok(
  $$insert into game.ballots (election_id, house_id, candidacy_id, cast_at) values ('00000000-0000-7000-8000-00000000510a',
    '00000000-0000-7000-8000-0000000051b1', '00000000-0000-7000-8000-0000000051b2', now() - interval '1 minute')$$,
  '23001', 'a ballot is cast now', 'même le propriétaire n''antidate pas un bulletin');
select throws_ok(
  $$update game.ballots set candidacy_id = candidacy_id where house_id = '00000000-0000-7000-8000-0000000051a1'$$,
  '23001', 'a ballot is final', 'un bulletin ne change plus');

-- Candidatures.
select lives_ok(pg_temp.stand('d1', 'e'), 'un citoyen se présente pendant le dépôt des candidatures');
select throws_ok(pg_temp.stand('d1', 'e'), '23505', null, 'une candidature par maison et par élection');
select throws_ok(pg_temp.stand('b1', 'e'), '23514', 'only citizens of the city stand', 'seul un citoyen de la cité se présente');
select throws_ok(pg_temp.stand('a1', 'a'), '23514', 'outside the filing period', 'pas de candidature pendant le vote');
select throws_ok(
  $$select pg_temp.as_service('update game.candidacies set withdrawn_at = now() where id = ''00000000-0000-7000-8000-0000000051b2''')$$,
  '23514', 'outside the filing period', 'pas de retrait pendant le vote');
select lives_ok(
  $$select pg_temp.as_service('update game.candidacies set withdrawn_at = now() where house_id = ''00000000-0000-7000-8000-0000000051d1''')$$,
  'retrait pendant le dépôt');
select throws_ok(
  $$select pg_temp.as_service('update game.candidacies set withdrawn_at = now() where house_id = ''00000000-0000-7000-8000-0000000051d1''')$$,
  '23001', 'a candidacy only changes by its withdrawal, now', 'un retrait est définitif');
select throws_ok(pg_temp.stand('d1', 'e'), '23505', null, 'une candidature retirée ne se redépose pas');

-- Élections.
select lives_ok(
  $$select pg_temp.as_service($s$insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
    values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000104', 'archon', now(), now() + interval '4 days', now() + interval '7 days', now() + interval '35 days')$s$)$$,
  'le service ouvre une élection');
select throws_ok(
  $$select pg_temp.as_service($s$insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
    values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000104', 'archon', now(), now() + interval '5 days', now() + interval '8 days', now() + interval '36 days')$s$)$$,
  '23505', null, 'une seule élection ouverte par cité et par charge');
select throws_ok(
  $$insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
    values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon', now(), now() + interval '9 days', now() + interval '8 days', now() + interval '36 days')$$,
  '23514', null, 'le calendrier se suit dans l''ordre : dépôt, vote, mandat');
select throws_ok(
  $$select pg_temp.as_service('update game.elections set tallied_at = now() where id = ''00000000-0000-7000-8000-00000000510a''')$$,
  '23001', 'an election is tallied after its vote', 'pas de dépouillement avant la fin du vote');
select throws_ok(
  $$update game.elections set voting_closes_at = now() where id = '00000000-0000-7000-8000-00000000510a'$$,
  '23001', 'an election calendar is immutable', 'ni le propriétaire');

-- Dépouillement et charge : à égalité, la candidature la plus ancienne (Hélène) l'emporte.
create function pg_temp.fill(house text, starts text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.offices (world_id, city_id, office, house_id, election_id, starts_at, ends_at)
     select world_id, city_id, office, %L, id, %s, term_ends_at from game.elections where id = %L',
    '00000000-0000-7000-8000-0000000051' || house, starts, '00000000-0000-7000-8000-00000000510f'))
$$;
select throws_ok(pg_temp.fill('e1', 'voting_closes_at'), '23001', 'an office is filled by the tally of its election',
  'pas de charge avant le dépouillement');
select lives_ok(
  $$select pg_temp.as_service('update game.elections set tallied_at = now() where id = ''00000000-0000-7000-8000-00000000510f''')$$,
  'le service dépouille une élection après la fin du vote');
select throws_ok(
  $$select pg_temp.as_service('update game.elections set tallied_at = now() where id = ''00000000-0000-7000-8000-00000000510f''')$$,
  '23001', 'an election is tallied once, now', 'une seule fois');
select throws_ok(pg_temp.fill('f1', 'voting_closes_at'), '23001', 'an office goes to the elected candidate',
  'la charge ne va pas à la candidature la plus récente quand les voix sont égales');
select throws_ok(pg_temp.fill('e1', 'now()'), '23001', 'an office follows its election calendar',
  'la charge suit le calendrier de son élection');
select lives_ok(pg_temp.fill('e1', 'voting_closes_at'), 'la charge va à la plus ancienne candidature en cas d''égalité');
select throws_ok(pg_temp.fill('e1', 'voting_closes_at'), '23505', null, 'une charge par élection');

select * from finish();
rollback;
