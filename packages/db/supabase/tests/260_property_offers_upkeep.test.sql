begin;
select plan(19);

-- Jeu d'essai, dans le monde de la graine, à l'horloge Europe/Paris clôturant à 4 h : Alice offre à la vente
-- un bien impayé depuis 03:59:59 heure d'été (f1, encore le jour de jeu du 28 mars 2026) et à la location un
-- bien impayé depuis 04:00:00 (f2, le 29 mars) ; elle a retiré l'offre d'un troisième bien impayé (f5).
-- Chloé offre un bien payé (f3) et garde, sans l'offrir, un bien impayé (f4) ; f6 est à la cité.
-- Biens et offres posés par le propriétaire de la base, gardes levées, à des instants fixés.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c260', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c260', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000260aa', 'upkeep-alice@example.test'),
  ('00000000-0000-4000-8000-0000000260ab', 'upkeep-bob@example.test'),
  ('00000000-0000-4000-8000-0000000260ac', 'upkeep-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon)
  select ('00000000-0000-7000-8000-0000000260' || h || '1')::uuid, '01900000-0000-7000-8000-000000000001',
         ('00000000-0000-4000-8000-0000000260a' || h)::uuid, n, '{}'
  from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Pisistratides')) v (h, n);
insert into game.properties (id, world_id, city_id, size_id, lot)
  select ('00000000-0000-7000-8000-0000000260f' || n)::uuid, '01900000-0000-7000-8000-000000000001',
         '01900000-0000-7000-8000-000000000101', 'townhouse', 9600 + n
  from generate_series(1, 6) n;
create function pg_temp.h(name text) returns uuid language sql as $$ select ('00000000-0000-7000-8000-0000000260' || name || '1')::uuid $$;
create function pg_temp.f(n integer) returns uuid language sql as $$ select ('00000000-0000-7000-8000-0000000260f' || n)::uuid $$;
grant execute on function pg_temp.h(text), pg_temp.f(integer) to authenticated;
set constraints all immediate;
alter table game.properties disable trigger properties_guard;
alter table game.property_listings disable trigger property_listings_guard;
update game.properties p set owner_house_id = pg_temp.h(v.h), acquired_at = now(), condition = v.c, upkeep_unpaid_since = v.u
  from (values (1, 'a', 7000, '2026-03-29 01:59:59+00'::timestamptz), (2, 'a', 9000, '2026-03-29 02:00:00+00'),
               (3, 'c', 10000, null), (4, 'c', 10000, '2026-01-15 03:00:00+00'), (5, 'a', 10000, '2026-01-15 02:59:59+00')) v (n, h, c, u)
  where p.id = pg_temp.f(v.n);
insert into game.property_listings (world_id, property_id, house_id, kind, price_oboles, closed_at, outcome)
  select '01900000-0000-7000-8000-000000000001', pg_temp.f(n), pg_temp.h(h), k, p, c, o
  from (values (1, 'a', 'sale', 5000, null::timestamptz, null), (2, 'a', 'lease', 40, null, null),
               (3, 'c', 'sale', 4500, null, null), (5, 'a', 'sale', 3000, now(), 'withdrawn')) v (n, h, k, p, c, o);
alter table game.properties enable trigger properties_guard;
alter table game.property_listings enable trigger property_listings_guard;

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'property_offers_upkeep' and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'vue en lecture seule pour les joueurs connectés, rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname, ' ') from pg_roles r where has_function_privilege(r.oid, 'game.property_offers_upkeep()', 'execute')
     and not r.rolsuper and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'property_offers_upkeep'),
  array['property_id', 'city_id', 'size_id', 'lot', 'condition', 'kind', 'price_oboles', 'listed_at', 'upkeep_unpaid', 'upkeep_unpaid_day'],
  'les colonnes de property_offers puis l''impayé : ni la maison qui offre, ni l''instant exact');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'property_offers'),
  array['property_id', 'city_id', 'size_id', 'lot', 'condition', 'kind', 'price_oboles', 'listed_at'],
  'property_offers inchangée : le code précédent la lit encore (ADR 0006)');

-- Visiteur anonyme : rien, ni par la vue ni par la fonction.
set local role anon;
select throws_ok('select * from public.property_offers_upkeep', '42501', null, 'anon ne lit pas les offres et leur impayé');
select throws_ok('select * from game.property_offers_upkeep()', '42501', null, 'ni par la fonction');

