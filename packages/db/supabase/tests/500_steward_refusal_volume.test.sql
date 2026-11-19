begin;
select plan(16);

-- Volume des refus durables d'intendant (#621 ; ADR 0002). Une règle refusée se repose (`stewards.refusalRestTicks`,
-- lu par le moteur) : elle n'inscrit rien pendant son repos. Chaque opération inscrite garde sa ligne du journal des
-- commandes et sa clé : ces tests tiennent les gardes dont dépend l'idempotence de ses rangs, même une fois
-- l'opération purgée (migration 440). Jeu d'essai : un monde joué jusqu'au tick 30, l'intendant Kléon de Bob, refusé
-- aux ticks 10 (il y a 40 jours) et 30.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000500c1', '{}');
insert into game.worlds (id, slug, name) values ('00000000-0000-7000-8000-000000050001', 'refus-621', 'Refus');
insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch) values
  ('00000000-0000-7000-8000-000000050001', 30, now(), 'graine-de-test-0500', '00000000-0000-7000-8000-0000000500c1', false, false);
insert into game.cities (id, world_id, slug, name) values
  ('00000000-0000-7000-8000-000000050011', '00000000-0000-7000-8000-000000050001', 'kalliste', 'Kalliste');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000500aa', 'refus-bob@example.test'),
  ('00000000-0000-4000-8000-0000000500ab', 'refus-eve@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-000000050021', '00000000-0000-7000-8000-000000050001', '00000000-0000-4000-8000-0000000500aa', 'Cypsélides', '{}'),
  ('00000000-0000-7000-8000-000000050022', '00000000-0000-7000-8000-000000050001', '00000000-0000-4000-8000-0000000500ab', 'Alcméonides', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-000000050031', '00000000-0000-7000-8000-000000050001', '00000000-0000-7000-8000-000000050021',
   '00000000-0000-7000-8000-000000050011', 'grow_wheat');
insert into game.stewards (id, world_id, house_id, site_id, name) values
  ('00000000-0000-7000-8000-000000050041', '00000000-0000-7000-8000-000000050001', '00000000-0000-7000-8000-000000050021',
   '00000000-0000-7000-8000-000000050031', 'Kléon');
update game.stewards set rules_revision = 1, unpaid_since = null where id = '00000000-0000-7000-8000-000000050041';
insert into game.steward_rules (steward_id, revision, position, kind, good_id, price_oboles, units) values
  ('00000000-0000-7000-8000-000000050041', 1, 0, 'buy', 'wheat', 7, 5000);

-- Chaque refus : sa ligne du journal (clé `steward:<intendant>:<tick>:<rang>`), son événement et son opération.
insert into game.command_log (id, user_id, command, idempotency_key, input, status, error_code, response, duration_ms, steward_id)
  select ('00000000-0000-7000-8000-0000000500' || t)::uuid, '00000000-0000-4000-8000-0000000500aa', 'market.placeOrder',
         'steward:00000000-0000-7000-8000-000000050041:' || t || ':0', '{}', 'rejected', 'INSUFFICIENT_FUNDS',
         '{"ok": false}', 1, '00000000-0000-7000-8000-000000050041'
  from unnest(array[10, 30]) t;
insert into game.domain_events (command_id, type, payload)
  select ('00000000-0000-7000-8000-0000000500' || t)::uuid, 'StewardActionFailed',
         jsonb_build_object('stewardId', '00000000-0000-7000-8000-000000050041', 'tickIndex', t)
  from unnest(array[10, 30]) t;
