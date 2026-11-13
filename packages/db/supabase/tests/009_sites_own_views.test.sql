begin;
select plan(36);

-- Jeu d'essai : Alice et Bob ont chacun une maison, un compte crédité, un stock et un champ.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000b1');
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'test') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, account, amount from entry, (values
  ((select id from game.accounts where system_key = 'faucet_starting_grant' and world_id = '01900000-0000-7000-8000-000000000001'), -1000),
  ('00000000-0000-7000-8000-0000000000aa'::uuid, 600), ('00000000-0000-7000-8000-0000000000bb'::uuid, 400)) as lines(account, amount);
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000001a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'wheat'),
  ('00000000-0000-7000-8000-0000000001b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'wheat');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000002a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000002b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'grow_wheat');

-- Intégrité des sites.
select throws_ok($$update game.sites set house_id = '00000000-0000-7000-8000-0000000000b1' where id = '00000000-0000-7000-8000-0000000002a1'$$, '23001', null, 'un site ne change pas de maison');
select throws_ok($$update game.sites set recipe_id = 'grow_olives' where id = '00000000-0000-7000-8000-0000000002a1'$$, '23001', null, 'un site ne change pas de recette');
select throws_ok($$update game.sites set city_id = gen_random_uuid() where id = '00000000-0000-7000-8000-0000000002a1'$$, '23001', null, 'un site ne change pas de cité');
select throws_ok($$update game.sites set id = gen_random_uuid() where id = '00000000-0000-7000-8000-0000000002a1'$$, '23001', null, 'un site ne change pas d''identifiant');
select throws_ok($$update game.sites set world_id = '01900000-0000-7000-8000-000000000002' where id = '00000000-0000-7000-8000-0000000002a1'$$, '23001', null, 'un site ne change pas de monde');
select throws_ok($$update game.sites set created_at = created_at - interval '1 day' where id = '00000000-0000-7000-8000-0000000002a1'$$, '23001', null, 'la date de création ne change pas');
select lives_ok($$update game.sites set cycle_started_at = now() where id = '00000000-0000-7000-8000-0000000002a1'$$, 'l''horodatage du cycle peut rester ou avancer jusqu''à maintenant');
select throws_ok($$update game.sites set cycle_started_at = now() - interval '1 second' where id = '00000000-0000-7000-8000-0000000002a1'$$, '23001', null, 'l''horodatage du cycle ne recule pas');
select throws_ok($$update game.sites set cycle_started_at = now() + interval '1 second' where id = '00000000-0000-7000-8000-0000000002a1'$$, '23001', null, 'ni ne part dans le futur');
select throws_ok($$insert into game.sites (world_id, house_id, city_id, recipe_id, cycle_started_at) values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat', '2000-01-01')$$, '23001', null, 'un site ne naît pas antidaté');
select throws_ok($$insert into game.sites (world_id, house_id, city_id, recipe_id, created_at, cycle_started_at) values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat', '2000-01-01', '2000-01-01')$$, '23001', null, 'même avec une date de création antidatée');
select throws_ok($$insert into game.sites (world_id, house_id, city_id, recipe_id) values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'Bad Recipe')$$, '23514', null, 'recette mal formée refusée');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
insert into game.cities (id, world_id, slug, name) values ('01900000-0000-7000-8000-000000000201', '01900000-0000-7000-8000-000000000002', 'ailleurs', 'Ailleurs');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000d', 'dion@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values ('00000000-0000-7000-8000-0000000000d1', '01900000-0000-7000-8000-000000000002', '00000000-0000-4000-8000-00000000000d', 'Étéoboutades', '{}');
select throws_ok($$insert into game.sites (world_id, house_id, city_id, recipe_id) values ('01900000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000201', 'grow_wheat')$$, '23503', 'insert or update on table "sites" violates foreign key constraint "sites_house_same_world"', 'site d''un autre monde que sa maison refusé');
select throws_ok($$insert into game.sites (world_id, house_id, city_id, recipe_id) values ('01900000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000d1', '01900000-0000-7000-8000-000000000101', 'grow_wheat')$$, '23503', 'insert or update on table "sites" violates foreign key constraint "sites_city_same_world"', 'site d''un autre monde que sa cité refusé');

-- Contrôle d'accès, lu dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.sites'::regclass), 'règles par ligne actives sur game.sites');
-- (La liste figée des colonnes lisibles de tout le schéma `game` est dans 002_world_houses.test.sql.)
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type <> 'SELECT'))),
  0::bigint, 'vues publiques : rien pour anon, lecture seule pour authenticated');
