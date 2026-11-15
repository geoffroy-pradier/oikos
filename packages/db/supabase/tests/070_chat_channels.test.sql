begin;
select plan(50);

-- Jeu d'essai : Alice, métèque de Kallistè ; Bob, citoyen de Kallistè ; Chloé, métèque d'Elaia ; Dion, dans un
-- autre monde. Le canal d'une cité naît avec elle (seed et cité créée ici).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000070aa', 'canal-alice@example.test'),
  ('00000000-0000-4000-8000-0000000070ab', 'canal-bob@example.test'),
  ('00000000-0000-4000-8000-0000000070ac', 'canal-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000070ad', 'canal-dion@example.test');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000070f0', 'canal-ailleurs', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000070f1', '01900000-0000-7000-8000-0000000070f0', 'ailleurs', 'Ailleurs');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000070a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000070aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000070b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000070ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000070c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000070ac', 'Bacchiades', '{}'),
  ('00000000-0000-7000-8000-0000000070d1', '01900000-0000-7000-8000-0000000070f0', '00000000-0000-4000-8000-0000000070ad', 'Étéoboutades', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000070a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000070c1', '01900000-0000-7000-8000-000000000103'),
  ('00000000-0000-7000-8000-0000000070d1', '01900000-0000-7000-8000-0000000070f1');
insert into game.citizenships (house_id, city_id, since)
  values ('00000000-0000-7000-8000-0000000070b1', '01900000-0000-7000-8000-000000000101', now() - interval '9 days');
update game.citizenships set status = 'citizen', since = now() where house_id = '00000000-0000-7000-8000-0000000070b1';

-- Instructions exécutées sous le rôle de service ; les assertions restent au propriétaire (pgTAP n'est pas
-- dans le chemin du service).
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.city_channel(city uuid) returns uuid language sql as $$
  select id from game.channels where city_id = city
$$;
create function pg_temp.post(channel uuid, house text, body text) returns text language sql as $$
  select format($s$select pg_temp.as_service($q$insert into game.messages (channel_id, house_id, body)
    values (%L, %L, %L)$q$)$s$, channel, house, body)
$$;

-- Droits, lus dans le catalogue.
select ok(c.relrowsecurity, format('règles par ligne actives sur game.%s', c.relname))
from pg_class c where c.oid in ('game.channels'::regclass, 'game.channel_members'::regclass, 'game.messages'::regclass)
order by c.relname;
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('channels', 'channel_members', 'messages')
     and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'channels.house_high:INSERT channels.house_low:INSERT channels.world_id:INSERT '
    || 'messages.body:INSERT messages.channel_id:INSERT messages.house_id:INSERT',
  'le service ouvre une conversation et écrit un message, sans identifiant, date, type, cité ni masquage : liste figée');
