begin;
select plan(32);

-- Jeu d'essai : un monde à lui, sa cité, trois maisons (Alice possède trois biens, Bob et Chloé n'en ont
-- pas), un bien encore à la cité. Achats posés par le propriétaire de la base, garde des biens levée.
-- Offres, baux, ventes et loyers sont posés sous le rôle de service, comme par l'API et le moteur.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000101c1', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000101f0', 'reventes', 'Reventes');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000101f1', '01900000-0000-7000-8000-0000000101f0', 'kalliste', 'Kallistè');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000101aa', 'reventes-alice@example.test'),
  ('00000000-0000-4000-8000-0000000101ab', 'reventes-bob@example.test'),
  ('00000000-0000-4000-8000-0000000101ac', 'reventes-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000101a1', '01900000-0000-7000-8000-0000000101f0', '00000000-0000-4000-8000-0000000101aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000101b1', '01900000-0000-7000-8000-0000000101f0', '00000000-0000-4000-8000-0000000101ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000101c1', '01900000-0000-7000-8000-0000000101f0', '00000000-0000-4000-8000-0000000101ac', 'Pisistratides', '{}');
insert into game.accounts (world_id, kind, house_id)
  select '01900000-0000-7000-8000-0000000101f0', 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000101f0';
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000101f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a.id, case when a.kind = 'house' then 100000 else -300000 end from entry, game.accounts a
where a.world_id = '01900000-0000-7000-8000-0000000101f0' and (a.kind = 'house' or a.system_key = 'faucet_starting_grant');
insert into game.properties (id, world_id, city_id, size_id, lot)
  select ('00000000-0000-7000-8000-00000000011' || n)::uuid, '01900000-0000-7000-8000-0000000101f0', '01900000-0000-7000-8000-0000000101f1', 'townhouse', n
  from generate_series(1, 4) n;
set constraints all immediate;
alter table game.properties disable trigger properties_guard;
update game.properties set owner_house_id = '00000000-0000-7000-8000-0000000101a1', acquired_at = now()
  where id in ('00000000-0000-7000-8000-000000000111', '00000000-0000-7000-8000-000000000112', '00000000-0000-7000-8000-000000000113');
alter table game.properties enable trigger properties_guard;
set constraints all deferred;

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.svc(statement text) returns text language sql as $$
  select 'select pg_temp.as_service(' || quote_literal(statement) || ')'
$$;
-- Maisons et biens par leur initiale et leur numéro : a, b, c ; p1 à p4 (p4 est à la cité).
create function pg_temp.h(name text) returns text language sql as $$
  select '00000000-0000-7000-8000-0000000101' || name || '1' $$;
create function pg_temp.p(n integer) returns text language sql as $$
  select '00000000-0000-7000-8000-00000000011' || n $$;
create function pg_temp.offer(property integer, house text, kind text, price integer) returns text language sql as $$
  select format('insert into game.property_listings (world_id, property_id, house_id, kind, price_oboles) values (%L, %L, %L, %L, %s)',
    '01900000-0000-7000-8000-0000000101f0', pg_temp.p(property), pg_temp.h(house), kind, price) $$;
create function pg_temp.listing(property integer) returns text language sql as $$
  select id::text from game.property_listings where property_id = pg_temp.p(property)::uuid and closed_at is null $$;
create function pg_temp.lease(property integer, landlord text, tenant text, rent integer) returns text language sql as $$
  select format('insert into game.leases (world_id, property_id, listing_id, landlord_house_id, tenant_house_id, rent_oboles) values (%L, %L, '
    || '(select id from game.property_listings where property_id = %2$L and closed_at is null), %L, %L, %s)',
    '01900000-0000-7000-8000-0000000101f0', pg_temp.p(property), pg_temp.h(landlord), pg_temp.h(tenant), rent) $$;
-- Écriture `kind` de méta `meta`, où la maison `payer` paie `amount` à `payee`.
create function pg_temp.entry(kind text, meta jsonb, payer text, payee text, amount integer) returns uuid language plpgsql as $$
declare
  created uuid;
  payer_id uuid := pg_temp.h(payer);
  payee_id uuid := pg_temp.h(payee);
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-0000000101f0', kind, meta) returning ledger_entries.id into created;
  insert into game.ledger_lines (entry_id, account_id, amount)
    select created, a.id, case when a.house_id = payer_id then -amount else amount end from game.accounts a
    where a.house_id in (payer_id, payee_id);
  perform set_config('role', 'none', true);
  return created;
end $$;

-- L'offre ouverte du bien, vendue par l'écriture donnée (sous le rôle de service).
create function pg_temp.sold(property integer, entry uuid) returns void language plpgsql as $$
declare
  listing text := pg_temp.listing(property);
