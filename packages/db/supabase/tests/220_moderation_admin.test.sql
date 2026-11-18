begin;
select plan(45);

-- Jeu d'essai : Alice (aa) et Bob (ab), de Kallistè, auteurs d'un message que l'autre a signalé ; Dion (ad), Eudore (ae) et
-- Phédon (af), de l'équipe. Une seule transaction : `now()` y est un même instant ; une sanction se désigne par son motif.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000220aa', 'madm-alice@example.test'),
  ('00000000-0000-4000-8000-0000000220ab', 'madm-bob@example.test'),
  ('00000000-0000-4000-8000-0000000220ad', 'madm-dion@example.test'),
  ('00000000-0000-4000-8000-0000000220ae', 'madm-eudore@example.test'),
  ('00000000-0000-4000-8000-0000000220af', 'madm-phedon@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000220a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000220aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000220b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000220ab', 'Philaïdes', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000220a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000220b1', '01900000-0000-7000-8000-000000000101');
insert into game.messages (id, channel_id, house_id, body)
select m.id::uuid, c.id, m.house_id::uuid, m.body
from (values
  ('00000000-0000-7000-8000-0000000220f1', '00000000-0000-7000-8000-0000000220b1', 'De Bob'),
  ('00000000-0000-7000-8000-0000000220f2', '00000000-0000-7000-8000-0000000220a1', 'D''Alice')
) m (id, house_id, body)
join game.channels c on c.city_id = '01900000-0000-7000-8000-000000000101';
insert into game.reports (id, message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000220c1', '00000000-0000-7000-8000-0000000220f1', '00000000-0000-7000-8000-0000000220b1', '00000000-0000-7000-8000-0000000220a1', 'spam'),
  ('00000000-0000-7000-8000-0000000220c2', '00000000-0000-7000-8000-0000000220f2', '00000000-0000-7000-8000-0000000220a1', '00000000-0000-7000-8000-0000000220b1', 'hate');
-- Sanctions posées par le propriétaire, à des instants que le service ne choisit pas.
insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id) values
  ('00000000-0000-4000-8000-0000000220aa', 'ban', now() - interval '1 day', null, 'Ban-ancien', '00000000-0000-4000-8000-0000000220ad'),
  ('00000000-0000-4000-8000-0000000220aa', 'warning', now() - interval '3 days', now() - interval '2 days', 'Fini', '00000000-0000-4000-8000-0000000220ad'),
  ('00000000-0000-4000-8000-0000000220aa', 'suspension', now() + interval '1 day', now() + interval '2 days', 'A-venir', '00000000-0000-4000-8000-0000000220ad'),
  ('00000000-0000-4000-8000-0000000220ab', 'suspension', now() - interval '1 hour', now() + interval '7 days', 'Appel-rejete', '00000000-0000-4000-8000-0000000220ad'),
  ('00000000-0000-4000-8000-0000000220ab', 'silence', now() - interval '1 hour', now() + interval '1 day', 'Appel-accueilli', '00000000-0000-4000-8000-0000000220ad'),
  ('00000000-0000-4000-8000-0000000220ab', 'warning', now() - interval '1 hour', now() + interval '1 day', 'Sans-appel', '00000000-0000-4000-8000-0000000220ad');
-- Un avertissement fini, dont l'appel a été fait avant sa fin : posé sans la garde.
alter table admin.sanctions disable trigger sanctions_guard;
insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id, appeal_body, appealed_at) values
  ('00000000-0000-4000-8000-0000000220aa', 'warning', now() - interval '3 days', now() - interval '1 day', 'Fini-appel', '00000000-0000-4000-8000-0000000220ad', 'Non.', now() - interval '2 days');
alter table admin.sanctions enable trigger sanctions_guard;

create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'oikos_service', true);
  execute statement into result;
  perform set_config('role', 'none', true);
  return result;
end $$;

-- Droits du service et des joueurs, lus dans le catalogue.
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where grantee = 'oikos_service' and (table_schema, table_name) in (('game', 'reports'), ('admin', 'sanctions'), ('game', 'messages'))
     and privilege_type in ('INSERT', 'UPDATE')),
  'messages.body:INSERT messages.channel_id:INSERT messages.hidden_at:UPDATE messages.house_id:INSERT '
  || 'reports.house_id:INSERT reports.message_id:INSERT reports.reason:INSERT reports.reported_house_id:INSERT reports.resolved_by:UPDATE reports.state:UPDATE '
  || 'sanctions.appeal_body:UPDATE sanctions.appeal_decided_by:UPDATE sanctions.appeal_decision:UPDATE sanctions.author_id:INSERT sanctions.ends_at:INSERT '
  || 'sanctions.kind:INSERT sanctions.lifted_by:UPDATE sanctions.reason:INSERT sanctions.user_id:INSERT sanctions.validated_by:UPDATE',
  'le service n''écrit ni un instant, ni un début, ni la validation d''une sanction qu''il prononce');
