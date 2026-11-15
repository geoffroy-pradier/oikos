begin;
select plan(11);

-- Télémétrie des clôtures (migration 39), écrite par le service comme le moteur l'écrit.
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
select lives_ok($$select pg_temp.as_service($s$insert into telemetry.close_runs (world_id, game_day, status, duration_ms, error) values
  ('01900000-0000-7000-8000-000000000001', 20771, 'failed', 12, 'house 01900000-0000-7000-8000-0000000000a1: boom'),
  ('01900000-0000-7000-8000-000000000001', 20771, 'done', 40, null),
  ('01900000-0000-7000-8000-000000000001', 20771, 'skipped', 1, null)$s$)$$, 'le service note plusieurs tentatives d''une même clôture');
select is((select count(*) from telemetry.close_runs where game_day = 20771 and status = 'failed'
           and world_id = '01900000-0000-7000-8000-000000000001'), 1::bigint, 'et il les relit');
select throws_ok($$insert into telemetry.close_runs (world_id, game_day, status, duration_ms) values ('01900000-0000-7000-8000-000000000001', 1, 'failed', 1)$$,
  '23514', null, 'un échec porte son erreur');
select throws_ok($$insert into telemetry.close_runs (world_id, game_day, status, duration_ms, error) values ('01900000-0000-7000-8000-000000000001', 1, 'done', 1, 'x')$$,
  '23514', null, 'un succès ne porte pas d''erreur');
select throws_ok($$insert into telemetry.close_runs (world_id, game_day, status, duration_ms) values ('01900000-0000-7000-8000-000000000001', 1, 'running', 1)$$,
  '23514', null, 'statut inconnu refusé');
select throws_ok($$insert into telemetry.close_runs (world_id, game_day, status, duration_ms) values ('01900000-0000-7000-8000-000000000001', -1, 'done', 1)$$,
  '23514', null, 'jour de jeu négatif refusé');
select throws_ok($$insert into telemetry.close_runs (world_id, game_day, status, duration_ms) values ('01900000-0000-7000-8000-000000000001', 1, 'done', -5)$$,
  '23514', null, 'durée négative refusée');
-- Une trace ne se réécrit pas, même par le propriétaire ; le service n'en a d'ailleurs pas le droit.
select throws_ok($$update telemetry.close_runs set error = 'rien' where game_day = 20771 and status = 'failed'$$,
  '23001', 'telemetry.close_runs is append-only', 'une trace ne se réécrit pas');
select throws_ok($$select pg_temp.as_service('delete from telemetry.close_runs')$$, '42501', null, 'le service ne supprime aucune trace');

-- Aucun rôle client ne lit ni n'écrit cette table.
select is(
  (select count(*) from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'telemetry.close_runs', p)),
  0::bigint, 'aucun droit client sur la télémétrie des clôtures');
select ok((select relrowsecurity from pg_class where oid = 'telemetry.close_runs'::regclass), 'règles par ligne actives');

select * from finish();
rollback;
