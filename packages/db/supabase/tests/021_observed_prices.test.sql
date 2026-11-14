begin;
select plan(17);

-- Jeu d'essai : le blé à Kallistè, 8 oboles observées sur 20 unités en 24 heures.
create function pg_temp.observe(good text, price bigint, volume bigint, period integer default 86400,
  city uuid default '01900000-0000-7000-8000-000000000101', world uuid default '01900000-0000-7000-8000-000000000001'
) returns void language sql as $$
  insert into game.observed_prices (world_id, city_id, good_id, price, volume, window_seconds, observed_at)
  values (world, city, good, price, volume, period, '2026-11-11 12:00+00')
$$;
select lives_ok($$select pg_temp.observe('wheat', 8, 20)$$, 'un prix observé est accepté');
select throws_ok($$select pg_temp.observe('wheat', 9, 1)$$, '23505', null, 'un seul prix observé par cité et par bien');
select lives_ok($$select pg_temp.observe('olives', 9, 2)$$, 'un autre bien a le sien');
select throws_ok($$select pg_temp.observe('fish', 0, 2)$$, '23514', null, 'prix nul refusé');
select throws_ok($$select pg_temp.observe('fish', 5, 0)$$, '23514', null, 'pas de prix observé sans échange');
select throws_ok($$select pg_temp.observe('fish', 5, 2, period => 0)$$, '23514', null, 'fenêtre nulle refusée');
select throws_ok($$select pg_temp.observe('Fish', 5, 2)$$, '23514', null, 'identifiant de bien mal formé refusé');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
select throws_ok($$select pg_temp.observe('fish', 5, 2, world => '01900000-0000-7000-8000-000000000002')$$, '23503', null,
  'la cité doit être du même monde');

-- Le service remplace les valeurs d'un marché ; il ne le déplace ni ne le supprime.
select is(
  (select string_agg(privilege_type, ' ' order by privilege_type) from information_schema.role_table_grants
   where table_schema = 'game' and table_name = 'observed_prices' and grantee = 'oikos_service'),
  'INSERT SELECT', 'le service lit et insère ; ni modification de ligne entière, ni suppression');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'observed_prices' and grantee = 'oikos_service' and privilege_type = 'UPDATE'),
  'observed_at price volume window_seconds', 'il ne remplace que les valeurs, jamais la clé');

-- Clients : lecture seule par la vue, sans le monde ; rien pour un visiteur anonyme.
select ok((select relrowsecurity from pg_class where oid = 'game.observed_prices'::regclass), 'règles par ligne actives');
select is(
  (select string_agg(policyname || ':' || cmd || ':' || roles::text, ' ' order by policyname) from pg_policies
   where schemaname = 'game' and tablename = 'observed_prices'),
  'observed_prices_read:SELECT:{authenticated} service_all:ALL:{oikos_service}', 'règles par ligne : liste figée');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type) from information_schema.role_table_grants
   where table_schema in ('public', 'game') and table_name = 'observed_prices' and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'la vue en lecture seule pour un joueur ; aucun droit de table, rien pour un visiteur');

set local role anon;
select throws_ok('select * from public.observed_prices', '42501', null, 'un visiteur anonyme ne lit pas les prix observés');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$select * from public.observed_prices order by good_id$$,
  $$values ('01900000-0000-7000-8000-000000000101'::uuid, 'olives', 9::bigint, 2::bigint, 86400, '2026-11-11 12:00+00'::timestamptz),
           ('01900000-0000-7000-8000-000000000101', 'wheat', 8, 20, 86400, '2026-11-11 12:00+00')$$,
  'un joueur sans maison lit les prix observés, colonnes figées, sans identité');
select throws_ok($$update public.observed_prices set price = 1$$, '42501', null, 'un joueur ne modifie pas un prix observé par la vue');
select throws_ok($$update game.observed_prices set price = 1$$, '42501', null, 'ni par la table');
reset role;

select * from finish();
rollback;
