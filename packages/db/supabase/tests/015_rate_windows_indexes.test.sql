begin;
select plan(15);

-- Fenêtres de limite de débit.
select lives_ok($$insert into telemetry.rate_windows (key, window_start, count) values ('alice:house.rename', now(), 1)$$, 'une fenêtre est comptée');
select throws_ok($$insert into telemetry.rate_windows (key, window_start, count) values ('alice:house.rename', now(), 0)$$, '23514', null, 'compteur nul refusé');
select throws_ok($$insert into telemetry.rate_windows (key, window_start, count) values ('a', now(), 1)$$, '23514', null, 'clé trop courte refusée');
select throws_ok($$insert into telemetry.rate_windows (key, window_start, count) values (repeat('k', 161), now(), 1)$$, '23514', null, 'clé trop longue refusée');
select is((select relpersistence from pg_class where oid = 'telemetry.rate_windows'::regclass), 'u'::"char", 'table non journalisée : compteurs éphémères');
select is((select relrowsecurity from pg_class where oid = 'telemetry.rate_windows'::regclass), true, 'règles par ligne actives');
select is(
  (select count(*) from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'telemetry.rate_windows', p)), 0::bigint, 'aucun accès client');
select ok(has_table_privilege('oikos_service', 'telemetry.rate_windows', 'insert')
  and has_column_privilege('oikos_service', 'telemetry.rate_windows', 'count', 'update')
  and not has_column_privilege('oikos_service', 'telemetry.rate_windows', 'key', 'update')
  and not has_table_privilege('oikos_service', 'telemetry.rate_windows', 'delete'), 'le service compte, sans supprimer');

-- Purge : fenêtres closes depuis plus d'une heure seulement.
insert into telemetry.rate_windows (key, window_start, count) values
  ('old:house.rename', now() - interval '61 minutes', 9), ('recent:house.rename', now() - interval '59 minutes', 9);
-- La base peut contenir d'autres fenêtres (suite d'intégration) : seules celles du test sont regardées.
select cmp_ok(telemetry.prune_rate_windows(), '>=', 1::bigint, 'la purge dit combien de fenêtres elle retire');
select is((select string_agg(key, ' ' order by key) from telemetry.rate_windows
           where key in ('alice:house.rename', 'old:house.rename', 'recent:house.rename')),
  'alice:house.rename recent:house.rename', 'la fenêtre close depuis plus d''une heure disparaît, les récentes restent');
select ok(has_function_privilege('oikos_service', 'telemetry.prune_rate_windows()', 'execute')
  and not has_function_privilege('authenticated', 'telemetry.prune_rate_windows()', 'execute')
  and not has_function_privilege('anon', 'telemetry.prune_rate_windows()', 'execute'), 'seul le service purge');

-- Index du back-office : le planificateur peut s'en servir pour les requêtes de la Vigie et de l'audit.
create function pg_temp.plan(query text) returns text language plpgsql as $$
declare
  line text;
  whole text := '';
begin
  for line in execute 'explain ' || query loop
    whole := whole || line || E'\n';
  end loop;
  return whole;
end $$;
set local enable_seqscan = off;
select matches(pg_temp.plan($$select count(*) from game.command_log where created_at > now() - interval '24 hours'$$),
  'command_log_created_idx', 'Vigie : commandes des dernières 24 heures par l''index des dates');
select matches(pg_temp.plan($$select id from game.command_log where command like 'admin.%' order by id desc limit 50$$),
  'command_log_admin_idx', 'audit : première page par l''index des commandes d''administration');
select matches(pg_temp.plan($$select id from game.command_log where command like 'admin.%' and id < '01900000-0000-7000-8000-000000000001' order by id desc limit 50$$),
  'command_log_admin_idx', 'audit : page suivante par le même index');
select matches(pg_temp.plan($$select max(duration_ms) from telemetry.tick_runs where created_at > now() - interval '24 hours'$$),
  'tick_runs_created_idx', 'Vigie : ticks des dernières 24 heures par l''index des dates');

select * from finish();
rollback;