select ok(not has_table_privilege('oikos_service', t, p), format('le service n''a pas %s sur %s', p, t))
from unnest(array['game.channels', 'game.channel_members', 'game.messages']) t, unnest(array['update', 'delete', 'truncate']) p
where p <> 'truncate' or t = 'game.messages';
select ok(not exists (select 1 from pg_roles r, unnest(array['game.guard_channel()', 'game.guard_channel_member()', 'game.guard_message()',
    'game.create_city_channel()', 'game.create_direct_channel_members()']) f
  where has_function_privilege(r.oid, f, 'execute') and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')),
  'personne n''exécute les gardes ni les déclencheurs de la discussion');

-- Canal de cité : un par cité, né avec elle ; le service n'en crée pas.
select is((select count(*) from game.cities c where not exists (select 1 from game.channels ch where ch.city_id = c.id and ch.kind = 'city')),
  0::bigint, 'chaque cité a son canal');
select is((select world_id from game.channels where city_id = '01900000-0000-7000-8000-0000000070f1'),
  '01900000-0000-7000-8000-0000000070f0'::uuid, 'une cité créée a son canal, dans son monde');
select throws_ok($$select pg_temp.as_service($s$insert into game.channels (world_id, kind, city_id)
  values ('01900000-0000-7000-8000-000000000001', 'city', '01900000-0000-7000-8000-000000000101')$s$)$$,
  '42501', null, 'le service ne crée pas de canal de cité');
select throws_ok($$insert into game.channels (world_id, kind, city_id)
  values ('01900000-0000-7000-8000-000000000001', 'city', '01900000-0000-7000-8000-000000000101')$$,
  '23505', null, 'une cité n''a qu''un canal');

-- Conversations privées.
select lives_ok($$select pg_temp.as_service($s$insert into game.channels (world_id, house_low, house_high)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000070a1', '00000000-0000-7000-8000-0000000070b1')$s$)$$,
  'le service ouvre une conversation entre deux maisons');
select is(
  (select string_agg(m.house_id::text || ':' || (m.joined_at = now())::text, ' ' order by m.house_id)
   from game.channel_members m join game.channels c on c.id = m.channel_id
   where c.house_low = '00000000-0000-7000-8000-0000000070a1' and c.house_high = '00000000-0000-7000-8000-0000000070b1'),
  '00000000-0000-7000-8000-0000000070a1:true 00000000-0000-7000-8000-0000000070b1:true',
  'ses deux maisons en sont membres, inscrites par la base');
select is((select (kind, created_at = now()) from game.channels where house_low = '00000000-0000-7000-8000-0000000070a1'),
  row('direct'::text, true), 'elle est privée, ouverte maintenant');
select throws_ok($$select pg_temp.as_service($s$insert into game.channels (world_id, house_low, house_high)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000070a1', '00000000-0000-7000-8000-0000000070b1')$s$)$$,
  '23505', null, 'une paire n''a qu''une conversation');
select throws_ok($$select pg_temp.as_service($s$insert into game.channels (world_id, house_low, house_high)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000070b1', '00000000-0000-7000-8000-0000000070a1')$s$)$$,
  '23514', null, 'les deux maisons sont rangées dans l''ordre : pas de seconde conversation à l''envers');
select throws_ok($$select pg_temp.as_service($s$insert into game.channels (world_id, house_low, house_high)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000070a1', '00000000-0000-7000-8000-0000000070a1')$s$)$$,
  '23514', null, 'pas de conversation avec soi-même');
select throws_ok($$select pg_temp.as_service($s$insert into game.channels (world_id, house_low, house_high)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000070a1', '00000000-0000-7000-8000-0000000070d1')$s$)$$,
  '23503', null, 'pas de conversation avec une maison d''un autre monde');
select throws_ok($$select pg_temp.as_service($s$insert into game.channels (world_id, house_low) values
  ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000070a1')$s$)$$,
  '23514', null, 'une conversation a deux maisons');
select throws_ok($$select pg_temp.as_service($s$insert into game.channel_members (channel_id, house_id)
  select id, '00000000-0000-7000-8000-0000000070c1' from game.channels where house_low = '00000000-0000-7000-8000-0000000070a1'$s$)$$,
  '42501', null, 'le service n''inscrit aucun membre');
select throws_ok($$insert into game.channel_members (channel_id, house_id)
  select id, '00000000-0000-7000-8000-0000000070c1' from game.channels where house_low = '00000000-0000-7000-8000-0000000070a1'$$,
  '23001', 'only the two houses of a direct channel are its members', 'même le propriétaire n''ajoute pas de tiers');
select throws_ok($$update game.channels set world_id = world_id where house_low = '00000000-0000-7000-8000-0000000070a1'$$,
  '23001', 'a channel is immutable', 'un canal ne change plus');

-- Messages : qui écrit où.
select lives_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000101'), '00000000-0000-7000-8000-0000000070a1', 'Khaire, Kallistè !'),
  'une maison métèque écrit dans le canal de sa cité');
select lives_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000101'), '00000000-0000-7000-8000-0000000070b1', 'Bienvenue.'),
  'une maison citoyenne aussi');
select throws_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000101'), '00000000-0000-7000-8000-0000000070c1', 'Intrus'),
  '23514', 'a house only writes in its city channel and its own conversations', 'une maison d''une autre cité n''y écrit pas');
select throws_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000101'), '00000000-0000-7000-8000-0000000070d1', 'Intrus'),
  '23514', null, 'ni une maison d''un autre monde');
select lives_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000103'), '00000000-0000-7000-8000-0000000070c1', 'Khaire, Elaia.'),
  'Chloé écrit dans le canal d''Elaia');
select lives_ok(pg_temp.post((select id from game.channels where house_low = '00000000-0000-7000-8000-0000000070a1'), '00000000-0000-7000-8000-0000000070b1', 'Un mot en privé.'),
  'un membre écrit dans sa conversation');
select throws_ok(pg_temp.post((select id from game.channels where house_low = '00000000-0000-7000-8000-0000000070a1'), '00000000-0000-7000-8000-0000000070c1', 'Indiscret'),
  '23514', null, 'une maison étrangère à la conversation n''y écrit pas');
select is((select count(*) from game.messages where created_at = now() and hidden_at is null and visible_body = body
           and house_id::text like '00000000-0000-7000-8000-0000000070%'), 4::bigint,
  'chaque message est daté de sa transaction, visible, texte rendu');

-- Messages : forme du texte et colonnes réservées.
select throws_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000101'), '00000000-0000-7000-8000-0000000070a1', ''),
  '23514', null, 'pas de message vide');
select throws_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000101'), '00000000-0000-7000-8000-0000000070a1', E' \n\t '),
  '23514', null, 'ni de message blanc');
