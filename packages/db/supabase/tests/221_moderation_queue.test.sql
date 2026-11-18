begin;
select plan(21);

-- Jeu d'essai : Alice (aa), Bob (ab) et Dora (af), de Kallistè ; Chloé (ac), d'Elaia ; Minos (ad), modérateur sans
-- maison au départ, rôle accordé par Rhéa (ae). Messages de Kallistè k1 à k6, d'une minute en une minute, e1 à Elaia, d0 et d1
-- (masqué) dans la conversation d'Alice et de Bob. Signalements ouverts : k3 (il y a une heure), un message purgé
-- (45 minutes), k6 deux fois (30 et 20 minutes), d1 (30 minutes) ; k1, traité. Gardes coupées le temps du jeu
-- d'essai, pour dater signalements et messages.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000221aa', 'mq-alice@example.test'),
  ('00000000-0000-4000-8000-0000000221ab', 'mq-bob@example.test'),
  ('00000000-0000-4000-8000-0000000221ac', 'mq-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000221ad', 'mq-minos@example.test'),
  ('00000000-0000-4000-8000-0000000221ae', 'mq-rhea@example.test'),
  ('00000000-0000-4000-8000-0000000221af', 'mq-dora@example.test');
insert into admin.roles (user_id, role, granted_by) values
  ('00000000-0000-4000-8000-0000000221ae', 'super_admin', null),
  ('00000000-0000-4000-8000-0000000221ad', 'moderator', '00000000-0000-4000-8000-0000000221ae');
