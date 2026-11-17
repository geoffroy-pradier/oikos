begin;
select plan(26);

-- Jeu d'essai : Alice et Bob, de Kallistè ; Chloé, d'Elaia ; Dion et Eudore, modérateurs sans maison. Alice a
-- signalé un message de Bob, Bob un message d'Alice. Sanctions : Alice, un silence en cours, qu'elle a contesté,
-- et un avertissement fini ; Bob, une suspension et une exclusion pas encore validée ; Chloé, une exclusion
-- validée. Une version de configuration en vigueur porte deux motifs et un terme interdit.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000211aa', 'lire-moder-alice@example.test'),
  ('00000000-0000-4000-8000-0000000211ab', 'lire-moder-bob@example.test'),
  ('00000000-0000-4000-8000-0000000211ac', 'lire-moder-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000211ad', 'lire-moder-dion@example.test'),
  ('00000000-0000-4000-8000-0000000211ae', 'lire-moder-eudore@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000211a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000211aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000211b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000211ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000211c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000211ac', 'Bacchiades', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000211a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000211b1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000211c1', '01900000-0000-7000-8000-000000000103');
insert into game.messages (id, channel_id, house_id, body)
select m.id::uuid, c.id, m.house_id::uuid, 'Propos'
from (values ('00000000-0000-7000-8000-0000000211f1', '00000000-0000-7000-8000-0000000211b1'),
             ('00000000-0000-7000-8000-0000000211f2', '00000000-0000-7000-8000-0000000211a1')) m (id, house_id)
join game.channels c on c.city_id = '01900000-0000-7000-8000-000000000101';
insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000211f1', '00000000-0000-7000-8000-0000000211b1', '00000000-0000-7000-8000-0000000211a1', 'spam'),
  ('00000000-0000-7000-8000-0000000211f2', '00000000-0000-7000-8000-0000000211a1', '00000000-0000-7000-8000-0000000211b1', 'hate');
insert into admin.sanctions (id, user_id, kind, starts_at, ends_at, reason, author_id, validated_by) values
  ('00000000-0000-7000-8000-000000021151', '00000000-0000-4000-8000-0000000211aa', 'silence', now() - interval '1 hour', now() + interval '1 day', 'Insultes', '00000000-0000-4000-8000-0000000211ad', null),
  ('00000000-0000-7000-8000-000000021152', '00000000-0000-4000-8000-0000000211aa', 'warning', now() - interval '3 days', now() - interval '2 days', 'Ton', '00000000-0000-4000-8000-0000000211ad', null),
  ('00000000-0000-7000-8000-000000021153', '00000000-0000-4000-8000-0000000211ab', 'suspension', now(), now() + interval '7 days', 'Triche', '00000000-0000-4000-8000-0000000211ad', null),
  ('00000000-0000-7000-8000-000000021154', '00000000-0000-4000-8000-0000000211ab', 'ban', now(), null, 'Récidive', '00000000-0000-4000-8000-0000000211ad', null),
  ('00000000-0000-7000-8000-000000021155', '00000000-0000-4000-8000-0000000211ac', 'ban', now(), null, 'Haine', '00000000-0000-4000-8000-0000000211ad', '00000000-0000-4000-8000-0000000211ae');
update admin.sanctions set appeal_body = 'Je conteste.' where id = '00000000-0000-7000-8000-000000021151';
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000002c1f1',
  '{"moderation": {"reportReasons": ["spam", "other"], "bannedTerms": ["maudit"], "maxAppealLength": 600}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000002c1f1', now());

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where (schemaname, tablename) in (('game', 'reports'), ('admin', 'sanctions'))),
  'reports:reports_read_own:SELECT:authenticated reports:service_all:ALL:oikos_service sanctions:service_all:ALL:oikos_service',
  'les joueurs lisent leurs signalements ; des sanctions, aucune règle pour eux');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('my_reports', 'my_sanctions', 'moderation_rules')
     and grantee in ('anon', 'authenticated', 'oikos_service')),
  'moderation_rules:authenticated:SELECT my_reports:authenticated:SELECT my_sanctions:authenticated:SELECT',
  'vues en lecture seule, rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname || ':' || f, ' ' order by r.rolname, f) from pg_roles r,
     unnest(array['game.my_sanctions()', 'game.moderation_rules()']) f
   where has_function_privilege(r.oid, f, 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated:game.moderation_rules() authenticated:game.my_sanctions()',
  'seuls les joueurs connectés exécutent les lectures de la modération');
