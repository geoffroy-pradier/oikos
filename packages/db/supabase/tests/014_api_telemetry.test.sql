begin;
select plan(22);

-- Compteurs de refus : une ligne par heure, nature et raison.
select lives_ok($$insert into telemetry.api_refusals (bucket, kind, reason, count)
  values ('2300-01-01 10:00:00+00', 'command', 'unauthenticated', 3)$$, 'un compteur d''une heure ronde est accepté');
select throws_ok($$insert into telemetry.api_refusals (bucket, kind, reason, count)
  values ('2300-01-01 10:30:00+00', 'command', 'unauthenticated', 1)$$, '23514', null, 'l''heure doit être ronde');
select throws_ok(format($$insert into telemetry.api_refusals (bucket, kind, reason, count) values ('2300-01-01 11:00:00+00', %s)$$, bad),
  '23514', null, 'refusé : ' || bad)
from unnest(array[$$'player', 'unauthenticated', 1$$, $$'command', 'because', 1$$, $$'command', 'forbidden', 0$$, $$'command', 'forbidden', -4$$]) bad;
select throws_ok($$insert into telemetry.api_refusals (bucket, kind, reason, count)
  values ('2300-01-01 10:00:00+00', 'command', 'unauthenticated', 1)$$, '23505', null, 'un seul compteur par heure, nature et raison');
select lives_ok($$update telemetry.api_refusals set count = count + 2 where bucket = '2300-01-01 10:00:00+00'$$, 'un compteur croît');
select throws_ok($$update telemetry.api_refusals set count = 1 where bucket = '2300-01-01 10:00:00+00'$$, '23001', null, 'un compteur ne décroît pas');
select throws_ok($$update telemetry.api_refusals set reason = 'forbidden' where bucket = '2300-01-01 10:00:00+00'$$, '23001', null,
  'un compteur ne change pas de raison');
select throws_ok($$delete from telemetry.api_refusals$$, '23001', null, 'un compteur ne se supprime pas');
select throws_ok($$truncate telemetry.api_refusals$$, '23001', null, 'les compteurs ne se vident pas');

-- Trace des lectures du back-office : ajout seul, route en gabarit.
select lives_ok($$insert into telemetry.admin_reads (user_id, admin_role, route, status)
  values ('00000000-0000-4000-8000-00000000000a', 'observer', '/api/admin/config/versions/:id', 200)$$, 'une lecture est tracée');
select throws_ok(format($$insert into telemetry.admin_reads (user_id, admin_role, route, status)
  values ('00000000-0000-4000-8000-00000000000a', 'observer', %L, 200)$$, bad), '23514', null, 'route refusée : ' || bad)
from unnest(array['/api/admin/audit?limit=5', '/api/commands/house.rename', '/api/admin/<script>']) bad;
select throws_ok($$update telemetry.admin_reads set status = 200$$, '23001', null, 'une trace ne se réécrit pas');
select throws_ok($$delete from telemetry.admin_reads$$, '23001', null, 'une trace ne se supprime pas');

-- Accès : rien pour les clients ; le service compte et trace, sans supprimer ni réécrire une trace.
select is(
  (select count(*) from pg_class c, unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
   where c.oid in ('telemetry.api_refusals'::regclass, 'telemetry.admin_reads'::regclass) and has_table_privilege(r, c.oid, p)),
  0::bigint, 'aucun accès client aux compteurs ni aux traces');
select is((select count(*) from pg_class where oid in ('telemetry.api_refusals'::regclass, 'telemetry.admin_reads'::regclass) and relrowsecurity),
  2::bigint, 'règles par ligne actives sur les deux tables');
select ok(has_table_privilege('oikos_service', 'telemetry.api_refusals', 'insert')
  and has_column_privilege('oikos_service', 'telemetry.api_refusals', 'count', 'update')
  and not has_column_privilege('oikos_service', 'telemetry.api_refusals', 'reason', 'update')
  and not has_table_privilege('oikos_service', 'telemetry.api_refusals', 'delete'), 'le service incrémente un compteur, rien d''autre');
select ok(has_table_privilege('oikos_service', 'telemetry.admin_reads', 'insert')
  and not has_table_privilege('oikos_service', 'telemetry.admin_reads', 'update')
  and not has_table_privilege('oikos_service', 'telemetry.admin_reads', 'delete'), 'le service ajoute une trace, sans la modifier');

select * from finish();
rollback;
