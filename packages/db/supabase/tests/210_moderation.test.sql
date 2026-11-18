begin;
select plan(31);

-- Jeu d'essai : Alice et Bob, de Kallistè, avec leur conversation ; Chloé, d'Elaia ; Dion et Eudore, modérateurs
-- sans maison. Bob a écrit dans Kallistè (un message visible, un masqué) et dans la conversation, Alice dans
-- Kallistè, Chloé dans Elaia. Alice a signalé le message de Bob dans Kallistè, Bob celui d'Alice.
-- Sanctions : Alice, un silence en cours et un avertissement fini ; Bob, une suspension.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000210aa', 'moder-alice@example.test'),
  ('00000000-0000-4000-8000-0000000210ab', 'moder-bob@example.test'),
  ('00000000-0000-4000-8000-0000000210ac', 'moder-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000210ad', 'moder-dion@example.test'),
  ('00000000-0000-4000-8000-0000000210ae', 'moder-eudore@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000210a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000210aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000210b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000210ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000210c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000210ac', 'Bacchiades', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000210a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000210b1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000210c1', '01900000-0000-7000-8000-000000000103');
insert into game.channels (id, world_id, house_low, house_high) values
  ('00000000-0000-7000-8000-0000000210e1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000210a1', '00000000-0000-7000-8000-0000000210b1');
insert into game.messages (id, channel_id, house_id, body)
select m.id::uuid, coalesce(c.id, m.channel_id::uuid), m.house_id::uuid, m.body
from (values
  ('00000000-0000-7000-8000-0000000210f1', '01900000-0000-7000-8000-000000000101', null, '00000000-0000-7000-8000-0000000210b1', 'De Bob, à Kallistè'),
  ('00000000-0000-7000-8000-0000000210f2', '01900000-0000-7000-8000-000000000101', null, '00000000-0000-7000-8000-0000000210a1', 'D''Alice, à Kallistè'),
  ('00000000-0000-7000-8000-0000000210f3', null, '00000000-0000-7000-8000-0000000210e1', '00000000-0000-7000-8000-0000000210b1', 'De Bob, en privé'),
  ('00000000-0000-7000-8000-0000000210f4', '01900000-0000-7000-8000-000000000103', null, '00000000-0000-7000-8000-0000000210c1', 'De Chloé, à Elaia'),
  ('00000000-0000-7000-8000-0000000210f5', '01900000-0000-7000-8000-000000000101', null, '00000000-0000-7000-8000-0000000210b1', 'De Bob, masqué')
) m (id, city_id, channel_id, house_id, body)
left join game.channels c on c.city_id = m.city_id::uuid;
update game.messages set hidden_at = now() where id = '00000000-0000-7000-8000-0000000210f5';
insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f1', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210a1', 'spam'),
  ('00000000-0000-7000-8000-0000000210f2', '00000000-0000-7000-8000-0000000210a1', '00000000-0000-7000-8000-0000000210b1', 'hate');
insert into admin.sanctions (id, user_id, kind, starts_at, ends_at, reason, author_id, validated_by) values
  ('00000000-0000-7000-8000-000000021051', '00000000-0000-4000-8000-0000000210aa', 'silence', now() - interval '1 hour', now() + interval '1 day', 'Insultes', '00000000-0000-4000-8000-0000000210ad', null),
  ('00000000-0000-7000-8000-000000021052', '00000000-0000-4000-8000-0000000210aa', 'warning', now() - interval '3 days', now() - interval '2 days', 'Ton', '00000000-0000-4000-8000-0000000210ad', null),
  ('00000000-0000-7000-8000-000000021053', '00000000-0000-4000-8000-0000000210ab', 'suspension', now(), now() + interval '7 days', 'Triche', '00000000-0000-4000-8000-0000000210ad', null);

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

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where (schemaname, tablename) in (('game', 'reports'), ('admin', 'sanctions')) and policyname = 'service_all'),
  'reports:service_all:ALL:oikos_service sanctions:service_all:ALL:oikos_service', 'le service lit et écrit sous ses droits de colonnes');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where grantee = 'oikos_service' and (table_schema, table_name) in (('game', 'reports'), ('admin', 'sanctions'))
     and privilege_type = 'INSERT' and table_name = 'reports'),
  'reports.house_id:INSERT reports.message_id:INSERT reports.reason:INSERT reports.reported_house_id:INSERT',
  'le service écrit un signalement sans son état ni sa date (droits des sanctions : 220)');

