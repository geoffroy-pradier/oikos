begin;
select plan(39);

-- Jeu d'essai : deux mondes. Le premier a Kallistè et Halos, une élection en dépôt et une en vote à Kallistè, un décret
-- de Kallistè en vote ; Alice y est citoyenne de Kallistè, Bob y est métèque. Le second a Delphis et la maison de Dion.
-- Les maisons PNJ sont fondées par le service, comme la clôture le fait.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000715f1', 'secours-un', 'Secours un'),
  ('01900000-0000-7000-8000-0000000715f2', 'secours-deux', 'Secours deux');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000715c1', '01900000-0000-7000-8000-0000000715f1', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000715c2', '01900000-0000-7000-8000-0000000715f1', 'halos', 'Halos'),
  ('01900000-0000-7000-8000-0000000715c9', '01900000-0000-7000-8000-0000000715f2', 'delphis', 'Delphis');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000715a' || n)::uuid, 'npc-' || n || '@example.test' from unnest(array['a', 'b', 'd', 'e']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000715' || n || '1')::uuid, ('01900000-0000-7000-8000-0000000715f' || w)::uuid,
       ('00000000-0000-4000-8000-0000000715a' || n)::uuid, name, '{}'
from (values ('a', '1', 'Alcméonides'), ('b', '1', 'Philaïdes'), ('d', '2', 'Eumolpides')) h (n, w, name);
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000715a1', '01900000-0000-7000-8000-0000000715c1'),
  ('00000000-0000-7000-8000-0000000715b1', '01900000-0000-7000-8000-0000000715c1'),
  ('00000000-0000-7000-8000-0000000715d1', '01900000-0000-7000-8000-0000000715c9');
update game.citizenships set status = 'citizen', since = now() where house_id = '00000000-0000-7000-8000-0000000715a1';
-- Une maison PNJ qui ne tient encore aucune filière.
insert into game.houses (id, world_id, user_id, name, blazon, kind) values
  ('00000000-0000-7000-8000-0000000715e3', '01900000-0000-7000-8000-0000000715f1', null, 'Pressoirs de Halos', '{}', 'npc');
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at) values
  ('00000000-0000-7000-8000-000000715e01', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c1', 'archon',
   now() - interval '1 hour', now() + interval '1 day', now() + interval '2 days', now() + interval '30 days');
alter table game.elections disable trigger elections_guard;
alter table game.candidacies disable trigger candidacies_guard;
alter table game.decrees disable trigger decrees_guard;
alter table game.decrees disable trigger decrees_guard_ostracism;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at) values
  ('00000000-0000-7000-8000-000000715e02', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c2', 'archon',
   now() - interval '3 days', now() - interval '1 hour', now() + interval '1 day', now() + interval '29 days');
insert into game.candidacies (id, election_id, house_id, created_at) values
  ('00000000-0000-7000-8000-000000715ca1', '00000000-0000-7000-8000-000000715e02', '00000000-0000-7000-8000-0000000715a1', now() - interval '2 days');
alter table game.offices disable trigger offices_guard;
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at) values
  ('00000000-0000-7000-8000-000000715af1', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c1', 'archon',
   '00000000-0000-7000-8000-0000000715a1', '00000000-0000-7000-8000-000000715e01', now() - interval '1 day', now() + interval '20 days');
alter table game.offices enable trigger offices_guard;
insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at, quorum_bps)
values ('00000000-0000-7000-8000-000000715dc1', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c1',
        'public_works', '{"amountOboles": 600}', '00000000-0000-7000-8000-000000715af1', '00000000-0000-7000-8000-0000000715a1', now() - interval '1 hour',
        now() + interval '1 day', 5000);
alter table game.elections enable trigger elections_guard;
alter table game.candidacies enable trigger candidacies_guard;
alter table game.decrees enable trigger decrees_guard;
alter table game.decrees enable trigger decrees_guard_ostracism;

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.as_player(account text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    format('{"sub": "00000000-0000-4000-8000-0000000715a%s", "role": "authenticated"}', account), true);
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pg_temp.as_owner(), pg_temp.as_player(text) to authenticated;
-- Fonde une maison PNJ comme la clôture : maison sans compte, citoyenneté, filière.
create function pg_temp.found(house text, world text, city text, chain text, name text) returns void language sql as $$
  select pg_temp.as_service(format($s$
    insert into game.houses (id, world_id, user_id, name, blazon, kind) values (%1$L, %2$L, null, %5$L, '{}', 'npc');
    insert into game.citizenships (house_id, city_id) values (%1$L, %3$L);
    insert into game.npc_houses (house_id, world_id, city_id, chain_id) values (%1$L, %2$L, %3$L, %4$L)$s$,
    house, world, city, chain, name));
$$;

-- Une maison PNJ n'a pas de compte, une maison de joueur en a un ; aucune ne change de nature ni de compte.
select lives_ok($$select pg_temp.found('00000000-0000-7000-8000-0000000715e1', '01900000-0000-7000-8000-0000000715f1',
  '01900000-0000-7000-8000-0000000715c1', 'bread', 'Greniers de Kallistè')$$, 'le service fonde une maison PNJ, sans compte');
