begin;
select plan(17);

insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000000c1', '{}');
insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch) values
  ('01900000-0000-7000-8000-000000000001', 100, '2030-01-01 04:00+00', 'graine-de-test-0001', '00000000-0000-7000-8000-0000000000c1', true, true);

-- Un tick n'est appliqué qu'une fois par monde.
select throws_ok($$insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
  values ('01900000-0000-7000-8000-000000000001', 100, '2030-01-01 04:00+00', 'graine-de-test-0002', '00000000-0000-7000-8000-0000000000c1', false, false)$$,
  '23505', null, 'un tick ne se joue qu''une fois');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
select lives_ok($$insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
  values ('01900000-0000-7000-8000-000000000002', 100, '2030-01-01 04:00+00', 'graine-de-test-0003', '00000000-0000-7000-8000-0000000000c1', false, false)$$,
  'le même indice dans un autre monde est un autre tick');

-- Cohérence d'une ligne.
select throws_ok($$insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
  values ('01900000-0000-7000-8000-000000000001', 101, now(), 'graine-de-test-0004', '00000000-0000-7000-8000-0000000000c1', false, true)$$,
  '23514', null, 'pas de bascule de saison hors clôture');
select throws_ok($$insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
  values ('01900000-0000-7000-8000-000000000001', 102, now(), 'courte', '00000000-0000-7000-8000-0000000000c1', false, false)$$,
  '23514', null, 'graine trop courte refusée');
select throws_ok($$insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
  values ('01900000-0000-7000-8000-000000000001', -1, now(), 'graine-de-test-0005', '00000000-0000-7000-8000-0000000000c1', false, false)$$,
  '23514', null, 'indice négatif refusé');
select throws_ok($$insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
  values ('01900000-0000-7000-8000-000000000001', 103, now(), 'graine-de-test-0006', game.uuid_v7(), false, false)$$,
  '23503', null, 'version de configuration inconnue refusée');
select throws_ok($$insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch, summary)
  values ('01900000-0000-7000-8000-000000000001', 104, now(), 'graine-de-test-0007', '00000000-0000-7000-8000-0000000000c1', false, false, '[]')$$,
  '23514', null, 'le résumé est un objet');

-- Un tick joué ne se réécrit pas : c'est la base du rejeu et de l'audit.
select throws_ok($$update game.ticks set seed = 'graine-modifiee-0001'$$, '23001', 'game.ticks is append-only', 'tick non modifiable');
select throws_ok('delete from game.ticks', '23001', null, 'tick non supprimable');
select throws_ok('truncate game.ticks', '23001', null, 'ticks non vidables');

-- Télémétrie des tentatives.
select lives_ok($$insert into telemetry.tick_runs (world_id, tick_index, status, duration_ms, error) values
  ('01900000-0000-7000-8000-000000000001', 100, 'failed', 12, 'boom'),
  ('01900000-0000-7000-8000-000000000001', 100, 'done', 40, null),
  ('01900000-0000-7000-8000-000000000001', 100, 'skipped', 1, null)$$, 'plusieurs tentatives pour un même tick');
select throws_ok($$insert into telemetry.tick_runs (world_id, tick_index, status, duration_ms) values ('01900000-0000-7000-8000-000000000001', 1, 'failed', 1)$$,
  '23514', null, 'un échec porte son erreur');
select throws_ok($$insert into telemetry.tick_runs (world_id, tick_index, status, duration_ms, error) values ('01900000-0000-7000-8000-000000000001', 1, 'done', 1, 'x')$$,
  '23514', null, 'un succès ne porte pas d''erreur');
select throws_ok($$insert into telemetry.tick_runs (world_id, tick_index, status, duration_ms) values ('01900000-0000-7000-8000-000000000001', 1, 'running', 1)$$,
  '23514', null, 'statut inconnu refusé');
select throws_ok($$insert into telemetry.tick_runs (world_id, tick_index, status, duration_ms) values ('01900000-0000-7000-8000-000000000001', 1, 'done', -5)$$,
  '23514', null, 'durée négative refusée');

-- Aucun rôle client ne lit ni n'écrit ces tables.
select is(
  (select count(*) from pg_class c, unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
   where (c.oid = 'game.ticks'::regclass or c.oid = 'telemetry.tick_runs'::regclass) and has_table_privilege(r, c.oid, p)),
  0::bigint, 'aucun droit client sur les ticks ni sur leur télémétrie');
select is(
  (select count(*) from pg_class where oid in ('game.ticks'::regclass, 'telemetry.tick_runs'::regclass) and relrowsecurity),
  2::bigint, 'règles par ligne actives sur les deux tables');

select * from finish();
rollback;
