begin;
select plan(9);

-- Jeu d'essai : deux versions, la seconde sans section `sites`, activée dans une heure.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c001',
   '{"recipes": [{"id": "grow_wheat"}], "sites": {"limitByHeadquartersLevel": [2]}, "goods": [{"id": "wheat"}]}'),
  ('00000000-0000-7000-8000-00000000c002', '{"recipes": [{"id": "grow_olives"}]}');
insert into config.activations (version_id, activate_at) values
  ('00000000-0000-7000-8000-00000000c001', now()),
  ('00000000-0000-7000-8000-00000000c002', now() + interval '1 hour');

select ok(has_function_privilege('authenticated', 'public.site_rules()', 'execute'), 'un joueur connecté lit les règles des sites');
select ok(not has_function_privilege('anon', 'public.site_rules()', 'execute'), 'un visiteur anonyme ne les lit pas');
select ok(not has_table_privilege('authenticated', 'config.versions', 'select'), 'la table des versions reste fermée aux joueurs');

set local role authenticated;
select is(public.site_rules() ->> 'configVersionId', '00000000-0000-7000-8000-00000000c001', 'la version rendue est celle en vigueur, pas la suivante');
select is(public.site_rules() -> 'recipes', '[{"id": "grow_wheat"}]'::jsonb, 'les recettes de la version en vigueur');
select is(public.site_rules() -> 'sites', '{"limitByHeadquartersLevel": [2]}'::jsonb, 'la section des sites de la version en vigueur');
select is((select array_agg(k order by k) from jsonb_object_keys(public.site_rules()) k), array['configVersionId', 'recipes', 'sites'],
  'rien d''autre de la configuration n''est rendu');
select throws_ok('select 1 from config.versions', '42501', null, 'la lecture directe des versions est refusée');
reset role;

-- Une version publiée avant la section `sites` : nul, le client applique les valeurs par défaut.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c002', now());
select is(public.site_rules() -> 'sites', 'null'::jsonb, 'section absente : nul, jamais une valeur inventée en base');

select * from finish();
rollback;
