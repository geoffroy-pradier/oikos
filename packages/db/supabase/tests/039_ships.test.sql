begin;
select plan(46);

-- Jeu d'essai : Alice et Bob ont chacun une maison et un caboteur dans le monde de test, Chloé n'a pas de
-- maison, Dion a la sienne dans un autre monde. Deux versions : l'une avec des navires, l'autre publiée
-- avant le transport.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000003aa', 'navires-alice@example.test'),
  ('00000000-0000-4000-8000-0000000003ab', 'navires-bob@example.test'),
  ('00000000-0000-4000-8000-0000000003ac', 'navires-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000003ad', 'navires-dion@example.test');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000003f0', 'navires-ailleurs', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000003f1', '01900000-0000-7000-8000-0000000003f0', 'ailleurs', 'Ailleurs');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000003a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000003aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000003b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000003ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000003d1', '01900000-0000-7000-8000-0000000003f0', '00000000-0000-4000-8000-0000000003ad', 'Étéoboutades', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000003a2', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000003a1'),
  ('00000000-0000-7000-8000-0000000003b2', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000003b1');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id) values
  ('00000000-0000-7000-8000-0000000003a5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000003b5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003b1', 'coaster', '01900000-0000-7000-8000-000000000103');
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c3a1',
   '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
     "ships": {"classes": [{"id": "coaster", "capacityUnits": 300, "speedBps": 10000, "purchaseCostOboles": 2400, "dailyUpkeepOboles": 0}]},
     "sites": {"limitByHeadquartersLevel": [4]}}'),
  ('00000000-0000-7000-8000-00000000c3a2', '{"sites": {"limitByHeadquartersLevel": [4]}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c3a1', now());

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;

-- Droits, lus dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.ships'::regclass), 'règles par ligne actives sur game.ships');
select is(
  (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by policyname)
   from pg_policies where schemaname = 'game' and tablename = 'ships'),
  'service_all:ALL:oikos_service ships_read_own:SELECT:authenticated', 'une règle de lecture pour les joueurs, aucune d''écriture');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('my_ships', 'ship_rules') and grantee in ('anon', 'authenticated')),
  'my_ships:authenticated:SELECT ship_rules:authenticated:SELECT', 'vues en lecture seule, rien pour un visiteur anonyme');
