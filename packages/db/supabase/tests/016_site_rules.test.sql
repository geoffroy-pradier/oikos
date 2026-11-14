begin;
select plan(10);

-- Jeu d'essai : deux versions, la seconde sans section `sites`, activée dans une heure.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c001',
   '{"recipes": [{"id": "grow_wheat"}], "sites": {"limitByHeadquartersLevel": [2]}, "goods": [{"id": "wheat"}]}'),
  ('00000000-0000-7000-8000-00000000c002', '{"recipes": [{"id": "grow_olives"}]}');
insert into config.activations (version_id, activate_at) values
  ('00000000-0000-7000-8000-00000000c001', now()),
  ('00000000-0000-7000-8000-00000000c002', now() + interval '1 hour');

select ok(has_table_privilege('authenticated', 'public.site_rules', 'select'), 'un joueur connecté lit les règles des sites');
select ok(not has_table_privilege('authenticated', 'config.versions', 'select'), 'la table des versions reste fermée aux joueurs');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.site_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction : liste figée');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
           where table_schema = 'public' and table_name = 'site_rules'), array['recipes', 'sites'],
  'rien d''autre de la configuration n''est rendu');

set local role anon;
select throws_ok('select * from public.site_rules', '42501', null, 'un visiteur anonyme ne lit pas les règles');
set local role authenticated;
select is((select count(*) from public.site_rules), 1::bigint, 'une seule ligne : la version en vigueur');
select is((select recipes from public.site_rules), '[{"id": "grow_wheat"}]'::jsonb, 'les recettes de la version en vigueur, pas de la suivante');
select is((select sites from public.site_rules), '{"limitByHeadquartersLevel": [2]}'::jsonb, 'la section des sites de la version en vigueur');
select throws_ok('select 1 from config.versions', '42501', null, 'la lecture directe des versions est refusée');
reset role;

-- Une version publiée avant la section `sites` : nul, le client applique les valeurs par défaut.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c002', now());
select is((select sites from public.site_rules), null, 'section absente : nul, jamais une valeur inventée en base');

select * from finish();
rollback;
