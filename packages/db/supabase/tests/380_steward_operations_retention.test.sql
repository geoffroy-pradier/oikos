begin;
select plan(23);

-- Conservation des opérations d'intendant (#561, migration 440). Jeu d'essai : deux mondes à part ; dans le premier,
-- dernier tick 20, Bob a trois intendants. Kléon a refusé tick après tick, Nikias n'a agi qu'une fois, il y a longtemps,
-- et Timon mène deux opérations par tick. Le second monde a joué jusqu'au tick 1000.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000380c1', '{}');
insert into game.worlds (id, slug, name) values
  ('00000000-0000-7000-8000-000000038001', 'retention-561-a', 'Rétention A'),
  ('00000000-0000-7000-8000-000000038002', 'retention-561-b', 'Rétention B');
insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch) values
  ('00000000-0000-7000-8000-000000038001', 20, now(), 'graine-de-test-0380', '00000000-0000-7000-8000-0000000380c1', false, false),
  ('00000000-0000-7000-8000-000000038002', 1000, now(), 'graine-de-test-0381', '00000000-0000-7000-8000-0000000380c1', false, false);
insert into game.cities (id, world_id, slug, name) values
  ('00000000-0000-7000-8000-000000038011', '00000000-0000-7000-8000-000000038001', 'kalliste', 'Kalliste');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000380aa', 'retention-bob@example.test'),
  ('00000000-0000-4000-8000-0000000380ab', 'retention-eve@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-000000038021', '00000000-0000-7000-8000-000000038001', '00000000-0000-4000-8000-0000000380aa', 'Cypsélides', '{}'),
  ('00000000-0000-7000-8000-000000038022', '00000000-0000-7000-8000-000000038001', '00000000-0000-4000-8000-0000000380ab', 'Alcméonides', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id)
  select ('00000000-0000-7000-8000-00000003803' || n)::uuid, '00000000-0000-7000-8000-000000038001',
         '00000000-0000-7000-8000-000000038021', '00000000-0000-7000-8000-000000038011', 'grow_wheat'
  from generate_series(1, 3) n;
insert into game.stewards (id, world_id, house_id, site_id, name)
  select ('00000000-0000-7000-8000-00000003804' || n)::uuid, '00000000-0000-7000-8000-000000038001',
         '00000000-0000-7000-8000-000000038021', ('00000000-0000-7000-8000-00000003803' || n)::uuid,
         (array['Kléon', 'Nikias', 'Timon'])[n]
  from generate_series(1, 3) n;
update game.stewards set rules_revision = 1, unpaid_since = null where world_id = '00000000-0000-7000-8000-000000038001';
insert into game.steward_rules (steward_id, revision, position, kind, good_id, price_oboles, units)
  select id, 1, 0, 'collect', null, null, null from game.stewards where world_id = '00000000-0000-7000-8000-000000038001';

-- Opérations antidatées (garde levée le temps de les poser) : intendant (1 Kléon, 2 Nikias, 3 Timon), tick, rang, âge.
alter table game.steward_operations disable trigger steward_operations_guard;
insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status,
  error_code, summary, command_id, created_at)
  select '00000000-0000-7000-8000-000000038001', ('00000000-0000-7000-8000-00000003804' || s)::uuid, t, r, 1, 0,
         case when s = 1 then 'rejected' else 'ok' end, case when s = 1 then 'INSUFFICIENT_FUNDS' end,
         '{"command": "site.collect"}', game.uuid_v7(), now() - make_interval(days => age)
  from (values (1, 10, 0, 40), (1, 11, 0, 40), (1, 12, 0, 35), (1, 13, 0, 2), (2, 5, 0, 40),
               (3, 19, 0, 40), (3, 20, 0, 40), (3, 20, 1, 40)) v (s, t, r, age);
alter table game.steward_operations enable trigger steward_operations_guard;

create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'oikos_service', true);
  if statement ~* '^\s*select' then
    execute statement into result;
  else
    execute statement;
  end if;
  perform set_config('role', 'none', true);
  return result;
