begin;
select plan(23);

-- Une bourse des PNJ n'est créditée que par les salaires, l'hébergement et son propre revenu public (migration 1200 ;
-- ticket 651). Chaque essai est joué sous le rôle de service, comme le moteur et l'API, puis les contrôles différés
-- sont validés : un refus annule l'essai entier. Bob (b1) et Cléo (c1) ont chacun une trésorerie à Kallistè (101) ;
-- Elaia (103) est une autre cité du monde.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000057b', 'bob-570@example.test'),
  ('00000000-0000-4000-8000-00000000057c', 'cleo-570@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000005b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000057b', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000005c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000057c', 'Alcméonides', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000005bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000005b1'),
  ('00000000-0000-7000-8000-0000000005cc', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000005c1');

-- Compte par nom : clé d'un compte système, `bob`, `cleo`, `treasury` (de Kallistè), ou `purse:101`, `purse:103`.
create function pg_temp.acc(name text) returns uuid language sql as $$
  select case
    when name = 'bob' then '00000000-0000-7000-8000-0000000005bb'::uuid
    when name = 'cleo' then '00000000-0000-7000-8000-0000000005cc'::uuid
    when name = 'treasury' then (select id from game.accounts where kind = 'treasury' and not npc_purse
                                   and city_id = '01900000-0000-7000-8000-000000000101')
    when name like 'purse:%' then (select account_id from game.npc_purses()
                                     where city_id = ('01900000-0000-7000-8000-000000000' || substr(name, 7))::uuid)
    else (select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001' and system_key = name)
  end
$$;
-- Écriture `kind` (méta, comptes nommés, montants) sous le service, puis contrôles différés validés.
create function pg_temp.post(kind text, meta jsonb, names text[], amounts bigint[]) returns void language plpgsql as $$
declare
  entry uuid;
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', kind, meta)
    returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) select entry, pg_temp.acc(n), m from unnest(names, amounts) u (n, m);
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
-- La même écriture, au nom du propriétaire du schéma, sans rien valider après l'insertion.
create function pg_temp.post_as_owner(kind text, meta jsonb, names text[], amounts bigint[]) returns void language plpgsql as $$
declare
  entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', kind, meta)
    returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) select entry, pg_temp.acc(n), m from unnest(names, amounts) u (n, m);
end $$;
grant execute on function pg_temp.acc(text), pg_temp.post(text, jsonb, text[], bigint[]) to oikos_service;
create function pg_temp.balance(name text) returns bigint language sql as $$
  select balance from game.accounts where id = pg_temp.acc(name)
$$;
create function pg_temp.house(day integer) returns jsonb language sql as $$
  select jsonb_build_object('houseId', '00000000-0000-7000-8000-0000000005b1', 'gameDay', day)
$$;
create function pg_temp.income(city text, day jsonb) returns jsonb language sql as $$
  select jsonb_build_object('cityId', city, 'gameDay', day)
$$;

select pg_temp.post('test.seed', '{}', array['faucet_starting_grant', 'bob', 'cleo'], array[-2000, 1000, 1000]);

-- Natures admises. Bourses à zéro : un premier crédit d'une obole passe comme un autre.
select lives_ok($$select pg_temp.post('upkeep.daily', pg_temp.house(20771), array['bob', 'sink_upkeep', 'purse:101', 'purse:103'],
  array[-16, 5, 1, 10])$$, 'salaires de la clôture, des sites et des intendants, aux bourses des cités de leurs sites');
select lives_ok($$select pg_temp.post('upkeep.restart', jsonb_build_object('houseId', '00000000-0000-7000-8000-0000000005b1',
  'siteId', '00000000-0000-7000-8000-0000000005b2'), array['bob', 'purse:101'], array[-7, 7])$$, 'salaires d''une relance');
select lives_ok($$select pg_temp.post('lodging.daily', pg_temp.house(20771), array['bob', 'purse:101'], array[-3, 3])$$,
  'hébergement de la clôture');
select lives_ok($$select pg_temp.post('lodging.restart', jsonb_build_object('houseId', '00000000-0000-7000-8000-0000000005b1',
  'siteId', '00000000-0000-7000-8000-0000000005b2'), array['bob', 'purse:101'], array[-2, 2])$$, 'hébergement d''une relance');
select lives_ok($$select pg_temp.post('npc.public_income', pg_temp.income('01900000-0000-7000-8000-000000000101', '20771'),
  array['faucet_npc_public_income', 'purse:101'], array[-100, 100])$$, 'revenu public de la cité de la bourse');
select is(array[pg_temp.balance('purse:101'), pg_temp.balance('purse:103'), pg_temp.balance('bob')], array[113, 10, 972]::bigint[],
  'chaque crédit admis est au solde de sa bourse, à l''obole près');

-- Natures refusées, sous le service : le refus tombe dès la ligne, avant tout contrôle différé.
select throws_like($$select pg_temp.post('voyage.departure', '{}', array['bob', 'sink_port_dues', 'purse:101'], array[-10, 5, 5])$$,
  'the NPC purse of city % is credited only by wages, lodging and its own public income', 'pas le droit de port d''un départ');
select throws_like($$select pg_temp.post('property.sale', jsonb_build_object('propertyId', '00000000-0000-7000-8000-0000000005d1',
  'listingId', '00000000-0000-7000-8000-0000000005d2'), array['cleo', 'bob', 'sink_market_tax', 'purse:101'], array[-100, 96, 2, 2])$$,
  'the NPC purse of city % is credited only by wages, lodging and its own public income', 'ni la taxe d''une revente');
