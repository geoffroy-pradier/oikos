begin;
select plan(6);

-- Trois versions : avec intendants et salaires, avec intendants sans `staff`, et publiée avant les intendants.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c281',
   '{"recipes": [], "sites": {"limitByHeadquartersLevel": [4]}, "staff": {"dailyWageOboles": {"kalliste": 5}},
     "stewards": {"limitByHeadquartersLevel": [2], "dailyWageOboles": 3, "rulesPerSteward": 5, "names": ["Nikias", "Kléon"]}}'),
  ('00000000-0000-7000-8000-00000000c282',
   '{"recipes": [], "sites": {"limitByHeadquartersLevel": [4]},
     "stewards": {"limitByHeadquartersLevel": [1], "dailyWageOboles": 0, "rulesPerSteward": 3, "names": ["Timon"]}}'),
  ('00000000-0000-7000-8000-00000000c283', '{"recipes": [], "sites": {"limitByHeadquartersLevel": [4]}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c281', now());

set local role anon;
select throws_ok('select * from public.site_rules', '42501', null, 'un visiteur anonyme ne lit pas les règles');
set local role authenticated;
select is((select sites from public.site_rules),
  '{"limitByHeadquartersLevel": [4], "staff": {"dailyWageOboles": {"kalliste": 5}},
    "stewards": {"limitByHeadquartersLevel": [2], "dailyWageOboles": 3, "rulesPerSteward": 5}}'::jsonb,
  'postes, salaire et nombre de règles des intendants rendus avec les règles des sites, sans la liste des noms');
reset role;
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c282', now());
set local role authenticated;
select is((select sites from public.site_rules),
  '{"limitByHeadquartersLevel": [4], "stewards": {"limitByHeadquartersLevel": [1], "dailyWageOboles": 0, "rulesPerSteward": 3}}'::jsonb,
  'sans section `staff`, les intendants seuls');
reset role;
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c283', now());
set local role authenticated;
select is((select sites from public.site_rules), '{"limitByHeadquartersLevel": [4]}'::jsonb,
  'version publiée avant les intendants : pas de clé, le client lit « aucun poste »');
reset role;
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'site_rules'), array['recipes', 'sites'],
  'colonnes inchangées : le rejeu des migrations 18 et 61 reste possible (ADR 0006)');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.site_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction : liste figée');

select * from finish();
rollback;
