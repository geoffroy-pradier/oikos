begin;
select plan(10);

-- Jeu d'essai : deux versions, la seconde sans taxe de marché (publiée avant elle), activée dans une heure.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c001',
   '{"marketTax": {"rateBps": 500, "burnShareBps": 5000}, "market": {"npcMaxPriceFactor": 3}, "npcClasses": [{"id": "thetes"}]}'),
  ('00000000-0000-7000-8000-00000000c002', '{"market": {"npcMaxPriceFactor": 3}}');
insert into config.activations (version_id, activate_at) values
  ('00000000-0000-7000-8000-00000000c001', now()),
  ('00000000-0000-7000-8000-00000000c002', now() + interval '1 hour');

select ok(has_table_privilege('authenticated', 'public.market_rules', 'select'), 'un joueur connecté lit les règles de marché');
select is(
  (select string_agg(privilege_type, ' ' order by privilege_type) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'market_rules' and grantee in ('anon', 'authenticated')),
  'SELECT', 'lecture seule, et rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.market_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction : liste figée');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
           where table_schema = 'public' and table_name = 'market_rules'), array['market_tax'],
  'rien d''autre de la configuration n''est rendu');

set local role anon;
select throws_ok('select * from public.market_rules', '42501', null, 'un visiteur anonyme ne lit pas les règles');
select throws_ok('select * from game.market_rules()', '42501', null, 'ni n''appelle la fonction');
set local role authenticated;
select results_eq('select market_tax from public.market_rules', $$values ('{"rateBps": 500, "burnShareBps": 5000}'::jsonb)$$,
  'une seule ligne : la taxe de la version en vigueur, pas de la suivante');
select ok((select market_tax::text from public.market_rules) !~ 'npc', 'ni budget ni prix de réserve des PNJ');
select throws_ok('select 1 from config.versions', '42501', null, 'la lecture directe des versions est refusée');
reset role;

-- Une version publiée avant la taxe : nul, le client applique le taux nul du schéma partagé.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c002', now());
select is((select market_tax from public.market_rules), null, 'section absente : nul, jamais une valeur inventée en base');

select * from finish();
rollback;