-- Bob, sans bien : chaque offre ouverte, l'impayé et son jour de jeu, à l'heure d'été de Paris.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000260ab", "role": "authenticated"}';
select results_eq($$select property_id, kind, price_oboles, condition, upkeep_unpaid, upkeep_unpaid_day from public.property_offers_upkeep
    where property_id::text like '00000000-0000-7000-8000-0000000260f%' order by lot$$,
  $$values (pg_temp.f(1), 'sale', 5000::bigint, 7000, true, date '2026-03-28' - date '1970-01-01'),
           (pg_temp.f(2), 'lease', 40::bigint, 9000, true, date '2026-03-29' - date '1970-01-01'),
           (pg_temp.f(3), 'sale', 4500::bigint, 10000, false, null::integer)$$,
  'offres ouvertes : impayé de la veille jusqu''à 03:59:59, du jour dès la clôture de 04:00 (heure d''été) ; payé sans jour');
select is((select count(*) from public.property_offers_upkeep where property_id in (pg_temp.f(4), pg_temp.f(5), pg_temp.f(6))), 0::bigint,
  'ni le bien impayé qui n''est pas offert, ni l''offre retirée, ni le bien de la cité');
select results_eq($$select property_id, city_id, size_id, lot, condition, kind, price_oboles, listed_at from public.property_offers_upkeep
    where property_id::text like '00000000-0000-7000-8000-0000000260f%' order by lot$$,
  $$select property_id, city_id, size_id, lot, condition, kind, price_oboles, listed_at from public.property_offers
    where property_id::text like '00000000-0000-7000-8000-0000000260f%' order by lot$$,
  'mêmes offres et mêmes colonnes que property_offers');
select is((select count(*) from game.properties where id::text like '00000000-0000-7000-8000-0000000260f%'), 0::bigint,
  'Bob ne lit pas les biens des autres dans game');
select is((select count(*) from game.property_listings where house_id <> pg_temp.h('b')), 0::bigint, 'ni leurs offres');
select throws_ok($$insert into public.property_offers_upkeep (property_id) values ('00000000-0000-7000-8000-0000000260f4')$$,
  '55000', null, 'la vue ne s''écrit pas (ni droit accordé, ni vue modifiable)');
select throws_ok('delete from public.property_offers_upkeep', '55000', null, 'ni ne s''efface');
select throws_ok($$update game.properties set upkeep_unpaid_since = null where id = '00000000-0000-7000-8000-0000000260f1'$$,
  '42501', null, 'un joueur ne lève pas un impayé');

-- Alice, qui offre : ses offres comme les autres les voient ; son bien retiré de l'offre n'y est plus.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000260aa", "role": "authenticated"}';
select results_eq($$select property_id, upkeep_unpaid from public.property_offers_upkeep
    where property_id::text like '00000000-0000-7000-8000-0000000260f%' order by lot$$,
  $$values (pg_temp.f(1), true), (pg_temp.f(2), true), (pg_temp.f(3), false)$$, 'Alice lit les mêmes offres');
select results_eq($$select id, upkeep_unpaid_since from public.my_properties order by lot$$,
  $$values (pg_temp.f(1), '2026-03-29 01:59:59+00'::timestamptz), (pg_temp.f(2), '2026-03-29 02:00:00+00'), (pg_temp.f(5), '2026-01-15 02:59:59+00')$$,
  'et l''instant exact de ses seuls impayés par my_properties');
select throws_ok('update game.property_listings set closed_at = now(), outcome = ''withdrawn''', '42501', null,
  'ni ne ferme son offre directement');

-- Chloé : l'impayé de son bien non offert reste à elle.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000260ac", "role": "authenticated"}';
select results_eq('select id, upkeep_unpaid_since is not null from public.my_properties order by lot',
  $$values (pg_temp.f(3), false), (pg_temp.f(4), true)$$, 'Chloé lit ses biens, impayé compris');
reset role;

-- Chloé offre son bien impayé, Alice offre de nouveau le sien : l'impayé devient public, avec son jour,
-- ici à l'heure d'hiver (03:00 UTC est la clôture de 04:00 à Paris ; 02:59:59 UTC, encore la veille).
alter table game.property_listings disable trigger property_listings_guard;
insert into game.property_listings (world_id, property_id, house_id, kind, price_oboles)
  values ('01900000-0000-7000-8000-000000000001', pg_temp.f(4), pg_temp.h('c'), 'lease', 25),
         ('01900000-0000-7000-8000-000000000001', pg_temp.f(5), pg_temp.h('a'), 'sale', 3100);
alter table game.property_listings enable trigger property_listings_guard;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000260ab", "role": "authenticated"}';
select results_eq($$select property_id, upkeep_unpaid, upkeep_unpaid_day from public.property_offers_upkeep
    where property_id in (pg_temp.f(4), pg_temp.f(5)) order by lot$$,
  $$values (pg_temp.f(4), true, date '2026-01-15' - date '1970-01-01'), (pg_temp.f(5), true, date '2026-01-14' - date '1970-01-01')$$,
  'offrir un bien rend son impayé public, avec son jour de jeu à l''heure d''hiver');
reset role;

select * from finish();
rollback;
