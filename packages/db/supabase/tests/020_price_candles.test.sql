begin;
select plan(31);

-- Jeu d'essai : un chandelier d'une heure du blé à Kallistè, pour quatre échanges 6×10, 8×5, 5×20, 7×1 :
-- ouverture 6, plus haut 8, plus bas 5, clôture 7, volume 36, montant 60 + 40 + 100 + 7 = 207.
create function pg_temp.candle(
  starts timestamptz, open bigint, high bigint, low bigint, close bigint, volume bigint, turnover bigint,
  period integer default 3600, good text default 'wheat',
  city uuid default '01900000-0000-7000-8000-000000000101', world uuid default '01900000-0000-7000-8000-000000000001'
) returns void language sql as $$
  insert into game.price_candles (world_id, city_id, good_id, period_seconds, period_start, open, high, low, close, volume, turnover)
  values (world, city, good, period, starts, open, high, low, close, volume, turnover)
$$;
create function pg_temp.breaks(rule text) returns text language sql as
  $$select format('new row for relation "price_candles" violates check constraint "%s"', rule)$$;
select lives_ok($$select pg_temp.candle('2026-11-14 10:00+00', 6, 8, 5, 7, 36, 207)$$, 'un chandelier cohérent est accepté');

-- Clé : une ligne par cité, bien, durée et période.
select throws_ok($$select pg_temp.candle('2026-11-14 10:00+00', 6, 6, 6, 6, 1, 6)$$, '23505', null, 'un seul chandelier par période');
select lives_ok($$select pg_temp.candle('2026-11-14 11:00+00', 7, 7, 7, 7, 1, 7)$$, 'la période suivante a le sien');
select lives_ok($$select pg_temp.candle('2026-11-14 10:00+00', 9, 9, 9, 9, 2, 18, good => 'olives')$$, 'un autre bien a le sien');
select lives_ok($$select pg_temp.candle('2026-11-14 00:00+00', 6, 8, 5, 7, 37, 214, period => 86400)$$,
  'une autre durée ouvre une autre série, sans toucher à la première');

-- Période : alignée sur un multiple de la durée depuis l'époque Unix.
select throws_ok($$select pg_temp.candle('2026-11-14 10:00:01+00', 6, 6, 6, 6, 1, 6)$$, '23514', pg_temp.breaks('price_candles_period_aligned'),
  'une période décalée d''une seconde est refusée');
select throws_ok($$select pg_temp.candle('2026-11-14 10:00+00', 6, 6, 6, 6, 1, 6, period => 86400)$$, '23514', pg_temp.breaks('price_candles_period_aligned'),
  'dix heures n''est pas un début de journée');
select lives_ok($$select pg_temp.candle('2026-11-14 02:00+02', 6, 6, 6, 6, 1, 6, period => 86400, good => 'fish')$$,
  'une journée commence à minuit en temps universel, quel que soit le fuseau de l''écriture');
select throws_ok($$select pg_temp.candle('2026-11-14 10:00+00', 6, 6, 6, 6, 1, 6, period => 0, good => 'salt')$$, '23514', null,
  'durée nulle refusée');

-- Prix : plus bas ≤ ouverture, clôture ≤ plus haut, et strictement positifs.
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 4, 8, 5, 7, 36, 207)$$, '23514', pg_temp.breaks('price_candles_prices_ordered'), 'ouverture sous le plus bas refusée');
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 9, 8, 5, 7, 36, 207)$$, '23514', pg_temp.breaks('price_candles_prices_ordered'), 'ouverture au-dessus du plus haut refusée');
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 6, 8, 5, 4, 36, 207)$$, '23514', pg_temp.breaks('price_candles_prices_ordered'), 'clôture sous le plus bas refusée');
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 6, 8, 5, 9, 36, 324)$$, '23514', pg_temp.breaks('price_candles_prices_ordered'), 'clôture au-dessus du plus haut refusée');
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 0, 8, 0, 7, 36, 207)$$, '23514', pg_temp.breaks('price_candles_prices_ordered'), 'prix nul refusé');

