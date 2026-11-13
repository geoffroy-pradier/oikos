begin;
select plan(17);

insert into game.command_log (id, user_id, command, idempotency_key, input, status, response, duration_ms) values
  ('00000000-0000-7000-8000-00000000c001', '00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-00000001',
   '{"name": "Alcméonides"}', 'ok', '{"ok": true}', 12);
insert into game.domain_events (command_id, type, payload) values
  ('00000000-0000-7000-8000-00000000c001', 'HouseRenamed', '{"name": "Alcméonides"}');

-- Idempotence : une clé ne sert qu'une fois par compte ; un autre compte peut employer la même.
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-00000001', '{}', 'ok', '{}', 1)$$,
  '23505', null, 'clé d''idempotence unique par compte');
select lives_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000b', 'house.rename', 'key-00000001', '{}', 'ok', '{}', 1)$$,
  'même clé pour un autre compte');
-- Une erreur inattendue ne consomme pas la clé : plusieurs lignes sans clé sont admises.
select lives_ok($$insert into game.command_log (user_id, command, input, status, error_code, response, duration_ms)
  select '00000000-0000-4000-8000-00000000000a', 'house.rename', '{}', 'failed', 'INTERNAL', '{}', 1 from generate_series(1, 2)$$,
  'erreurs inattendues sans clé');

-- Cohérence des lignes.
select throws_ok($$insert into game.command_log (user_id, command, input, status, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', '{}', 'ok', '{}', 1)$$, '23514', null, 'une commande réussie porte une clé');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-00000002', '{}', 'rejected', '{}', 1)$$, '23514', null, 'un refus porte un code d''erreur');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, error_code, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-00000003', '{}', 'ok', 'X', '{}', 1)$$, '23514', null, 'un succès ne porte pas de code d''erreur');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'court', '{}', 'ok', '{}', 1)$$, '23514', null, 'clé trop courte refusée');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'DROP TABLE', 'key-00000004', '{}', 'ok', '{}', 1)$$, '23514', null, 'nom de commande mal formé refusé');
select throws_ok($$insert into game.domain_events (type, payload) values ('house_renamed', '{}')$$, '23514', null, 'type d''événement mal formé refusé');
select throws_ok($$insert into game.domain_events (type, payload) values ('HouseRenamed', '[]')$$, '23514', null, 'le contenu d''un événement est un objet');

-- Journal d'audit inaltérable.
select throws_ok($$update game.command_log set response = '{}'$$, '23001', null, 'journal non modifiable');
select throws_ok('delete from game.command_log', '23001', null, 'journal non supprimable');
select throws_ok('truncate game.command_log cascade', '23001', null, 'journal non vidable');
select throws_ok($$update game.domain_events set payload = '{}'$$, '23001', null, 'événement non modifiable');
select throws_ok('delete from game.domain_events', '23001', null, 'événement non supprimable');

-- Aucun rôle client ne lit ni n'écrit ces journaux.
select is(
  (select count(*) from pg_class c, unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
   where c.relnamespace = 'game'::regnamespace and c.relname in ('command_log', 'domain_events') and has_table_privilege(r, c.oid, p)),
  0::bigint, 'aucun droit client sur les journaux');
select is(
  (select count(*) from pg_class where relnamespace = 'game'::regnamespace and relrowsecurity and relname in ('command_log', 'domain_events')),
  2::bigint, 'règles par ligne actives sur les deux tables');

select * from finish();
rollback;