insert into game.houses (id, world_id, user_id, name, blazon)
select h.id::uuid, '01900000-0000-7000-8000-000000000001', h.user_id::uuid, h.name, '{}'
from (values
  ('00000000-0000-7000-8000-0000000221a1', '00000000-0000-4000-8000-0000000221aa', 'Alcméonides'),
  ('00000000-0000-7000-8000-0000000221b1', '00000000-0000-4000-8000-0000000221ab', 'Philaïdes'),
  ('00000000-0000-7000-8000-0000000221c1', '00000000-0000-4000-8000-0000000221ac', 'Bacchiades'),
  ('00000000-0000-7000-8000-0000000221f1', '00000000-0000-4000-8000-0000000221af', 'Doriens')) h (id, user_id, name);
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000221a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000221b1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000221f1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000221c1', '01900000-0000-7000-8000-000000000103');
insert into game.channels (id, world_id, house_low, house_high) values
  ('00000000-0000-7000-8000-0000000221e0', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000221a1', '00000000-0000-7000-8000-0000000221b1');
alter table game.messages disable trigger user;
alter table game.reports disable trigger user;
insert into game.messages (id, channel_id, house_id, body, created_at, hidden_at)
select ('00000000-0000-7000-8000-0000000221' || m.n)::uuid, coalesce(c.id, m.channel_id::uuid),
       ('00000000-0000-7000-8000-0000000221' || m.house)::uuid, 'Message ' || m.n, now() - m.age * interval '1 minute', m.hidden
from (values
  ('d0', 'a1', null, '00000000-0000-7000-8000-0000000221e0', 12, null::timestamptz),
  ('d1', 'b1', null, '00000000-0000-7000-8000-0000000221e0', 11, now()),
  ('01', 'a1', '01900000-0000-7000-8000-000000000101', null, 10, null), ('02', 'b1', '01900000-0000-7000-8000-000000000101', null, 9, null),
  ('03', 'a1', '01900000-0000-7000-8000-000000000101', null, 8, null), ('04', 'b1', '01900000-0000-7000-8000-000000000101', null, 7, null),
  ('05', 'a1', '01900000-0000-7000-8000-000000000101', null, 6, null), ('06', 'b1', '01900000-0000-7000-8000-000000000101', null, 5, null),
  ('e1', 'c1', '01900000-0000-7000-8000-000000000103', null, 8, null)
) m (n, house, city_id, channel_id, age, hidden)
left join game.channels c on c.city_id = m.city_id::uuid;
insert into game.reports (id, message_id, reported_house_id, house_id, reason, state, created_at, resolved_at, resolved_by)
select ('00000000-0000-7000-8000-0000000221' || r.n)::uuid, ('00000000-0000-7000-8000-0000000221' || r.msg)::uuid,
       ('00000000-0000-7000-8000-0000000221' || r.author)::uuid, ('00000000-0000-7000-8000-0000000221' || r.house)::uuid,
       r.reason, r.state, now() - r.age * interval '1 minute', r.resolved, r.resolved_by::uuid
from (values
  ('c3', '03', 'a1', 'b1', 'spam', 'open', 60, null::timestamptz, null),
  ('c6', '06', 'b1', 'a1', 'hate', 'open', 30, null, null),
  ('c7', '06', 'b1', 'f1', 'spam', 'open', 20, null, null),
  ('cd', 'd1', 'b1', 'a1', 'harassment', 'open', 30, null, null),
  ('c1', '01', 'a1', 'b1', 'spam', 'dismissed', 90, now(), '00000000-0000-4000-8000-0000000221ad')
) r (n, msg, author, house, reason, state, age, resolved, resolved_by);
insert into game.reports (id, message_id, reported_house_id, house_id, reason, created_at) values
  ('00000000-0000-7000-8000-0000000221c9', null, '00000000-0000-7000-8000-0000000221b1', '00000000-0000-7000-8000-0000000221a1', 'other', now() - interval '45 minutes');
alter table game.messages enable trigger user;
alter table game.reports enable trigger user;
insert into admin.sanctions (user_id, kind, ends_at, reason, author_id, validated_by) values
  ('00000000-0000-4000-8000-0000000221aa', 'silence', now() + interval '1 day', 'Silence-appel', '00000000-0000-4000-8000-0000000221ad', null),
  ('00000000-0000-4000-8000-0000000221aa', 'warning', now() + interval '1 day', 'Sans-appel', '00000000-0000-4000-8000-0000000221ad', null),
  ('00000000-0000-4000-8000-0000000221ab', 'ban', null, 'Ban-propose', '00000000-0000-4000-8000-0000000221ad', null),
  ('00000000-0000-4000-8000-0000000221ac', 'ban', null, 'Ban-valide', '00000000-0000-4000-8000-0000000221ad', '00000000-0000-4000-8000-0000000221ae');
update admin.sanctions set appeal_body = 'Je conteste.' where reason = 'Silence-appel';

create temp table q on commit drop as select admin.moderation_queue(2, 10) as doc;
create function pg_temp.ids(entries jsonb, path text) returns text[] language sql as $$
  select coalesce(array_agg(right(e #>> path::text[], 2) order by o), '{}') from jsonb_array_elements(entries) with ordinality x (e, o)
$$;

select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where r.rolname in ('anon', 'authenticated', 'oikos_service') and has_function_privilege(r.rolname, 'admin.moderation_queue(integer, integer)', 'execute')),
  'oikos_service', 'seul le service lit la file');
select is(pg_temp.ids((select doc -> 'queue' from q), '{reports,0,id}'), array['c3', 'c9', 'c6', 'cd'],
  'la plus ancienne d''abord, puis la plus signalée ; un signalement traité n''y est plus');
select is(pg_temp.ids((select doc -> 'queue' -> 2 -> 'reports' from q), '{id}'), array['c6', 'c7'],
  'les signalements ouverts d''un message, dans l''ordre de leur dépôt');
select is(pg_temp.ids((select doc -> 'queue' from q), '{message,id}'), array['03', null, '06', 'd1'],
  'une entrée par message ; un signalement au message purgé fait la sienne');
select is(pg_temp.ids((select doc -> 'queue' -> 0 -> 'context' from q), '{id}'), array['01', '02', '04', '05'],
  'contexte : les messages qui précèdent et qui suivent, dans le seul canal du message');
select is(pg_temp.ids((select doc -> 'queue' -> 2 -> 'context' from q), '{id}'), array['04', '05'],
  'le dernier message du canal n''a que ceux qui le précèdent');
select is((select doc -> 'queue' -> 3 -> 'message' ->> 'body' from q), 'Message d1', 'un message masqué se lit dans la file');
select ok((select doc -> 'queue' -> 3 -> 'message' ->> 'hiddenAt' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' from q),
  'dit masqué, à l''instant ISO 8601');
select is((select (doc -> 'queue' -> 3 -> 'channel') - 'id' from q), '{"kind": "direct", "city": null}'::jsonb,
  'dans une conversation privée');
select is((select doc -> 'queue' -> 1 from q) - 'reports', jsonb_build_object('world', 'archipel', 'reportedHouse',
  jsonb_build_object('id', '00000000-0000-7000-8000-0000000221b1', 'name', 'Philaïdes', 'userId', '00000000-0000-4000-8000-0000000221ab'),
  'channel', null, 'message', null, 'context', '[]'::jsonb), 'un message purgé : la maison signalée et son compte, ni texte ni contexte');
select is(
  (select array_agg(distinct k order by k) from q, jsonb_path_query(q.doc, 'lax $.**') v, jsonb_object_keys(v) k
   where jsonb_typeof(v) = 'object'),
  array['appealBody', 'appealedAt', 'appeals', 'authorId', 'body', 'channel', 'city', 'context', 'createdAt', 'endsAt',
        'hiddenAt', 'houseId', 'houseName', 'id', 'kind', 'message', 'name', 'pendingExclusions', 'proposedAt', 'queue',
        'reason', 'reportedHouse', 'reports', 'sanctionId', 'startsAt', 'userId', 'world'],
  'la file ne rend que ces champs : aucune donnée économique');
select is((select position('00000000-0000-7000-8000-0000000221f1' in doc::text) from q), 0, 'ni la maison qui signale');
select is((select jsonb_agg(a -> 'reason') from q, jsonb_array_elements(doc -> 'appeals') a), '["Silence-appel"]'::jsonb,
  'les appels à trancher');
select is((select jsonb_agg(a -> 'reason') from q, jsonb_array_elements(doc -> 'pendingExclusions') a), '["Ban-propose"]'::jsonb,
  'les exclusions à valider');
select is(pg_temp.ids(admin.moderation_queue(0, 1) -> 'queue', '{reports,0,id}') || pg_temp.ids(admin.moderation_queue(0, 1) -> 'queue' -> 0 -> 'context', '{id}'),
  array['c3'], 'bornes : au plus une entrée, sans contexte');

-- Minos, modérateur, a aussi une maison, à Elaia : connecté au jeu, son rôle ne lui ouvre rien de plus qu'à un joueur.
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000221a9', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000221ad', 'Minyens', '{}');
insert into game.citizenships (house_id, city_id) values ('00000000-0000-7000-8000-0000000221a9', '01900000-0000-7000-8000-000000000103');
insert into game.inventories (world_id, house_id, city_id, good_id)
select '01900000-0000-7000-8000-000000000001', h::uuid, '01900000-0000-7000-8000-000000000101', 'wheat'
from unnest(array['00000000-0000-7000-8000-0000000221a1', '00000000-0000-7000-8000-0000000221a9']) h;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000221ad", "role": "authenticated", "aal": "aal2"}';
select throws_ok('select admin.moderation_queue(2, 10)', '42501', null, 'un modérateur ne lit pas la file par Supabase');
select is(
  (select count(*) from (
     select house_id from public.my_inventories union all select house_id from public.my_orders
     union all select house_id from public.my_balance_sheet union all select house_id from public.my_cash_flows
     union all select house_id from public.my_treasury union all select house_id from public.my_valued_stocks
     union all select house_id from public.my_income_statement union all select house_id from public.my_sites
     union all select house_id from public.my_ships union all select house_id from public.my_properties
     union all select house_id from public.my_workforce union all select house_id from public.my_favor) mine
   where house_id <> '00000000-0000-7000-8000-0000000221a9'),
  0::bigint, 'aucune donnée économique d''une autre maison par les vues my_*');
select is((select count(*) from public.my_inventories), 1::bigint, 'seulement le stock de sa propre maison');
select is(
  (select count(*) from public.channel_messages where house_id <> '00000000-0000-7000-8000-0000000221c1')
    + (select count(*) from public.my_reports),
  0::bigint, 'ni les messages de Kallistè et de la conversation signalés, ni les signalements');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000221aa", "role": "authenticated"}';
select is((select count(*) from public.my_inventories), 1::bigint, 'Alice, elle, lit son stock');
select ok((select count(*) from public.channel_messages) > 0, 'et sa discussion');
reset role;

select * from finish();
rollback;