-- Volume et montant : au moins une unité, chacune échangée entre le plus bas (5 × 36 = 180) et le plus haut (8 × 36 = 288).
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 6, 6, 6, 6, 0, 0)$$, '23514', null, 'pas de chandelier sans échange');
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 6, 8, 5, 7, 36, 179)$$, '23514', pg_temp.breaks('price_candles_turnover_bounds'), 'montant sous le plus bas × volume refusé');
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 6, 8, 5, 7, 36, 289)$$, '23514', pg_temp.breaks('price_candles_turnover_bounds'), 'montant au-dessus du plus haut × volume refusé');
select lives_ok($$select pg_temp.candle('2026-11-14 12:00+00', 6, 8, 5, 7, 36, 180)$$, 'la borne basse est permise');
select throws_ok($$update game.price_candles set close = 9 where period_start = '2026-11-14 11:00+00'$$, '23514', pg_temp.breaks('price_candles_prices_ordered'),
  'un recalcul incohérent est refusé comme une insertion');

-- Rattachement : bien bien formé, cité du même monde.
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 6, 6, 6, 6, 1, 6, good => 'Wheat')$$, '23514', null, 'identifiant de bien mal formé refusé');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
select throws_ok($$select pg_temp.candle('2026-11-14 12:00+00', 6, 6, 6, 6, 1, 6, good => 'wool', world => '01900000-0000-7000-8000-000000000002')$$,
  '23503', null, 'la cité doit être du même monde');

-- Le service remplit et recalcule les valeurs ; il ne déplace ni ne supprime un chandelier.
select is(
  (select string_agg(privilege_type, ' ' order by privilege_type) from information_schema.role_table_grants
   where table_schema = 'game' and table_name = 'price_candles' and grantee = 'oikos_service'),
  'INSERT SELECT', 'le service lit et insère ; ni modification de ligne entière, ni suppression');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'price_candles' and grantee = 'oikos_service' and privilege_type = 'UPDATE'),
  'close high low open turnover volume', 'il ne recalcule que les valeurs, jamais la clé');

-- Clients : lecture seule par la vue, sans le monde ; rien pour un visiteur anonyme.
select ok((select relrowsecurity from pg_class where oid = 'game.price_candles'::regclass), 'règles par ligne actives');
select is(
  (select string_agg(policyname || ':' || cmd || ':' || roles::text, ' ' order by policyname) from pg_policies
   where schemaname = 'game' and tablename = 'price_candles'),
  'price_candles_read:SELECT:{authenticated} service_all:ALL:{oikos_service}', 'règles par ligne : liste figée');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type) from information_schema.role_table_grants
   where ((table_schema = 'public') or (table_schema = 'game')) and table_name = 'price_candles' and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'la vue en lecture seule pour un joueur ; aucun droit de table, rien pour un visiteur');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'price_candles'),
  array['city_id', 'good_id', 'period_seconds', 'period_start', 'open', 'high', 'low', 'close', 'volume', 'turnover'],
  'colonnes de la vue : liste figée, sans identité de maison ni d''ordre');

set local role anon;
select throws_ok('select * from public.price_candles', '42501', null, 'un visiteur anonyme ne lit pas l''historique');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$select good_id, period_seconds, period_start, open, high, low, close, volume, turnover from public.price_candles
    where city_id = '01900000-0000-7000-8000-000000000101' and good_id in ('wheat', 'olives') order by good_id, period_seconds, period_start$$,
  $$values ('olives', 3600, '2026-11-14 10:00+00'::timestamptz, 9::bigint, 9::bigint, 9::bigint, 9::bigint, 2::bigint, 18::bigint),
           ('wheat', 3600, '2026-11-14 10:00+00', 6, 8, 5, 7, 36, 207),
           ('wheat', 3600, '2026-11-14 11:00+00', 7, 7, 7, 7, 1, 7),
           ('wheat', 3600, '2026-11-14 12:00+00', 6, 8, 5, 7, 36, 180),
           ('wheat', 86400, '2026-11-14 00:00+00', 6, 8, 5, 7, 37, 214)$$,
  'un joueur sans maison lit tout l''historique public, tel qu''il a été écrit');
select throws_ok($$insert into public.price_candles (city_id, good_id, period_seconds, period_start, open, high, low, close, volume, turnover)
  values ('01900000-0000-7000-8000-000000000101', 'salt', 3600, '2026-11-14 10:00+00', 1, 1, 1, 1, 1, 1)$$, '42501', null,
  'un joueur n''écrit pas dans l''historique');
select throws_ok($$update game.price_candles set close = 8$$, '42501', null, 'ni ne le modifie par la table');
reset role;

select * from finish();
rollback;