begin
  perform pg_temp.as_service(format('update game.property_listings set outcome = %L, ledger_entry_id = %L where id = %L', 'sold', entry, listing));
end $$;
create function pg_temp.sale_meta(property integer) returns jsonb language sql as $$
  select jsonb_build_object('listingId', pg_temp.listing(property), 'propertyId', pg_temp.p(property)) $$;
create function pg_temp.owner(property integer, house text) returns text language sql as $$
  select pg_temp.svc(format('update game.properties set owner_house_id = %L where id = %L', pg_temp.h(house), pg_temp.p(property))) $$;

-- 1. L'offre de vente se ferme par une écriture `property.sale` de la transaction, au prix exact.
select lives_ok(pg_temp.svc(pg_temp.offer(1, 'a', 'sale', 5000)), 'Alice met son bien en vente');
select throws_ok('select pg_temp.sold(1, pg_temp.entry(''property.sale'', pg_temp.sale_meta(1), ''b'', ''a'', 4999))',
  '23001', 'a listing is sold only by a sale entry of the same transaction, at its price', 'pas à un autre prix');
select throws_ok('select pg_temp.sold(1, pg_temp.entry(''property.sale'', pg_temp.sale_meta(1), ''a'', ''b'', 5000))',
  '23001', 'a listing is sold only by a sale entry of the same transaction, at its price', 'pas par une écriture que paie le vendeur');
select throws_ok('select pg_temp.sold(1, pg_temp.entry(''property.sale'', jsonb_build_object(''listingId'', gen_random_uuid(),
  ''propertyId'', pg_temp.p(1)), ''b'', ''a'', 5000))', '23001', 'a listing is sold only by a sale entry of the same transaction, at its price', 'pas par l''écriture d''une autre offre');
select throws_ok('select pg_temp.sold(1, pg_temp.entry(''upkeep.restart'', pg_temp.sale_meta(1), ''b'', ''a'', 5000))',
  '23001', 'a listing is sold only by a sale entry of the same transaction, at its price', 'ni d''une autre nature');
select throws_ok($$select pg_temp.entry('property.sale', jsonb_build_object('listingId', upper(pg_temp.listing(1)), 'propertyId', pg_temp.p(1)), 'b', 'a', 5000)$$,
  '23514', null, 'l''écriture de vente désigne l''offre et le bien sous une seule forme');
-- 2. Le bien ne change de maison qu'avec l'offre vendue et l'écriture de la transaction.
select throws_ok(pg_temp.owner(1, 'b'), '23001', 'a listed property changes hands only once its listing is closed',
  'pas tant que l''offre est ouverte');
create temporary table sale on commit drop as select pg_temp.entry('property.sale', pg_temp.sale_meta(1), 'b', 'a', 5000) as entry_id;
select lives_ok('select pg_temp.sold(1, (select entry_id from sale))', 'l''offre est vendue par l''écriture de Bob');
select throws_ok(pg_temp.owner(1, 'c'), '23001', 'a property passes between houses only by a sale entry of the same transaction',
  'à l''acheteur seulement');
select lives_ok(pg_temp.owner(1, 'b'), 'Bob devient propriétaire');
select is((select (owner_house_id, acquired_at = now()) from game.properties where id = pg_temp.p(1)::uuid), (pg_temp.h('b')::uuid, true),
  'acquis maintenant (date posée par la base)');
select throws_ok($$select pg_temp.entry('property.sale', jsonb_build_object('listingId', (select id from game.property_listings
  where ledger_entry_id = (select entry_id from sale)), 'propertyId', pg_temp.p(1)), 'c', 'b', 5000)$$, '23505', null, 'une offre n''est vendue qu''une fois');
select throws_ok(pg_temp.svc(format('update game.properties set owner_house_id = %L where id = %L', pg_temp.h('c'), pg_temp.p(2))),
  '23001', 'a property passes between houses only by a sale entry of the same transaction', 'sans offre ni écriture, rien ne change');
select throws_ok(pg_temp.svc(format('update game.properties set owner_house_id = null where id = %L', pg_temp.p(1))),
  '23001', 'a property does not return to its city', 'un bien revendu ne revient pas à la cité');
-- Un bien loué ne change pas de maison.
select lives_ok(pg_temp.svc(pg_temp.offer(2, 'a', 'lease', 40) || '; ' || pg_temp.lease(2, 'a', 'b', 40)
  || format('; update game.property_listings set outcome = %L where property_id = %L and closed_at is null', 'leased', pg_temp.p(2))),
  'Bob loue le second bien d''Alice');
select throws_ok(pg_temp.owner(2, 'c'), '23001', 'a leased property does not change hands', 'un bien loué ne se vend pas');

