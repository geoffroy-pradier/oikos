begin;
select plan(38);

-- Jeu d'essai : un monde à lui, sa cité, trois maisons (Alice possède trois biens, Bob et Chloé n'en ont
-- pas), un bien encore à la cité. Achats posés par le propriétaire de la base, garde des biens levée.
-- Offres, baux et écritures sont posés sous le rôle de service, comme par l'API et le moteur.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000100c1', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000100f0', 'baux', 'Baux');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000100f1', '01900000-0000-7000-8000-0000000100f0', 'kalliste', 'Kallistè');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000100aa', 'baux-alice@example.test'),
  ('00000000-0000-4000-8000-0000000100ab', 'baux-bob@example.test'),
  ('00000000-0000-4000-8000-0000000100ac', 'baux-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000100a1', '01900000-0000-7000-8000-0000000100f0', '00000000-0000-4000-8000-0000000100aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000100b1', '01900000-0000-7000-8000-0000000100f0', '00000000-0000-4000-8000-0000000100ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000100c1', '01900000-0000-7000-8000-0000000100f0', '00000000-0000-4000-8000-0000000100ac', 'Pisistratides', '{}');
insert into game.accounts (world_id, kind, house_id)
  select '01900000-0000-7000-8000-0000000100f0', 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000100f0';
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000100f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a.id, case when a.kind = 'house' then 100000 else -300000 end from entry, game.accounts a
where a.world_id = '01900000-0000-7000-8000-0000000100f0' and (a.kind = 'house' or a.system_key = 'faucet_starting_grant');
insert into game.properties (id, world_id, city_id, size_id, lot)
  select ('00000000-0000-7000-8000-00000000010' || n)::uuid, '01900000-0000-7000-8000-0000000100f0', '01900000-0000-7000-8000-0000000100f1', 'townhouse', n
  from generate_series(1, 4) n;
set constraints all immediate;
alter table game.properties disable trigger properties_guard;
update game.properties set owner_house_id = '00000000-0000-7000-8000-0000000100a1', acquired_at = now()
  where id in ('00000000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-000000000102', '00000000-0000-7000-8000-000000000103');
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
  select '00000000-0000-7000-8000-0000000100' || name || '1' $$;
create function pg_temp.p(n integer) returns text language sql as $$
  select '00000000-0000-7000-8000-00000000010' || n $$;
create function pg_temp.offer(property integer, house text, kind text, price integer) returns text language sql as $$
  select format('insert into game.property_listings (world_id, property_id, house_id, kind, price_oboles) values (%L, %L, %L, %L, %s)',
    '01900000-0000-7000-8000-0000000100f0', pg_temp.p(property), pg_temp.h(house), kind, price) $$;
create function pg_temp.listing(property integer) returns text language sql as $$
  select id::text from game.property_listings where property_id = pg_temp.p(property)::uuid and closed_at is null $$;
create function pg_temp.lease(property integer, landlord text, tenant text, rent integer) returns text language sql as $$
  select format('insert into game.leases (world_id, property_id, listing_id, landlord_house_id, tenant_house_id, rent_oboles) values (%L, %L, '
    || '(select id from game.property_listings where property_id = %2$L and closed_at is null), %L, %L, %s)',
    '01900000-0000-7000-8000-0000000100f0', pg_temp.p(property), pg_temp.h(landlord), pg_temp.h(tenant), rent) $$;

-- Droits, lus dans le catalogue.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('game.property_listings'::regclass, 'game.leases'::regclass)),
  'règles par ligne actives sur les offres et les baux');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('property_listings', 'leases') and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'leases.end_reason:UPDATE leases.end_requested_by:UPDATE leases.ended_day:UPDATE leases.landlord_house_id:INSERT '
    || 'leases.listing_id:INSERT leases.property_id:INSERT leases.rent_oboles:INSERT leases.tenant_house_id:INSERT leases.world_id:INSERT '
    || 'property_listings.house_id:INSERT property_listings.kind:INSERT property_listings.ledger_entry_id:UPDATE '
    || 'property_listings.outcome:UPDATE property_listings.price_oboles:INSERT property_listings.property_id:INSERT property_listings.world_id:INSERT',
  'le service ne choisit ni identifiant ni date : liste figée');
select ok(not has_table_privilege('oikos_service', 'game.leases', 'delete') and not has_table_privilege('oikos_service', 'game.property_listings', 'delete')
  and not has_any_column_privilege('anon', 'game.leases', 'select') and not has_any_column_privilege('authenticated', 'game.leases', 'insert, update')
  and not has_any_column_privilege('authenticated', 'game.property_listings', 'insert, update'), 'ni suppression, ni écriture cliente');
