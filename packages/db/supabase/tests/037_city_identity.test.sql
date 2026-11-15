begin;
select plan(18);

-- Jeu d'essai : un monde à trois cités, dont une absente de la configuration, et deux joueurs. Trois
-- versions : la courante, une suivante activée dans une heure, une publiée avant les quatre cités.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000002a0', 'identite', 'Identité');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000002a1', '01900000-0000-7000-8000-0000000002a0', 'elaia', 'Elaia'),
  ('01900000-0000-7000-8000-0000000002a2', '01900000-0000-7000-8000-0000000002a0', 'halos', 'Halos'),
  ('01900000-0000-7000-8000-0000000002a3', '01900000-0000-7000-8000-0000000002a0', 'delos', 'Délos');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000002aa', 'identite-a@example.test'),
  ('00000000-0000-4000-8000-0000000002ab', 'identite-b@example.test');
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c2a1',
   '{"starting": {"grantOboles": 3000, "siteRecipeId": "grow_wheat"}, "sites": {"limitByHeadquartersLevel": [9]},
     "gods": [{"id": "athena"}, {"id": "poseidon"}],
     "cities": [
       {"id": "elaia", "population": {"thetes": 1}, "terroir": ["grow_wheat", "rake_salt"], "hasPort": true, "patronGodId": "athena"},
       {"id": "halos", "population": {"thetes": 2}, "terroir": ["catch_fish"], "hasPort": false, "patronGodId": "poseidon", "startingRecipeId": "catch_fish"}
     ]}'),
  ('00000000-0000-7000-8000-00000000c2a2',
   '{"starting": {"grantOboles": 3000, "siteRecipeId": "grow_wheat"},
     "cities": [{"id": "elaia", "population": {"thetes": 1}, "terroir": ["grow_olives"], "startingRecipeId": "grow_olives"}]}'),
  ('00000000-0000-7000-8000-00000000c2a3',
   '{"starting": {"grantOboles": 3000, "siteRecipeId": "grow_wheat"}, "cities": [{"id": "halos", "population": {"thetes": 2}}]}');
insert into config.activations (version_id, activate_at) values
  ('00000000-0000-7000-8000-00000000c2a1', now()),
  ('00000000-0000-7000-8000-00000000c2a2', now() + interval '1 hour');

-- Droits : lecture seule pour les joueurs connectés, rien pour un visiteur anonyme.
select is(
  (select string_agg(privilege_type, ' ' order by privilege_type) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'city_identity' and grantee in ('anon', 'authenticated')),
  'SELECT', 'lecture seule, et rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.city_identity()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction : liste figée');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
           where table_schema = 'public' and table_name = 'city_identity'),
  array['city_id', 'has_port', 'patron_god_id', 'slug', 'starting_recipe_id', 'terroir', 'world_id'],
  'rien d''autre de la configuration n''est rendu : ni population ni autre section');
select ok(not has_table_privilege('authenticated', 'config.versions', 'select'), 'la table des versions reste fermée aux joueurs');

set local role anon;
select throws_ok('select * from public.city_identity', '42501', null, 'un visiteur anonyme ne lit pas l''identité des cités');
select throws_ok('select * from game.city_identity()', '42501', null, 'ni n''appelle la fonction');

-- Premier joueur : il lit l'identité de chaque cité de la version en vigueur, pas de la suivante.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000002aa", "role": "authenticated"}';
select results_eq(
  $$select slug, terroir, has_port, patron_god_id, starting_recipe_id from public.city_identity
    where world_id = '01900000-0000-7000-8000-0000000002a0' order by slug$$,
  $$values ('elaia', '["grow_wheat", "rake_salt"]'::jsonb, true, 'athena', 'grow_wheat'),
           ('halos', '["catch_fish"]'::jsonb, false, 'poseidon', 'catch_fish')$$,
  'terroir, port, dieu et recette de départ (la sienne, sinon la commune) de la version en vigueur');
select is(
  (select city_id from public.city_identity where slug = 'halos' and world_id = '01900000-0000-7000-8000-0000000002a0'),
  '01900000-0000-7000-8000-0000000002a2'::uuid, 'chaque ligne désigne la cité du monde par son identifiant');
select is(
  (select count(*) from public.city_identity where city_id = '01900000-0000-7000-8000-0000000002a3'),
  0::bigint, 'une cité absente de la configuration n''a pas d''identité');
select throws_ok('select 1 from config.versions', '42501', null, 'la lecture directe des versions est refusée');

-- Aucune écriture : ni par la vue, ni sur les cités, ni sur la configuration. La vue n'est pas modifiable
-- (jointure), et un joueur n'a de toute façon aucun droit d'écriture sur elle (premier test).
select throws_ok(
  $$insert into public.city_identity (city_id, world_id, slug) values (gen_random_uuid(), '01900000-0000-7000-8000-0000000002a0', 'x')$$,
  '55000', null, 'un joueur n''insère rien par la vue');
select throws_ok($$update public.city_identity set has_port = true$$, '55000', null, 'ne la modifie pas');
select throws_ok($$delete from public.city_identity$$, '55000', null, 'n''en supprime rien');
select throws_ok($$update game.cities set slug = 'halos' where slug = 'elaia'$$, '42501', null,
  'ne renomme pas une cité pour lui prêter une autre identité');
select throws_ok(
  $$insert into config.versions (payload) values ('{}')$$, '42501', null, 'ne publie aucune version');

-- Second joueur : les mêmes lignes, publiques, et rien de plus.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000002ab", "role": "authenticated"}';
select results_eq(
  $$select slug, patron_god_id from public.city_identity where world_id = '01900000-0000-7000-8000-0000000002a0' order by slug$$,
  $$values ('elaia', 'athena'), ('halos', 'poseidon')$$,
  'un autre joueur lit la même identité publique');
reset role;

-- Une version publiée avant les quatre cités : champs nuls, le client applique les valeurs par défaut.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c2a3', now());
set local role authenticated;
select results_eq(
  $$select slug, terroir, has_port, patron_god_id, starting_recipe_id from public.city_identity
    where world_id = '01900000-0000-7000-8000-0000000002a0'$$,
  $$values ('halos', null::jsonb, null::boolean, null::text, 'grow_wheat')$$,
  'champs absents : nuls, jamais une valeur inventée en base ; recette de départ commune');
reset role;

select is(
  (select count(*) from public.city_identity where world_id = '01900000-0000-7000-8000-0000000002a0'),
  1::bigint, 'le propriétaire lit la même vue, sur la version en vigueur');

select * from finish();
rollback;
