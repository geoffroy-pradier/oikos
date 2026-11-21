begin;
select plan(22);

-- Jeu d'essai : Alice écrit deux messages, Bob est modérateur, avec une maison, et Rhéa super-administratrice.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000763aa', 'rt-alice@example.test'),
  ('00000000-0000-4000-8000-0000000763ab', 'rt-bob@example.test'),
  ('00000000-0000-4000-8000-0000000763ac', 'rt-rhea@example.test');
insert into admin.roles (user_id, role, granted_by) values
  ('00000000-0000-4000-8000-0000000763ac', 'super_admin', null);
insert into admin.roles (user_id, role, granted_by) values
  ('00000000-0000-4000-8000-0000000763ab', 'moderator', '00000000-0000-4000-8000-0000000763ac');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000763a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000763aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000763b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000763ab', 'Philaïdes', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000763a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000763b1', '01900000-0000-7000-8000-000000000101');
insert into game.messages (id, channel_id, house_id, body)
select m.id::uuid, c.id, '00000000-0000-7000-8000-0000000763a1', m.body
from (values ('00000000-0000-7000-8000-0000000763f1', 'Premier'), ('00000000-0000-7000-8000-0000000763f2', 'Second'),
             ('00000000-0000-7000-8000-0000000763f3', 'Troisième'), ('00000000-0000-7000-8000-0000000763f4', 'Quatrième')) m (id, body)
join game.channels c on c.city_id = '01900000-0000-7000-8000-000000000101';

-- Appel sous le rôle de service ; les assertions restent au propriétaire.
create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'oikos_service', true);
  execute statement into result;
  perform set_config('role', 'none', true);
  return result;
end $$;

-- Règles par ligne et droits, lus dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.report_triage'::regclass),
  'les règles par ligne sont actives sur le pré-tri');
select is(
  (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ') from pg_policies
   where schemaname = 'game' and tablename = 'report_triage'),
  'service_all:ALL:oikos_service', 'une seule règle : celle du service');
select ok(not has_table_privilege('authenticated', 'game.report_triage', 'select')
  and not has_table_privilege('anon', 'game.report_triage', 'select')
  and not has_column_privilege('authenticated', 'game.report_triage', 'summary', 'select'),
  'aucun client ne lit le pré-tri');
select ok(has_table_privilege('oikos_service', 'game.report_triage', 'select')
  and not has_table_privilege('oikos_service', 'game.report_triage', 'update')
  and not has_table_privilege('oikos_service', 'game.report_triage', 'delete')
  and not has_column_privilege('oikos_service', 'game.report_triage', 'triaged_at', 'insert'),
  'le service lit et insère, sans modifier, supprimer ni dater');

-- Écriture par le service : une catégorie avec son résumé, ou une issue sans les deux.
select is(pg_temp.as_service($$insert into game.report_triage (message_id, category, summary, outcome) values
  ('00000000-0000-7000-8000-0000000763f1', 'likely_violation', 'Propos hostiles.', 'ok') returning category$$),
  'likely_violation', 'le service écrit une catégorie et son résumé');
select is(pg_temp.as_service($$insert into game.report_triage (message_id, outcome) values
  ('00000000-0000-7000-8000-0000000763f2', 'invalid') returning outcome$$),
  'invalid', 'le service écrit une issue de repli, sans catégorie');
select is((select triaged_at = now() from game.report_triage where message_id = '00000000-0000-7000-8000-0000000763f1'), true,
  'la base date l''essai');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, category, summary, outcome) values
  ('00000000-0000-7000-8000-0000000763f3', 'sanction', 'Hors liste.', 'ok')$s$)$$, '23514', null, 'une catégorie hors liste est refusée');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, category, outcome) values
  ('00000000-0000-7000-8000-0000000763f3', 'doubtful', 'ok')$s$)$$, '23514', null, 'une catégorie sans résumé est refusée');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, summary, outcome) values
  ('00000000-0000-7000-8000-0000000763f3', 'Résumé seul.', 'invalid')$s$)$$, '23514', null, 'un résumé sans catégorie est refusé');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, category, summary, outcome) values
  ('00000000-0000-7000-8000-0000000763f3', 'doubtful', 'Ambigu.', 'invalid')$s$)$$, '23514', null, 'une catégorie ne vient que d''une sortie acceptée');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, outcome) values
  ('00000000-0000-7000-8000-0000000763f3', 'ok')$s$)$$, '23514', null, 'une sortie acceptée a sa catégorie');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, category, summary, outcome) values
  ('00000000-0000-7000-8000-0000000763f3', 'doubtful', '   ', 'ok')$s$)$$, '23514', null, 'un résumé n''est pas blanc');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, category, summary, outcome) values
  ('00000000-0000-7000-8000-0000000763f3', 'doubtful', repeat('a', 501), 'ok')$s$)$$, '23514', null, 'un résumé a un plafond technique');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, outcome) values
  ('00000000-0000-7000-8000-0000000763f3', 'disabled')$s$)$$, '23514', null, 'un usage coupé n''écrit rien');
select throws_ok($$select pg_temp.as_service($s$insert into game.report_triage (message_id, outcome) values
  ('00000000-0000-7000-8000-0000000763f1', 'error')$s$)$$, '23505', null, 'un seul essai par message');
select throws_ok($$select pg_temp.as_service($s$update game.report_triage set category = 'likely_unfounded'
  where message_id = '00000000-0000-7000-8000-0000000763f1'$s$)$$, '42501', null, 'le service ne change pas une catégorie');
select throws_ok($$select pg_temp.as_service($s$delete from game.report_triage$s$)$$, '42501', null, 'ni ne la supprime');

-- Les clients : un modérateur lui-même ne lit rien par Supabase, il passe par l'API (15.4).
set local role anon;
select throws_ok('select * from game.report_triage', '42501', null, 'anon ne lit pas le pré-tri');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000763ab", "role": "authenticated"}';
select throws_ok('select * from game.report_triage', '42501', null, 'un modérateur connecté ne le lit pas en direct');
select throws_ok($$insert into game.report_triage (message_id, outcome) values ('00000000-0000-7000-8000-0000000763f4', 'error')$$,
  '42501', null, 'un client n''y écrit pas');
reset role;

-- La purge d'un message emporte son pré-tri.
select set_config('oikos.message_purge', 'on', true);
delete from game.messages where id = '00000000-0000-7000-8000-0000000763f1';
select set_config('oikos.message_purge', 'off', true);
select is((select count(*) from game.report_triage where message_id::text like '00000000-0000-7000-8000-0000000763f%'), 1::bigint, 'le pré-tri suit son message à la purge');

select * from finish();
rollback;