select is(
  (select count(*) from pg_class c, unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update', 'delete', 'truncate']) p
   where c.relnamespace = 'game'::regnamespace and c.relkind in ('r', 'p') and has_table_privilege(r, c.oid, p)),
  0::bigint, 'toujours aucun droit d''écriture client sur game');
select is(
  (select count(*) from pg_policies where schemaname = 'game' and tablename in ('accounts', 'inventories', 'sites') and cmd <> 'SELECT'),
  0::bigint, 'aucune règle d''écriture');

-- Visiteur anonyme : rien.
set local role anon;
select throws_ok('select * from public.my_treasury', '42501', null, 'anon ne lit pas de trésorerie');
select throws_ok('select * from public.my_sites', '42501', null, 'anon ne lit pas de sites');
select throws_ok('select * from public.my_inventories', '42501', null, 'anon ne lit pas de stocks');

-- Alice ne voit que ce qui est à elle.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select results_eq('select balance from public.my_treasury', $$values (600::bigint)$$, 'Alice lit sa trésorerie, et elle seule');
select results_eq('select id from public.my_sites', $$values ('00000000-0000-7000-8000-0000000002a1'::uuid)$$, 'Alice ne voit que son champ');
select results_eq('select id from public.my_inventories', $$values ('00000000-0000-7000-8000-0000000001a1'::uuid)$$, 'Alice ne voit que son stock');
-- Même en interrogeant `game` directement, les lignes des autres et les comptes système restent invisibles.
select is((select count(*) from game.accounts), 1::bigint, 'ni le compte de Bob ni les comptes système');
select is((select count(*) from game.sites where house_id = '00000000-0000-7000-8000-0000000000b1'), 0::bigint, 'pas le champ de Bob');
select is((select count(*) from game.inventories where house_id = '00000000-0000-7000-8000-0000000000b1'), 0::bigint, 'pas le stock de Bob');
select throws_ok('select id, world_id, allow_negative, system_key from game.accounts', '42501', null, 'colonnes internes des comptes illisibles');
select throws_ok('select * from game.ledger_lines', '42501', null, 'le grand livre reste illisible');
select throws_ok('select * from game.stock_ledger', '42501', null, 'le journal des stocks reste illisible');
select throws_ok($$update public.my_treasury set balance = 1000000$$, '42501', null, 'pas d''écriture par la vue de trésorerie');
select throws_ok($$update public.my_sites set cycle_started_at = now() - interval '10 days'$$, '42501', null, 'pas d''antidatage de son champ');
select throws_ok($$insert into public.my_inventories (house_id, city_id, good_id, quantity) values ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'silver', 999)$$, '42501', null, 'pas de stock créé par la vue');

-- Bob, de même.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq('select balance from public.my_treasury', $$values (400::bigint)$$, 'Bob lit sa trésorerie');
select results_eq('select id from public.my_sites', $$values ('00000000-0000-7000-8000-0000000002b1'::uuid)$$, 'Bob ne voit que son champ');
-- Compte sans maison : aucune ligne, aucune erreur.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.my_treasury) + (select count(*) from public.my_sites) + (select count(*) from public.my_inventories), 0::bigint, 'un compte sans maison ne voit rien');

reset role;
select * from finish();
rollback;