select is(
  (select string_agg(column_name || ':' || privilege_type, ' ' order by column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'ships' and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'class_id:INSERT docked_city_id:INSERT docked_city_id:UPDATE house_id:INSERT laid_up_at:UPDATE world_id:INSERT',
  'le service crée un navire sans en choisir ni l''identifiant, ni la date, ni le désarmement, puis ne change que son quai (voyages) et son désarmement (entretien, #252) : liste figée');
select ok(not has_table_privilege('oikos_service', 'game.ships', 'delete'), 'le service ne supprime pas un navire');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.ship_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction des règles : liste figée');
select ok(not exists (select 1 from pg_roles r where has_function_privilege(r.oid, 'game.guard_ship()', 'execute')
  and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')), 'personne n''exécute la garde des navires');
select is(
  (select count(*) from game.worlds w where not exists (
     select 1 from game.accounts a where a.world_id = w.id and a.system_key = 'sink_ship_purchase' and not a.allow_negative)),
  0::bigint, 'chaque monde a son puits d''achat de navires, qui ne devient jamais débiteur');

-- Intégrité, sous le rôle de service : un navire naît à quai, dans une cité de son monde.
select lives_ok($$select pg_temp.as_service($s$insert into game.ships (world_id, house_id, class_id, docked_city_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'round_ship', '01900000-0000-7000-8000-000000000101')$s$)$$,
  'le service crée un navire à quai dans une cité de son monde');
select is((select created_at = now() and laid_up_at is null from game.ships where class_id = 'round_ship' and house_id = '00000000-0000-7000-8000-0000000003a1'),
  true, 'il naît maintenant, armé');
select throws_ok($$select pg_temp.as_service($s$insert into game.ships (world_id, house_id, class_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster')$s$)$$,
  '23001', 'a ship is commissioned docked in a city', 'un navire ne naît pas en mer');
select throws_ok($$select pg_temp.as_service($s$insert into game.ships (world_id, house_id, class_id, docked_city_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-0000000003f1')$s$)$$,
  '23503', 'insert or update on table "ships" violates foreign key constraint "ships_docked_city_same_world"',
  'ni à quai dans une cité d''un autre monde');
select throws_ok($$select pg_temp.as_service($s$insert into game.ships (world_id, house_id, class_id, docked_city_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', gen_random_uuid())$s$)$$,
  '23503', null, 'ni dans une cité qui n''existe pas');
select throws_ok($$select pg_temp.as_service($s$insert into game.ships (world_id, house_id, class_id, docked_city_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003d1', 'coaster', '01900000-0000-7000-8000-000000000101')$s$)$$,
  '23503', 'insert or update on table "ships" violates foreign key constraint "ships_house_same_world"',
  'ni pour une maison d''un autre monde');
select throws_ok($$select pg_temp.as_service($s$insert into game.ships (world_id, house_id, class_id, docked_city_id, laid_up_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-000000000101', now())$s$)$$,
  '42501', null, 'le service ne crée pas un navire désarmé');
select throws_ok($$select pg_temp.as_service($s$insert into game.ships (world_id, house_id, class_id, docked_city_id, created_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-000000000101', '2000-01-01')$s$)$$,
  '42501', null, 'ni antidaté');
select throws_ok($$select pg_temp.as_service($s$insert into game.ships (id, world_id, house_id, class_id, docked_city_id)
  values ('00000000-0000-7000-8000-0000000003b5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-000000000101')$s$)$$,
  '42501', null, 'ni sous un identifiant de son choix');
select throws_ok($$select pg_temp.as_service($s$update game.ships set house_id = '00000000-0000-7000-8000-0000000003b1'
  where id = '00000000-0000-7000-8000-0000000003a5'$s$)$$, '42501', null, 'le service ne change pas le propriétaire d''un navire');
select throws_ok($$select pg_temp.as_service($s$delete from game.ships where id = '00000000-0000-7000-8000-0000000003a5'$s$)$$,
  '42501', null, 'ni ne le supprime pour le recréer ailleurs');

-- La garde ne dépend pas des droits : même le propriétaire de la table ne passe pas outre.
select throws_ok($$insert into game.ships (world_id, house_id, class_id, docked_city_id, created_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-000000000101', '2000-01-01')$$,
  '23001', 'a ship is commissioned now', 'un navire ne naît pas antidaté');
select throws_ok($$insert into game.ships (world_id, house_id, class_id, docked_city_id, laid_up_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-000000000101', now())$$,
  '23001', 'a ship is commissioned in service', 'ni désarmé');
select throws_ok($$insert into game.ships (world_id, house_id, class_id, docked_city_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'Galère', '01900000-0000-7000-8000-000000000101')$$,
  '23514', null, 'classe mal formée refusée');
select throws_ok($$update game.ships set house_id = '00000000-0000-7000-8000-0000000003b1' where id = '00000000-0000-7000-8000-0000000003a5'$$,
  '23001', 'ship identity is immutable', 'un navire ne change pas de maison');
select throws_ok($$update game.ships set class_id = 'round_ship' where id = '00000000-0000-7000-8000-0000000003a5'$$,
  '23001', 'ship identity is immutable', 'ni de classe');
select throws_ok($$update game.ships set world_id = '01900000-0000-7000-8000-0000000003f0', house_id = '00000000-0000-7000-8000-0000000003d1',
  docked_city_id = '01900000-0000-7000-8000-0000000003f1' where id = '00000000-0000-7000-8000-0000000003a5'$$,
  '23001', 'ship identity is immutable', 'ni de monde');
select throws_ok($$update game.ships set created_at = created_at - interval '1 day' where id = '00000000-0000-7000-8000-0000000003a5'$$,
  '23001', 'ship identity is immutable', 'ni de date de naissance');
select throws_ok($$update game.ships set id = gen_random_uuid() where id = '00000000-0000-7000-8000-0000000003a5'$$,
  '23001', 'ship identity is immutable', 'ni d''identifiant');

-- Visiteur anonyme : rien.
set local role anon;
select throws_ok('select * from public.my_ships', '42501', null, 'anon ne lit pas de navires');
select throws_ok('select * from public.ship_rules', '42501', null, 'ni les règles des navires');

-- Alice ne voit que ses navires, et seulement les colonnes accordées.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000003aa", "role": "authenticated"}';
select results_eq('select house_id, class_id, docked_city_id, laid_up_at from public.my_ships order by class_id',
  $$values ('00000000-0000-7000-8000-0000000003a1'::uuid, 'coaster', '01900000-0000-7000-8000-000000000101'::uuid, null::timestamptz),
           ('00000000-0000-7000-8000-0000000003a1'::uuid, 'round_ship', '01900000-0000-7000-8000-000000000101'::uuid, null::timestamptz)$$,
  'Alice lit ses deux navires, à quai, armés');
select is((select count(*) from game.ships where house_id = '00000000-0000-7000-8000-0000000003b1'), 0::bigint,
  'pas le navire de Bob, même en interrogeant game');
select throws_ok('select world_id, created_at from game.ships', '42501', null, 'colonnes internes illisibles');
select throws_ok($$update public.my_ships set docked_city_id = '01900000-0000-7000-8000-000000000103'$$, '42501', null,
  'pas de déplacement d''un navire par la vue');
select throws_ok($$insert into public.my_ships (house_id, class_id, docked_city_id)
  values ('00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-000000000101')$$, '42501', null,
  'pas de navire créé par la vue');
select throws_ok($$delete from public.my_ships$$, '42501', null, 'ni supprimé');
select throws_ok($$insert into game.ships (world_id, house_id, class_id, docked_city_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000003a1', 'coaster', '01900000-0000-7000-8000-000000000101')$$,
  '42501', null, 'ni directement dans game');
select results_eq('select ships from public.ship_rules',
  $$values ('{"classes": [{"id": "coaster", "capacityUnits": 300, "speedBps": 10000, "purchaseCostOboles": 2400, "dailyUpkeepOboles": 0}]}'::jsonb)$$,
  'règles publiques : la section des navires de la version en vigueur');

-- Bob ne voit que le sien ; Chloé, sans maison, rien.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000003ab", "role": "authenticated"}';
select results_eq('select id, docked_city_id from public.my_ships',
  $$values ('00000000-0000-7000-8000-0000000003b5'::uuid, '01900000-0000-7000-8000-000000000103'::uuid)$$, 'Bob ne voit que son caboteur');
select is((select count(*) from public.ship_rules), 1::bigint, 'Bob lit les mêmes règles publiques');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000003ac", "role": "authenticated"}';
select is((select count(*) from public.my_ships), 0::bigint, 'un compte sans maison ne voit aucun navire');
reset role;

-- Flux de trésorerie : l'achat d'un navire est une acquisition, hors exploitation (4.1).
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'house.starting_grant') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, account, amount from entry, (values
  ((select id from game.accounts where system_key = 'faucet_starting_grant' and world_id = '01900000-0000-7000-8000-000000000001'), -3000),
  ('00000000-0000-7000-8000-0000000003a2'::uuid, 3000)) as lines (account, amount);
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'ship.acquire') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, account, amount from entry, (values
  ((select id from game.accounts where system_key = 'sink_ship_purchase' and world_id = '01900000-0000-7000-8000-000000000001'), 2400),
  ('00000000-0000-7000-8000-0000000003a2'::uuid, -2400)) as lines (account, amount);
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000003aa", "role": "authenticated"}';
select results_eq('select account, nature, amount from public.my_cash_flows order by nature',
  $$values ('treasury', 'acquisitions', -2400::bigint), ('treasury', 'grant', 3000::bigint)$$,
  'l''achat du navire est une acquisition de la trésorerie');
select results_eq('select acquisitions, non_operating, operating_result, cash_change from public.my_income_statement',
  $$values (-2400::bigint, 600::bigint, 0::bigint, 600::bigint)$$, 'hors exploitation au compte de résultat, sans effet sur le résultat');
select results_eq('select balance from public.my_treasury', $$values (600::bigint)$$, 'et la trésorerie suit le grand livre');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000003ab", "role": "authenticated"}';
select is((select count(*) from public.my_cash_flows), 0::bigint, 'Bob ne voit rien de l''achat d''Alice');
reset role;

-- Une version publiée avant le transport : section nulle, jamais une valeur inventée en base.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c3a2', now());
set local role authenticated;
select results_eq('select ships from public.ship_rules', $$values (null::jsonb)$$,
  'version sans navires : section nulle, le client applique la valeur par défaut (aucune classe)');
reset role;
select is((select array_agg(column_name::text) from information_schema.columns where table_schema = 'public' and table_name = 'ship_rules'),
  array['ships'], 'rien d''autre de la configuration n''est rendu');

select * from finish();
rollback;
