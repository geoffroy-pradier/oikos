begin;
select plan(32);

-- Jeu d'essai : deux comptes, deux maisons dans la cité de test.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001',
   '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001',
   '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101');

-- Règles par ligne actives sur toutes les tables.
select ok(relrowsecurity, format('règles par ligne actives sur game.%s', relname))
from pg_class
where relnamespace = 'game'::regnamespace and relkind = 'r'
  and relname in ('worlds', 'cities', 'houses', 'citizenships')
order by relname;

-- Règle 3 : aucune table de `game` n'est accessible en écriture aux rôles clients.
select is(
  (select count(*)
   from pg_class c, unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update', 'delete', 'truncate']) p
   where c.relnamespace = 'game'::regnamespace and c.relkind in ('r', 'p')
     and has_table_privilege(r, c.oid, p)),
  0::bigint,
  'aucun droit d''écriture client sur les tables de game'
);

-- Liste exacte de ce qu'un joueur connecté peut lire dans `game` : toute extension doit modifier ce test.
select is(
  (select string_agg(format('%s(%s)', t, cols), ' ' order by t collate "C")
   from (select table_name::text as t, string_agg(column_name::text, ',' order by column_name::text collate "C") as cols
         from information_schema.column_privileges
         where grantee = 'authenticated' and table_schema = 'game' and privilege_type = 'SELECT'
         group by table_name) granted),
  'accounts(balance,house_id,id,kind) ballots(cast_at,election_id,house_id) '
    || 'candidacies(created_at,election_id,house_id,id,withdrawn_at) '
    || 'channels(city_id,created_at,house_high,house_low,id,kind,world_id) '
    || 'chronicle_articles(city_id,created_at,game_day,id,source,text_en,text_fr,world_id) '
    || 'cities(created_at,id,name,slug,world_id) '
    || 'citizenships(city_id,house_id,id,since,status) '
    || 'decree_votes(cast_at,decree_id,house_id) '
    || 'decrees(applied_at,city_id,electorate,id,model,params,proposed_at,proposed_by,quorum_bps,settled_day,status,tallied_at,votes_against,votes_for,voting_closes_at,world_id) '
    || 'elections(candidacy_opens_at,city_id,id,office,tallied_at,term_ends_at,voting_closes_at,voting_opens_at,world_id) '
    || 'favor(charis,god_id,house_id) graces_used(charis_spent,consumed_at,effect,god_id,grace_id,house_id,id,invoked_at,magnitude_bps,ready_at) '
    || 'houses(blazon,created_at,id,name,world_id) '
    || 'inventories(city_id,good_id,house_id,id,quantity,reserved) '
    || 'labor_market(city_id,employed,game_day,lodging_oboles,supply,unhoused,wage_oboles) '
    || 'leases(end_reason,end_requested_at,end_requested_by,ended_at,ended_day,id,landlord_house_id,property_id,rent_oboles,started_at,tenant_house_id) '
    || 'ledger_entries(created_at,id,kind) ledger_lines(account_id,amount,entry_id,nature) '
    || 'messages(channel_id,created_at,hidden_at,house_id,id,visible_body) '
    || 'npc_population(city_id,class_id,closed_day,coverage_bps,population) '
    || 'observed_prices(city_id,good_id,observed_at,price,volume,window_seconds) '
    || 'offices(city_id,election_id,ends_at,house_id,id,office,starts_at,world_id) '
    || 'oracle_consultations(city_id,created_at,house_id,id,oracle_ids) oracles(id,source,text_en,text_fr) '
    || 'orders(city_id,created_at,good_id,house_id,id,price,quantity,remaining,side,status) '
    || 'price_candles(city_id,close,good_id,high,low,open,period_seconds,period_start,turnover,volume) '
    || 'properties(acquired_at,city_id,condition,id,lot,owner_house_id,size_id,upkeep_unpaid_since) '
    || 'property_listings(closed_at,created_at,house_id,id,kind,ledger_entry_id,outcome,price_oboles,property_id) '
    || 'reports(created_at,house_id,id,message_id,reason,state) '
    || 'ships(class_id,docked_city_id,house_id,id,laid_up_at) sites(city_id,cycle_started_at,halted_at,house_id,id,recipe_id) '
    || 'steward_rules(good_id,kind,position,price_oboles,revision,steward_id,units) stewards(dismissed_at,hired_at,house_id,id,name,rules_revision,site_id,unpaid_since) '
    || 'trades(ledger_entry_id,price,quantity,sell_order_id) voyage_cargo(good_id,quantity,voyage_id) '
    || 'voyages(arrived_at,arrives_at,departed_at,from_city_id,house_id,id,ship_id,to_city_id) '
    || 'world_events(city_id,end_day,ends_at,good_id,id,magnitude_bps,model,other_city_id,start_day,starts_at,world_id) '
    || 'worlds(created_at,id,name,slug)',
  'colonnes de game lisibles par authenticated : liste figée');
