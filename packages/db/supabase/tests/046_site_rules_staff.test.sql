begin;
select plan(7);

-- Trois versions : avec salaires, sans section `staff` (publiée avant le personnel), et sans section
-- `sites` mais avec `staff` (forme qu'aucune version validée n'a, rendue sans rien inventer).
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c001',
   '{"recipes": [{"id": "grow_wheat", "workers": 4}], "sites": {"limitByHeadquartersLevel": [2]}, "staff": {"dailyWageOboles": {"kalliste": 5, "elaia": 0}}, "goods": []}'),
  ('00000000-0000-7000-8000-00000000c002', '{"recipes": [], "sites": {"limitByHeadquartersLevel": [3]}}'),
  ('00000000-0000-7000-8000-00000000c003', '{"recipes": [], "staff": {"dailyWageOboles": {"kalliste": 5}}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c001', now());

select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'site_rules'), array['recipes', 'sites'],
  'colonnes inchangées : le rejeu de la migration 18 reste possible, le client précédent reste servi');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.site_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction : liste figée');

set local role anon;
select throws_ok('select * from public.site_rules', '42501', null, 'un visiteur anonyme ne lit pas les règles');
set local role authenticated;
select is((select sites from public.site_rules),
  '{"limitByHeadquartersLevel": [2], "staff": {"dailyWageOboles": {"kalliste": 5, "elaia": 0}}}'::jsonb,
  'le salaire du jour de chaque cité est rendu avec les règles des sites');
select is((select recipes from public.site_rules), '[{"id": "grow_wheat", "workers": 4}]'::jsonb,
  'avec le nombre de travailleurs de chaque recette');
reset role;

insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c002', now());
set local role authenticated;
select is((select sites from public.site_rules), '{"limitByHeadquartersLevel": [3]}'::jsonb,
  'version publiée avant le personnel : la section des sites telle quelle, aucun salaire inventé');
reset role;

insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c003', now());
set local role authenticated;
select is((select sites from public.site_rules), null, 'sans section des sites : nul, comme avant');
reset role;

select * from finish();
rollback;
