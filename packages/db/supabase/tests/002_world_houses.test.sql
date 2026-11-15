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
  'accounts(balance,house_id,id,kind) cities(created_at,id,name,slug,world_id) '
    || 'citizenships(city_id,house_id,id,since,status) houses(blazon,created_at,id,name,world_id) '
    || 'inventories(city_id,good_id,house_id,id,quantity,reserved) '
    || 'ledger_entries(created_at,id,kind) ledger_lines(account_id,amount,entry_id,nature) '
    || 'npc_population(city_id,class_id,closed_day,coverage_bps,population) '
    || 'observed_prices(city_id,good_id,observed_at,price,volume,window_seconds) '
    || 'orders(city_id,created_at,good_id,house_id,id,price,quantity,remaining,side,status) '
    || 'price_candles(city_id,close,good_id,high,low,open,period_seconds,period_start,turnover,volume) '
    || 'ships(class_id,docked_city_id,house_id,id,laid_up_at) sites(city_id,cycle_started_at,halted_at,house_id,id,recipe_id) '
    || 'trades(ledger_entry_id,price,quantity,sell_order_id) worlds(created_at,id,name,slug)',
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