select lives_ok($$select pg_temp.found('00000000-0000-7000-8000-0000000715e9', '01900000-0000-7000-8000-0000000715f2',
  '01900000-0000-7000-8000-0000000715c9', 'bread', 'Greniers de Delphis')$$, 'et une autre dans le second monde');
select throws_ok($$select pg_temp.as_service($s$insert into game.houses (world_id, user_id, name, blazon, kind)
  values ('01900000-0000-7000-8000-0000000715f1', '00000000-0000-4000-8000-0000000715ae', 'Pressoirs', '{}', 'npc')$s$)$$,
  '23514', null, 'une maison PNJ n''a pas de compte');
select throws_ok($$select pg_temp.as_service($s$insert into game.houses (world_id, user_id, name, blazon, kind)
  values ('01900000-0000-7000-8000-0000000715f1', null, 'Pressoirs', '{}', 'player')$s$)$$,
  '23514', null, 'une maison de joueur a un compte');
select throws_ok($$select pg_temp.as_service($s$insert into game.houses (world_id, user_id, name, blazon)
  values ('01900000-0000-7000-8000-0000000715f1', null, 'Pressoirs', '{}')$s$)$$,
  '23514', null, 'une maison fondée sans nature est une maison de joueur, qui a un compte');
select throws_ok($$select pg_temp.as_service($s$update game.houses set kind = 'player'
  where id = '00000000-0000-7000-8000-0000000715e1'$s$)$$, '42501', null, 'le service ne change pas la nature d''une maison');
select throws_ok($$select pg_temp.as_service($s$update game.houses set user_id = '00000000-0000-4000-8000-0000000715ae'
  where id = '00000000-0000-7000-8000-0000000715e1'$s$)$$, '42501', null, 'ni ne donne un compte à une maison PNJ');
select is((select convalidated from pg_constraint where conname = 'houses_account_by_kind'), true,
  'la contrainte vaut pour toutes les maisons, validée');

-- Aucune commande n'agit pour elle : aucun compte ne la désigne, ni par `current_house_ids()` ni par son compte.
select pg_temp.as_player('a');
select results_eq('select * from game.current_house_ids()', $$values ('00000000-0000-7000-8000-0000000715a1'::uuid)$$,
  'le compte d''Alice ne désigne que sa maison');
select pg_temp.as_player('e');
select is((select count(*) from game.current_house_ids()), 0::bigint, 'un compte sans maison n''en désigne aucune, PNJ comprise');
select pg_temp.as_owner();

-- Filière : une maison PNJ par cité et par filière, dans le monde de sa cité, et seulement une maison PNJ.
select throws_ok($$select pg_temp.found('00000000-0000-7000-8000-0000000715e2', '01900000-0000-7000-8000-0000000715f1',
  '01900000-0000-7000-8000-0000000715c1', 'bread', 'Fournils de Kallistè')$$, '23505', null,
  'une seule maison PNJ par cité et par filière');
select lives_ok($$select pg_temp.found('00000000-0000-7000-8000-0000000715e2', '01900000-0000-7000-8000-0000000715f1',
  '01900000-0000-7000-8000-0000000715c2', 'bread', 'Greniers de Halos')$$, 'la même filière dans une autre cité');
