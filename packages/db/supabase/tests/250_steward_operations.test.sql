begin;
select plan(32);

-- Jeu d'essai : Alice et Bob ont chacun une maison, un site et un intendant payé qui récolte ; Chloé n'a pas de
-- maison. Celui d'Alice n'est pas encore payé.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000029aa', 'operations-alice@example.test'),
  ('00000000-0000-4000-8000-0000000029ab', 'operations-bob@example.test'),
  ('00000000-0000-4000-8000-0000000029ac', 'operations-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000029a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000029aa', 'Bacchiades', '{}'),
  ('00000000-0000-7000-8000-0000000029b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000029ab', 'Cypsélides', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000029a3', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000029a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000029b3', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000029b1', '01900000-0000-7000-8000-000000000101', 'grow_wheat');
insert into game.stewards (id, world_id, house_id, site_id, name) values
  ('00000000-0000-7000-8000-0000000029a5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000029a1', '00000000-0000-7000-8000-0000000029a3', 'Nikias'),
  ('00000000-0000-7000-8000-0000000029b5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000029b1', '00000000-0000-7000-8000-0000000029b3', 'Kléon');
update game.stewards set rules_revision = 1 where id in ('00000000-0000-7000-8000-0000000029a5', '00000000-0000-7000-8000-0000000029b5');
insert into game.steward_rules (steward_id, revision, position, kind, good_id, price_oboles, units) values
  ('00000000-0000-7000-8000-0000000029a5', 1, 0, 'collect', null, null, null),
  ('00000000-0000-7000-8000-0000000029b5', 1, 0, 'collect', null, null, null),
  ('00000000-0000-7000-8000-0000000029b5', 1, 1, 'sell', 'wheat', 6, 0);
update game.stewards set unpaid_since = null where id = '00000000-0000-7000-8000-0000000029b5';

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Une opération de Kléon (ou de l'intendant donné) au tick et au rang donnés, sous le rôle de service.
create function pg_temp.op(tick int, rnk int, status text = 'ok', code text = null, pos int = 0,
  steward text = '00000000-0000-7000-8000-0000000029b5', revision int = 1,
  world text = '01900000-0000-7000-8000-000000000001') returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status, error_code, summary, command_id)
     values (%L, %L, %s, %s, %s, %s, %L, %L, %L, game.uuid_v7())',
    world, steward, tick, rnk, revision, pos, status, code, '{"command": "site.collect"}'));
$$;

-- Droits, lus dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.steward_operations'::regclass), 'règles par ligne actives');
select is(
  (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by policyname)
   from pg_policies where schemaname = 'game' and tablename = 'steward_operations'),
  'service_all:ALL:oikos_service steward_operations_read_own:SELECT:authenticated',
  'une règle de lecture pour les joueurs, aucune d''écriture');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'steward_operations' and grantee = 'oikos_service' and privilege_type = 'INSERT'),
  'command_id error_code rank rule_position rules_revision status steward_id summary tick_index world_id',
  'le service inscrit une opération sans choisir ni l''identifiant ni la date');
select ok(not has_table_privilege('oikos_service', 'game.steward_operations', 'update')
  and not has_table_privilege('oikos_service', 'game.steward_operations', 'delete'), 'il n''en modifie ni n''en efface aucune');
select ok(not has_table_privilege('authenticated', 'game.steward_operations', 'insert')
  and not has_table_privilege('authenticated', 'game.steward_operations', 'update')
  and not has_table_privilege('authenticated', 'game.steward_operations', 'delete')
  and not has_table_privilege('anon', 'game.steward_operations', 'select'), 'un joueur n''écrit rien, un visiteur ne lit rien');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'my_steward_operations' and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'la vue en lecture seule, rien pour un visiteur anonyme');
