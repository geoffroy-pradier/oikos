begin;
select plan(31);

-- Jeu d'essai, monde de test. Alice est archonte de Kallistè ; Bob l'a été (mandat passé) ; Chloé y est
-- métèque ; Dion est citoyen d'Elaia ; Eudore est devenu citoyen de Kallistè à l'instant. Alice, Bob et Dion
-- sont citoyens depuis dix jours (garde levée le temps de l'antidater).
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000110a' || u)::uuid, 'decree-' || u || '@example.test'
from unnest(array['a', 'b', 'c', 'd', 'e']) u;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000110' || u || '1')::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-4000-8000-0000000110a' || u)::uuid, n, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Bouzyges'), ('d', 'Étéoboutades'), ('e', 'Eunides')) as v (u, n);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000000110' || u || '1')::uuid, ('01900000-0000-7000-8000-000000000' || c)::uuid
from (values ('a', '101'), ('b', '101'), ('c', '101'), ('d', '103'), ('e', '101')) as v (u, c);
update game.citizenships set status = 'citizen', since = now() where house_id = '00000000-0000-7000-8000-0000000110e1';
alter table game.citizenships disable trigger citizenships_guard;
update game.citizenships set status = 'citizen', since = now() - interval '10 days'
where house_id in ('00000000-0000-7000-8000-0000000110a1', '00000000-0000-7000-8000-0000000110b1', '00000000-0000-7000-8000-0000000110d1');
alter table game.citizenships enable trigger citizenships_guard;
-- Charges : Alice en charge, Bob au mandat passé ; élections et charges posées garde levée.
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values
  ('00000000-0000-7000-8000-00000001100a', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
   now() - interval '8 days', now() - interval '4 days', now() - interval '1 day', now() + interval '27 days', now()),
  ('00000000-0000-7000-8000-00000001100b', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
   now() - interval '37 days', now() - interval '33 days', now() - interval '30 days', now() - interval '2 days', now());
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select ('00000000-0000-7000-8000-00000001100' || o)::uuid, world_id, city_id, office, ('00000000-0000-7000-8000-0000000110' || o || '1')::uuid,
       id, voting_closes_at, term_ends_at
from game.elections e join (values ('a'), ('b')) as v (o) on e.id = ('00000000-0000-7000-8000-00000001100' || o)::uuid;
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;
-- Deux décrets de Kallistè dont le vote est clos depuis une heure, proposés et votés il y a trois jours
-- (garde levée) : C, quorum 50 %, Alice et Bob pour ; Q, quorum 100 %, Alice seule pour.
alter table game.decrees disable trigger decrees_guard;
alter table game.decree_votes disable trigger decree_votes_guard;
insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at, quorum_bps)
select ('00000000-0000-7000-8000-0000000110d' || d)::uuid, '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
       'public_works', '{"amountOboles": 600}', '00000000-0000-7000-8000-00000001100a', '00000000-0000-7000-8000-0000000110a1',
       now() - interval '3 days', now() - interval '1 hour', q
from (values ('c', 5000), ('f', 10000)) as v (d, q);
insert into game.decree_votes (decree_id, house_id, approve, cast_at)
select ('00000000-0000-7000-8000-0000000110d' || d)::uuid, ('00000000-0000-7000-8000-0000000110' || h || '1')::uuid, true, now() - interval '2 days'
from (values ('c', 'a'), ('c', 'b'), ('f', 'a')) as v (d, h);
alter table game.decrees enable trigger decrees_guard;
alter table game.decree_votes enable trigger decree_votes_guard;

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Décret du jeu d'essai, ou « 1 » : celui que la proposition crée dans ce test.
create function pg_temp.decree(decree text) returns uuid language sql as $$
  select case when decree = '1' then (select id from game.decrees where proposed_at = now())
              else ('00000000-0000-7000-8000-0000000110d' || decree)::uuid end
$$;
-- Proposition : maison, charge, cité (101 Kallistè, 103 Elaia) et fin du vote.
create function pg_temp.propose(house text, office text, city text default '101',
  closes text default 'now() + interval ''2 days''', model text default 'public_works', params text default '{"amountOboles": 600}')
returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by, voting_closes_at, quorum_bps) '
    'values (%L, %L, %L, %L, %L, %L, %s, 2000)',
    '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000' || city,
    model, params, '00000000-0000-7000-8000-00000001100' || office, '00000000-0000-7000-8000-0000000110' || house || '1', closes))
$$;
create function pg_temp.vote(house text, decree text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.decree_votes (decree_id, house_id, approve) values (%L, %L, true)',
    pg_temp.decree(decree), '00000000-0000-7000-8000-0000000110' || house || '1'))
$$;
create function pg_temp.tally(decree text, status text, electorate int, votes_for int, votes_against int) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'update game.decrees set status = %L, tallied_at = now(), electorate = %s, votes_for = %s, votes_against = %s where id = %L',
    status, electorate, votes_for, votes_against, pg_temp.decree(decree)))
$$;

