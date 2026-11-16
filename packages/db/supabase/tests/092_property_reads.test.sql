begin;
select plan(19);

-- Jeu d'essai : une version de configuration en vigueur, deux biens à Alice (Kallistè et Elaia), un à Bob
-- (impayé), un encore à la cité. Achats et impayé posés par le propriétaire de la base, gardes levées.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c921',
  '{"properties": {"sizes": [{"id": "townhouse", "housingUnits": 4}], "countsByCity": {}}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c921', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000092aa', 'reads-alice@example.test'),
  ('00000000-0000-4000-8000-0000000092ab', 'reads-bob@example.test'),
  ('00000000-0000-4000-8000-0000000092ac', 'reads-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000092a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000092aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000092b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000092ab', 'Philaïdes', '{}');
insert into game.properties (id, world_id, city_id, size_id, lot) values
  ('00000000-0000-7000-8000-0000000092f1', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'townhouse', 9201),
  ('00000000-0000-7000-8000-0000000092f2', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000103', 'townhouse', 9202),
  ('00000000-0000-7000-8000-0000000092f3', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'tenement', 9203),
  ('00000000-0000-7000-8000-0000000092f4', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'townhouse', 9204);
set constraints all immediate;
alter table game.properties disable trigger properties_guard;
update game.properties set owner_house_id = '00000000-0000-7000-8000-0000000092a1', acquired_at = now(), condition = 7000
  where id in ('00000000-0000-7000-8000-0000000092f1', '00000000-0000-7000-8000-0000000092f2');
update game.properties set owner_house_id = '00000000-0000-7000-8000-0000000092b1', acquired_at = now(), upkeep_unpaid_since = now()
  where id = '00000000-0000-7000-8000-0000000092f3';
alter table game.properties enable trigger properties_guard;

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by policyname)
   from pg_policies where schemaname = 'game' and tablename = 'properties'),
  'properties_read_own:SELECT:authenticated service_all:ALL:oikos_service', 'une règle de lecture pour les joueurs, aucune d''écriture');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('my_properties', 'city_properties', 'property_rules') and grantee in ('anon', 'authenticated')),
  'city_properties:authenticated:SELECT my_properties:authenticated:SELECT property_rules:authenticated:SELECT',
  'vues en lecture seule, rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname || ':' || f, ' ' order by r.rolname, f) from pg_roles r,
     unnest(array['game.property_rules()', 'game.city_properties()']) f
   where has_function_privilege(r.oid, f, 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated:game.city_properties() authenticated:game.property_rules()',
  'seuls les joueurs connectés exécutent les fonctions de lecture : liste figée');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'city_properties'),
  array['id', 'city_id', 'size_id', 'lot', 'for_sale', 'condition'], 'le parc public ne nomme aucun propriétaire');

-- Visiteur anonyme : rien.
set local role anon;
select throws_ok('select * from public.city_properties', '42501', null, 'anon ne lit pas le parc');
select throws_ok('select * from public.my_properties', '42501', null, 'ni des biens');
select throws_ok('select * from public.property_rules', '42501', null, 'ni les règles');

-- Alice : ses deux biens, avec leur état ; le parc de toutes les cités, sans propriétaire.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000092aa", "role": "authenticated"}';
select results_eq('select id, house_id, size_id, condition, upkeep_unpaid_since is null from public.my_properties order by lot',
  $$values ('00000000-0000-7000-8000-0000000092f1'::uuid, '00000000-0000-7000-8000-0000000092a1'::uuid, 'townhouse', 7000, true),
           ('00000000-0000-7000-8000-0000000092f2'::uuid, '00000000-0000-7000-8000-0000000092a1'::uuid, 'townhouse', 7000, true)$$,
  'Alice lit ses deux biens, dans deux cités');
select is((select count(*) from game.properties where id = '00000000-0000-7000-8000-0000000092f3'), 0::bigint,
  'pas le bien de Bob, même en interrogeant game');
select throws_ok('select world_id, worn_day from game.properties', '42501', null, 'colonnes internes illisibles');
select results_eq($$select id, for_sale, condition from public.city_properties where id::text like '00000000-0000-7000-8000-0000000092f%' order by lot$$,
  $$values ('00000000-0000-7000-8000-0000000092f1'::uuid, false, null::integer), ('00000000-0000-7000-8000-0000000092f2'::uuid, false, null),
           ('00000000-0000-7000-8000-0000000092f3'::uuid, false, null), ('00000000-0000-7000-8000-0000000092f4'::uuid, true, 10000)$$,
  'le parc : tous les biens, ceux que la cité vend encore et leur état ; rien de l''état d''un bien détenu');
select results_eq('select properties -> ''sizes'' -> 0 ->> ''housingUnits'' from public.property_rules', $$values ('4')$$,
  'règles publiques : la section de l''immobilier de la version en vigueur');
select throws_ok($$update public.my_properties set condition = 10000$$, '42501', null, 'pas de rénovation par la vue');
select throws_ok($$update game.properties set owner_house_id = '00000000-0000-7000-8000-0000000092a1'
  where id = '00000000-0000-7000-8000-0000000092f4'$$, '42501', null, 'ni d''achat directement dans game');
select throws_ok($$insert into game.properties (world_id, city_id, size_id, lot)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'townhouse', 9299)$$,
  '42501', null, 'ni de bien créé');
select throws_ok($$delete from public.my_properties$$, '42501', null, 'ni supprimé');

-- Bob : son seul bien, impayé ; Chloé, sans maison, rien à elle mais le même parc.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000092ab", "role": "authenticated"}';
select results_eq('select id, upkeep_unpaid_since is not null from public.my_properties',
  $$values ('00000000-0000-7000-8000-0000000092f3'::uuid, true)$$, 'Bob ne voit que son immeuble, impayé');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000092ac", "role": "authenticated"}';
select is((select count(*) from public.my_properties), 0::bigint, 'un compte sans maison ne voit aucun bien à lui');
select is((select count(*) from public.city_properties where id::text like '00000000-0000-7000-8000-0000000092f%'), 4::bigint,
  'mais lit le parc des cités');
reset role;

select * from finish();
rollback;
