begin;
select plan(9);

-- Masquage diffusé (ADR 0008, ticket 532), sur le modèle de 190_chat_broadcast. Jeu d'essai : Alice, métèque de
-- Kallistè ; Bob, citoyen de Kallistè ; Chloé, métèque d'Elaia. Conversation Bob–Chloé.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000532', 'masquage-alice@example.test'),
  ('00000000-0000-4000-8000-000000000533', 'masquage-bob@example.test'),
  ('00000000-0000-4000-8000-000000000534', 'masquage-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000532a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000000532', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000532b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000000533', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000532c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000000534', 'Bacchiades', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000532a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000532c1', '01900000-0000-7000-8000-000000000103');
insert into game.citizenships (house_id, city_id, since)
  values ('00000000-0000-7000-8000-0000000532b1', '01900000-0000-7000-8000-000000000101', now() - interval '9 days');
update game.citizenships set status = 'citizen', since = now() where house_id = '00000000-0000-7000-8000-0000000532b1';
insert into game.channels (id, world_id, house_low, house_high) values
  ('00000000-0000-7000-8000-0000000532e2', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000532b1', '00000000-0000-7000-8000-0000000532c1');

-- Messages écrits par le service comme le fait l'API : un dans le canal de Kallistè, un dans la conversation.
set local role oikos_service;
insert into game.messages (channel_id, house_id, body)
select id, '00000000-0000-7000-8000-0000000532a1', 'Texte secret de Kallistè' from game.channels where city_id = '01900000-0000-7000-8000-000000000101';
insert into game.messages (channel_id, house_id, body)
  values ('00000000-0000-7000-8000-0000000532e2', '00000000-0000-7000-8000-0000000532c1', 'Texte secret privé');
reset role;
create temporary table ours as
  select id::text as id, channel_id::text as channel_id, body from game.messages
  where house_id in ('00000000-0000-7000-8000-0000000532a1', '00000000-0000-7000-8000-0000000532c1');
select is((select count(*) from realtime.messages where event = 'message_hidden'
           and payload ->> 'message_id' in (select id from ours)), 0::bigint, 'rien n''est diffusé tant que rien n''est masqué');

-- Masquage du message de la cité, par le service comme la modération.
set local role oikos_service;
update game.messages set hidden_at = now() where body = 'Texte secret de Kallistè';
reset role;
select results_eq(
  $$select topic, extension, private from realtime.messages
    where event = 'message_hidden' and payload ->> 'message_id' in (select id from ours)$$,
  $$select 'chat:' || channel_id, 'broadcast'::text, true from ours where body = 'Texte secret de Kallistè'$$,
  'le masquage d''un message de cité est diffusé une fois, sur le sujet de son canal, en canal privé');
select is(
  (select payload - 'id' from realtime.messages
   where event = 'message_hidden' and payload ->> 'channel_id' = (select channel_id from ours where body = 'Texte secret de Kallistè')),
  (select jsonb_build_object('channel_id', channel_id, 'message_id', id) from ours where body = 'Texte secret de Kallistè'),
  'la diffusion ne porte que le canal et l''identifiant du message');
select ok((select bool_and(payload::text not like '%secret%' and payload::text not like '%532a1%') from realtime.messages
           where event = 'message_hidden' and payload ->> 'message_id' in (select id from ours)), 'ni le texte ni l''auteur');
select is((select count(*) from realtime.messages where event = 'message_posted'
           and payload ->> 'message_id' in (select id from ours)), 3::bigint, 'la création reste diffusée sous son événement : un sujet pour la cité, deux pour la conversation');

-- Masquage dans une conversation : les deux maisons, à elles seules.
set local role oikos_service;
update game.messages set hidden_at = now() where body = 'Texte secret privé';
reset role;
select results_eq(
  $$select topic from realtime.messages where event = 'message_hidden'
    and payload ->> 'message_id' = (select id from ours where body = 'Texte secret privé') order by topic$$,
  $$values ('house:00000000-0000-7000-8000-0000000532b1'), ('house:00000000-0000-7000-8000-0000000532c1')$$,
  'le masquage d''un message privé est diffusé aux deux maisons de la conversation');

-- Aucune autre mise à jour ne diffuse : ni un second passage de `hidden_at`, ni une autre colonne.
reset role;
select is((select count(*) from realtime.messages where event = 'message_hidden'
           and payload ->> 'message_id' in (select id from ours)), 3::bigint, 'chaque masquage est diffusé une fois par sujet');
select throws_ok($$update game.messages set hidden_at = now() + interval '1 second' where body = 'Texte secret privé'$$,
  '23001', null, 'un message déjà masqué ne se masque pas de nouveau (aucune nouvelle diffusion)');
select is((select count(*) from realtime.messages where event = 'message_hidden'
           and payload ->> 'message_id' in (select id from ours)), 3::bigint, 'et rien de plus n''est diffusé');

select * from finish();
rollback;
