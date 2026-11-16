begin;
select plan(51);

-- Jeu d'essai : un monde à lui, sa cité, deux maisons dotées de 10 000 oboles, une version de configuration.
-- Les biens et les écritures sont posés sous le rôle de service, comme par le moteur et l'API.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000090c1', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000090f0', 'immobilier', 'Immobilier');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000090f1', '01900000-0000-7000-8000-0000000090f0', 'kalliste', 'Kallistè');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000090aa', 'immobilier-alice@example.test'),
  ('00000000-0000-4000-8000-0000000090ab', 'immobilier-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000090a1', '01900000-0000-7000-8000-0000000090f0', '00000000-0000-4000-8000-0000000090aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000090b1', '01900000-0000-7000-8000-0000000090f0', '00000000-0000-4000-8000-0000000090ab', 'Philaïdes', '{}');
insert into game.accounts (world_id, kind, house_id) values
  ('01900000-0000-7000-8000-0000000090f0', 'house', '00000000-0000-7000-8000-0000000090a1'),
  ('01900000-0000-7000-8000-0000000090f0', 'house', '00000000-0000-7000-8000-0000000090b1');
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000090f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a.id, case when a.kind = 'house' then 10000 else -20000 end from entry, game.accounts a
where a.world_id = '01900000-0000-7000-8000-0000000090f0' and (a.kind = 'house' or a.system_key = 'faucet_starting_grant');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- L'instruction donnée, à exécuter sous le rôle de service par `throws_ok` ou `lives_ok`.
create function pg_temp.svc(statement text) returns text language sql as $$
  select 'select pg_temp.as_service(' || quote_literal(statement) || ')'
$$;
create function pg_temp.account(key text) returns uuid language sql as $$
  select id from game.accounts where world_id = '01900000-0000-7000-8000-0000000090f0'
    and (system_key = key or house_id::text = key)