select is(
  (select count(*) from information_schema.column_privileges
   where grantee in ('anon', 'authenticated') and table_schema = 'game' and privilege_type <> 'SELECT'),
  0::bigint, 'aucun droit par colonne autre que la lecture');
select ok(not has_function_privilege('anon', 'game.current_house_ids()', 'execute'),
  'anon n''appelle pas current_house_ids');

-- Contraintes d'intégrité.
select throws_ok(
  $$insert into game.houses (world_id, user_id, name, blazon)
    values ('01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Seconde', '{}')$$,
  '23505', null, 'une seule maison par joueur et par monde');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000c', 'chloe@example.test');
select throws_ok(
  $$insert into game.houses (world_id, user_id, name, blazon)
    values ('01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', 'ALCMÉONIDES', '{}')$$,
  '23505', null, 'nom unique, sans tenir compte de la casse');
select throws_ok(
  format($$insert into game.houses (world_id, user_id, name, blazon)
    values ('01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', %L, '{}')$$, bad),
  '23514', null, format('nom refusé : « %s »', bad))
from unnest(array['Ab', ' Espace', 'Chiffre1', 'Nom<script>', repeat('a', 25)]) as bad;
select throws_ok(
  $$insert into game.citizenships (house_id, city_id)
    values ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101')$$,
  '23505', null, 'une seule citoyenneté par maison');
select matches(game.uuid_v7()::text, '^[0-9a-f]{8}-[0-9a-f]{4}-7', 'uuid_v7 produit un UUID de version 7');

-- Visiteur anonyme : aucune lecture.
set local role anon;
select throws_ok('select * from public.houses', '42501', null, 'anon ne lit pas les maisons');
select throws_ok('select * from public.cities', '42501', null, 'anon ne lit pas les cités');

-- Joueuse connectée (Alice).
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';

select is((select count(*) from public.cities where world_id = '01900000-0000-7000-8000-000000000001'), 4::bigint, 'les quatre cités du monde de test sont lisibles');
select is((select count(*) from public.houses where name in ('Alcméonides', 'Philaïdes')), 2::bigint, 'les profils de maison sont publics');
select results_eq(
  'select name from public.houses where is_mine',
  $$values ('Alcméonides'::text)$$,
  'is_mine ne désigne que sa propre maison');
select is(
  (select citizenship_status from public.houses where is_mine), 'metic',
  'le nouveau venu est métèque');
select hasnt_column('public', 'houses', 'user_id', 'l''identifiant de compte ne sort pas');

select throws_ok(
  $$insert into public.cities (world_id, slug, name)
    values ('01900000-0000-7000-8000-000000000001', 'pirate', 'Pirate')$$,
  '42501', null, 'pas d''insertion par une vue');
select throws_ok(
  $$update public.worlds set name = 'Volé'$$,
  '42501', null, 'pas de modification par une vue');
select throws_ok('select user_id from game.houses', '42501', null, 'user_id illisible, même en direct');
select throws_ok('select name_key from game.houses', '42501', null, 'name_key illisible');
select throws_ok('select * from game.houses', '42501', null, 'pas de lecture de toutes les colonnes');
select throws_ok(
  $$update game.houses set name = 'Volée'$$,
  '42501', null, 'pas de modification directe de game.houses');
select throws_ok('delete from game.citizenships', '42501', null, 'pas de suppression directe');
select throws_ok(
  $$insert into game.cities (world_id, slug, name)
    values ('01900000-0000-7000-8000-000000000001', 'pirate', 'Pirate')$$,
  '42501', null, 'pas de création de cité');

reset role;
select * from finish();
rollback;
