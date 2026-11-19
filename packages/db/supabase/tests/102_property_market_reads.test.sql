begin;
select plan(23);

-- Jeu d'essai, dans le monde de la graine : Alice offre une maison de ville à la vente (f1), loue la
-- seconde à Bob (f2) et lui a vendu un immeuble (f3) ; Chloé offre la sienne à la location (f4) ; f5 est à
-- la cité. Biens, offres et bail posés par le propriétaire de la base, gardes levées ; le grand livre porte
-- les dotations, la vente (taxe de 102 : 51 détruites, 51 au trésor de Kallistè) et un loyer.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c102', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c102', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000102aa', 'market-alice@example.test'),
  ('00000000-0000-4000-8000-0000000102ab', 'market-bob@example.test'),
  ('00000000-0000-4000-8000-0000000102ac', 'market-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon)
  select ('00000000-0000-7000-8000-0000000102' || h || '1')::uuid, '01900000-0000-7000-8000-000000000001',
         ('00000000-0000-4000-8000-0000000102a' || u)::uuid, n, '{}'
  from (values ('a', 'a', 'Alcméonides'), ('b', 'b', 'Philaïdes'), ('c', 'c', 'Pisistratides')) v (h, u, n);
insert into game.accounts (world_id, kind, house_id)
  select world_id, 'house', id from game.houses where id::text like '00000000-0000-7000-8000-0000000102_1';
insert into game.properties (id, world_id, city_id, size_id, lot)
  select ('00000000-0000-7000-8000-0000000102f' || n)::uuid, '01900000-0000-7000-8000-000000000001',
         case when n = 2 then '01900000-0000-7000-8000-000000000103'::uuid else '01900000-0000-7000-8000-000000000101'::uuid end,
         case when n = 3 then 'tenement' else 'townhouse' end, 9300 + n
  from generate_series(1, 5) n;
create function pg_temp.h(name text) returns uuid language sql as $$ select ('00000000-0000-7000-8000-0000000102' || name || '1')::uuid $$;
create function pg_temp.f(n integer) returns uuid language sql as $$ select ('00000000-0000-7000-8000-0000000102f' || n)::uuid $$;
create function pg_temp.acc(key text) returns uuid language sql as $$
  select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001'
    and (system_key = key or house_id::text = key or (kind = 'treasury' and not npc_purse and city_id::text = key)) $$;
create function pg_temp.post(kind text, accounts uuid[], amounts bigint[], meta jsonb default '{}') returns uuid language sql as $$
  with entry as (insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', kind, meta) returning id),
  lines as (insert into game.ledger_lines (entry_id, account_id, amount) select entry.id, u.account, u.amount from entry, unnest(accounts, amounts) u (account, amount))
  select id from entry $$;
select pg_temp.post('house.starting_grant', array[pg_temp.acc('faucet_starting_grant'), pg_temp.acc(pg_temp.h('a')::text), pg_temp.acc(pg_temp.h('b')::text)], array[-10000, 5000, 5000]);
create temporary table sale on commit drop as select pg_temp.post('property.sale',
  array[pg_temp.acc(pg_temp.h('b')::text), pg_temp.acc(pg_temp.h('a')::text), pg_temp.acc('sink_market_tax'), pg_temp.acc('01900000-0000-7000-8000-000000000101')],
  array[-2021, 1919, 51, 51], jsonb_build_object('propertyId', pg_temp.f(3), 'listingId', gen_random_uuid())) as entry_id;
set constraints all immediate;
alter table game.properties disable trigger properties_guard;
alter table game.property_listings disable trigger property_listings_guard;
alter table game.leases disable trigger leases_guard;
update game.properties set owner_house_id = case when id = pg_temp.f(3) then pg_temp.h('b') when id = pg_temp.f(4) then pg_temp.h('c') else pg_temp.h('a') end,
  acquired_at = now() where id in (pg_temp.f(1), pg_temp.f(2), pg_temp.f(3), pg_temp.f(4));
insert into game.property_listings (id, world_id, property_id, house_id, kind, price_oboles, closed_at, outcome, ledger_entry_id)
  select ('00000000-0000-7000-8000-0000000102e' || n)::uuid, '01900000-0000-7000-8000-000000000001', pg_temp.f(n), pg_temp.h(h), k, p, c, o, e
  from (values (1, 'a', 'sale', 5000, null::timestamptz, null, null::uuid), (2, 'a', 'lease', 40, now(), 'leased', null),
               (3, 'a', 'sale', 2021, now(), 'sold', (select entry_id from sale)), (4, 'c', 'lease', 30, null, null, null)) v (n, h, k, p, c, o, e);
insert into game.leases (id, world_id, property_id, listing_id, landlord_house_id, tenant_house_id, rent_oboles)
  values ('00000000-0000-7000-8000-0000000102d1', '01900000-0000-7000-8000-000000000001', pg_temp.f(2),
          '00000000-0000-7000-8000-0000000102e2', pg_temp.h('a'), pg_temp.h('b'), 40);
alter table game.properties enable trigger properties_guard;
alter table game.property_listings enable trigger property_listings_guard;
alter table game.leases enable trigger leases_guard;
select pg_temp.post('lease.rent', array[pg_temp.acc(pg_temp.h('b')::text), pg_temp.acc(pg_temp.h('a')::text)], array[-40, 40],
  '{"leaseId": "00000000-0000-7000-8000-0000000102d1", "gameDay": 20000}');

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('property_listings', 'leases')),
  'leases.leases_read_party:SELECT:authenticated leases.service_all:ALL:oikos_service '
    || 'property_listings.property_listings_read_own:SELECT:authenticated property_listings.service_all:ALL:oikos_service',
  'une règle de lecture par table pour les joueurs, aucune d''écriture');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('property_offers', 'my_leases') and grantee in ('anon', 'authenticated')),
  'my_leases:authenticated:SELECT property_offers:authenticated:SELECT', 'vues en lecture seule, rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname, ' ') from pg_roles r where has_function_privilege(r.oid, 'game.property_offers()', 'execute')
     and not r.rolsuper and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés lisent les offres');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'property_offers'),
  array['property_id', 'city_id', 'size_id', 'lot', 'condition', 'kind', 'price_oboles', 'listed_at'],
  'les offres ne nomment pas la maison qui offre');

