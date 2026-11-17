begin;
select plan(44);

-- Diffusion des messages par Realtime (ADR 0008, ticket 274). Jeu d'essai : Alice, métèque de Kallistè ; Bob,
-- citoyen de Kallistè ; Chloé, métèque d'Elaia ; Dion, dans un autre monde ; Eudore, sans maison.
-- Conversations Alice–Bob et Bob–Chloé.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000274aa', 'diffuser-alice@example.test'),
  ('00000000-0000-4000-8000-0000000274ab', 'diffuser-bob@example.test'),
  ('00000000-0000-4000-8000-0000000274ac', 'diffuser-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000274ad', 'diffuser-dion@example.test'),
  ('00000000-0000-4000-8000-0000000274ae', 'diffuser-eudore@example.test');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000274f0', 'diffuser-ailleurs', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000274f1', '01900000-0000-7000-8000-0000000274f0', 'ailleurs', 'Ailleurs');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000274a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000274aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000274b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000274ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000274c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000274ac', 'Bacchiades', '{}'),
  ('00000000-0000-7000-8000-0000000274d1', '01900000-0000-7000-8000-0000000274f0', '00000000-0000-4000-8000-0000000274ad', 'Étéoboutades', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000274a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000274c1', '01900000-0000-7000-8000-000000000103'),
  ('00000000-0000-7000-8000-0000000274d1', '01900000-0000-7000-8000-0000000274f1');
insert into game.citizenships (house_id, city_id, since)
  values ('00000000-0000-7000-8000-0000000274b1', '01900000-0000-7000-8000-000000000101', now() - interval '9 days');
update game.citizenships set status = 'citizen', since = now() where house_id = '00000000-0000-7000-8000-0000000274b1';
insert into game.channels (id, world_id, house_low, house_high) values
  ('00000000-0000-7000-8000-0000000274e1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000274a1', '00000000-0000-7000-8000-0000000274b1'),
  ('00000000-0000-7000-8000-0000000274e2', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000274b1', '00000000-0000-7000-8000-0000000274c1');
create temporary table topic (name text primary key, topic text not null);
insert into topic
select 'kalliste', 'chat:' || id from game.channels where city_id = '01900000-0000-7000-8000-000000000101'
union all select 'elaia', 'chat:' || id from game.channels where city_id = '01900000-0000-7000-8000-000000000103'
union all values ('alice', 'house:00000000-0000-7000-8000-0000000274a1'), ('bob', 'house:00000000-0000-7000-8000-0000000274b1'),
  ('chloe', 'house:00000000-0000-7000-8000-0000000274c1'), ('alice_bob', 'chat:00000000-0000-7000-8000-0000000274e1'),
  ('bob_chloe', 'chat:00000000-0000-7000-8000-0000000274e2');
grant select on topic to anon, authenticated;
create function pg_temp.t(name text) returns text language sql as $$ select topic from topic where name = $1 $$;
grant execute on function pg_temp.t(text) to anon, authenticated;
-- Messages écrits par les maisons du jeu d'essai, relevés par le propriétaire avant chaque vérification : la base
-- peut porter d'autres diffusions (tests de bout en bout, usage local sans `db:reset`), qui ne comptent pas.
create temporary table ours (id text primary key);
grant select on ours to anon, authenticated;
create function pg_temp.collect() returns void language sql as $$
  insert into ours select id::text from game.messages where house_id in ('00000000-0000-7000-8000-0000000274a1',
    '00000000-0000-7000-8000-0000000274b1', '00000000-0000-7000-8000-0000000274c1', '00000000-0000-7000-8000-0000000274d1')
  on conflict do nothing $$;

-- Ce que Realtime décide à l'abonnement d'un canal privé, par sa propre fonction : lecture et écriture, pour la
-- diffusion puis pour la présence. `sub` nul : un visiteur anonyme.
create function pg_temp.realtime_rights(sub text, topic text) returns text language sql as $$
  select format('lire %s/%s écrire %s/%s', a.read_allowed[1], a.read_allowed[2], a.write_allowed[1], a.write_allowed[2])
  from realtime.authorize(
    case when sub is null then 'anon' else 'authenticated' end, topic,
    case when sub is null then '{"role": "anon"}' else format('{"sub": "%s", "role": "authenticated"}', sub) end,
    sub, '{}', array['broadcast', 'presence'], array['broadcast', 'presence']) a
$$;
create function pg_temp.rights_of(who text, topic text) returns text language sql as $$
  select pg_temp.realtime_rights(case who when 'alice' then '00000000-0000-4000-8000-0000000274aa'
    when 'bob' then '00000000-0000-4000-8000-0000000274ab' when 'chloe' then '00000000-0000-4000-8000-0000000274ac'
    when 'dion' then '00000000-0000-4000-8000-0000000274ad' when 'eudore' then '00000000-0000-4000-8000-0000000274ae' end, topic)
$$;

-- Le schéma de Realtime est là (la CLI le crée avant les migrations quand Realtime est activé), et ses règles.
select isnt(to_regclass('realtime.messages'), null, 'realtime.messages existe : Realtime est activé dans la pile');
select ok((select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass), 'règles par ligne actives sur realtime.messages');
select is(
  (select string_agg(policyname || ':' || permissive || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by policyname)
   from pg_policies where schemaname = 'realtime' and tablename = 'messages'),
  'chat_listen:PERMISSIVE:SELECT:authenticated no_client_delete:RESTRICTIVE:DELETE:anon,authenticated '
    || 'no_client_insert:RESTRICTIVE:INSERT:anon,authenticated no_client_update:RESTRICTIVE:UPDATE:anon,authenticated',
  'une seule lecture, pour les joueurs connectés ; aucune écriture des clients : liste figée');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.readable_realtime_topics()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction des sujets lisibles');

-- Diffusion : un message validé du canal de Kallistè, écrit par le service comme le fait l'API.
set local role oikos_service;
insert into game.messages (channel_id, house_id, body)
select id, '00000000-0000-7000-8000-0000000274a1', 'Texte secret de Kallistè' from game.channels where city_id = '01900000-0000-7000-8000-000000000101';
reset role;
create temporary table kalliste_message as
  select id from game.messages where body = 'Texte secret de Kallistè';
select pg_temp.collect();
select results_eq(
  $$select topic, event, extension, private from realtime.messages where payload ->> 'message_id' in (select id from ours)$$,
  $$select pg_temp.t('kalliste'), 'message_posted'::text, 'broadcast'::text, true$$,
  'un message du canal d''une cité est diffusé une fois, sur le sujet du canal, en canal privé');
select is(
  (select payload - 'id' from realtime.messages where payload ->> 'message_id' in (select id from ours)),
  jsonb_build_object('channel_id', substr(pg_temp.t('kalliste'), 6), 'message_id', (select id from kalliste_message)),
  'la diffusion ne porte que le canal et l''identifiant du message');
select ok((select payload::text not like '%secret%' and payload::text not like '%00000000-0000-7000-8000-0000000274a1%' from realtime.messages
           where payload ->> 'message_id' in (select id from ours)), 'ni le texte ni l''auteur');

-- Une conversation privée : diffusée sur le sujet de chacune de ses deux maisons, pas sur celui du canal.
set local role oikos_service;
insert into game.messages (channel_id, house_id, body)
  values ('00000000-0000-7000-8000-0000000274e2', '00000000-0000-7000-8000-0000000274c1', 'Privé Chloé–Bob');
reset role;
select results_eq(
  $$select topic from realtime.messages where payload ->> 'channel_id' = '00000000-0000-7000-8000-0000000274e2' order by topic$$,
  $$values (pg_temp.t('bob')), (pg_temp.t('chloe'))$$,
  'un message privé est diffusé aux deux maisons de la conversation, à elles seules');
-- Un message refusé par la base n'est pas diffusé.
select throws_ok(
  $$insert into game.messages (channel_id, house_id, body)
    values ('00000000-0000-7000-8000-0000000274e2', '00000000-0000-7000-8000-0000000274a1', 'Intrusion')$$,
  '23514', null, 'une maison n''écrit pas dans la conversation d''autres maisons');
select pg_temp.collect();
select is((select count(*) from realtime.messages where payload ->> 'message_id' in (select id from ours)), 3::bigint,
  'et rien de plus n''est diffusé');
-- Un message d'Elaia, pour les lectures ci-dessous.
insert into game.messages (channel_id, house_id, body)
select id, '00000000-0000-7000-8000-0000000274c1', 'Elaia' from game.channels where city_id = '01900000-0000-7000-8000-000000000103';
select pg_temp.collect();

-- Abonnement, tel que Realtime le décide : un joueur écoute les canaux qu'il lit et ses maisons, n'écrit nulle
-- part, et la présence n'est ouverte à personne.
select is(pg_temp.rights_of('alice', pg_temp.t('kalliste')), 'lire t/f écrire f/f',
  'une métèque écoute le canal de sa cité, sans y diffuser');
select is(pg_temp.rights_of('alice', pg_temp.t('alice')), 'lire t/f écrire f/f',
  'elle écoute le sujet de sa maison, où arrivent ses conversations');
select is(pg_temp.rights_of('alice', pg_temp.t('elaia')), 'lire f/f écrire f/f', 'pas le canal d''une autre cité');
select is(pg_temp.rights_of('alice', pg_temp.t('bob')), 'lire f/f écrire f/f', 'ni le sujet d''une autre maison');
select is(pg_temp.rights_of('alice', pg_temp.t('bob_chloe')), 'lire f/f écrire f/f', 'ni la conversation d''autres maisons');
select is(pg_temp.rights_of('alice', pg_temp.t('alice_bob')), 'lire t/f écrire f/f', 'mais sa propre conversation');
select is(pg_temp.rights_of('bob', pg_temp.t('kalliste')), 'lire t/f écrire f/f', 'un citoyen écoute le canal de sa cité');
select is(pg_temp.rights_of('bob', pg_temp.t('bob')), 'lire t/f écrire f/f', 'et le sujet de sa maison');
select is(pg_temp.rights_of('chloe', pg_temp.t('kalliste')), 'lire f/f écrire f/f', 'une maison d''Elaia n''écoute pas Kallistè');
select is(pg_temp.rights_of('chloe', pg_temp.t('elaia')), 'lire t/f écrire f/f', 'mais Elaia');
select is(pg_temp.rights_of('dion', pg_temp.t('kalliste')), 'lire f/f écrire f/f', 'ni une maison d''un autre monde');
select is(pg_temp.rights_of('eudore', pg_temp.t('kalliste')) || ' ' || pg_temp.rights_of('eudore', pg_temp.t('alice')),
  'lire f/f écrire f/f lire f/f écrire f/f', 'un compte sans maison n''écoute rien');
select is(pg_temp.rights_of(null, pg_temp.t('kalliste')) || ' ' || pg_temp.rights_of(null, pg_temp.t('alice')),
  'lire f/f écrire f/f lire f/f écrire f/f', 'un visiteur anonyme non plus');
select is(
  (select string_agg(pg_temp.rights_of('alice', bad), ' | ') from unnest(array[
     upper(pg_temp.t('kalliste')), pg_temp.t('kalliste') || ' ', 'chat:*', 'chat:', '', substr(pg_temp.t('kalliste'), 6),
     'realtime:' || pg_temp.t('kalliste'), 'house:' || upper(substr(pg_temp.t('alice'), 7))]) bad),
  rtrim(repeat('lire f/f écrire f/f | ', 8), ' | '),
  'un sujet approché (casse, blanc, motif, préfixe) n''ouvre rien');

-- Les règles elles-mêmes, en direct : Alice lit les lignes de ses sujets, pas celles des autres.
insert into realtime.messages (topic, extension, payload) values (pg_temp.t('alice'), 'presence', '{}');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000274aa", "role": "authenticated"}';
select is((select count(*) from realtime.messages where topic = pg_temp.t('kalliste') and payload ->> 'message_id' in (select id from ours)),
  1::bigint, 'Alice lit la diffusion de sa cité');
select is((select count(*) from realtime.messages where topic in (pg_temp.t('elaia'), pg_temp.t('bob'), pg_temp.t('chloe'))),
  0::bigint, 'pas celle d''Elaia, ni celles des maisons de Bob et de Chloé');
select is((select count(*) from realtime.messages where extension = 'presence'), 0::bigint, 'ni la présence, même sur son sujet');

-- Aucun client ne diffuse : ni par la table, ni par la fonction de Realtime, ni sur ses propres sujets.
select throws_ok(format($$insert into realtime.messages (topic, extension, payload) values (%L, 'broadcast', '{}')$$, pg_temp.t('kalliste')),
  '42501', null, 'un joueur n''écrit pas dans realtime.messages, même sur le sujet de sa cité');
select throws_ok(format($$insert into realtime.messages (topic, extension, payload) values (%L, 'broadcast', '{}')$$, pg_temp.t('alice')),
  '42501', null, 'ni sur celui de sa maison');
select throws_ok(format($$insert into realtime.messages (topic, extension, payload, private) values (%L, 'broadcast', '{}', false)$$, 'public-room'),
  '42501', null, 'ni sur un sujet public');
-- Une règle permissive ajoutée plus tard (par Studio, par exemple) n'ouvre pas l'écriture : les règles
-- restrictives l'emportent.
reset role;
create policy later_permissive on realtime.messages for insert to authenticated with check (true);
set local role authenticated;
select throws_ok(format($$insert into realtime.messages (topic, extension, payload) values (%L, 'broadcast', '{}')$$, pg_temp.t('kalliste')),
  '42501', null, 'une règle permissive d''écriture ajoutée plus tard ne fait pas diffuser un joueur');
reset role;
drop policy later_permissive on realtime.messages;
set local role authenticated;
select lives_ok(format($$select realtime.send('{"forged": true}', 'message_posted', %L, true)$$, pg_temp.t('kalliste')),
  'realtime.send, ouverte à tous par Realtime, ne lève pas…');
select is((select count(*) from realtime.messages where payload ? 'forged'), 0::bigint, '… mais n''écrit rien');
with u as (update realtime.messages set payload = '{"forged": true}' returning 1)
select is(count(*), 0::bigint, 'un joueur ne modifie aucune diffusion') from u;
select throws_ok('delete from realtime.messages', '42501', null, 'ni n''en supprime');
reset role;
set local role anon;
select throws_ok(format($$insert into realtime.messages (topic, extension, payload) values (%L, 'broadcast', '{}')$$, pg_temp.t('kalliste')),
  '42501', null, 'un visiteur anonyme n''écrit pas non plus');
select is((select count(*) from realtime.messages), 0::bigint, 'ni ne lit rien');
with u as (update realtime.messages set payload = '{}' returning 1) select is(count(*), 0::bigint, 'ni ne modifie') from u;
reset role;
select is((select count(*) from realtime.messages where payload ? 'forged'), 0::bigint, 'aucune diffusion forgée en base');
select is((select count(*) from realtime.messages where payload ->> 'message_id' in (select id from ours)), 4::bigint,
  'les diffusions de la base sont intactes : Kallistè, la conversation (deux), Elaia');

-- Une maison retirée de sa cité (citoyenneté supprimée) n'écoute plus le canal de la cité, et garde son sujet et
-- sa conversation.
delete from game.citizenships where house_id = '00000000-0000-7000-8000-0000000274a1';
select is(pg_temp.rights_of('alice', pg_temp.t('kalliste')), 'lire f/f écrire f/f', 'retirée de Kallistè, Alice n''en écoute plus le canal');
select is(pg_temp.rights_of('alice', pg_temp.t('alice')) || ' ' || pg_temp.rights_of('alice', pg_temp.t('alice_bob')),
  'lire t/f écrire f/f lire t/f écrire f/f', 'elle garde le sujet de sa maison et sa conversation');

-- Une diffusion en échec (Realtime en panne, partition du jour manquante) n'empêche pas d'écrire le message :
-- `realtime.send` n'en rend qu'un avertissement. La panne est simulée par un déclencheur qui refuse toute ligne,
-- jusqu'à la fin du test.
create function pg_temp.refuse() returns trigger language plpgsql as $$
begin raise exception 'Realtime en panne'; end $$;
create trigger refuse before insert on realtime.messages for each row execute function pg_temp.refuse();
-- L'insertion se fait sous le rôle du service, qui ne voit pas les fonctions de pgTAP : une erreur ferait échouer
-- le test ; la vérification se fait ensuite sous le rôle du test.
set local role oikos_service;
insert into game.messages (channel_id, house_id, body)
  values ('00000000-0000-7000-8000-0000000274e1', '00000000-0000-7000-8000-0000000274b1', 'Sans Realtime');
reset role;
select is((select count(*) from game.messages where body = 'Sans Realtime'), 1::bigint,
  'Realtime en panne, le message est écrit quand même et il est en base');
select pg_temp.collect();
select is((select count(*) from realtime.messages where payload ->> 'message_id' in (select id from ours)), 4::bigint,
  'et sans diffusion');

select * from finish();
rollback;
