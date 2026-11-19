begin;
select plan(10);

-- La bourse des PNJ paie les achats des PNJ de sa cité, et rien d'autre (migration 1110 ; ticket 632). Chaque essai
-- est joué sous le rôle de service, comme le moteur, puis les contrôles différés sont validés : un refus annule
-- l'essai entier. Bob (b1) vend du blé à Kallistè (101) ; Elaia (103) est une autre cité du monde.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000053b', 'bob-530@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000005b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000053b', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000005bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000005b1');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000005b2', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000005b1', '01900000-0000-7000-8000-000000000101', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-0000000005b2', 'site.collect');
insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining) values
  ('00000000-0000-7000-8000-000000000530', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
   '00000000-0000-7000-8000-0000000005b1', 'wheat', 'sell', 8, 50, 50);

-- Compte par nom : clé d'un compte système, `bob`, `treasury` (de Kallistè), ou `purse:101`, `purse:103`.
create function pg_temp.acc(name text) returns uuid language sql as $$
  select case
    when name = 'bob' then '00000000-0000-7000-8000-0000000005bb'::uuid
    when name = 'treasury' then (select id from game.accounts where kind = 'treasury' and not npc_purse
                                   and city_id = '01900000-0000-7000-8000-000000000101')
    when name like 'purse:%' then (select account_id from game.npc_purses()
                                     where city_id = ('01900000-0000-7000-8000-000000000' || substr(name, 7))::uuid)
    else (select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001' and system_key = name)
  end
$$;
-- Écriture `kind` (comptes nommés, montants), et, si `quantity` n'est pas nul, l'échange de la vente 530 à 8 qu'elle
-- règle, sans ordre d'achat ; puis contrôles différés validés. Sous le service.
create function pg_temp.post(kind text, names text[], amounts bigint[], quantity bigint default null) returns void
language plpgsql as $$
declare
  entry uuid;
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', kind) returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
    select entry, pg_temp.acc(n), m from unnest(names, amounts) u (n, m);
  if quantity is not null then
    insert into game.trades (world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id)
      values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000530', null, 8, quantity, entry);
  end if;
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
grant execute on function pg_temp.acc(text), pg_temp.post(text, text[], bigint[], bigint) to oikos_service;
create function pg_temp.balance(name text) returns bigint language sql as $$
  select balance from game.accounts where id = pg_temp.acc(name)
$$;

-- Revenu public : 104 à la bourse de Kallistè, 50 à celle d'Elaia.
select pg_temp.post('npc.public_income', array['faucet_npc_public_income', 'purse:101'], array[-104, 104]);
select pg_temp.post('npc.public_income', array['faucet_npc_public_income', 'purse:103'], array[-50, 50]);

select lives_ok($$select pg_temp.post('npc.purchase', array['purse:101', 'bob', 'sink_market_tax', 'treasury'],
  array[-40, 36, 2, 2], 5)$$, 'la bourse de Kallistè paie un achat des PNJ de son marché, taxe comprise');
select is(array[pg_temp.balance('purse:101'), pg_temp.balance('treasury'), pg_temp.balance('purse:103')],
  array[64, 2, 50]::bigint[], 'la bourse paie le brut, le trésor reçoit sa part de la taxe');
select throws_ok($$select pg_temp.post('npc.purchase', array['purse:103', 'bob'], array[-8, 8], 1)$$, '23514', null,
  'la bourse d''une autre cité ne paie pas cet achat');
select throws_ok($$select pg_temp.post('npc.purchase', array['purse:101', 'bob', 'purse:103'], array[-16, 15, 1], 2)$$, '23514',
  null, 'la taxe ne va pas à une bourse');
select throws_ok($$select pg_temp.post('npc.purchase', array['treasury', 'bob'], array[-8, 8], 1)$$, '23514', null,
  'le trésor ne paie pas un achat des PNJ');
select throws_like($$select pg_temp.post('test.transfer', array['purse:101', 'bob'], array[-10, 10])$$,
  'the NPC purse of city % pays only NPC purchases', 'la bourse ne paie rien d''autre qu''un achat');
select throws_like($$select pg_temp.post('npc.purchase', array['purse:101', 'bob'], array[-10, 10])$$,
  'the NPC purse of city % pays only NPC purchases', 'ni une écriture d''achat qui ne règle aucun échange');
select throws_ok($$select pg_temp.post('npc.purchase', array['purse:101', 'bob'], array[-72, 72], 9)$$, '23514',
  'new row for relation "accounts" violates check constraint "accounts_no_overdraft"', 'aucun achat ne rend la bourse débitrice');
select lives_ok($$select pg_temp.post('npc.purchase', array['purse:101', 'bob'], array[-64, 64], 8);
  select pg_temp.post('npc.purchase', array['faucet_npc_purchases', 'bob'], array[-8, 8], 1)$$,
  'un achat la vide jusqu''à zéro ; le robinet d''avant reste admis (code précédent)');
select is(pg_temp.balance('purse:101'), 0::bigint, 'solde nul, jamais négatif');

select * from finish();
rollback;