-- Gardes des signalements.
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f2', '00000000-0000-7000-8000-0000000210a1', '00000000-0000-7000-8000-0000000210a1', 'spam')$$,
  '23514', null, 'une maison ne signale pas son propre message');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f3', '00000000-0000-7000-8000-0000000210c1', '00000000-0000-7000-8000-0000000210a1', 'spam')$$,
  '23514', 'a report names the house that wrote the message', 'un signalement désigne l''auteur du message');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f1', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210c1', 'spam')$$,
  '23514', 'a house only reports a message it reads', 'une maison d''une autre cité ne signale pas le canal de Kallistè');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f3', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210c1', 'spam')$$,
  '23514', 'a house only reports a message it reads', 'ni la conversation d''autres maisons');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f5', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210a1', 'spam')$$,
  '23514', 'only a visible message is reported', 'un message masqué ne se signale plus');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210ff', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210a1', 'spam')$$,
  '23514', 'a report is filed on an existing message', 'ni un message inconnu');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f1', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210a1', 'hate')$$,
  '23505', null, 'un signalement par maison et par message, quel que soit le motif');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason, state) values
  ('00000000-0000-7000-8000-0000000210f3', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210a1', 'spam', 'upheld')$$,
  '23001', null, 'un signalement naît ouvert');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f3', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210a1', 'Spam!')$$,
  '23514', null, 'un motif a la forme d''un identifiant de configuration');
select throws_ok($$update game.reports set state = 'upheld'$$, '23001', 'a report is immutable', 'un signalement ne change pas');
select throws_ok($$update game.reports set message_id = null$$, '23001', 'a report is immutable', 'ni ne perd son message hors de la purge');

-- Le service signale dans la conversation : Alice, le message de Bob ; il ne choisit ni l'état ni la date.
select is(pg_temp.as_service($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f3', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210a1', 'other')
  returning state$$), 'open', 'le service écrit un signalement, ouvert');
select throws_ok($$select pg_temp.as_service($s$insert into game.reports (message_id, reported_house_id, house_id, reason, state)
  values ('00000000-0000-7000-8000-0000000210f4', '00000000-0000-7000-8000-0000000210c1', '00000000-0000-7000-8000-0000000210a1', 'spam', 'open')$s$)$$,
  '42501', null, 'sans en écrire l''état');

-- Gardes des sanctions.
select throws_ok($$insert into admin.sanctions (user_id, kind, ends_at, reason, author_id, appeal_body) values
  ('00000000-0000-4000-8000-0000000210aa', 'warning', now() + interval '1 day', 'x', '00000000-0000-4000-8000-0000000210ad', 'Déjà')$$,
  '23001', null, 'une sanction naît sans appel');
select throws_ok($$insert into admin.sanctions (user_id, kind, ends_at, reason, author_id, validated_by) values
  ('00000000-0000-4000-8000-0000000210aa', 'ban', now() + interval '1 day', 'x', '00000000-0000-4000-8000-0000000210ad', '00000000-0000-4000-8000-0000000210ae')$$,
  '23514', null, 'une exclusion n''a pas de fin');
select throws_ok($$insert into admin.sanctions (user_id, kind, reason, author_id) values
  ('00000000-0000-4000-8000-0000000210aa', 'silence', 'x', '00000000-0000-4000-8000-0000000210ad')$$,
  '23514', null, 'un silence en a une');
