begin;
select plan(17);

-- Jeu d'essai : un monde à lui, Alice et Bob ; une version en vigueur qui porte une grâce. Les invocations sont
-- posées par le propriétaire, garde levée : celle d'Alice en attente, une autre consommée et encore en recharge,
-- une troisième consommée et rechargée ; une de Bob en attente.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c171',
  '{"gods": [{"id": "demeter"}],
    "graces": [{"id": "demeter_harvest", "godId": "demeter", "effect": "blessed_harvest", "magnitudeBps": 2000,
                "charisRequired": 300, "charisSpent": 150, "cooldownDays": 3}]}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c171', now());
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000171f0', 'graces-lues', 'Grâces lues');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000171f1', '01900000-0000-7000-8000-0000000171f0', 'kalliste', 'Kallistè');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000171aa', 'graces-lues-alice@example.test'),
  ('00000000-0000-4000-8000-0000000171ab', 'graces-lues-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000171a1', '01900000-0000-7000-8000-0000000171f0', '00000000-0000-4000-8000-0000000171aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000171b1', '01900000-0000-7000-8000-0000000171f0', '00000000-0000-4000-8000-0000000171ab', 'Philaïdes', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000171a1', '01900000-0000-7000-8000-0000000171f1'),
  ('00000000-0000-7000-8000-0000000171b1', '01900000-0000-7000-8000-0000000171f1');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000171a5', '01900000-0000-7000-8000-0000000171f0', '00000000-0000-7000-8000-0000000171a1', '01900000-0000-7000-8000-0000000171f1', 'grow_wheat');
set constraints all immediate;
set constraints all deferred;
alter table game.graces_used disable trigger graces_used_guard;
insert into game.graces_used (id, world_id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, invoked_at,
  ready_at, consumed_at, site_id)
select id::uuid, '01900000-0000-7000-8000-0000000171f0', ('00000000-0000-7000-8000-0000000171' || house || '1')::uuid,
  grace, 'demeter', 'blessed_harvest', 2000, 0, now() - invoked, now() + ready,
  case when consumed then now() - invoked end, case when consumed then '00000000-0000-7000-8000-0000000171a5'::uuid end
from (values
  ('00000000-0000-7000-8000-0000000171c1', 'a', 'pending', interval '1 hour', interval '2 days', false),
  ('00000000-0000-7000-8000-0000000171c2', 'a', 'recharging', interval '1 hour', interval '2 days', true),
  ('00000000-0000-7000-8000-0000000171c3', 'a', 'recharged', interval '5 days', interval '-2 days', true),
  ('00000000-0000-7000-8000-0000000171c4', 'b', 'pending', interval '1 hour', interval '2 days', false)
) g (id, house, grace, invoked, ready, consumed);
set constraints all immediate;
set constraints all deferred;
alter table game.graces_used enable trigger graces_used_guard;

-- Droits : lecture seule pour les joueurs connectés, rien pour un visiteur anonyme.
select is(
  (select string_agg(table_name || ':' || privilege_type, ' ' order by table_name, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('temple_rules', 'my_graces') and grantee in ('anon', 'authenticated')),
  'my_graces:SELECT temple_rules:SELECT', 'lecture seule des deux vues, et rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.temple_graces()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction');
select is(
  (select string_agg(table_name || '.' || column_name, ' ' order by table_name, column_name) from information_schema.columns
   where table_schema = 'public' and table_name in ('temple_rules', 'my_graces')),
  'my_graces.charis_spent my_graces.consumed_at my_graces.effect my_graces.god_id my_graces.grace_id my_graces.house_id '
    || 'my_graces.id my_graces.invoked_at my_graces.magnitude_bps my_graces.ready_at temple_rules.gods temple_rules.graces',
  'colonnes des vues : liste figée');
select ok(not has_column_privilege('authenticated', 'game.graces_used', 'site_id', 'select')
  and not has_column_privilege('authenticated', 'game.graces_used', 'voyage_id', 'select')
  and not has_any_column_privilege('authenticated', 'game.graces_used', 'insert, update'),
  'ni l''action qui l''a consommée, ni écriture');

set local role anon;
select throws_ok('select * from public.my_graces', '42501', null, 'un visiteur anonyme ne lit pas de grâces');
select throws_ok('select * from public.temple_rules', '42501', null, 'ni les règles des temples');

-- Alice : les grâces de la version en vigueur ; les siennes, en attente ou en recharge.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000171aa", "role": "authenticated"}';
select is((select graces -> 0 ->> 'id' from public.temple_rules), 'demeter_harvest', 'les grâces de la version en vigueur');
select is((select graces -> 0 ->> 'charisSpent' from public.temple_rules), '150', 'avec leur Charis requise et dépensée');
select is((select gods -> 0 ->> 'id' from public.temple_rules), 'demeter', 'les dieux restent dans leur colonne');
select results_eq('select grace_id, consumed_at is null, ready_at > now() from public.my_graces order by grace_id',
  $$values ('pending', true, true), ('recharging', false, true)$$,
  'ses grâces en attente, et en recharge jusqu''à `ready_at` ; pas une grâce rechargée');
select is((select count(*) from game.graces_used), 3::bigint, 'pas celles de Bob, même par la table');
select throws_ok('select site_id from game.graces_used', '42501', null, 'ni l''action qui a consommé la sienne');
select throws_ok($$update game.graces_used set consumed_at = now()$$, '42501', null, 'un joueur ne consomme pas de grâce');
select throws_ok($$insert into game.graces_used (world_id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, ready_at)
  values ('01900000-0000-7000-8000-0000000171f0', '00000000-0000-7000-8000-0000000171a1', 'free', 'demeter', 'blessed_harvest',
  1, 0, now() + interval '1 day')$$, '42501', null, 'ni n''en invoque hors de l''API');

-- Bob : la sienne seulement ; un compte sans maison : rien.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000171ab", "role": "authenticated"}';
select results_eq('select house_id, grace_id from public.my_graces',
  $$values ('00000000-0000-7000-8000-0000000171b1'::uuid, 'pending')$$, 'Bob ne lit que sa grâce');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000171ff", "role": "authenticated"}';
select is((select count(*) from public.my_graces), 0::bigint, 'un compte sans maison ne lit aucune grâce');
reset role;

-- Une version publiée avant les grâces : une liste vide, la colonne reste.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c172', '{"gods": []}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c172', now());
set local role authenticated;
select is((select graces from public.temple_rules), '[]'::jsonb, 'une version sans grâce rend une liste vide');

select * from finish();
rollback;