$$;
-- Écriture d'un bien : `kind` pour `property`, payée par la maison `payer` (dans la même transaction, à
-- moins de `created` explicite), puis l'instruction `then` ; le tout sous le rôle de service.
create function pg_temp.entry(kind text, property text, payer text, sink text, then_ text,
  created text default 'now()') returns text language sql as $$
  select format($s$select pg_temp.as_service($q$
    with entry as (insert into game.ledger_entries (world_id, kind, meta, created_at)
      values ('01900000-0000-7000-8000-0000000090f0', %L, jsonb_build_object('propertyId', %L), %s) returning id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, account, amount from entry, (values (%L::uuid, -300::bigint), (%L::uuid, 300)) l (account, amount);
    %s$q$)$s$, kind, property, created, pg_temp.account(payer), pg_temp.account(sink), then_)
$$;
create function pg_temp.record(day integer) returns void language sql as $$
  insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-0000000090f0', day, '2026-11-14 03:00+00', '00000000-0000-7000-8000-0000000090c1')
$$;

-- Droits, lus dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.properties'::regclass), 'règles par ligne actives');
select is(
  (select string_agg(column_name || ':' || privilege_type, ' ' order by column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'properties' and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'city_id:INSERT condition:UPDATE lot:INSERT owner_house_id:UPDATE size_id:INSERT upkeep_unpaid_since:UPDATE '
    || 'world_id:INSERT worn_day:UPDATE',
  'le service crée un bien sans en choisir ni l''identifiant, ni la date, ni l''état : liste figée');
select ok(not has_table_privilege('oikos_service', 'game.properties', 'delete')
  and not has_any_column_privilege('anon', 'game.properties', 'select')
  and not has_any_column_privilege('authenticated', 'game.properties', 'insert, update'), 'ni suppression, ni accès client direct');
select ok(not exists (select 1 from pg_roles r where has_function_privilege(r.oid, 'game.guard_property()', 'execute')
  and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')), 'personne n''exécute la garde des biens');
select is((select count(*) from game.worlds w, unnest(array['sink_property_purchase', 'sink_property_upkeep', 'sink_property_works']) k
           where not exists (select 1 from game.accounts a where a.world_id = w.id and a.system_key = k and not a.allow_negative)),
  0::bigint, 'trois puits de l''immobilier, dans chaque monde, jamais débiteurs');

-- Le parc : le service crée les biens de la cité, neufs, numérotés par taille.
select lives_ok($$select pg_temp.as_service($s$insert into game.properties (world_id, city_id, size_id, lot) values
  ('01900000-0000-7000-8000-0000000090f0', '01900000-0000-7000-8000-0000000090f1', 'townhouse', 1),
  ('01900000-0000-7000-8000-0000000090f0', '01900000-0000-7000-8000-0000000090f1', 'townhouse', 2),
  ('01900000-0000-7000-8000-0000000090f0', '01900000-0000-7000-8000-0000000090f1', 'tenement', 1)$s$)$$,
  'le service crée le parc d''une cité');
select is((select count(*) from game.properties where world_id = '01900000-0000-7000-8000-0000000090f0'
           and owner_house_id is null and acquired_at is null and condition = 10000 and worn_day is null
           and upkeep_unpaid_since is null and created_at = now()), 3::bigint, 'neufs, à la cité, nés maintenant');
create temporary table lots on commit drop as
  select size_id || lot as name, id::text as id from game.properties where world_id = '01900000-0000-7000-8000-0000000090f0';
create function pg_temp.lot(name text) returns text language sql as $$ select id from lots where lots.name = $1 $$;
select throws_ok($$select pg_temp.as_service($s$insert into game.properties (world_id, city_id, size_id, lot) values
  ('01900000-0000-7000-8000-0000000090f0', '01900000-0000-7000-8000-0000000090f1', 'townhouse', 2)$s$)$$,
  '23505', null, 'deux moteurs ne créent pas deux fois le même numéro');
select throws_ok($$select pg_temp.as_service($s$insert into game.properties (world_id, city_id, size_id, lot) values
  ('01900000-0000-7000-8000-0000000090f0', '01900000-0000-7000-8000-0000000090f1', 'townhouse', 0)$s$)$$,
  '23514', null, 'un numéro commence à 1');
select throws_ok($$select pg_temp.as_service($s$insert into game.properties (world_id, city_id, size_id, lot, condition) values
  ('01900000-0000-7000-8000-0000000090f0', '01900000-0000-7000-8000-0000000090f1', 'townhouse', 3, 5000)$s$)$$,
  '42501', null, 'le service ne choisit pas l''état d''un bien neuf');
select throws_ok($$insert into game.properties (world_id, city_id, size_id, lot, owner_house_id, acquired_at) values
  ('01900000-0000-7000-8000-0000000090f0', '01900000-0000-7000-8000-0000000090f1', 'townhouse', 4,
   '00000000-0000-7000-8000-0000000090a1', now())$$,
  '23001', 'a property is first held by its city', 'même le propriétaire de la base : un bien naît à la cité');
select throws_ok($$insert into game.properties (world_id, city_id, size_id, lot, created_at) values
  ('01900000-0000-7000-8000-0000000090f0', '01900000-0000-7000-8000-0000000090f1', 'townhouse', 4, now() - interval '1 day')$$,
  '23001', 'a property is built now', 'un bien naît maintenant');

-- 1. Changer de propriétaire : seulement par une écriture d'achat de la même transaction.
select throws_ok(pg_temp.svc(format('update game.properties set owner_house_id = %L where id = %L',
  '00000000-0000-7000-8000-0000000090a1', pg_temp.lot('townhouse1'))),
  '23001', 'a property changes hands only by a purchase entry of the same transaction', 'sans écriture, pas d''achat');
select throws_ok(pg_temp.entry('property.buy', pg_temp.lot('townhouse2'), '00000000-0000-7000-8000-0000000090a1', 'sink_property_purchase',
  format('update game.properties set owner_house_id = %L where id = %L', '00000000-0000-7000-8000-0000000090a1', pg_temp.lot('townhouse1'))),
  '23001', null, 'une écriture d''achat d''un autre bien ne vaut pas');
select throws_ok(pg_temp.entry('property.buy', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090b1', 'sink_property_purchase',
  format('update game.properties set owner_house_id = %L where id = %L', '00000000-0000-7000-8000-0000000090a1', pg_temp.lot('townhouse1'))),
  '23001', null, 'une écriture payée par une autre maison ne vaut pas');
select throws_ok(pg_temp.entry('property.renovate', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090a1', 'sink_property_works',
  format('update game.properties set owner_house_id = %L where id = %L', '00000000-0000-7000-8000-0000000090a1', pg_temp.lot('townhouse1'))),
  '23001', null, 'une écriture d''une autre nature ne vaut pas');
select throws_ok(pg_temp.entry('property.buy', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090a1', 'sink_property_purchase',
  format('update game.properties set owner_house_id = %L where id = %L', '00000000-0000-7000-8000-0000000090a1', pg_temp.lot('townhouse1')),
  $$now() - interval '1 second'$$),
  '23001', null, 'une écriture d''une autre transaction (datée d''avant) ne vaut pas');
select lives_ok(pg_temp.entry('property.buy', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090a1', 'sink_property_purchase',
  format('update game.properties set owner_house_id = %L where id = %L', '00000000-0000-7000-8000-0000000090a1', pg_temp.lot('townhouse1'))),
  'achat : l''écriture de la transaction désigne le bien et débite l''acheteur');
-- Un bien n'est acheté à la cité qu'une fois : une seconde écriture d'achat, même écrite autrement, est
-- refusée ; sans l'index, la garde refuse encore qu'un bien passe d'une maison à une autre.
select throws_ok(pg_temp.entry('property.buy', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090b1', 'sink_property_purchase',
  format('update game.properties set owner_house_id = %L where id = %L', '00000000-0000-7000-8000-0000000090b1', pg_temp.lot('townhouse1'))),
  '23505', null, 'une seule écriture d''achat par bien');
select throws_ok(pg_temp.entry('property.buy', upper(pg_temp.lot('townhouse1')), '00000000-0000-7000-8000-0000000090b1', 'sink_property_purchase',
  'select 1'), '23505', null, 'même avec l''identifiant écrit en majuscules');
select throws_ok('drop index game.ledger_entries_property_bought_once; '
  || pg_temp.entry('property.buy', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090b1', 'sink_property_purchase',
  format('update game.properties set owner_house_id = %L where id = %L', '00000000-0000-7000-8000-0000000090b1', pg_temp.lot('townhouse1'))),
  '23001', 'a property is bought only from its city', 'un bien ne passe pas d''une maison à une autre par un achat');
select is((select (owner_house_id::text, acquired_at = now()) from game.properties where id = pg_temp.lot('townhouse1')::uuid),
  ('00000000-0000-7000-8000-0000000090a1'::text, true), 'le bien est à l''acheteur, acquis maintenant (date posée par la base)');
select lives_ok(format($$update game.properties set acquired_at = now() - interval '1 day' where id = %L$$, pg_temp.lot('townhouse1')),
  'le propriétaire de la base peut demander à réécrire la date d''achat...');
select is((select acquired_at = now() from game.properties where id = pg_temp.lot('townhouse1')::uuid), true,
  '... la garde la garde : elle ne change qu''avec le propriétaire');
select throws_ok(pg_temp.svc(format('update game.properties set owner_house_id = null where id = %L', pg_temp.lot('townhouse1'))),
  '23001', 'a property does not return to its city', 'un bien ne revient pas à la cité');
select throws_ok(format($$update game.properties set size_id = 'tenement' where id = %L$$, pg_temp.lot('townhouse1')),
  '23001', 'property identity is immutable', 'ni la taille, ni la cité, ni le numéro ne changent');

-- 2. L'état ne remonte que par une rénovation, jusqu'au maximum.
update game.properties set condition = 2000, worn_day = 20000 where id = pg_temp.lot('townhouse1')::uuid;
update game.properties set condition = 4000, worn_day = 20000 where id = pg_temp.lot('townhouse2')::uuid;
select pg_temp.record(20000);
select throws_ok(pg_temp.svc(format('update game.properties set condition = 10000 where id = %L', pg_temp.lot('townhouse1'))),
  '23001', 'a property is restored only by a renovation entry of the same transaction', 'sans rénovation, l''état ne remonte pas');
select throws_ok(pg_temp.entry('property.renovate', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090a1', 'sink_property_works',
  format('update game.properties set condition = 9000 where id = %L', pg_temp.lot('townhouse1'))),
  '23001', 'a renovation restores a property to its full condition', 'une rénovation rend l''état neuf, pas moins');
select throws_ok(pg_temp.entry('property.renovate', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090b1', 'sink_property_works',
  format('update game.properties set condition = 10000 where id = %L', pg_temp.lot('townhouse1'))),
  '23001', null, 'une rénovation payée par une autre maison que le propriétaire ne vaut pas');
select throws_ok(pg_temp.entry('property.buy', pg_temp.lot('townhouse2'), '00000000-0000-7000-8000-0000000090a1', 'sink_property_purchase',
  format('update game.properties set owner_house_id = %L, condition = 10000 where id = %L', '00000000-0000-7000-8000-0000000090a1',
  pg_temp.lot('townhouse2'))),
  '23001', 'a property is restored only by a renovation entry of the same transaction', 'un achat ne rénove pas');
select throws_ok(pg_temp.entry('property.renovate', pg_temp.lot('townhouse2'), '00000000-0000-7000-8000-0000000090a1', 'sink_property_works',
  format('update game.properties set condition = 10000 where id = %L', pg_temp.lot('townhouse2'))),
  '23001', null, 'un bien de la cité n''est rénové par personne');
select lives_ok(pg_temp.entry('property.renovate', pg_temp.lot('townhouse1'), '00000000-0000-7000-8000-0000000090a1', 'sink_property_works',
  format('update game.properties set condition = 10000 where id = %L', pg_temp.lot('townhouse1'))),
  'rénovation : l''écriture de la transaction désigne le bien et débite son propriétaire');
select is((select condition from game.properties where id = pg_temp.lot('townhouse1')::uuid), 10000, 'le bien est neuf');

-- 3. La vétusté : une fois par jour de jeu, avant l'enregistrement de la clôture de ce jour.
select throws_ok(pg_temp.svc(format('update game.properties set condition = 9900 where id = %L', pg_temp.lot('tenement1'))),
  '23001', 'a property wears once per game day, forward', 'user un bien avance son jour d''usure');
select lives_ok(pg_temp.svc(format('update game.properties set condition = 9900, worn_day = 20001 where id = %L',
  pg_temp.lot('tenement1'))), 'la clôture du jour use le bien');
select throws_ok('set constraints all immediate', '23503', null, 'à la validation, la clôture du jour doit être enregistrée');
set constraints all deferred;
select lives_ok($$select pg_temp.record(20001); set constraints all immediate; set constraints all deferred$$,
  'la clôture enregistrée dans la même transaction, la référence tient');
select throws_ok(pg_temp.svc(format('update game.properties set condition = 9800, worn_day = 20001 where id = %L',
  pg_temp.lot('tenement1'))), '23001', 'a property wears once per game day, forward', 'pas deux fois le même jour');
select throws_ok(pg_temp.svc(format('update game.properties set condition = 9800, worn_day = 20000 where id = %L',
  pg_temp.lot('tenement1'))), '23001', 'a property wears once per game day, forward', 'ni en arrière');
select throws_ok(pg_temp.svc(format('update game.properties set condition = 3800, worn_day = 19000 where id = %L',
  pg_temp.lot('townhouse2'))), '23001', 'a property wears once per game day, forward', 'jamais en arrière, même pour un autre bien');
select throws_ok(pg_temp.svc(format('update game.properties set condition = 3900, worn_day = 20001 where id = %L',
  pg_temp.lot('townhouse2'))), '23001', 'a property wears before its close is recorded', 'pas sur une clôture déjà enregistrée');
select throws_ok(pg_temp.svc(format('update game.properties set condition = 10000, worn_day = 20002 where id = %L',
  pg_temp.lot('townhouse2'))), '23001', 'a renovation restores a property to its full condition', 'l''usure ne fait pas remonter l''état');

-- 4. L'entretien impayé : daté de la transaction qui l'écrit, sans changer ensuite ; seul un bien détenu par
-- une maison peut l'être.
select throws_ok(pg_temp.svc(format('update game.properties set upkeep_unpaid_since = now() where id = %L',
  pg_temp.lot('townhouse2'))), '23514', null, 'un bien de la cité ne doit pas d''entretien');
select throws_ok(pg_temp.svc(format('update game.properties set upkeep_unpaid_since = now() - interval ''1 hour'' where id = %L',
  pg_temp.lot('townhouse1'))), '23001', 'unpaid upkeep is dated by the transaction that writes it', 'pas d''impayé antidaté');
select lives_ok(pg_temp.svc(format('update game.properties set upkeep_unpaid_since = now() where id = %L',
  pg_temp.lot('townhouse1'))), 'la clôture constate l''impayé');
select throws_ok(pg_temp.svc(format('update game.properties set upkeep_unpaid_since = clock_timestamp() where id = %L',
  pg_temp.lot('townhouse1'))), '23001', 'an unpaid date does not change', 'la date d''un impayé ne change pas');
select lives_ok(pg_temp.svc(format('update game.properties set upkeep_unpaid_since = null where id = %L',
  pg_temp.lot('townhouse1'))), 'la clôture qui paie lève l''impayé');

-- Ni suppression ni troncature, même par le propriétaire de la base.
select throws_ok(pg_temp.svc(format('delete from game.properties where id = %L', pg_temp.lot('townhouse1'))),
  '42501', null, 'le service ne supprime pas un bien');
select throws_ok(format($$delete from game.properties where id = %L$$, pg_temp.lot('townhouse1')),
  '23001', null, 'le propriétaire de la base non plus');
select throws_ok('set constraints all immediate; truncate game.properties cascade', '23001', null, 'ni troncature');
select is((select count(*) from game.properties where world_id = '01900000-0000-7000-8000-0000000090f0'), 3::bigint,
  'le parc est intact');

select * from finish();
rollback;
