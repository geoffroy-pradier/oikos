begin;
select plan(13);

-- Repos d'une règle refusée lu par le client (#640) : la révision des règles de chaque opération (vue
-- `my_steward_operations`) et la durée du tick (clé `clock` de `site_rules`). Jeu d'essai : Bob et son intendant Kléon,
-- refusé sous la révision 1, puis passé à la révision 2 ; Alice a une maison, sans intendant.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000560aa', 'repos-alice@example.test'),
  ('00000000-0000-4000-8000-0000000560ab', 'repos-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-000000056001', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000560aa', 'Bacchiades', '{}'),
  ('00000000-0000-7000-8000-000000056002', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000560ab', 'Cypsélides', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-000000056012', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000056002',
   '01900000-0000-7000-8000-000000000101', 'grow_wheat');
insert into game.stewards (id, world_id, house_id, site_id, name) values
  ('00000000-0000-7000-8000-000000056022', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000056002',
   '00000000-0000-7000-8000-000000056012', 'Kléon');
update game.stewards set rules_revision = 1, unpaid_since = null where id = '00000000-0000-7000-8000-000000056022';
insert into game.steward_rules (steward_id, revision, position, kind, good_id, price_oboles, units) values
  ('00000000-0000-7000-8000-000000056022', 1, 0, 'collect', null, null, null),
  ('00000000-0000-7000-8000-000000056022', 1, 1, 'buy', 'wheat', 7, 50);

-- Une opération de Kléon sous le rôle de service, comme le moteur l'inscrit.
create function pg_temp.op(tick int, status text, code text, pos int, revision int) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status,
    error_code, summary, command_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000056022', tick, 0, revision, pos, status,
    code, '{"command": "market.placeOrder"}', game.uuid_v7());
  perform set_config('role', 'none', true);
end $$;
select pg_temp.op(300, 'ok', null, 0, 1);
select pg_temp.op(301, 'rejected', 'INSUFFICIENT_FUNDS', 1, 1);

-- Forme et droits de la vue, lus dans le catalogue.
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'my_steward_operations'),
  array['steward_id', 'site_id', 'tick_index', 'rank', 'created_at', 'status', 'error_code', 'summary', 'kind', 'good_id',
        'rules_revision'],
  'une colonne en fin de liste, aucune retirée : le client précédent lit les mêmes');
select is(
  (select string_agg(r.rolname || ':' || p.privilege, ' ' order by r.rolname, p.privilege) from pg_roles r
   cross join unnest(array['select', 'insert', 'update', 'delete']) p(privilege)
   where has_table_privilege(r.oid, 'public.my_steward_operations', p.privilege) and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated:select', 'la vue en lecture pour les seuls joueurs connectés : liste figée');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.my_steward_operations'::regclass),
  'la vue lit sous les règles par ligne du joueur');

-- Lectures des joueurs.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000560ab", "role": "authenticated"}';
select is((select string_agg(tick_index || ':' || status || ':' || rules_revision, ' ' order by tick_index)
           from public.my_steward_operations where steward_id = '00000000-0000-7000-8000-000000056022'),
  '300:ok:1 301:rejected:1', 'Bob lit la révision des règles de chaque opération de son intendant');
reset role;
update game.stewards set rules_revision = 2 where id = '00000000-0000-7000-8000-000000056022';
insert into game.steward_rules (steward_id, revision, position, kind, good_id, price_oboles, units) values
  ('00000000-0000-7000-8000-000000056022', 2, 0, 'buy', 'wheat', 7, 50);
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000560ab", "role": "authenticated"}';
select is((select rules_revision from public.my_steward_operations where status = 'rejected'), 1,
  'des règles nouvelles : le dernier refus garde la révision qui l''a vu, le repos ne vaut plus');
select is((select rules_revision from public.my_stewards where id = '00000000-0000-7000-8000-000000056022'), 2,
  'et la révision en vigueur se lit à côté');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000560aa", "role": "authenticated"}';
select is((select count(*)::int from public.my_steward_operations where steward_id = '00000000-0000-7000-8000-000000056022'),
  0, 'Alice ne lit pas les opérations de l''intendant de Bob, ni leur révision');
select throws_ok($$insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position,
  status, error_code, summary, command_id) values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000056022',
  302, 0, 2, 0, 'rejected', 'INSUFFICIENT_FUNDS', '{}', game.uuid_v7())$$,
  '42501', null, 'ni n''inscrit un refus qui mettrait sa règle au repos');
reset role;
set local role anon;
select throws_ok('select rules_revision from public.my_steward_operations', '42501', null, 'un visiteur ne lit rien');
reset role;

-- Durée du tick dans `site_rules` : avec intendants, sans `clock` (version d'essai), et avant la section `sites`.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-0000000560c1',
   '{"recipes": [], "clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
     "sites": {"limitByHeadquartersLevel": [4]},
     "stewards": {"limitByHeadquartersLevel": [1], "dailyWageOboles": 3, "rulesPerSteward": 5, "refusalRestTicks": 5,
                  "names": ["Timon"]}}'),
  ('00000000-0000-7000-8000-0000000560c2', '{"recipes": [], "sites": {"limitByHeadquartersLevel": [4]}}'),
  ('00000000-0000-7000-8000-0000000560c3',
   '{"recipes": [], "clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000000560c1', now());
set local role authenticated;
select is((select sites from public.site_rules),
  '{"limitByHeadquartersLevel": [4], "clock": {"tickMinutes": 10},
    "stewards": {"limitByHeadquartersLevel": [1], "dailyWageOboles": 3, "rulesPerSteward": 5, "refusalRestTicks": 5}}'::jsonb,
  'le repos et la seule durée du tick, sans le reste de l''horloge ni les noms');
reset role;
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000000560c2', now());
set local role authenticated;
select is((select sites from public.site_rules), '{"limitByHeadquartersLevel": [4]}'::jsonb,
  'sans horloge lisible, pas de clé : le client n''annonce pas d''heure');
reset role;
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000000560c3', now());
set local role authenticated;
select is((select sites from public.site_rules), null, 'version publiée avant les sites : rien d''ajouté, comme avant');
reset role;
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'site_rules'), array['recipes', 'sites'],
  'colonnes de `site_rules` inchangées : le rejeu des migrations 18, 61 et 271 reste possible (ADR 0006)');

select * from finish();
rollback;
