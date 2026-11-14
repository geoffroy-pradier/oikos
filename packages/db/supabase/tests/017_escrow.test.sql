begin;
select plan(32);

-- Jeu d'essai : Alice (acheteuse, 1 000 oboles) et Bob (vendeur, 100 blés), chacun sa trésorerie.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000b1');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000001b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-0000000001b1', 'site.collect');

-- Une écriture équilibrée entre deux comptes ; rend son identifiant.
create function pg_temp.post(debited uuid, credited uuid, amount bigint) returns uuid language plpgsql as $$
declare
  entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'test') returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, debited, -amount), (entry, credited, amount);
  return entry;
end $$;
create function pg_temp.place(order_id text, house text, side text, price bigint, quantity bigint) returns void language sql as $$
  insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining)
  values (('00000000-0000-7000-8000-0000000003' || order_id)::uuid, '01900000-0000-7000-8000-000000000001',
          '01900000-0000-7000-8000-000000000101', ('00000000-0000-7000-8000-0000000000' || house)::uuid, 'wheat', side, price, quantity, quantity)
$$;
-- Un échange réglé par le compte indiqué (séquestre ou trésorerie de l'acheteur) au profit de Bob.
create function pg_temp.trade(sell text, buy text, price bigint, quantity bigint, payer uuid) returns void language sql as $$
  insert into game.trades (world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id)
  values ('01900000-0000-7000-8000-000000000001', ('00000000-0000-7000-8000-0000000003' || sell)::uuid,
          ('00000000-0000-7000-8000-0000000003' || buy)::uuid, price, quantity,
          pg_temp.post(payer, '00000000-0000-7000-8000-0000000000bb', price * quantity))
$$;
create function pg_temp.cancel(order_id text) returns void language sql as
  $$update game.orders set status = 'cancelled' where id = ('00000000-0000-7000-8000-0000000003' || order_id)::uuid$$;
create function pg_temp.balances() returns text language sql as
  $$select string_agg(kind || ':' || balance, ' ' order by kind desc, house_id) from game.accounts
    where house_id in ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000b1')$$;
select pg_temp.post((select id from game.accounts where system_key = 'faucet_starting_grant' and world_id = '01900000-0000-7000-8000-000000000001'),
  '00000000-0000-7000-8000-0000000000aa', 1000);

-- L'ancienne garde a disparu avec sa fonction.
select hasnt_trigger('game', 'orders', 'orders_no_resting_buy', 'la garde « un achat ne reste pas dans le carnet » est retirée');
select hasnt_function('game', 'forbid_resting_buy_order', 'ainsi que sa fonction');
select ok(not has_function_privilege(r, 'game.check_escrow_matches_orders()', 'execute'), r || ' n''exécute pas le contrôle du séquestre')
from unnest(array['anon', 'authenticated', 'oikos_service']) r;

-- Compte de séquestre : un par maison, à la maison, jamais débiteur. Le service l'ouvre lui-même.
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
select lives_ok($$select pg_temp.as_service($s$insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000ae', '01900000-0000-7000-8000-000000000001', 'escrow', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000be', '01900000-0000-7000-8000-000000000001', 'escrow', '00000000-0000-7000-8000-0000000000b1')$s$)$$,
  'le service ouvre le séquestre d''une maison');
select throws_ok($$insert into game.accounts (world_id, kind, house_id) values ('01900000-0000-7000-8000-000000000001', 'escrow', '00000000-0000-7000-8000-0000000000a1')$$,
  '23505', null, 'un seul séquestre par maison');
select throws_ok($$insert into game.accounts (world_id, kind, house_id) values ('01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1')$$,
  '23505', null, 'toujours une seule trésorerie par maison');
select throws_ok($$insert into game.accounts (world_id, kind, system_key) values ('01900000-0000-7000-8000-000000000001', 'escrow', 'sink_fake')$$,
  '23514', null, 'pas de séquestre sans maison');
select throws_ok($$insert into game.accounts (world_id, kind, house_id, allow_negative) values ('01900000-0000-7000-8000-000000000001', 'escrow', '00000000-0000-7000-8000-0000000000d1', true)$$,
  '23514', null, 'un séquestre ne peut pas être débiteur');
select throws_ok($$select pg_temp.post('00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa', 1)$$,
  '23514', null, 'ni l''être en pratique');