select ok(not exists (select 1 from pg_roles r where has_function_privilege(r.oid, 'game.guard_steward_operation()', 'execute')
  and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')), 'personne n''exécute la garde');
select has_column('game', 'command_log', 'steward_id', 'le journal des commandes nomme l''intendant acteur');
create function pg_temp.log(key text, steward uuid) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms, steward_id)
     values (%L, %L, %L, %L, %L, %L, 0, %L)', '00000000-0000-4000-8000-0000000029ab', 'site.collect', key, '{}', 'ok', '{}', steward));
$$;
select lives_ok(pg_temp.log('steward:00000000-0000-7000-8000-0000000029b5:100:0', '00000000-0000-7000-8000-0000000029b5'),
  'une opération d''intendant porte sa clé, avec le deux-points');
select throws_ok(pg_temp.log('steward:00000000-0000-7000-8000-0000000029b5:100:1', null), '23514', null,
  'une clé avec le deux-points est réservée aux lignes d''un intendant');
select lives_ok(pg_temp.log('steward-00000000-0000-7000-8000-0000000029b5-100-1', null),
  'les clés du joueur restent celles d''avant');

-- Intégrité, sous le rôle de service.
select lives_ok(pg_temp.op(100, 0), 'le service inscrit une opération d''un intendant payé');
select is((select created_at = now() from game.steward_operations where tick_index = 100), true, 'datée de sa transaction');
select throws_ok(pg_temp.op(100, 0), '23505', null, 'une seule opération par intendant, tick et rang : rejouer ne double rien');
select throws_ok(pg_temp.op(100, 1, 'rejected'), '23514', null, 'un refus porte son code');
select throws_ok(pg_temp.op(100, 1, 'ok', 'INSUFFICIENT_STOCK'), '23514', null, 'une réussite n''en porte pas');
select throws_ok(pg_temp.op(100, 20), '23514', null, 'au plus 20 rangs');
select throws_ok(pg_temp.op(100, 1, pos => 2), '23503', null, 'l''opération mène une règle existante');
select throws_ok(pg_temp.op(100, 1, steward => '00000000-0000-7000-8000-0000000029a5'),
  '23001', 'an operation follows the current rules of a paid steward in post', 'un intendant impayé n''agit pas');
select throws_ok(pg_temp.op(100, 1, world => '01900000-0000-7000-8000-000000000002'),
  '23001', 'an operation follows the current rules of a paid steward in post', 'ni hors de son monde');
select throws_ok($$select pg_temp.as_service($s$insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision,
  rule_position, status, summary, command_id, created_at) values ('01900000-0000-7000-8000-000000000001',
  '00000000-0000-7000-8000-0000000029b5', 101, 0, 1, 0, 'ok', '{}', game.uuid_v7(), now() - interval '1 hour')$s$)$$,
  '42501', null, 'le service n''antidate pas une opération');
select throws_ok($$update game.steward_operations set status = 'rejected', error_code = 'X_Y' where tick_index = 100$$,
  '23001', 'a steward operation does not change', 'même le propriétaire ne la modifie pas');
select throws_ok($$delete from game.steward_operations where tick_index = 100$$,
  '23001', 'a steward operation does not change', 'ni ne l''efface');

-- Sept opérations de Kléon, dont un refus ancien : la vue en garde les cinq dernières et ce refus.
select lives_ok(pg_temp.op(101, 0, 'rejected', 'INSUFFICIENT_STOCK', 1), 'un refus de vente');
select pg_temp.as_service(format(
  'insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status, summary, command_id)
   select %L, %L, t, 0, 1, 0, %L, %L, game.uuid_v7() from generate_series(102, 106) t',
  '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000029b5', 'ok', '{"command": "site.collect"}'));
-- Une révision nouvelle n'efface rien : les opérations passées restent lisibles avec leur règle.
select throws_ok(pg_temp.op(107, 0, revision => 2), '23001', 'an operation follows the current rules of a paid steward in post',
  'une opération suit la révision en vigueur');

-- Lectures des joueurs.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000029ab", "role": "authenticated"}';
select is((select count(*)::int from game.steward_operations), 7, 'Bob lit toutes les opérations de son intendant');
select is((select string_agg(tick_index || ':' || status || ':' || kind || coalesce(':' || error_code, ''), ' ' order by tick_index)
           from public.my_steward_operations where site_id = '00000000-0000-7000-8000-0000000029b3'),
  '101:rejected:sell:INSUFFICIENT_STOCK 102:ok:collect 103:ok:collect 104:ok:collect 105:ok:collect 106:ok:collect',
  'la fiche de son site montre les cinq dernières opérations et le dernier refus, avec la règle menée');
select throws_ok($$select command_id from game.steward_operations$$, '42501', null, 'pas la ligne du journal des commandes');
select throws_ok($$insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status, summary, command_id)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000029b5', 200, 0, 1, 0, 'ok', '{}', game.uuid_v7())$$,
  '42501', null, 'Bob n''inscrit aucune opération, même pour son intendant');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000029aa", "role": "authenticated"}';
select is((select count(*)::int from game.steward_operations where steward_id = '00000000-0000-7000-8000-0000000029b5')
  + (select count(*)::int from public.my_steward_operations where steward_id = '00000000-0000-7000-8000-0000000029b5'), 0,
  'Alice ne lit pas les opérations de l''intendant de Bob');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000029ac", "role": "authenticated"}';
select is((select count(*)::int from public.my_steward_operations where steward_id = '00000000-0000-7000-8000-0000000029b5'), 0,
  'Chloé, sans maison, non plus');
reset role;
set local role anon;
select throws_ok($$select 1 from public.my_steward_operations$$, '42501', null, 'un visiteur ne lit pas la vue');
reset role;

select * from finish();
rollback;
