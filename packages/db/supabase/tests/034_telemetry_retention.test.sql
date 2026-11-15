begin;
select plan(9);

-- Rétention de la télémétrie et activations à l'horloge différente (migration 41, ticket 213).
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;

insert into telemetry.tick_runs (world_id, tick_index, status, duration_ms, created_at) values
  ('01900000-0000-7000-8000-000000000213', 1, 'done', 1, now() - interval '10 days'),
  ('01900000-0000-7000-8000-000000000213', 2, 'done', 1, now() - interval '1 hour');
insert into telemetry.close_runs (world_id, game_day, status, duration_ms, created_at) values
  ('01900000-0000-7000-8000-000000000213', 1, 'done', 1, now() - interval '10 days'),
  ('01900000-0000-7000-8000-000000000213', 2, 'done', 1, now() - interval '1 hour');

select lives_ok($$select pg_temp.as_service('select * from telemetry.purge_runs(now() - interval ''5 days'')')$$,
  'le service purge par la fonction du propriétaire');
select is((select count(*) from telemetry.tick_runs where world_id = '01900000-0000-7000-8000-000000000213'), 1::bigint,
  'seul le passage de tick récent reste');
select is((select count(*) from telemetry.close_runs where world_id = '01900000-0000-7000-8000-000000000213'), 1::bigint,
  'seule la clôture récente reste');
select is(current_setting('oikos.telemetry_purge', true), 'off', 'la purge ne laisse pas la suppression ouverte derrière elle');
select throws_ok($$select * from telemetry.purge_runs(now())$$, '23514', 'telemetry younger than one day cannot be purged',
  'le dernier jour n''est jamais purgé');
-- Le réglage de la purge ne donne aucun droit : le service n'a pas DELETE, le propriétaire reste gardé.
select throws_ok($$select set_config('oikos.telemetry_purge', 'on', true), pg_temp.as_service('delete from telemetry.close_runs')$$,
  '42501', null, 'le service ne supprime aucune trace, réglage posé ou non');
select throws_ok($$truncate telemetry.close_runs$$, '23001', 'telemetry.close_runs is append-only', 'TRUNCATE reste refusé');

-- Aucun rôle client n'exécute ces fonctions ; le service les exécute.
select is(
  (select count(*) from unnest(array['anon', 'authenticated']) r,
     unnest(array['telemetry.purge_runs(timestamptz)', 'config.cancel_clock_changing_activations()']) f
   where has_function_privilege(r, f, 'execute')),
  0::bigint, 'aucun droit client sur la purge ni sur l''annulation');
select ok(has_function_privilege('oikos_service', 'telemetry.purge_runs(timestamptz)', 'execute')
  and has_function_privilege('oikos_service', 'config.cancel_clock_changing_activations()', 'execute'),
  'le service exécute la purge et l''annulation');

select * from finish();
rollback;