select ok(relrowsecurity, format('règles par ligne actives sur game.%s', relname))
from pg_class where oid in ('game.decrees'::regclass, 'game.decree_votes'::regclass) order by relname;
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('decrees', 'decree_votes') and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'decree_votes.approve:INSERT decree_votes.decree_id:INSERT decree_votes.house_id:INSERT '
    || 'decrees.applied_at:UPDATE decrees.city_id:INSERT decrees.electorate:UPDATE decrees.model:INSERT decrees.office_id:INSERT decrees.params:INSERT '
    || 'decrees.proposed_by:INSERT decrees.quorum_bps:INSERT decrees.status:UPDATE decrees.tallied_at:UPDATE '
    || 'decrees.votes_against:UPDATE decrees.votes_for:UPDATE decrees.voting_closes_at:INSERT decrees.world_id:INSERT',
  'le service ne choisit ni identifiant, ni date, ni état à la proposition : liste figée');
select is(
  (select string_agg(table_name || ':' || privilege_type, ' ' order by table_name, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'game' and table_name in ('decrees', 'decree_votes') and grantee in ('anon', 'authenticated', 'oikos_service')
     and privilege_type <> 'SELECT'),
  null, 'aucune suppression, aucune écriture de table entière, rien pour les joueurs');

-- Proposition.
select lives_ok(pg_temp.propose('a', 'a'), 'l''archonte en charge propose un décret à sa cité');
select is((select status || ':' || (proposed_at = now()) from game.decrees where id = pg_temp.decree('1')),
  'proposed:true', 'proposé maintenant, au vote');
select throws_ok(pg_temp.propose('b', 'a'), '23514', null, 'une autre maison ne propose pas sous la charge de l''archonte');
select throws_ok(pg_temp.propose('b', 'b'), '23514', null, 'ni l''archonte d''un mandat passé');
select throws_ok(pg_temp.propose('a', 'a', '103'), '23514', null, 'ni l''archonte dans une autre cité');
select throws_ok(pg_temp.propose('a', 'a', '101', 'now()'), '23514', null, 'le vote finit après la proposition');
select throws_ok(pg_temp.propose('a', 'a', model => 'embargo'), '23514', null, 'un modèle hors du catalogue est refusé');
select throws_ok(pg_temp.propose('a', 'a', params => '[600]'), '23514', null, 'des paramètres sont un objet');
select throws_ok(
  $$select pg_temp.as_service('insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by, voting_closes_at, quorum_bps, status)
    values (''01900000-0000-7000-8000-000000000001'', ''01900000-0000-7000-8000-000000000101'', ''public_works'', ''{}'',
    ''00000000-0000-7000-8000-00000001100a'', ''00000000-0000-7000-8000-0000000110a1'', now() + interval ''1 day'', 0, ''adopted'')')$$,
  '42501', null, 'le service ne propose pas un décret déjà adopté');
select throws_ok($$select pg_temp.as_service('delete from game.decrees')$$, '42501', null, 'ni ne supprime un décret');

-- Votes.
select lives_ok(pg_temp.vote('b', '1'), 'un citoyen vote pendant le vote');
select lives_ok(pg_temp.vote('e', '1'), 'une maison devenue citoyenne vote aussitôt');
select throws_ok(pg_temp.vote('b', '1'), '23505', null, 'un seul vote par maison et par décret');
select throws_ok(pg_temp.vote('c', '1'), '23514', null, 'un métèque ne vote pas');
select throws_ok(pg_temp.vote('d', '1'), '23514', null, 'ni le citoyen d''une autre cité');
select throws_ok(pg_temp.vote('e', 'c'), '23514', null, 'ni un citoyen de la cité après la fin du vote');
select is((select approve::text || ':' || (cast_at = now()) from game.decree_votes
           where decree_id = pg_temp.decree('1') and house_id = '00000000-0000-7000-8000-0000000110b1'),
  'true:true', 'le vote est daté de sa transaction');
select throws_ok($$select pg_temp.as_service('update game.decree_votes set approve = false')$$, '42501', null,
  'le service ne change pas un vote');
select throws_ok('update game.decree_votes set approve = false', '23001', null, 'et la base le refuse à tous');

-- Dépouillement : la base recompte les votes et les citoyens devenus citoyens avant la fin du vote (Alice et
-- Bob, pas Eudore).
select throws_ok(pg_temp.tally('1', 'rejected', 3, 2, 0), '23001', null, 'pas de dépouillement avant la fin du vote');
select throws_ok(pg_temp.tally('c', 'adopted', 3, 2, 0), '23001', null, 'un citoyen promu après la fin du vote n''est pas compté');
select throws_ok(pg_temp.tally('c', 'rejected', 2, 2, 0), '23001', null, 'quorum et majorité : adopté, pas rejeté');
select throws_ok(pg_temp.tally('c', 'adopted', 2, 1, 1), '23001', null, 'les votes sont recomptés');
select lives_ok(pg_temp.tally('c', 'adopted', 2, 2, 0), 'deux pour sur deux citoyens, quorum de 50 % : adopté');
select throws_ok(pg_temp.tally('c', 'adopted', 2, 2, 0), '23001', null, 'un décret n''est dépouillé qu''une fois');
select throws_ok(pg_temp.tally('f', 'adopted', 2, 1, 0), '23001', null, 'un pour sur deux, quorum de 100 % : pas adopté');
select lives_ok(pg_temp.tally('f', 'rejected', 2, 1, 0), 'quorum manqué : rejeté malgré la majorité');

select * from finish();
rollback;