select lives_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000101'), '00000000-0000-7000-8000-0000000070a1', repeat('ω', 2000)),
  '2 000 caractères passent, même sur deux octets');
select throws_ok(pg_temp.post(pg_temp.city_channel('01900000-0000-7000-8000-000000000101'), '00000000-0000-7000-8000-0000000070a1', repeat('a', 2001)),
  '23514', null, 'pas au-delà du plafond technique');
select throws_ok(format($$select pg_temp.as_service($s$insert into game.messages (channel_id, house_id, body, created_at)
  values (%L, '00000000-0000-7000-8000-0000000070a1', 'Antidaté', now() - interval '1 day')$s$)$$, pg_temp.city_channel('01900000-0000-7000-8000-000000000101')),
  '42501', null, 'le service ne date pas un message');
select throws_ok(format($$select pg_temp.as_service($s$insert into game.messages (channel_id, house_id, body, hidden_at)
  values (%L, '00000000-0000-7000-8000-0000000070a1', 'Masqué', now())$s$)$$, pg_temp.city_channel('01900000-0000-7000-8000-000000000101')),
  '42501', null, 'ni ne le masque');
select throws_ok(format($$insert into game.messages (channel_id, house_id, body, created_at)
  values (%L, '00000000-0000-7000-8000-0000000070a1', 'Antidaté', now() - interval '1 day')$$, pg_temp.city_channel('01900000-0000-7000-8000-000000000101')),
  '23001', 'a message is posted now, visible', 'même le propriétaire n''antidate pas un message');

-- Après l'écriture : seul le masquage change, une fois ; aucune suppression hors de la purge.
select throws_ok($$select pg_temp.as_service($s$update game.messages set hidden_at = now() where body = 'Bienvenue.'$s$)$$,
  '42501', null, 'le service ne masque pas un message (modération, #276)');
select throws_ok($$select pg_temp.as_service($s$delete from game.messages where body = 'Bienvenue.'$s$)$$,
  '42501', null, 'ni ne le supprime');
select throws_ok($$delete from game.messages where body = 'Bienvenue.'$$,
  '23001', 'a message is only removed by the retention purge', 'même le propriétaire ne supprime pas un message hors de la purge');
select throws_ok($$truncate game.messages cascade$$, '23001', null, 'ni ne vide la table');
select throws_ok($$update game.messages set body = 'Réécrit' where body = 'Bienvenue.'$$,
  '23001', 'a message is immutable, except for its hiding', 'un message n''est pas réécrit');
select throws_ok($$update game.messages set hidden_at = now() - interval '1 hour' where body = 'Bienvenue.'$$,
  '23001', 'a message is hidden once, now', 'un masquage est daté de sa transaction');
update game.messages set hidden_at = now() where body = 'Bienvenue.';
select is((select (visible_body is null, body, hidden_at = now()) from game.messages where body = 'Bienvenue.'),
  row(true, 'Bienvenue.'::text, true), 'masqué, le message ne rend plus son texte visible ; l''original reste pour la modération');
select throws_ok($$update game.messages set hidden_at = null where body = 'Bienvenue.'$$,
  '23001', 'a message is hidden once, now', 'un masquage ne se lève pas');

select * from finish();
rollback;
