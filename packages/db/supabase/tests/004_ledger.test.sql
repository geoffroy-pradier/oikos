begin;
select plan(27);

-- Jeu d'essai : deux maisons avec un compte et un stock de blé chacune, un robinet et un puits.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000b1');
insert into game.inventories (id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'wheat'),
  ('00000000-0000-7000-8000-0000000001b1', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'wheat'),
  ('00000000-0000-7000-8000-0000000001b2', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'bread');

create function pg_temp.faucet() returns uuid language sql as
  $$select id from game.accounts where system_key = 'faucet_npc_purchases'$$;
-- Passe une écriture et force le contrôle différé, comme le ferait la validation de la transaction.
create function pg_temp.post(accounts uuid[], amounts bigint[]) returns void language plpgsql as $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'test') returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) select entry, a, m from unnest(accounts, amounts) as t(a, m);
  set constraints all immediate;
  set constraints all deferred;
end $$;

-- Ajoute une ligne isolée à une écriture déjà passée.
create function pg_temp.append_line() returns void language plpgsql as $$
begin
  insert into game.ledger_lines (entry_id, account_id, amount)
    select id, '00000000-0000-7000-8000-0000000000aa', 10 from game.ledger_entries limit 1;
  set constraints all immediate;
  set constraints all deferred;
end $$;

-- Écriture équilibrée : le robinet crée 600 oboles pour Alice, puis Alice en verse 250 à Bob.
select lives_ok($$select pg_temp.post(array[pg_temp.faucet(), '00000000-0000-7000-8000-0000000000aa'], array[-600, 600])$$, 'création de monnaie par un robinet');
select lives_ok($$select pg_temp.post(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-250, 250])$$, 'virement entre maisons');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000aa'), 350::bigint, 'solde d''Alice');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000bb'), 250::bigint, 'solde de Bob');
select is((select balance from game.accounts where id = pg_temp.faucet()), -600::bigint, 'le robinet porte la monnaie créée');
select is((select sum(balance) from game.accounts), 0::numeric, 'conservation : la somme de tous les soldes est nulle');
select is((select count(*) from game.account_balance_check where not ok), 0::bigint, 'vue de contrôle : solde = cumul des lignes');

-- Écritures refusées.
select throws_ok($$select pg_temp.post(array[pg_temp.faucet(), '00000000-0000-7000-8000-0000000000aa'], array[-100, 99])$$, '23514', null, 'somme non nulle refusée');
select throws_ok($$select pg_temp.post(array['00000000-0000-7000-8000-0000000000aa']::uuid[], array[5])$$, '23514', null, 'une seule ligne refusée');
select throws_ok($$select pg_temp.post(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-351, 351])$$, '23514', null, 'découvert refusé pour une maison');
select throws_ok($$insert into game.ledger_lines (entry_id, account_id, amount) select id, pg_temp.faucet(), 0 from game.ledger_entries limit 1$$, '23514', null, 'montant nul refusé');
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'game' and (table_name, column_name) in (('ledger_lines', 'amount'), ('accounts', 'balance'),
     ('inventories', 'quantity'), ('stock_ledger', 'quantity')) and data_type = 'bigint'),
  4::bigint, 'montants et quantités en entiers (bigint), aucun flottant');
select throws_ok('select pg_temp.append_line()', '23514', null, 'ligne ajoutée après coup à une écriture : déséquilibre refusé');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000aa'), 350::bigint, 'les écritures refusées n''ont rien changé');

-- Les journaux sont en ajout seul et les soldes ne se modifient que par eux.
select throws_ok('update game.ledger_lines set amount = amount * 2', '23001', null, 'ligne non modifiable');
select throws_ok('delete from game.ledger_entries', '23001', null, 'écriture non supprimable');
select throws_ok($$update game.accounts set balance = 1000000 where kind = 'house'$$, '23001', null, 'solde non modifiable directement');
select throws_ok($$insert into game.accounts (world_id, kind, house_id, allow_negative) values ('01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1', true)$$, '23514', null, 'pas de découvert autorisé pour un compte de maison');

-- Stocks : production (source système), transfert, consommation (puits système).
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 40, 'production', '00000000-0000-7000-8000-0000000001a1', 'test');
insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 15, '00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-0000000001b1', 'test');
insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 5, '00000000-0000-7000-8000-0000000001b1', 'npc_consumption', 'test');
select results_eq(
  $$select quantity from game.inventories where good_id = 'wheat' order by id$$,
  $$values (25::bigint), (10::bigint)$$, 'quantités après production, transfert et consommation');
select is((select count(*) from game.inventory_quantity_check where quantity <> movements_total), 0::bigint, 'vue de contrôle : quantité = entrées - sorties');

select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 26, '00000000-0000-7000-8000-0000000001a1', 'npc_consumption', 'test')$$, '23514', null, 'stock négatif refusé');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, '00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-0000000001b2', 'test')$$, '23514', null, 'pas de blé dans un stock de pain');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_system, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, 'production', 'npc_consumption', 'test')$$, '23514', null, 'mouvement sans stock réel refusé');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 0, 'production', '00000000-0000-7000-8000-0000000001a1', 'test')$$, '23514', null, 'quantité nulle refusée');
select throws_ok('update game.inventories set quantity = 999', '23001', null, 'quantité non modifiable directement');
select throws_ok('delete from game.stock_ledger', '23001', null, 'journal des stocks en ajout seul');

-- Aucun rôle client ne lit ni n'écrit le grand livre.
select is(
  (select count(*) from pg_class c, unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
   where c.relnamespace = 'game'::regnamespace and c.relkind in ('r', 'v')
     and c.relname in ('accounts', 'ledger_entries', 'ledger_lines', 'inventories', 'stock_ledger', 'account_balance_check', 'inventory_quantity_check')
     and has_table_privilege(r, c.oid, p)),
  0::bigint, 'aucun droit client sur la monnaie ni sur les stocks');

select * from finish();
rollback;