select throws_ok($$insert into admin.sanctions (user_id, kind, ends_at, reason, author_id) values
  ('00000000-0000-4000-8000-0000000210aa', 'silence', now() - interval '1 second', 'x', '00000000-0000-4000-8000-0000000210ad')$$,
  '23514', null, 'qui suit son début');
select throws_ok($$insert into admin.sanctions (user_id, kind, ends_at, reason, author_id) values
  ('00000000-0000-4000-8000-0000000210ad', 'warning', now() + interval '1 day', 'x', '00000000-0000-4000-8000-0000000210ad')$$,
  '23514', null, 'nul ne se sanctionne lui-même');
select throws_ok($$insert into admin.sanctions (user_id, kind, reason, author_id, validated_by) values
  ('00000000-0000-4000-8000-0000000210aa', 'ban', 'x', '00000000-0000-4000-8000-0000000210ad', '00000000-0000-4000-8000-0000000210ad')$$,
  '23514', null, 'une exclusion est validée par une autre personne que son auteur');
select throws_ok($$insert into admin.sanctions (user_id, kind, ends_at, reason, author_id) values
  ('00000000-0000-4000-8000-0000000210aa', 'warning', now() + interval '1 day', ' ', '00000000-0000-4000-8000-0000000210ad')$$,
  '23514', null, 'une sanction a un motif');

-- Appel : le service n'écrit que son texte, une fois, d'une sanction en vigueur ; la base le date.
select is(pg_temp.as_service($$update admin.sanctions set appeal_body = 'Je conteste.'
  where id = '00000000-0000-7000-8000-000000021051' returning appealed_at = now()$$), 'true',
  'le service écrit l''appel, daté de sa transaction par la base');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_body = 'Encore'
  where id = '00000000-0000-7000-8000-000000021051'$s$)$$, '23001', 'a sanction only takes one appeal', 'un appel par sanction');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_body = 'Trop tard'
  where id = '00000000-0000-7000-8000-000000021052'$s$)$$, '23514', 'an ended sanction is not appealed',
  'pas d''appel d''une sanction finie');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appealed_at = now() - interval '1 day'
  where id = '00000000-0000-7000-8000-000000021053'$s$)$$, '42501', null, 'le service ne date pas un appel');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set ends_at = now()
  where id = '00000000-0000-7000-8000-000000021053'$s$)$$, '42501', null, 'ni ne raccourcit une sanction');
select throws_ok($$update admin.sanctions set ends_at = now() + interval '2 days', appeal_body = 'x'
  where id = '00000000-0000-7000-8000-000000021053'$$, '23001', 'a sanction only takes one appeal',
  'un appel ne change rien d''autre de la sanction');
-- La purge d'un message signalé garde le signalement, sans son message.
alter table game.messages disable trigger messages_guard;
insert into game.messages (id, channel_id, house_id, body, created_at)
select '00000000-0000-7000-8000-0000000210f6', c.id, '00000000-0000-7000-8000-0000000210b1', 'Ancien', now() - interval '40 days'
from game.channels c where c.city_id = '01900000-0000-7000-8000-000000000101';
alter table game.messages enable trigger messages_guard;
insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000210f6', '00000000-0000-7000-8000-0000000210b1', '00000000-0000-7000-8000-0000000210a1', 'spam');
select cmp_ok(pg_temp.as_service($$select game.purge_messages(now() - interval '30 days')$$)::bigint, '>=', 1::bigint,
  'la purge passe sur un message signalé');
select results_eq(
  $$select message_id, reported_house_id, state from game.reports where house_id = '00000000-0000-7000-8000-0000000210a1' and reason = 'spam'
    order by message_id nulls first$$,
  $$values (null::uuid, '00000000-0000-7000-8000-0000000210b1'::uuid, 'open'::text),
           ('00000000-0000-7000-8000-0000000210f1', '00000000-0000-7000-8000-0000000210b1', 'open')$$,
  'le signalement reste, sans son message, la maison signalée gardée');
select is(current_setting('oikos.message_purge', true), 'off', 'la garde se referme après la purge');

select * from finish();
rollback;