select is(
  (select count(*) from information_schema.column_privileges
   where grantee in ('anon', 'authenticated') and (table_schema, table_name) in (('game', 'reports'), ('admin', 'sanctions'), ('game', 'messages'))
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0::bigint, 'aucun joueur n''écrit une sanction, un signalement ni un message en direct');

-- Prononcer : le service écrit une sanction qui commence maintenant ; une exclusion naît à valider.
select is(pg_temp.as_service($$insert into admin.sanctions (user_id, kind, ends_at, reason, author_id) values
  ('00000000-0000-4000-8000-0000000220aa', 'silence', now() + interval '1 day', 'Silence', '00000000-0000-4000-8000-0000000220ad')
  returning (starts_at = now() and validated_by is null and lifted_at is null)::text$$), 'true',
  'le service prononce un silence, qui commence maintenant');
select is(pg_temp.as_service($$insert into admin.sanctions (user_id, kind, reason, author_id) values
  ('00000000-0000-4000-8000-0000000220aa', 'ban', 'Ban-propose', '00000000-0000-4000-8000-0000000220ad')
  returning (validated_by is null)::text$$), 'true', 'une exclusion proposée attend sa validation');
select throws_ok($$select pg_temp.as_service($s$insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id) values
  ('00000000-0000-4000-8000-0000000220aa', 'silence', now() - interval '1 day', now() + interval '1 day', 'x', '00000000-0000-4000-8000-0000000220ad')$s$)$$,
  '42501', null, 'le service ne choisit pas le début');
select throws_ok($$select pg_temp.as_service($s$insert into admin.sanctions (user_id, kind, reason, author_id, validated_by) values
  ('00000000-0000-4000-8000-0000000220aa', 'ban', 'x', '00000000-0000-4000-8000-0000000220ad', '00000000-0000-4000-8000-0000000220ae')$s$)$$,
  '42501', null, 'ni ne pose une exclusion déjà validée');
select throws_ok($$insert into admin.sanctions (user_id, kind, ends_at, reason, author_id, lifted_by) values
  ('00000000-0000-4000-8000-0000000220aa', 'warning', now() + interval '1 day', 'x', '00000000-0000-4000-8000-0000000220ad', '00000000-0000-4000-8000-0000000220ae')$$,
  '23001', 'a sanction is pronounced now, without appeal', 'une sanction naît sans levée');

-- Valider une exclusion : une seconde personne, une fois ; l'exclusion commence alors.
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set validated_by = '00000000-0000-4000-8000-0000000220ad' where reason = 'Ban-ancien'$s$)$$,
  '23514', 'new row for relation "sanctions" violates check constraint "sanctions_validated_by_other"', 'l''auteur ne valide pas sa propre proposition');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set validated_by = '00000000-0000-4000-8000-0000000220aa' where reason = 'Ban-ancien'$s$)$$,
  '23514', 'new row for relation "sanctions" violates check constraint "sanctions_validated_by_other"', 'ni le compte exclu');
select throws_ok($$update admin.sanctions set validated_by = '00000000-0000-4000-8000-0000000220ae', lifted_by = '00000000-0000-4000-8000-0000000220ae'
  where reason = 'Ban-ancien'$$, '23001', 'an exclusion is confirmed once, alone', 'une validation ne lève rien');
select is(pg_temp.as_service($$update admin.sanctions set validated_by = '00000000-0000-4000-8000-0000000220ae' where reason = 'Ban-ancien'
  returning (starts_at = now())::text$$), 'true', 'une autre personne valide : l''exclusion commence à sa validation');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set validated_by = '00000000-0000-4000-8000-0000000220af' where reason = 'Ban-ancien'$s$)$$,
  '23001', 'an exclusion is confirmed once, alone', 'une exclusion se valide une fois');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set validated_by = '00000000-0000-4000-8000-0000000220ae' where reason = 'Silence'$s$)$$,
  '23001', 'an exclusion is confirmed once, alone', 'seule une exclusion se valide');
select throws_ok($$update admin.sanctions set starts_at = now() - interval '1 day' where reason = 'Silence'$$,
  '23001', 'a sanction only changes by appeal, confirmation, decision or lift', 'le début d''une sanction ne change pas autrement');

-- Lever : jamais seule ; un appel accueilli lève, par qui le tranche, la sanction pas encore finie, et doit la lever.
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000220ae' where reason = 'Silence'$s$)$$,
  '23001', 'a sanction is lifted only by granting its appeal', 'une levée seule est refusée');