select throws_like($$select pg_temp.post('market.trade', '{}', array['cleo', 'bob', 'sink_market_tax', 'purse:101'], array[-40, 36, 2, 2])$$,
  'the NPC purse of city % is credited only by wages, lodging and its own public income', 'ni la taxe d''un échange entre maisons');
select throws_like($$select pg_temp.post('npc.purchase', '{}', array['purse:101', 'bob', 'purse:103'], array[-8, 7, 1])$$,
  'the NPC purse of city % is credited only by wages, lodging and its own public income', 'ni celle d''un achat des PNJ, même d''une bourse à l''autre');
select throws_like($$select pg_temp.post('lease.rent', jsonb_build_object('leaseId', '00000000-0000-7000-8000-0000000005d3',
  'gameDay', 20771), array['bob', 'purse:101'], array[-5, 5])$$,
  'the NPC purse of city % is credited only by wages, lodging and its own public income', 'ni un loyer');
select throws_like($$select pg_temp.post('house.starting_grant', '{}', array['faucet_starting_grant', 'purse:101'], array[-5, 5])$$,
  'the NPC purse of city % is credited only by wages, lodging and its own public income', 'ni un autre robinet');

-- Revenu public : celui de sa propre cité, sous une seule forme.
select throws_like($$select pg_temp.post('npc.public_income', pg_temp.income('01900000-0000-7000-8000-000000000101', '20772'),
  array['faucet_npc_public_income', 'purse:103'], array[-100, 100])$$,
  'the NPC purse of city % is credited only by wages, lodging and its own public income', 'pas le revenu public d''une autre cité');
select throws_ok($$select pg_temp.post('npc.public_income', '{}', array['faucet_npc_public_income', 'purse:101'], array[-1, 1])$$,
  '23514', 'new row for relation "ledger_entries" violates check constraint "ledger_entries_npc_public_income_meta"',
  'pas de revenu public sans cité ni jour de jeu');
-- Forme des clés : écritures qui ne créditent aucune bourse (le robinet paie Bob), pour que seule la contrainte de
-- `meta` puisse les refuser, et non la garde des bourses, qui lève le même code. Agora 570 : une cité dont
-- l'identifiant a des lettres, pour l'écrire aussi en majuscules.
insert into game.cities (id, world_id, slug, name)
  values ('0190000a-0000-7000-8000-0000000005a0', '01900000-0000-7000-8000-000000000001', 'agora-570', 'Agora 570');
create function pg_temp.shaped(city text, day jsonb) returns void language sql as $$
  select pg_temp.post('npc.public_income', pg_temp.income(city, day), array['faucet_npc_public_income', 'bob'], array[-1, 1])
$$;
select lives_ok($$select pg_temp.shaped('0190000a-0000-7000-8000-0000000005a0', '20771')$$,
  'sous sa forme unique, la clé d''Agora 570 passe la contrainte');
select throws_ok($$select pg_temp.shaped('0190000a-0000-7000-8000-0000000005a0', '"20772"')$$, '23514',
  'new row for relation "ledger_entries" violates check constraint "ledger_entries_npc_public_income_meta"',
  'ni un jour de jeu écrit en texte');
select throws_ok($$select pg_temp.shaped('0190000a-0000-7000-8000-0000000005a0', '20772.0')$$, '23514',
  'new row for relation "ledger_entries" violates check constraint "ledger_entries_npc_public_income_meta"',
  'ni un jour décimal, qui serait une autre clé du même jour pour l''index d''unicité');
select throws_ok($$select pg_temp.shaped('0190000a-0000-7000-8000-0000000005a0', '-1')$$, '23514',
  'new row for relation "ledger_entries" violates check constraint "ledger_entries_npc_public_income_meta"',
  'ni un jour négatif');
select throws_ok($$select pg_temp.shaped(upper('0190000a-0000-7000-8000-0000000005a0'), '20772')$$, '23514',
  'new row for relation "ledger_entries" violates check constraint "ledger_entries_npc_public_income_meta"',
  'ni la même cité en majuscules, qui serait une autre clé de la même cité pour l''index d''unicité');

-- Quel que soit le rôle, sans report possible.
select throws_like($$select pg_temp.post_as_owner('voyage.departure', '{}', array['bob', 'purse:101'], array[-5, 5])$$,
  'the NPC purse of city % is credited only by wages, lodging and its own public income', 'le propriétaire non plus');
select ok((select not tgdeferrable and tgconstraint = 0 from pg_trigger where tgname = 'ledger_lines_npc_purse_credit'),
  'le contrôle n''est pas une contrainte différable');
select is(array[pg_temp.balance('purse:101'), pg_temp.balance('purse:103'), pg_temp.balance('bob'), pg_temp.balance('cleo')],
  array[113, 10, 973, 1000]::bigint[], 'aucun essai refusé n''a laissé de trace (Bob : l''obole d''Agora 570 en plus)');
select lives_ok($$select pg_temp.post('npc.public_income', pg_temp.income('01900000-0000-7000-8000-000000000103', '20771'),
  array['faucet_npc_public_income', 'purse:103'], array[-1, 1])$$, 'la bourse d''Elaia reçoit son propre revenu public');

select * from finish();
rollback;