-- Visiteur anonyme : rien.
set local role anon;
select throws_ok('select * from public.property_offers', '42501', null, 'anon ne lit pas les offres');
select throws_ok('select * from public.my_leases', '42501', null, 'ni les baux');

-- Chloé : les offres ouvertes de toutes les cités, la sienne comprise, sans propriétaire ; aucun bail.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000102ac", "role": "authenticated"}';
select results_eq($$select property_id, kind, price_oboles, condition from public.property_offers
    where property_id::text like '00000000-0000-7000-8000-0000000102f%' order by lot$$,
  $$values ('00000000-0000-7000-8000-0000000102f1'::uuid, 'sale', 5000::bigint, 10000), ('00000000-0000-7000-8000-0000000102f4'::uuid, 'lease', 30::bigint, 10000)$$,
  'les offres ouvertes : ni le bien loué, ni le bien vendu');
select is((select count(*) from public.my_leases), 0::bigint, 'Chloé n''est partie à aucun bail');
select is((select count(*) from game.property_listings where house_id <> '00000000-0000-7000-8000-0000000102c1'), 0::bigint, 'ni ne lit les offres des autres dans game');
select is((select count(*) from game.leases), 0::bigint, 'ni leurs baux');
select is((select count(*) from public.my_cash_flows), 0::bigint, 'ni leurs comptes');
select throws_ok($$insert into game.property_listings (world_id, property_id, house_id, kind, price_oboles)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000102f4', '00000000-0000-7000-8000-0000000102c1', 'sale', 1)$$,
  '42501', null, 'un joueur n''offre rien directement');
select throws_ok('update game.leases set end_requested_by = ''tenant''', '42501', null, 'ni ne touche à un bail');
select throws_ok('delete from public.my_leases', '55000', null, 'ni par la vue, qui ne s''écrit pas');

-- Bob, locataire et acheteur : son bail ; le prix de l'immeuble en acquisition, le loyer en charge.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000102ab", "role": "authenticated"}';
select results_eq('select id, city_id, size_id, landlord_house_id, tenant_house_id, rent_oboles from public.my_leases',
  $$values ('00000000-0000-7000-8000-0000000102d1'::uuid, '01900000-0000-7000-8000-000000000103'::uuid, 'townhouse',
            '00000000-0000-7000-8000-0000000102a1'::uuid, '00000000-0000-7000-8000-0000000102b1'::uuid, 40::bigint)$$,
  'Bob lit son bail, avec la cité et la taille du bien');
select is((select count(*) from game.property_listings), 0::bigint, 'pas l''offre qu''il a achetée : elle est à Alice');
select results_eq('select nature, amount from public.my_cash_flows order by nature',
  $$values ('acquisitions', -2021::bigint), ('grant', 5000::bigint), ('rents', -40::bigint)$$,
  'l''achat d''un bien revendu est une acquisition, le loyer payé un loyer négatif');
select results_eq('select sales, taxes, upkeep, operating_result, acquisitions, non_operating, cash_change from public.my_income_statement',
  $$values (0::bigint, 0::bigint, -40::bigint, -40::bigint, -2021::bigint, 2979::bigint, 2939::bigint)$$,
  'le loyer payé est une charge courante, l''achat hors exploitation');

-- Alice, propriétaire et vendeuse : la vente au brut, sa taxe, le loyer reçu en produit.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000102aa", "role": "authenticated"}';
select results_eq('select id, tenant_house_id from public.my_leases', $$values ('00000000-0000-7000-8000-0000000102d1'::uuid, '00000000-0000-7000-8000-0000000102b1'::uuid)$$,
  'Alice lit le bail de son bien');
select results_eq('select nature, amount from public.my_cash_flows order by nature',
  $$values ('acquisitions', 2021::bigint), ('grant', 5000::bigint), ('rents', 40::bigint), ('taxes', -102::bigint)$$,
  'la revente au brut en acquisition (cession), la taxe à part, le loyer reçu positif');
select results_eq('select sales, taxes, upkeep, operating_result, acquisitions, grants, other, cash_change from public.my_income_statement',
  $$values (40::bigint, -102::bigint, 0::bigint, -62::bigint, 2021::bigint, 5000::bigint, 0::bigint, 6959::bigint)$$,
  'le loyer reçu est un produit d''exploitation, la taxe une charge, la cession hors exploitation ; rien dans « autre »');
select results_eq('select sales, upkeep, cash_change from public.my_income_statement_by_season',
  $$values (40::bigint, 0::bigint, 6959::bigint)$$, 'la vue par saison suit');
reset role;
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'my_income_statement'),
  array['house_id', 'game_day', 'season', 'sales', 'purchases', 'taxes', 'upkeep', 'operating_result', 'acquisitions',
        'grants', 'other', 'non_operating', 'cash_change', 'escrow_change'], 'colonnes du compte de résultat inchangées (ADR 0006)');

select * from finish();
rollback;
