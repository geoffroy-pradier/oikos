begin;
select plan(31);

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

-- Une erreur inattendue ne porte jamais de clé : sinon la nouvelle tentative serait refusée.
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, error_code, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-00000009', '{}', 'failed', 'INTERNAL', '{}', 1)$$, '23514', null, 'un échec inattendu ne consomme pas la clé');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, error_code, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-00000010', '{}', 'pending', 'X', '{}', 1)$$, '23514', null, 'statut inconnu refusé');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-00000011', '{}', 'ok', '[]', 1)$$, '23514', null, 'la réponse est un objet');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-00000012', '{}', 'ok', '{}', -1)$$, '23514', null, 'durée négative refusée');
select throws_ok($$insert into game.domain_events (command_id, type, payload) values (game.uuid_v7(), 'HouseRenamed', '{}')$$, '23503', null, 'événement d''une commande inconnue refusé');
insert into game.domain_events (command_id, type, payload) values
  ('00000000-0000-7000-8000-00000000c001', 'HouseRenamed', '{"n": 2}'), ('00000000-0000-7000-8000-00000000c001', 'HouseRenamed', '{"n": 3}');
select results_eq(
  $$select payload->>'n' from game.domain_events where command_id = '00000000-0000-7000-8000-00000000c001' and payload ? 'n' order by seq$$,
  $$values ('2'), ('3')$$, 'l''ordre d''émission est conservé');

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
select throws_ok('truncate game.command_log cascade', '23001', 'game.command_log is append-only', 'journal non vidable');
select throws_ok('truncate game.domain_events', '23001', 'game.domain_events is append-only', 'événements non vidables');
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

-- Contexte de la commande (migration 14) : facultatif, mais contrôlé quand il est donné.
select is((select aal is null and admin_role is null and config_version_id is null from game.command_log
           where id = '00000000-0000-7000-8000-00000000c001'), true, 'une ligne sans contexte reste valide');
select lives_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms, aal, admin_role, config_version_id)
  values ('00000000-0000-4000-8000-00000000000a', 'admin.publishConfig', 'key-contexte-1', '{}', 'ok', '{"ok": true}', 3,
          'aal2', 'game_designer', '00000000-0000-7000-8000-00000000c0f1')$$, 'contexte complet accepté');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms, aal)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-contexte-2', '{}', 'ok', '{"ok": true}', 3, 'aal3')$$,
  '23514', null, 'niveau d''assurance inconnu refusé');
select throws_ok($$insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms, admin_role)
  values ('00000000-0000-4000-8000-00000000000a', 'house.rename', 'key-contexte-3', '{}', 'ok', '{"ok": true}', 3, 'Super Admin')$$,
  '23514', null, 'rôle mal formé refusé');
select throws_ok($$update game.command_log set aal = 'aal2' where idempotency_key = 'key-00000001'$$, '23001', null,
  'le contexte ne se réécrit pas après coup');
select ok(not has_column_privilege('authenticated', 'game.command_log', 'aal', 'select'), 'contexte illisible par un joueur');
select ok(has_table_privilege('oikos_service', 'game.command_log', 'insert')
  and not has_table_privilege('oikos_service', 'game.command_log', 'update'), 'le service ajoute au journal, sans le modifier');

select * from finish();
rollback;
