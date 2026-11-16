begin;
select plan(27);

-- Jeu d'essai : Alice, métèque de Kallistè ; Bob, citoyen de Kallistè ; Chloé, métèque d'Elaia ; Dion, dans un
-- autre monde ; Eudore, sans maison. Conversations Alice–Bob et Alice–Chloé. Kallistè a deux messages, dont un
-- masqué ; Elaia et chaque conversation en ont un.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000071aa', 'lire-alice@example.test'),
  ('00000000-0000-4000-8000-0000000071ab', 'lire-bob@example.test'),
  ('00000000-0000-4000-8000-0000000071ac', 'lire-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000071ad', 'lire-dion@example.test'),
  ('00000000-0000-4000-8000-0000000071ae', 'lire-eudore@example.test');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000071f0', 'lire-ailleurs', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000071f1', '01900000-0000-7000-8000-0000000071f0', 'ailleurs', 'Ailleurs');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000071a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000071aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000071b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000071ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000071c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000071ac', 'Bacchiades', '{}'),
  ('00000000-0000-7000-8000-0000000071d1', '01900000-0000-7000-8000-0000000071f0', '00000000-0000-4000-8000-0000000071ad', 'Étéoboutades', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000071a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000071c1', '01900000-0000-7000-8000-000000000103'),
  ('00000000-0000-7000-8000-0000000071d1', '01900000-0000-7000-8000-0000000071f1');
insert into game.citizenships (house_id, city_id, since)
  values ('00000000-0000-7000-8000-0000000071b1', '01900000-0000-7000-8000-000000000101', now() - interval '9 days');
update game.citizenships set status = 'citizen', since = now() where house_id = '00000000-0000-7000-8000-0000000071b1';
insert into game.channels (id, world_id, house_low, house_high) values
  ('00000000-0000-7000-8000-0000000071e1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000071a1', '00000000-0000-7000-8000-0000000071b1'),
  ('00000000-0000-7000-8000-0000000071e2', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000071a1', '00000000-0000-7000-8000-0000000071c1');
insert into game.messages (channel_id, house_id, body)
select c.id, m.house_id::uuid, m.body
from (values
  ('01900000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-0000000071a1', 'Kallistè, d''une métèque'),
  ('01900000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-0000000071b1', 'Kallistè, propos masqué'),
  ('01900000-0000-7000-8000-000000000103', '00000000-0000-7000-8000-0000000071c1', 'Elaia, de Chloé'),
  ('01900000-0000-7000-8000-0000000071f1', '00000000-0000-7000-8000-0000000071d1', 'Ailleurs, de Dion')) m (city_id, house_id, body)
join game.channels c on c.city_id = m.city_id::uuid;
insert into game.messages (channel_id, house_id, body) values
  ('00000000-0000-7000-8000-0000000071e1', '00000000-0000-7000-8000-0000000071b1', 'Privé Alice–Bob'),
  ('00000000-0000-7000-8000-0000000071e2', '00000000-0000-7000-8000-0000000071c1', 'Privé Alice–Chloé');
update game.messages set hidden_at = now() where body = 'Kallistè, propos masqué';
-- Identifiant du canal de Kallistè, lu par le propriétaire pour les essais d'accès direct.
create temporary table kalliste as select id from game.channels where city_id = '01900000-0000-7000-8000-000000000101';
grant select on kalliste to authenticated;

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('channels', 'channel_members', 'messages')),
  'channel_members:service_all:ALL:oikos_service channels:channels_read:SELECT:authenticated channels:service_all:ALL:oikos_service '
    || 'messages:messages_read:SELECT:authenticated messages:service_all:ALL:oikos_service',
  'une règle de lecture pour les joueurs sur les canaux et les messages, aucune d''écriture, rien sur les membres');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('my_channels', 'channel_messages') and grantee in ('anon', 'authenticated')),
  'channel_messages:authenticated:SELECT my_channels:authenticated:SELECT', 'vues en lecture seule, rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.readable_channel_ids()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction des canaux lisibles : liste figée');
select ok(not has_column_privilege('authenticated', 'game.messages', 'body', 'select'),
  'le texte original d''un message n''est accordé à aucun joueur');

-- Visiteur anonyme.
set local role anon;
select throws_ok('select * from public.my_channels', '42501', null, 'anon ne lit pas les canaux');
select throws_ok('select * from public.channel_messages', '42501', null, 'anon ne lit pas les messages');
reset role;