end $$;
create function pg_temp.as_player(player uuid, statement text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', player, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Opérations restantes du premier monde : intendant (1, 2, 3), tick et rang, dans l'ordre.
create function pg_temp.remaining() returns text language sql as $$
  select string_agg(right(steward_id::text, 1) || ':' || tick_index || '/' || rank, ' ' order by steward_id, tick_index, rank)
  from game.steward_operations where world_id = '00000000-0000-7000-8000-000000038001';
$$;

-- Droits, lus dans le catalogue.
select ok((select prosecdef from pg_proc where oid = 'game.purge_steward_operations(timestamptz)'::regprocedure),
  'la purge s''exécute au nom du propriétaire');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.purge_steward_operations(timestamptz)', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'oikos_service', 'seul le service lance la purge des opérations');
select ok(not exists (select 1 from pg_roles r where has_function_privilege(r.oid, 'game.guard_steward_operation()', 'execute')
  and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')), 'personne n''exécute la garde');
select ok(not has_table_privilege('oikos_service', 'game.steward_operations', 'delete')
  and not has_table_privilege('authenticated', 'game.steward_operations', 'delete'), 'ni le service ni un joueur n''efface une opération');

-- La garde : aucune suppression hors de la purge, même au propriétaire ; aucune modification, purge ouverte ou non.
select throws_ok($$select pg_temp.as_service('delete from game.steward_operations')$$, '42501', null,
  'le service n''efface aucune opération en direct');
select throws_ok($$select pg_temp.as_player('00000000-0000-4000-8000-0000000380aa', 'delete from game.steward_operations')$$,
  '42501', null, 'le joueur n''efface pas les opérations de ses intendants');
select throws_ok($$select pg_temp.as_player('00000000-0000-4000-8000-0000000380ab', 'select game.purge_steward_operations(now() - interval ''30 days'')')$$,
  '42501', null, 'un joueur ne lance pas la purge');
select throws_ok($$delete from game.steward_operations where world_id = '00000000-0000-7000-8000-000000038001'$$,
  '23001', 'a steward operation does not change', 'le propriétaire n''efface rien hors de la purge');
select throws_ok($$truncate game.steward_operations$$, '23001', null, 'ni ne vide la table');
select set_config('oikos.steward_operation_purge', 'on', true);
select throws_ok($$select pg_temp.as_service('delete from game.steward_operations')$$, '42501', null,
  'ni en ouvrant la garde lui-même');
select throws_ok($$update game.steward_operations set status = 'ok' where world_id = '00000000-0000-7000-8000-000000038001'$$,
  '23001', 'a steward operation does not change', 'purge ouverte, une opération ne se modifie pas');
select lives_ok($$select pg_temp.as_service('insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status, error_code, summary, command_id)
  values (''00000000-0000-7000-8000-000000038001'', ''00000000-0000-7000-8000-000000038042'', 21, 0, 1, 0, ''ok'', null, ''{"command": "site.collect"}'', game.uuid_v7())')$$,
  'le service inscrit toujours une opération');
select throws_ok($$delete from game.steward_operations where world_id = '00000000-0000-7000-8000-000000038001' and tick_index = 21$$,
  '23001', 'a steward operation does not change', 'purge ouverte, jamais une opération de moins d''un jour');
select set_config('oikos.steward_operation_purge', 'off', true);

-- La purge, sous le rôle de service. Nikias a désormais son opération du tick 21 : celle du tick 5 n'est plus sa dernière.
select throws_ok($$select pg_temp.as_service('select game.purge_steward_operations(now() - interval ''23 hours'')')$$,
  '23514', 'steward operations younger than one day cannot be purged', 'jamais une opération de moins d''un jour');
select throws_ok($$select pg_temp.as_service('select game.purge_steward_operations(null)')$$,
  '23514', 'steward operations younger than one day cannot be purged', 'ni sans date');
select is(pg_temp.as_service($$select game.purge_steward_operations(now() - interval '36 days')$$)::bigint, 4::bigint,
  'le service supprime les opérations échues, et les compte');
select is(pg_temp.remaining(), '1:12/0 1:13/0 2:21/0 3:20/0 3:20/1',
  'restent les plus récentes, la dernière de chaque intendant et celles du dernier tick du monde, pas celles du dernier tick d''un autre monde');
select is(current_setting('oikos.steward_operation_purge', true), 'off', 'la garde se referme après la purge');
select is(pg_temp.as_service($$select game.purge_steward_operations(now() - interval '30 days')$$)::bigint, 1::bigint,
  'à la conservation suivante, la suivante de Kléon');
select is(pg_temp.as_service($$select game.purge_steward_operations(now() - interval '1 day 1 minute')$$)::bigint, 0::bigint,
  'la dernière opération de Kléon reste, même échue');
select is(pg_temp.remaining(), '1:13/0 2:21/0 3:20/0 3:20/1', 'la file de chaque intendant et les clés du dernier tick restent');

-- Le joueur lit toujours les siennes, et elles seules.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000380aa", "role": "authenticated"}';
select is((select count(steward_id) from game.steward_operations where steward_id::text like '00000000-0000-7000-8000-00000003804_'),
  4::bigint, 'Bob lit les opérations restantes de ses intendants');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000380ab", "role": "authenticated"}';
select is((select count(steward_id) from game.steward_operations where steward_id::text like '00000000-0000-7000-8000-00000003804_'),
  0::bigint, 'un autre joueur n''en lit aucune');
reset role;

select * from finish();
rollback;
