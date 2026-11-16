begin;
select plan(19);

-- Lectures des joueurs. Alice est archonte de Kallistè, Bob y est citoyen, Dion est citoyen d'Elaia. Deux
-- décrets de Kallistè : O au vote (Alice pour, Bob contre), T dépouillé et adopté. Décrets, votes, élection et
-- charge posés garde levée.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000111a' || u)::uuid, 'decree-reads-' || u || '@example.test'
from unnest(array['a', 'b', 'd']) u;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000111' || u || '1')::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-4000-8000-0000000111a' || u)::uuid, n, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('d', 'Étéoboutades')) as v (u, n);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000000111' || u || '1')::uuid, ('01900000-0000-7000-8000-000000000' || c)::uuid
from (values ('a', '101'), ('b', '101'), ('d', '103')) as v (u, c);
update game.citizenships set status = 'citizen', since = now() where house_id::text like '00000000-0000-7000-8000-0000000111%';
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
alter table game.decrees disable trigger decrees_guard;
alter table game.decree_votes disable trigger decree_votes_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values ('00000000-0000-7000-8000-00000001110a', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
  now() - interval '8 days', now() - interval '4 days', now() - interval '1 day', now() + interval '27 days', now());
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select '00000000-0000-7000-8000-00000001110a', world_id, city_id, office, '00000000-0000-7000-8000-0000000111a1', id, voting_closes_at, term_ends_at
from game.elections where id = '00000000-0000-7000-8000-00000001110a';
insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at, quorum_bps,
  status, tallied_at, electorate, votes_for, votes_against)
values
  ('00000000-0000-7000-8000-0000000111d0', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
   'market_tax_rate', '{"rateBps": 600}', '00000000-0000-7000-8000-00000001110a', '00000000-0000-7000-8000-0000000111a1',
   now() - interval '1 hour', now() + interval '2 days', 2000, 'proposed', null, null, null, null),
  ('00000000-0000-7000-8000-0000000111d7', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
   'public_works', '{"amountOboles": 600}', '00000000-0000-7000-8000-00000001110a', '00000000-0000-7000-8000-0000000111a1',
   now() - interval '4 days', now() - interval '1 day', 2000, 'adopted', now() - interval '1 day', 2, 2, 0);
insert into game.decree_votes (decree_id, house_id, approve) values
  ('00000000-0000-7000-8000-0000000111d0', '00000000-0000-7000-8000-0000000111a1', true),
  ('00000000-0000-7000-8000-0000000111d0', '00000000-0000-7000-8000-0000000111b1', false);
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;
alter table game.decrees enable trigger decrees_guard;
alter table game.decree_votes enable trigger decree_votes_guard;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c111',
  '{"decrees": {"votingDays": 2, "quorumBps": 2000, "maxOpenPerCity": 3, "spendingCapShareBps": 2500,
    "models": {"market_tax_rate": {"minRateBps": 200, "maxRateBps": 1000}, "public_works": {"minOboles": 600, "maxOboles": 60000}}}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c111', now());

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('decrees', 'decree_votes')),
  'decree_votes:decree_votes_read_own:SELECT:authenticated decree_votes:service_all:ALL:oikos_service '
    || 'decrees:decrees_read:SELECT:authenticated decrees:service_all:ALL:oikos_service',
  'décrets publics, votes : seulement ceux de sa maison ; aucune écriture pour les joueurs');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name in ('decrees', 'my_decree_votes', 'decree_rules')),
  'decree_rules:authenticated:SELECT decrees:authenticated:SELECT my_decree_votes:authenticated:SELECT',
  'vues en lecture seule, rien pour un visiteur anonyme');
select ok(not has_function_privilege('anon', 'game.decree_rules()', 'execute')
  and has_function_privilege('authenticated', 'game.decree_rules()', 'execute'),
  'règles exécutables par un joueur connecté, pas par un visiteur anonyme');

-- Alice.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000111aa", "role": "authenticated"}';
select is((select string_agg(right(decree_id::text, 2) || ':' || right(house_id::text, 2), ' ') from public.my_decree_votes),
  'd0:a1', 'Alice lit qu''elle a voté');
select throws_ok('select approve from game.decree_votes', '42501', null, 'mais pas son choix');
select is(
  (select string_agg(right(id::text, 2) || ':' || status || ':' || coalesce(votes_for || '/' || votes_against || '/' || electorate, 'secret'), ' ' order by id)
   from public.decrees where city_id = '01900000-0000-7000-8000-000000000101'),
  'd0:proposed:secret d7:adopted:2/0/2', 'les décrets de la cité sont publics, le décompte seulement après le dépouillement');
select is((select params ->> 'rateBps' from public.decrees where id = '00000000-0000-7000-8000-0000000111d0'), '600',
  'paramètres publics');
select throws_ok('select office_id from game.decrees', '42501', null, 'rien d''autre que les colonnes de la vue');
select is(
  (select string_agg(model || ':' || (bounds ->> case model when 'public_works' then 'maxOboles' else 'maxRateBps' end) || ':' || voting_days
     || ':' || quorum_bps || ':' || max_open_per_city || ':' || spending_cap_share_bps, ' ' order by model) from public.decree_rules),
  'market_tax_rate:1000:2:2000:3:2500 public_works:60000:2:2000:3:2500', 'modèles ouverts et bornes en vigueur');

-- Bob, puis Dion.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000111ab", "role": "authenticated"}';
select is((select string_agg(right(house_id::text, 2), ' ') from public.my_decree_votes), 'b1', 'Bob ne lit que son vote');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000111ad", "role": "authenticated"}';
select is((select count(*) from public.my_decree_votes), 0::bigint, 'Dion ne lit aucun vote d''une autre maison');
select is((select count(*) from game.decree_votes), 0::bigint, 'ni dans la table');
select is((select count(*) from public.decrees where id::text like '00000000-0000-7000-8000-0000000111d%'), 2::bigint,
  'mais il lit les décrets d''une autre cité');
select throws_ok(
  $$insert into game.decree_votes (decree_id, house_id, approve) values ('00000000-0000-7000-8000-0000000111d0',
    '00000000-0000-7000-8000-0000000111d1', true)$$,
  '42501', null, 'un joueur ne vote pas sans l''API');
select throws_ok(
  $$insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by, voting_closes_at, quorum_bps)
    values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000103', 'festival', '{}',
    '00000000-0000-7000-8000-00000001110a', '00000000-0000-7000-8000-0000000111d1', now() + interval '1 day', 0)$$,
  '42501', null, 'ni ne propose sans l''API');
select throws_ok($$update game.decrees set status = 'rejected'$$, '42501', null, 'ni ne dépouille');
reset role;
set local role anon;
select throws_ok('select * from public.decrees', '42501', null, 'un visiteur anonyme ne lit rien');
select throws_ok('select * from public.my_decree_votes', '42501', null, 'ni les votes');
select throws_ok('select * from game.decree_rules()', '42501', null, 'ni les règles par la fonction');
reset role;

select * from finish();
rollback;