select ok(not exists (select 1 from pg_roles r, unnest(array['game.guard_lease()', 'game.guard_property_listing()']) f
  where has_function_privilege(r.oid, f, 'execute') and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')),
  'personne n''exécute les gardes');

-- Offres : par la maison qui possède le bien, une ouverte par bien.
select lives_ok(pg_temp.svc(pg_temp.offer(1, 'a', 'sale', 5000)), 'Alice met son bien en vente');
select is((select (created_at = now(), closed_at, outcome) from game.property_listings where property_id = pg_temp.p(1)::uuid),
  (true, null::timestamptz, null::text), 'ouverte, datée maintenant');
select throws_ok(pg_temp.svc(pg_temp.offer(1, 'a', 'lease', 50)), '23505', null, 'une seule offre ouverte par bien');
select throws_ok(pg_temp.svc(pg_temp.offer(2, 'b', 'sale', 5000)), '23001', 'only its owner lists a property', 'pas le bien d''un autre');
select throws_ok(pg_temp.svc(pg_temp.offer(4, 'a', 'sale', 5000)), '23001', 'only its owner lists a property', 'ni un bien de la cité');
select throws_ok(pg_temp.svc(pg_temp.offer(2, 'a', 'sale', 0)), '23514', null, 'un prix positif');
select throws_ok(pg_temp.offer(2, 'a', 'sale', 1000000001), '23514', null, 'borné');
select throws_ok(replace(replace(pg_temp.offer(2, 'a', 'sale', 100), ') values', ', created_at) values'), '100)', '100, now() - interval ''1 hour'')'),
  '23001', 'a listing is made now', 'pas d''offre antidatée, même par le propriétaire de la base');
select throws_ok(pg_temp.svc(format('update game.property_listings set price_oboles = 1 where id = %L', pg_temp.listing(1))),
  '42501', null, 'le service ne change pas le prix');
select throws_ok(format('update game.property_listings set price_oboles = 1 where id = %L', pg_temp.listing(1)),
  '23001', 'listing terms are immutable', 'le propriétaire de la base non plus');

-- Fermeture : une fois, datée de la transaction ; une offre se retire sans écriture.
select throws_ok(pg_temp.svc(format('update game.property_listings set outcome = %L where id = %L', 'sold', pg_temp.listing(1))),
  '23001', 'a listing is sold only by a sale entry of the same transaction, at its price', 'une vente a son écriture (101)');
select lives_ok(pg_temp.svc(format('update game.property_listings set outcome = %L where id = %L', 'withdrawn', pg_temp.listing(1))),
  'Alice retire son offre');
select is((select (closed_at = now(), outcome) from game.property_listings where property_id = pg_temp.p(1)::uuid),
  (true, 'withdrawn'::text), 'l''offre est fermée maintenant');
select throws_ok(pg_temp.svc(format('update game.property_listings set outcome = %L where property_id = %L', 'sold', pg_temp.p(1))),
  '23001', 'a closed listing does not change', 'une offre fermée ne change plus');
select lives_ok(pg_temp.svc(pg_temp.offer(1, 'a', 'sale', 6000)), 'et le bien s''offre de nouveau');
select lives_ok(pg_temp.svc(pg_temp.offer(3, 'a', 'lease', 30)), 'Alice propose un autre bien à louer');
select throws_ok(pg_temp.svc(format('update game.property_listings set outcome = %L where id = %L', 'leased', pg_temp.listing(3))),
  '23001', 'a listing is leased only by a lease of the same transaction', 'une offre ne se loue pas sans bail');

-- Baux : d'une offre de location ouverte, au loyer de l'offre, entre le propriétaire et une autre maison.
select lives_ok(pg_temp.svc(pg_temp.offer(2, 'a', 'lease', 40)), 'Alice propose son bien à louer');
select throws_ok(pg_temp.svc(pg_temp.lease(2, 'a', 'b', 39)), '23001', 'a lease follows an open lease offer of the owner, at its rent',
  'pas à un autre loyer');
select throws_ok(pg_temp.svc(pg_temp.lease(2, 'b', 'c', 40)), '23001', null, 'pas avec un autre propriétaire');
select throws_ok(pg_temp.svc(pg_temp.lease(1, 'a', 'b', 6000)), '23001', null, 'pas d''une offre de vente');
select throws_ok(pg_temp.svc(pg_temp.lease(2, 'a', 'a', 40)), '23514', null, 'une maison ne loue pas son propre bien');
select throws_ok(replace(replace(pg_temp.lease(2, 'a', 'b', 40), ') values', ', started_at) values'), ' 40)', ' 40, now() - interval ''1 hour'')'),
  '23001', 'a lease starts now', 'pas de bail antidaté');
select lives_ok(pg_temp.svc(pg_temp.lease(2, 'a', 'b', 40) || format('; update game.property_listings set outcome = %L where id = %L',
  'leased', pg_temp.listing(2))), 'Bob loue le bien, l''offre est louée');
select is((select (started_at = now(), landlord_house_id, tenant_house_id, rent_oboles) from game.leases where property_id = pg_temp.p(2)::uuid),
  (true, pg_temp.h('a')::uuid, pg_temp.h('b')::uuid, 40::bigint), 'le bail court depuis maintenant, au loyer de l''offre');
select throws_ok(pg_temp.svc(pg_temp.offer(2, 'a', 'sale', 5000)), '23001', 'a leased property is not listed', 'un bien loué ne s''offre pas');
select throws_ok(pg_temp.svc(format('update game.leases set rent_oboles = 1 where property_id = %L', pg_temp.p(2))),
  '42501', null, 'le service ne change pas le loyer');
select throws_ok(format('update game.leases set tenant_house_id = %L where property_id = %L', pg_temp.h('c'), pg_temp.p(2)),
  '23001', 'lease terms are immutable', 'ni le propriétaire de la base le locataire');

-- Fin : demandée une fois, datée par la base ; elle prend effet à une clôture (101).
select lives_ok(pg_temp.svc(format('update game.leases set end_requested_by = %L where property_id = %L', 'tenant', pg_temp.p(2))),
  'Bob demande la fin du bail');
select is((select end_requested_at = now() from game.leases where property_id = pg_temp.p(2)::uuid), true, 'datée par la base');
select throws_ok(pg_temp.svc(format('update game.leases set end_requested_by = %L where property_id = %L', 'landlord', pg_temp.p(2))),
  '23001', 'an end is requested once', 'une seule demande');

-- Ni suppression ni troncature, même par le propriétaire de la base.
select throws_ok(pg_temp.svc('delete from game.leases'), '42501', null, 'le service ne supprime pas un bail');
select throws_ok('delete from game.property_listings', '23001', null, 'le propriétaire de la base ne supprime pas une offre');
select throws_ok('set constraints all immediate; truncate game.leases cascade', '23001', null, 'ni troncature');

select * from finish();
rollback;