alter table game.steward_operations disable trigger steward_operations_guard;
insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status,
  error_code, summary, command_id, created_at)
  select '00000000-0000-7000-8000-000000050001', '00000000-0000-7000-8000-000000050041', t, 0, 1, 0, 'rejected',
         'INSUFFICIENT_FUNDS', '{"command": "market.placeOrder"}', ('00000000-0000-7000-8000-0000000500' || t)::uuid,
         now() - make_interval(days => age)
  from (values (10, 40), (30, 0)) v (t, age);
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
create function pg_temp.as_player(player uuid, statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', player, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute statement into result;
  perform set_config('role', 'none', true);
  return result;
end $$;
create function pg_temp.kleon(relation text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from %s where %s', relation, case relation
    when 'game.domain_events' then $q$payload->>'stewardId' = '00000000-0000-7000-8000-000000050041'$q$
    else $q$steward_id = '00000000-0000-7000-8000-000000050041'$q$ end) into n;
  return n;
end $$;

-- Le repos se lit sur l'index des refus : par intendant, du tick le plus récent, refus seuls.
select is((select pg_get_expr(i.indpred, i.indrelid) from pg_index i
           where i.indexrelid = 'game.steward_operations_refused_idx'::regclass),
  '(status = ''rejected''::text)', 'le repos lit les refus récents d''un intendant par un index partiel');

-- Le journal des commandes et les événements des refus restent jusqu'au partitionnement : personne n'en efface une
-- ligne, pas même le propriétaire sous le réglage qui ouvre la purge des opérations.
select throws_ok($$select pg_temp.as_service('delete from game.command_log where steward_id is not null')$$, '42501', null,
  'le service n''efface aucune ligne du journal des commandes');
select throws_ok($$select pg_temp.as_service('delete from game.domain_events where type = ''StewardActionFailed''')$$,
  '42501', null, 'ni un événement de refus');
select throws_ok($$delete from game.command_log where steward_id = '00000000-0000-7000-8000-000000050041'$$,
  '23001', 'game.command_log is append-only', 'le propriétaire n''efface pas la ligne d''un refus');
select set_config('oikos.steward_operation_purge', 'on', true);
select throws_ok($$delete from game.command_log where steward_id = '00000000-0000-7000-8000-000000050041'$$,
  '23001', 'game.command_log is append-only', 'le réglage de la purge des opérations n''ouvre pas le journal');
select throws_ok($$delete from game.domain_events where payload->>'stewardId' = '00000000-0000-7000-8000-000000050041'$$,
  '23001', 'game.domain_events is append-only', 'ni les événements');
select set_config('oikos.steward_operation_purge', 'off', true);
select throws_ok($$update game.command_log set idempotency_key = null where steward_id = '00000000-0000-7000-8000-000000050041'$$,
  '23001', 'game.command_log is append-only', 'une clé ne se retire pas');
select throws_ok($$truncate game.domain_events$$, '23001', null, 'les événements ne se vident pas');

-- La purge prend l'opération échue du tick 10, pas sa ligne du journal ni son événement.
select ok(pg_temp.as_service($$select game.purge_steward_operations(now() - interval '30 days')$$)::bigint >= 1,
  'la purge supprime l''opération échue');
select is((select string_agg(tick_index::text, ' ' order by tick_index) from game.steward_operations
           where steward_id = '00000000-0000-7000-8000-000000050041'), '30', 'reste la dernière opération');
select is(pg_temp.kleon('game.command_log'), 2::bigint, 'les deux lignes du journal restent');
select is(pg_temp.kleon('game.domain_events'), 2::bigint, 'les deux événements de refus restent');

-- Un moteur qui mènerait encore le tick 10 ne reprend pas sa clé : la contrainte unique l'arrête (ADR 0002).
select throws_ok($$select pg_temp.as_service('insert into game.command_log (user_id, command, idempotency_key, input,
    status, response, duration_ms, steward_id) values (''00000000-0000-4000-8000-0000000500aa'', ''market.placeOrder'',
    ''steward:00000000-0000-7000-8000-000000050041:10:0'', ''{}'', ''ok'', ''{"ok": true}'', 1,
    ''00000000-0000-7000-8000-000000050041'')')$$,
  '23505', 'duplicate key value violates unique constraint "command_log_idempotency"',
  'la clé d''une opération purgée reste prise');
select lives_ok($$select pg_temp.as_service('insert into game.command_log (user_id, command, idempotency_key, input,
    status, response, duration_ms, steward_id) values (''00000000-0000-4000-8000-0000000500aa'', ''market.placeOrder'',
    ''steward:00000000-0000-7000-8000-000000050041:31:0'', ''{}'', ''ok'', ''{"ok": true}'', 1,
    ''00000000-0000-7000-8000-000000050041'')')$$, 'la clé d''un rang neuf se prend');

-- Un joueur ne lit ni n'écrit le journal des commandes : ni Bob, ni un autre.
select throws_ok($$select pg_temp.as_player('00000000-0000-4000-8000-0000000500ab', 'select count(*) from game.command_log')$$,
  '42501', null, 'un autre joueur ne lit pas le journal des refus');
select throws_ok($$select pg_temp.as_player('00000000-0000-4000-8000-0000000500aa', 'select count(*) from game.domain_events')$$,
  '42501', null, 'ni le joueur lui-même les événements, qui ne sortent que par les vues');

select * from finish();
rollback;
