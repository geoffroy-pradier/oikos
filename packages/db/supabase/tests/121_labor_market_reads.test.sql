begin;
select plan(13);

-- Jeu d'essai : un monde, deux cités, Alice, Bob et Chloé. Configuration en vigueur : le champ emploie 4
-- travailleurs, le moulin 2 ; une maison de ville loge 4 travailleurs dès l'état 3 000.
-- Alice : deux champs et un moulin à Kallistè, une maison de ville à Kallistè (logés : le premier champ) et
-- une autre qu'elle loue à Bob. Bob : un champ à Kallistè, logé par ce bail. Chloé : un moulin à Elaia, sa
-- maison de ville d'Elaia impayée.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c121',
  '{"recipes": [{"id": "grow_wheat", "workers": 4}, {"id": "mill_flour", "workers": 2}],
    "properties": {"sizes": [{"id": "townhouse", "housingUnits": 4, "minHabitableCondition": 3000}]}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c121', now());
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000121f0', 'travail-lu', 'Travail');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000121f1', '01900000-0000-7000-8000-0000000121f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000121f2', '01900000-0000-7000-8000-0000000121f0', 'elaia', 'Elaia');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000121aa', 'lu-alice@example.test'),
  ('00000000-0000-4000-8000-0000000121ab', 'lu-bob@example.test'),
  ('00000000-0000-4000-8000-0000000121ac', 'lu-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000121a1', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-4000-8000-0000000121aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000121b1', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-4000-8000-0000000121ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000121c1', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-4000-8000-0000000121ac', 'Pisistratides', '{}');
insert into game.accounts (world_id, kind, house_id)
select '01900000-0000-7000-8000-0000000121f0', 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000121f0';
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000121f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a.id, case when a.kind = 'house' then 1000 else -3000 end from entry, game.accounts a
where a.world_id = '01900000-0000-7000-8000-0000000121f0' and (a.kind = 'house' or a.system_key = 'faucet_starting_grant');
-- Sites, nés ensemble : l'identifiant départage l'ancienneté.
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-000000121a01', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-7000-8000-0000000121a1', '01900000-0000-7000-8000-0000000121f1', 'grow_wheat'),
  ('00000000-0000-7000-8000-000000121a02', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-7000-8000-0000000121a1', '01900000-0000-7000-8000-0000000121f1', 'mill_flour'),
  ('00000000-0000-7000-8000-000000121a03', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-7000-8000-0000000121a1', '01900000-0000-7000-8000-0000000121f1', 'grow_wheat'),
  ('00000000-0000-7000-8000-000000121b01', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-7000-8000-0000000121b1', '01900000-0000-7000-8000-0000000121f1', 'grow_wheat'),
  ('00000000-0000-7000-8000-000000121c01', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-7000-8000-0000000121c1', '01900000-0000-7000-8000-0000000121f2', 'mill_flour');
-- Biens : nés à la cité, achetés par une écriture `property.buy` de la transaction.
insert into game.properties (id, world_id, city_id, size_id, lot) values
  ('00000000-0000-7000-8000-000000121e01', '01900000-0000-7000-8000-0000000121f0', '01900000-0000-7000-8000-0000000121f1', 'townhouse', 1),
  ('00000000-0000-7000-8000-000000121e02', '01900000-0000-7000-8000-0000000121f0', '01900000-0000-7000-8000-0000000121f1', 'townhouse', 2),
  ('00000000-0000-7000-8000-000000121e03', '01900000-0000-7000-8000-0000000121f0', '01900000-0000-7000-8000-0000000121f2', 'townhouse', 1);
create function pg_temp.buy(property uuid, house uuid) returns void language sql as $$
  with entry as (insert into game.ledger_entries (world_id, kind, meta)
    values ('01900000-0000-7000-8000-0000000121f0', 'property.buy', jsonb_build_object('propertyId', property)) returning id)
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry.id, a.id, case when a.kind = 'house' then -100 else 100 end from entry, game.accounts a
  where a.world_id = '01900000-0000-7000-8000-0000000121f0' and (a.house_id = house or a.system_key = 'sink_property_purchase');
  update game.properties set owner_house_id = house where id = property;
$$;
select pg_temp.buy('00000000-0000-7000-8000-000000121e01', '00000000-0000-7000-8000-0000000121a1');
select pg_temp.buy('00000000-0000-7000-8000-000000121e02', '00000000-0000-7000-8000-0000000121a1');
select pg_temp.buy('00000000-0000-7000-8000-000000121e03', '00000000-0000-7000-8000-0000000121c1');
update game.properties set upkeep_unpaid_since = now() where id = '00000000-0000-7000-8000-000000121e03';
-- Le bail : une offre de location d'Alice, louée par Bob.
insert into game.property_listings (id, world_id, property_id, house_id, kind, price_oboles) values
  ('00000000-0000-7000-8000-000000121d01', '01900000-0000-7000-8000-0000000121f0', '00000000-0000-7000-8000-000000121e02',
   '00000000-0000-7000-8000-0000000121a1', 'lease', 5);
insert into game.leases (world_id, property_id, listing_id, landlord_house_id, tenant_house_id, rent_oboles) values
  ('01900000-0000-7000-8000-0000000121f0', '00000000-0000-7000-8000-000000121e02', '00000000-0000-7000-8000-000000121d01',
   '00000000-0000-7000-8000-0000000121a1', '00000000-0000-7000-8000-0000000121b1', 5);
update game.property_listings set outcome = 'leased' where id = '00000000-0000-7000-8000-000000121d01';
-- Marché du travail : deux jours à Kallistè, un à Elaia, posés par le propriétaire.
insert into game.labor_market (world_id, city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles) values
  ('01900000-0000-7000-8000-0000000121f0', '01900000-0000-7000-8000-0000000121f1', 30000, 20, 14, 6, 9, 4),
  ('01900000-0000-7000-8000-0000000121f0', '01900000-0000-7000-8000-0000000121f1', 30001, null, 14, 6, 10, 5),
  ('01900000-0000-7000-8000-0000000121f0', '01900000-0000-7000-8000-0000000121f2', 30001, 30, 2, 2, 6, 15);

-- Le marché du travail : public pour les joueurs connectés, le dernier jour de chaque cité.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000121ac", "role": "authenticated"}';
select results_eq($$select city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles from public.labor_market
    where city_id in ('01900000-0000-7000-8000-0000000121f1', '01900000-0000-7000-8000-0000000121f2') order by city_id$$,
  $$values ('01900000-0000-7000-8000-0000000121f1'::uuid, 30001, null::bigint, 14::bigint, 6::bigint, 10::bigint, 5::bigint),
           ('01900000-0000-7000-8000-0000000121f2'::uuid, 30001, 30::bigint, 2::bigint, 2::bigint, 6::bigint, 15::bigint)$$,
  'chaque joueur lit le marché du jour de chaque cité');
select throws_ok($$insert into game.labor_market (world_id, city_id, game_day, employed, unhoused, wage_oboles, lodging_oboles)
  values ('01900000-0000-7000-8000-0000000121f0', '01900000-0000-7000-8000-0000000121f1', 30002, 0, 0, 0, 0)$$,
  '42501', null, 'un joueur n''écrit pas le marché du travail');

-- Ses travailleurs : chaque maison ne lit que ses sites.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000121aa", "role": "authenticated"}';
select results_eq($$select site_id, workers, housed, unhoused from public.my_workforce order by site_id$$,
  $$values ('00000000-0000-7000-8000-000000121a01'::uuid, 4, 4, 0), ('00000000-0000-7000-8000-000000121a02'::uuid, 2, 0, 2),
           ('00000000-0000-7000-8000-000000121a03'::uuid, 4, 0, 4)$$,
  'Alice : sa maison de ville loge son plus ancien site ; celle qu''elle loue ne loge pas ses sites');
select is((select count(*) from public.my_workforce where house_id <> '00000000-0000-7000-8000-0000000121a1'), 0::bigint,
  'Alice ne voit rien des sites des autres');
select is((select count(*) from game.my_workforce() where site_id = '00000000-0000-7000-8000-000000121b01'), 0::bigint,
  'même en appelant la fonction');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000121ab", "role": "authenticated"}';
select results_eq($$select site_id, city_id, recipe_id, workers, housed, unhoused from public.my_workforce$$,
  $$values ('00000000-0000-7000-8000-000000121b01'::uuid, '01900000-0000-7000-8000-0000000121f1'::uuid, 'grow_wheat', 4, 4, 0)$$,
  'Bob : logé par son bail');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000121ac", "role": "authenticated"}';
select results_eq($$select site_id, workers, housed, unhoused from public.my_workforce$$,
  $$values ('00000000-0000-7000-8000-000000121c01'::uuid, 2, 0, 2)$$,
  'Chloé : un bien impayé ne loge personne');
select throws_ok($$select game.guard_labor_market()$$, '42501', null, 'un joueur n''exécute pas la garde');
reset role;

-- Visiteur anonyme : rien.
set local role anon;
select throws_ok($$select * from public.labor_market$$, '42501', null, 'un visiteur ne lit pas le marché du travail');
select throws_ok($$select * from public.my_workforce$$, '42501', null, 'ni des travailleurs');
reset role;
select ok(not has_function_privilege('anon', 'game.my_workforce()', 'execute')
  and not has_function_privilege('oikos_service', 'game.my_workforce()', 'execute'),
  'la fonction des travailleurs n''est ouverte qu''aux joueurs');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'labor_market'),
  array['city_id', 'game_day', 'supply', 'employed', 'unhoused', 'wage_oboles', 'lodging_oboles'], 'colonnes du marché du travail');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'my_workforce'),
  array['house_id', 'site_id', 'city_id', 'recipe_id', 'workers', 'housed', 'unhoused'], 'colonnes des travailleurs');

select * from finish();
rollback;