-- Séquestre = somme des restes à payer, contrôlé à la validation.
select pg_temp.place('01', 'a1', 'buy', 8, 30);
select throws_ok('set constraints all immediate', '23514', null, 'un achat en attente sans monnaie retenue est refusé');
set constraints all deferred;
select pg_temp.post('00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000ae', 239);
select throws_ok('set constraints all immediate', '23514', null, 'une obole de moins que prix × reste : refusé');
set constraints all deferred;
select pg_temp.post('00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000ae', 2);
select throws_ok('set constraints all immediate', '23514', null, 'une obole de plus : refusé');
set constraints all deferred;
select pg_temp.post('00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa', 1);
select lives_ok('set constraints all immediate', 'prix × reste retenu : l''achat attend dans le carnet');
set constraints all deferred;
select is(pg_temp.balances(), 'house:760 house:0 escrow:240 escrow:0', 'trésorerie et séquestre d''Alice');

-- Prix d'un échange : celui de l'ordre qui attendait (le plus ancien des deux).
select pg_temp.place('02', 'b1', 'sell', 6, 12);
select throws_ok($$select pg_temp.trade('02', '01', 6, 12, '00000000-0000-7000-8000-0000000000ae')$$, '23514',
  'a trade executes at the price of the resting order', 'une vente qui arrive ne s''exécute pas à son propre prix');
select throws_ok($$select pg_temp.trade('02', '01', 7, 12, '00000000-0000-7000-8000-0000000000ae')$$, '23514',
  'a trade executes at the price of the resting order', 'ni à un prix intermédiaire');
select throws_ok($$select pg_temp.trade('02', '01', 9, 12, '00000000-0000-7000-8000-0000000000ae')$$, '23514',
  'trade does not match its buy order', 'ni au-dessus du prix limite de l''acheteur');

-- Exécution payée par la trésorerie au lieu du séquestre : le séquestre retient trop.
select pg_temp.trade('02', '01', 8, 12, '00000000-0000-7000-8000-0000000000aa');
select throws_ok('set constraints all immediate', '23514', null, 'un achat en attente servi sans débiter son séquestre est refusé');
set constraints all deferred;
select pg_temp.post('00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa', 96);
select lives_ok('set constraints all immediate', 'payé par le séquestre : valide');
set constraints all deferred;
select is(pg_temp.balances(), 'house:760 house:96 escrow:144 escrow:0', 'le vendeur est payé, le séquestre ne retient plus que le reste');

-- Contrôle par maison : l'excédent de l'une ne couvre pas le manque de l'autre.
select pg_temp.post((select id from game.accounts where system_key = 'faucet_starting_grant' and world_id = '01900000-0000-7000-8000-000000000001'),
  '00000000-0000-7000-8000-0000000000be', 50);
select throws_ok('set constraints all immediate', '23514', null, 'monnaie retenue sans achat en attente : refusé');
set constraints all deferred;
select pg_temp.place('03', 'b1', 'buy', 5, 10);
select lives_ok('set constraints all immediate', 'le séquestre de Bob couvre son achat');
set constraints all deferred;

-- Annulation : le reste retenu doit être rendu dans la même transaction.
select pg_temp.cancel('01');
select throws_ok('set constraints all immediate', '23514', null, 'un achat annulé sans restitution est refusé');
set constraints all deferred;
select pg_temp.post('00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa', 144);
select lives_ok('set constraints all immediate', 'reste rendu à la trésorerie : valide');
set constraints all deferred;

-- Sens inverse : une vente attend, un achat arrive ; l'échange se fait au prix de la vente.
select pg_temp.place('04', 'b1', 'sell', 6, 10);
select pg_temp.place('05', 'a1', 'buy', 9, 10);
select throws_ok($$select pg_temp.trade('04', '05', 9, 10, '00000000-0000-7000-8000-0000000000aa')$$, '23514',
  'a trade executes at the price of the resting order', 'un achat qui arrive ne paie pas son prix limite');
select lives_ok($$select pg_temp.trade('04', '05', 6, 10, '00000000-0000-7000-8000-0000000000aa')$$, 'il paie le prix de la vente, de sa trésorerie');
select lives_ok('set constraints all immediate', 'achat servi en entier : rien n''est retenu');
select is(pg_temp.balances(), 'house:844 house:156 escrow:0 escrow:50', 'la monnaie n''a fait que circuler');
select is((select sum(balance) from game.accounts where world_id = '01900000-0000-7000-8000-000000000001'), 0::numeric,
  'conservation : la somme de tous les soldes du monde est nulle');

-- Un joueur ne lit que sa trésorerie : le séquestre passera par une vue dédiée.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq('select kind, balance from game.accounts', $$values ('house', 156::bigint)$$, 'Bob ne lit ni le séquestre d''Alice ni le sien en direct');
reset role;
select * from finish();
rollback;