-- La suite, contrôlée à la validation : une offre vendue a cédé le bien à l'acheteur, un bail a fermé son
-- offre louée. Tout est écrit sous le rôle de service ; seul le contrôle est avancé.
select lives_ok('set constraints all immediate; set constraints all deferred', 'la vente et le bail ci-dessus tiennent à la validation');
select throws_ok($$select pg_temp.as_service(pg_temp.offer(3, 'a', 'sale', 700));
  select pg_temp.sold(3, pg_temp.entry('property.sale', pg_temp.sale_meta(3), 'c', 'a', 700)); set constraints all immediate$$,
  '23001', 'a sold listing hands its property to the buyer in its transaction', 'l''acheteur ne paie pas sans recevoir le bien');
set constraints all deferred;
select throws_ok($$select pg_temp.as_service(pg_temp.offer(3, 'a', 'lease', 30) || '; ' || pg_temp.lease(3, 'a', 'c', 30));
  set constraints all immediate$$,
  '23001', 'a lease closes its offer as leased in its transaction', 'un bail ne laisse pas son offre ouverte');
set constraints all deferred;
select throws_ok($$select pg_temp.as_service(pg_temp.offer(3, 'a', 'lease', 30) || '; ' || pg_temp.lease(3, 'a', 'c', 30)
  || format('; update game.property_listings set outcome = %L where property_id = %L and closed_at is null', 'withdrawn', pg_temp.p(3)));
  set constraints all immediate$$,
  '23001', 'a lease closes its offer as leased in its transaction', 'ni ne la ferme retirée au lieu de louée');
set constraints all deferred;

-- 3. Le loyer : une écriture par bail et par jour de jeu ; la fin du bail à la clôture de son jour.
create function pg_temp.end_lease(property integer, day integer, reason text) returns text language sql as $$
  select pg_temp.svc(format('update game.leases set ended_day = %s, end_reason = %L where property_id = %L and ended_at is null',
    day, reason, pg_temp.p(property))) $$;
create function pg_temp.rent(property integer, day jsonb) returns uuid language sql as $$
  select pg_temp.entry('lease.rent', jsonb_build_object('leaseId', (select id from game.leases where property_id = pg_temp.p(property)::uuid
    and ended_at is null), 'gameDay', day), 'b', 'a', 40) $$;
select isnt(pg_temp.rent(2, '20001'), null, 'la clôture du jour 20001 encaisse le loyer');
select throws_ok('select pg_temp.rent(2, ''20001'')', '23505', null, 'un seul loyer par bail et par jour');
select throws_ok('select pg_temp.rent(2, ''"20002"'')', '23514', null, 'la clé du loyer s''écrit sous une seule forme');
select throws_ok(pg_temp.end_lease(2, 20001, 'unpaid'), '23001', 'a lease whose rent is paid does not end unpaid',
  'un bail payé ce jour ne prend pas fin faute de loyer');
select throws_ok(pg_temp.end_lease(2, 20001, 'requested'), '23001', 'a lease ends on request only once requested',
  'pas de fin « demandée » sans demande');
select lives_ok(pg_temp.svc(format('update game.leases set end_requested_by = %L where property_id = %L', 'landlord', pg_temp.p(2)))
  || '; ' || pg_temp.end_lease(2, 20001, 'requested'), 'Alice demande la fin du bail, et la clôture du jour y met fin');
select is((select (ended_at = now(), ended_day, end_reason) from game.leases where property_id = pg_temp.p(2)::uuid),
  (true, 20001, 'requested'::text), 'fin datée par la base');
select throws_ok('set constraints all immediate', '23503', null, 'à la validation, la clôture du jour doit être enregistrée');
set constraints all deferred;
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-0000000101f0', 20001, '2026-11-14 03:00+00', '00000000-0000-7000-8000-0000000101c1');
select throws_ok(pg_temp.svc(format('update game.leases set end_requested_by = %L where property_id = %L', 'tenant', pg_temp.p(2))),
  '23001', 'an ended lease does not change', 'un bail terminé ne change plus');
select lives_ok(pg_temp.svc(pg_temp.offer(2, 'a', 'lease', 60) || '; ' || pg_temp.lease(2, 'a', 'c', 60)
  || format('; update game.property_listings set outcome = %L where property_id = %L and closed_at is null', 'leased', pg_temp.p(2))),
  'le bail terminé, le bien se loue de nouveau, à Chloé');
select throws_ok(pg_temp.end_lease(2, 20001, 'unpaid'), '23001', 'a lease ends before its close is recorded',
  'pas sur une clôture déjà enregistrée');
select lives_ok(pg_temp.end_lease(2, 20002, 'unpaid'), 'la clôture suivante y met fin, loyer impayé');

select * from finish();
rollback;