select throws_ok($$select pg_temp.as_service($s$insert into game.npc_houses (house_id, world_id, city_id, chain_id) values
  ('00000000-0000-7000-8000-0000000715b1', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c2', 'oil')$s$)$$,
  '23503', null, 'une maison de joueur ne tient pas de filière');
select throws_ok($$select pg_temp.as_service($s$insert into game.npc_houses (house_id, world_id, city_id, chain_id) values
  ('00000000-0000-7000-8000-0000000715e3', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c9', 'oil')$s$)$$,
  '23503', null, 'ni une cité d''un autre monde');
select throws_ok($$select pg_temp.as_service($s$insert into game.npc_houses (house_id, world_id, city_id, chain_id, house_kind)
  values ('00000000-0000-7000-8000-0000000715b1', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c2', 'oil', 'player')$s$)$$,
  '42501', null, 'le service ne choisit pas la nature');
select throws_ok($$select pg_temp.as_service($s$insert into game.npc_houses (house_id, world_id, city_id, chain_id, founded_at)
  values ('00000000-0000-7000-8000-0000000715e2', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c2', 'oil', now())$s$)$$,
  '42501', null, 'ni la date de fondation');
select throws_ok($$select pg_temp.as_service($s$update game.npc_houses set chain_id = 'oil'$s$)$$, '42501', null,
  'le service ne change pas de filière');
select throws_ok($$select pg_temp.as_service($s$delete from game.npc_houses$s$)$$, '42501', null, 'ni n''en supprime');

-- Jamais citoyenne : métèque de sa cité, elle n'est pas promue, ne se présente ni ne vote.
select throws_ok($$select pg_temp.as_service($s$update game.citizenships set status = 'citizen', since = now()
  where house_id = '00000000-0000-7000-8000-0000000715e1'$s$)$$, '23514', 'an NPC house is never a citizen',
  'une maison PNJ ne devient pas citoyenne');
select lives_ok($$select pg_temp.as_service($s$update game.citizenships set status = 'citizen', since = now()
  where house_id = '00000000-0000-7000-8000-0000000715b1'$s$)$$, 'un métèque joueur, lui, est promu');
select is((select status from game.citizenships where house_id = '00000000-0000-7000-8000-0000000715e1'), 'metic',
  'la maison PNJ reste métèque');
select throws_ok($$select pg_temp.as_service($s$insert into game.candidacies (election_id, house_id)
  values ('00000000-0000-7000-8000-000000715e01', '00000000-0000-7000-8000-0000000715e1')$s$)$$, '23514', 'only citizens of the city stand',
  'elle ne se présente pas à une élection');
select throws_ok($$select pg_temp.as_service($s$insert into game.ballots (election_id, house_id, candidacy_id)
  values ('00000000-0000-7000-8000-000000715e02', '00000000-0000-7000-8000-0000000715e2', '00000000-0000-7000-8000-000000715ca1')$s$)$$,
  '23514', 'only citizens of the city vote', 'elle ne vote à aucune élection');
select throws_ok($$select pg_temp.as_service($s$insert into game.decree_votes (decree_id, house_id, approve)
  values ('00000000-0000-7000-8000-000000715dc1', '00000000-0000-7000-8000-0000000715e1', true)$s$)$$,
  '23514', 'only citizens of the city vote', 'ni à aucun décret');

-- Lecture : un joueur connecté lit les maisons PNJ de son monde, sans filière ni date ; il n'écrit rien.
select pg_temp.as_player('a');
select results_eq($$select house_id::text, city_id::text from public.npc_houses order by house_id$$,
  $$values ('00000000-0000-7000-8000-0000000715e1', '01900000-0000-7000-8000-0000000715c1'),
           ('00000000-0000-7000-8000-0000000715e2', '01900000-0000-7000-8000-0000000715c2')$$,
  'Alice lit les maisons PNJ de son monde, et elles seules');
select results_eq($$select name, city_id::text, citizenship_status, is_mine from public.houses
  where id = '00000000-0000-7000-8000-0000000715e1'$$,
  $$values ('Greniers de Kallistè'::text, '01900000-0000-7000-8000-0000000715c1', 'metic'::text, false)$$,
  'la vue des maisons la montre métèque de sa cité, et pas la sienne');
select is((select count(*) from public.npc_houses where house_id = '00000000-0000-7000-8000-0000000715a1'), 0::bigint,
  'une maison de joueur n''y figure pas');
select throws_ok('select chain_id from game.npc_houses', '42501', null, 'la filière ne se lit pas');
select throws_ok('select founded_at from game.npc_houses', '42501', null, 'ni la date de fondation');
select throws_ok($$insert into game.npc_houses (house_id, world_id, city_id, chain_id) values
  ('00000000-0000-7000-8000-0000000715a1', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c2', 'oil')$$,
  '42501', null, 'un joueur n''écrit pas de maison PNJ');
select throws_ok($$delete from game.npc_houses$$, '42501', null, 'ni n''en supprime');
select throws_ok($$update game.npc_houses set city_id = city_id$$, '42501', null, 'ni n''en modifie');
select throws_ok($$insert into public.npc_houses (house_id, world_id, city_id) values
  ('00000000-0000-7000-8000-0000000715a1', '01900000-0000-7000-8000-0000000715f1', '01900000-0000-7000-8000-0000000715c2')$$,
  '42501', null, 'ni par la vue');
select pg_temp.as_player('d');
select results_eq($$select house_id::text from public.npc_houses$$, $$values ('00000000-0000-7000-8000-0000000715e9')$$,
  'Dion ne lit que celle de son monde');
select is((select count(*) from public.npc_houses where world_id = '01900000-0000-7000-8000-0000000715f1'), 0::bigint,
  'rien du premier monde, même filtré sur lui');
select pg_temp.as_player('e');
select is((select count(*) from public.npc_houses), 0::bigint, 'un compte sans maison n''en lit aucune');
select pg_temp.as_owner();
set local role anon;
select throws_ok('select * from public.npc_houses', '42501', null, 'un visiteur anonyme ne lit pas la vue');
select throws_ok('select house_id from game.npc_houses', '42501', null, 'ni la table');
reset role;

-- Le service lit tout : la filière et la nature, pour la clôture.
set local role oikos_service;
select set_config('t.v', (select string_agg(chain_id || '@' || house_kind, ' ' order by city_id) from game.npc_houses
  where world_id = '01900000-0000-7000-8000-0000000715f1'), true);
reset role;
select is(current_setting('t.v'), 'bread@npc bread@npc', 'filières et nature, pour le service');

select * from finish();
rollback;