select throws_ok($$update admin.sanctions set ends_at = now() + interval '1 hour' where reason = 'Silence'$$,
  '23001', 'a sanction is lifted only by granting its appeal', 'une fin ne s''avance que par une levée');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_at = now() - interval '1 day' where reason = 'Sans-appel'$s$)$$,
  '42501', null, 'le service ne date pas une levée');

-- Trancher un appel : une fois, par une autre personne que l'auteur et que le sanctionné.
select pg_temp.as_service($$update admin.sanctions set appeal_body = 'Je conteste.'
  where reason in ('Silence', 'Ban-propose', 'Ban-ancien', 'A-venir', 'Appel-rejete', 'Appel-accueilli') returning 1$$);
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'rejected', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae'
  where reason = 'Sans-appel'$s$)$$, '23001', 'an appeal is decided once', 'pas de décision sans appel');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'rejected', appeal_decided_by = '00000000-0000-4000-8000-0000000220ad'
  where reason = 'Appel-rejete'$s$)$$, '23514', 'new row for relation "sanctions" violates check constraint "sanctions_decided_by_other"', 'l''auteur ne tranche pas l''appel de sa sanction');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'rejected', appeal_decided_by = '00000000-0000-4000-8000-0000000220ab'
  where reason = 'Appel-rejete'$s$)$$, '23514', 'new row for relation "sanctions" violates check constraint "sanctions_decided_by_other"', 'ni le compte sanctionné');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'rejected', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae',
  lifted_by = '00000000-0000-4000-8000-0000000220ae' where reason = 'Appel-rejete'$s$)$$,
  '23001', 'a sanction is lifted only by granting its appeal', 'un appel rejeté ne lève rien');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae'
  where reason = 'Silence'$s$)$$, '23514', 'a granted appeal lifts a sanction not yet ended', 'un appel accueilli sans levée est refusé');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae',
  lifted_by = '00000000-0000-4000-8000-0000000220af' where reason = 'Silence'$s$)$$,
  '23001', 'a sanction is lifted only by granting its appeal', 'la levée est le fait de qui accueille l''appel');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae',
  lifted_by = '00000000-0000-4000-8000-0000000220ae' where reason = 'Ban-propose'$s$)$$, '23514', 'only a sanction not yet ended is lifted', 'une exclusion à valider ne se lève pas');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae',
  lifted_by = '00000000-0000-4000-8000-0000000220ae' where reason = 'Fini-appel'$s$)$$, '23514', 'only a sanction not yet ended is lifted', 'ni une sanction finie');
select is(pg_temp.as_service($$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae'
  where reason = 'Fini-appel' returning (lifted_at is null)::text$$), 'true', 'l''appel d''une sanction finie s''accueille sans levée');
select throws_ok($$update admin.sanctions set appeal_decision = 'rejected' where reason = 'Appel-rejete'$$,
  '23001', 'an appeal is decided once', 'une décision nomme qui la prend');
select is(pg_temp.as_service($$update admin.sanctions set appeal_decision = 'rejected', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae'
  where reason = 'Appel-rejete' returning (appeal_decided_at = now() and ends_at > now() and lifted_at is null)::text$$), 'true',
  'un appel rejeté est daté, la sanction reste');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220af'
  where reason = 'Appel-rejete'$s$)$$, '23001', 'an appeal is decided once', 'un appel se tranche une fois');
select is(pg_temp.as_service($$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae',
  lifted_by = '00000000-0000-4000-8000-0000000220ae' where reason = 'Appel-accueilli'
  returning (appeal_decided_at = now() and lifted_at = now() and ends_at = now())::text$$), 'true',
  'un appel accueilli lève la sanction dans la même écriture : elle finit maintenant');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220af',
  lifted_by = '00000000-0000-4000-8000-0000000220af' where reason = 'Appel-accueilli'$s$)$$, '23001', 'an appeal is decided once', 'une sanction se lève une fois');
select is(pg_temp.as_service($$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220af',
  lifted_by = '00000000-0000-4000-8000-0000000220af' where reason = 'Ban-ancien' returning (ends_at = now())::text$$), 'true',
  'une exclusion validée se lève : elle prend une fin');
select is(pg_temp.as_service($$update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000220ae',
  lifted_by = '00000000-0000-4000-8000-0000000220ae' where reason = 'A-venir' returning (ends_at < starts_at)::text$$), 'true',
  'une sanction levée avant son début finit avant lui');