select ok(not has_column_privilege('authenticated', 'game.reports', 'reported_house_id', 'select'),
  'la maison signalée n''est lisible par aucun joueur');
select ok(not has_schema_privilege('authenticated', 'admin', 'usage') and not has_schema_privilege('anon', 'admin', 'usage'),
  'le schéma admin reste fermé aux joueurs');

-- Visiteur anonyme.
set local role anon;
select throws_ok('select * from public.my_sanctions', '42501', null, 'anon ne lit pas de sanction');
select throws_ok('select * from public.my_reports', '42501', null, 'anon ne lit pas de signalement');
select throws_ok('select * from public.moderation_rules', '42501', null, 'anon ne lit pas les motifs');
reset role;

-- Alice.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000211aa", "role": "authenticated"}';
select results_eq(
  $$select kind, reason, ends_at > now(), appeal_body, appealed_at is not null from public.my_sanctions order by starts_at$$,
  $$values ('warning'::text, 'Ton'::text, false, null::text, false), ('silence', 'Insultes', true, 'Je conteste.', true)$$,
  'un compte lit ses sanctions, finies comprises, avec son appel, et celles-là seules');
select results_eq(
  $$select message_id, house_id, reason, state from public.my_reports$$,
  $$values ('00000000-0000-7000-8000-0000000211f1'::uuid, '00000000-0000-7000-8000-0000000211a1'::uuid, 'spam'::text, 'open'::text)$$,
  'une maison lit ses signalements, pas ceux qui la visent');
select is((select count(*) from game.my_sanctions()), 2::bigint, 'la fonction ne rend que les sanctions du compte connecté');
select throws_ok('select * from admin.sanctions', '42501', null, 'les sanctions ne se lisent pas en direct');
select throws_ok('select reported_house_id from game.reports', '42501', null, 'ni la maison signalée');
select throws_ok($$insert into game.reports (message_id, reported_house_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000211f1', '00000000-0000-7000-8000-0000000211b1', '00000000-0000-7000-8000-0000000211c1', 'spam')$$,
  '42501', null, 'pas de signalement écrit en direct');
select throws_ok($$insert into public.my_reports (message_id, house_id, reason) values
  ('00000000-0000-7000-8000-0000000211f1', '00000000-0000-7000-8000-0000000211c1', 'spam')$$,
  '42501', null, 'ni par la vue');
select throws_ok($$update game.reports set state = 'dismissed'$$, '42501', null, 'pas de signalement modifié');
select throws_ok($$delete from game.reports$$, '42501', null, 'ni supprimé');
select throws_ok($$update public.my_sanctions set appeal_body = 'Grâce'$$, '55000', null, 'pas d''appel écrit par la vue');
select results_eq($$select * from public.moderation_rules$$, $$values ('["spam", "other"]'::jsonb)$$,
  'les motifs de la configuration en vigueur se lisent, jamais les termes interdits');

-- Bob : sa suspension, pas l'exclusion encore à valider.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000211ab", "role": "authenticated"}';
select results_eq($$select kind, reason from public.my_sanctions$$, $$values ('suspension'::text, 'Triche'::text)$$,
  'une exclusion pas encore validée n''est pas annoncée');
select results_eq($$select message_id, reason from public.my_reports$$,
  $$values ('00000000-0000-7000-8000-0000000211f2'::uuid, 'hate'::text)$$, 'Bob lit son seul signalement');

-- Chloé : son exclusion validée, sans fin.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000211ac", "role": "authenticated"}';
select results_eq($$select kind, ends_at from public.my_sanctions$$, $$values ('ban'::text, null::timestamptz)$$,
  'une exclusion validée est annoncée, sans fin');
select is((select count(*) from public.my_reports), 0::bigint, 'Chloé n''a rien signalé');

-- Dion, auteur de toutes ces sanctions, et Eudore, qui en a validé une, n'en lisent aucune.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000211ad", "role": "authenticated"}';
select is((select count(*) from public.my_sanctions), 0::bigint, 'l''auteur d''une sanction ne la lit pas par cette vue');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000211ae", "role": "authenticated"}';
select is((select count(*) from public.my_sanctions), 0::bigint, 'ni celui qui l''a validée');
reset role;

-- Une version publiée avant la modération : nul, le client applique les valeurs par défaut.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000002c1f2', '{}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000002c1f2', now());
set local role authenticated;
select is((select report_reasons from public.moderation_rules), null, 'section absente : nul, jamais une valeur inventée en base');
reset role;

select * from finish();
rollback;