-- Alice, métèque de Kallistè.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000071aa", "role": "authenticated"}';
select results_eq(
  $$select kind, city_id, other_house_id from public.my_channels order by kind, other_house_id$$,
  $$values ('city'::text, '01900000-0000-7000-8000-000000000101'::uuid, null::uuid),
           ('direct', null, '00000000-0000-7000-8000-0000000071b1'::uuid),
           ('direct', null, '00000000-0000-7000-8000-0000000071c1'::uuid)$$,
  'une métèque lit le canal de sa cité et ses deux conversations, l''autre maison nommée');
select results_eq(
  $$select body, hidden_at is not null from public.channel_messages order by body nulls first$$,
  $$values (null::text, true), ('Kallistè, d''une métèque', false), ('Privé Alice–Bob', false), ('Privé Alice–Chloé', false)$$,
  'elle lit leurs messages, et rien d''Elaia ni d''ailleurs ; le message masqué ne rend plus son texte');
select is((select count(*) from public.channel_messages where house_id = '00000000-0000-7000-8000-0000000071b1' and hidden_at is not null),
  1::bigint, 'le message masqué reste listé, dit masqué, avec son auteur');
select throws_ok('select body from game.messages', '42501', null, 'le texte original est illisible, même en direct');
select is((select count(*) from game.messages where visible_body = 'Kallistè, propos masqué'), 0::bigint,
  'et la colonne visible ne le rend pas');
select throws_ok('select * from game.channel_members', '42501', null, 'les membres ne se lisent pas en direct');
select throws_ok($$insert into public.channel_messages (channel_id, house_id) select id, '00000000-0000-7000-8000-0000000071a1' from kalliste$$,
  '42501', null, 'pas d''écriture par la vue');
select throws_ok($$insert into game.messages (channel_id, house_id, body) select id, '00000000-0000-7000-8000-0000000071a1', 'Forgé' from kalliste$$,
  '42501', null, 'ni en direct');
select throws_ok($$update game.messages set hidden_at = null$$, '42501', null, 'pas de démasquage');
select throws_ok($$delete from game.messages$$, '42501', null, 'pas de suppression');
select throws_ok($$insert into game.channels (world_id, house_low, house_high) values ('01900000-0000-7000-8000-000000000001',
  '00000000-0000-7000-8000-0000000071b1', '00000000-0000-7000-8000-0000000071c1')$$, '42501', null, 'pas de conversation ouverte en direct');

-- Bob, citoyen de Kallistè.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000071ab", "role": "authenticated"}';
select results_eq(
  $$select kind, other_house_id from public.my_channels order by kind$$,
  $$values ('city'::text, null::uuid), ('direct', '00000000-0000-7000-8000-0000000071a1'::uuid)$$,
  'un citoyen lit le canal de sa cité et sa conversation avec Alice, pas celle d''Alice et de Chloé');
select is((select count(*) from public.channel_messages where channel_id = '00000000-0000-7000-8000-0000000071e2'), 0::bigint,
  'ni les messages de la conversation d''Alice et de Chloé');
select is((select count(*) from public.channel_messages), 3::bigint, 'trois messages : deux de Kallistè, un privé');

-- Chloé, métèque d'Elaia : une autre cité du même monde.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000071ac", "role": "authenticated"}';
select results_eq(
  $$select kind, city_id, other_house_id from public.my_channels order by kind$$,
  $$values ('city'::text, '01900000-0000-7000-8000-000000000103'::uuid, null::uuid),
           ('direct', null, '00000000-0000-7000-8000-0000000071a1'::uuid)$$,
  'une maison d''une autre cité lit le canal de la sienne et sa conversation');
select is((select count(*) from public.channel_messages m join kalliste k on k.id = m.channel_id), 0::bigint,
  'elle ne lit rien du canal de Kallistè, même en le désignant');
select is((select count(*) from game.channels c join kalliste k on k.id = c.id), 0::bigint, 'ni le canal lui-même, en direct');
select results_eq($$select body from public.channel_messages order by body$$,
  $$values ('Elaia, de Chloé'::text), ('Privé Alice–Chloé')$$, 'ses messages, et ceux-là seulement');

-- Dion, dans un autre monde ; Eudore, sans maison.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000071ad", "role": "authenticated"}';
select results_eq($$select body from public.channel_messages$$, $$values ('Ailleurs, de Dion'::text)$$,
  'une maison d''un autre monde ne lit que le canal de sa cité');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000071ae", "role": "authenticated"}';
select is((select count(*) from public.my_channels), 0::bigint, 'un compte sans maison ne lit aucun canal');
select is((select count(*) from public.channel_messages), 0::bigint, 'ni aucun message');
reset role;

select * from finish();
rollback;