-- Traiter un signalement : écarté ou retenu, une fois, par un autre compte que ceux de la maison signalée et de celle qui signale.
select throws_ok($$select pg_temp.as_service($s$update game.reports set state = 'dismissed', resolved_by = '00000000-0000-4000-8000-0000000220ab'
  where id = '00000000-0000-7000-8000-0000000220c1'$s$)$$, '23514', 'a report is resolved by another account than the reported one and the reporter',
  'le compte signalé ne traite pas son signalement');
select throws_ok($$select pg_temp.as_service($s$update game.reports set state = 'upheld', resolved_by = '00000000-0000-4000-8000-0000000220aa'
  where id = '00000000-0000-7000-8000-0000000220c1'$s$)$$, '23514', 'a report is resolved by another account than the reported one and the reporter',
  'ni celui qui l''a fait');
select throws_ok($$select pg_temp.as_service($s$update game.reports set state = 'upheld' where id = '00000000-0000-7000-8000-0000000220c1'$s$)$$,
  '23001', 'a report is immutable', 'un traitement nomme qui le fait');
select is(pg_temp.as_service($$update game.reports set state = 'upheld', resolved_by = '00000000-0000-4000-8000-0000000220ae'
  where id = '00000000-0000-7000-8000-0000000220c2' returning (resolved_at = now())::text$$), 'true',
  'un signalement retenu est daté par la base');
select throws_ok($$select pg_temp.as_service($s$update game.reports set state = 'dismissed', resolved_by = '00000000-0000-4000-8000-0000000220af'
  where id = '00000000-0000-7000-8000-0000000220c2'$s$)$$, '23001', 'a report is immutable', 'un signalement se traite une fois');
select throws_ok($$update game.reports set state = 'open', resolved_by = null, resolved_at = null where id = '00000000-0000-7000-8000-0000000220c2'$$,
  '23001', 'a report is immutable', 'et ne se rouvre pas');
select throws_ok($$select pg_temp.as_service($s$update game.reports set resolved_at = now() where id = '00000000-0000-7000-8000-0000000220c1'$s$)$$,
  '42501', null, 'le service ne date pas un traitement');
-- La purge garde un signalement traité, sans son message. Un message masqué avant cette transaction, pour la suite.
alter table game.messages disable trigger messages_guard;
insert into game.messages (id, channel_id, house_id, body, created_at)
select '00000000-0000-7000-8000-0000000220f6', c.id, '00000000-0000-7000-8000-0000000220b1', 'Ancien', now() - interval '40 days'
from game.channels c where c.city_id = '01900000-0000-7000-8000-000000000101';
insert into game.messages (id, channel_id, house_id, body, hidden_at)
select '00000000-0000-7000-8000-0000000220f3', c.id, '00000000-0000-7000-8000-0000000220b1', 'Déjà masqué', now() - interval '1 hour'
from game.channels c where c.city_id = '01900000-0000-7000-8000-000000000101';
alter table game.messages enable trigger messages_guard;
insert into game.reports (id, message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000220c6', '00000000-0000-7000-8000-0000000220f6', '00000000-0000-7000-8000-0000000220b1', '00000000-0000-7000-8000-0000000220a1', 'spam');
select pg_temp.as_service($$update game.reports set state = 'dismissed', resolved_by = '00000000-0000-4000-8000-0000000220ae'
  where id = '00000000-0000-7000-8000-0000000220c6' returning 1$$);
select pg_temp.as_service($$select game.purge_messages(now() - interval '30 days')$$);
select results_eq($$select message_id, state, resolved_by from game.reports where id = '00000000-0000-7000-8000-0000000220c6'$$,
  $$values (null::uuid, 'dismissed'::text, '00000000-0000-4000-8000-0000000220ae'::uuid)$$,
  'la purge garde le signalement traité, sans son message');

-- Masquer un message : maintenant, une fois ; le texte reste à l'administration seule.
select is(pg_temp.as_service($$update game.messages set hidden_at = now() where id = '00000000-0000-7000-8000-0000000220f1'
  returning (visible_body is null and body = 'De Bob')::text$$), 'true', 'le service masque un message ; son texte ne se lit plus');
select throws_ok($$select pg_temp.as_service($s$update game.messages set hidden_at = now() where id = '00000000-0000-7000-8000-0000000220f3'$s$)$$,
  '23001', 'a message is hidden once, now', 'un message se masque une fois');
select throws_ok($$select pg_temp.as_service($s$update game.messages set hidden_at = now() - interval '1 day' where id = '00000000-0000-7000-8000-0000000220f2'$s$)$$,
  '23001', 'a message is hidden once, now', 'maintenant');
select throws_ok($$select pg_temp.as_service($s$update game.messages set body = 'Retouché' where id = '00000000-0000-7000-8000-0000000220f2'$s$)$$,
  '42501', null, 'et le service ne touche pas à son texte');

select * from finish();
rollback;
