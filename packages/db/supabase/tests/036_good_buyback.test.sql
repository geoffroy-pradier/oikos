begin;
select plan(11);

-- Rachat du stock d'un bien à retirer (migration 43, ticket 229) : un robinet dédié, une extrémité
-- système du journal des stocks dont rien ne ressort.

select is((select allow_negative from game.system_account_kinds where key = 'faucet_good_buyback'), true,
  'le robinet du rachat est au catalogue, et peut devenir débiteur');
select is(
  (select count(*) from game.worlds w where not exists (
     select 1 from game.accounts a where a.world_id = w.id and a.kind = 'system' and a.system_key = 'faucet_good_buyback')),
  0::bigint, 'chaque monde existant a son robinet du rachat');
insert into game.worlds (id, slug, name) values ('00000000-0000-7000-8000-00000000e229', 'essai-rachat', 'Essai');
select is(
  (select balance from game.accounts where world_id = '00000000-0000-7000-8000-00000000e229' and system_key = 'faucet_good_buyback'),
  0::bigint, 'un monde neuf naît avec le sien, à zéro');

-- Jeu d'essai, posé par le propriétaire : une maison et 30 blés dans le monde de test.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'alice@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000001a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 30, 'production', '00000000-0000-7000-8000-0000000001a1', 'test');
create function pg_temp.faucet() returns uuid language sql as
  $$select id from game.accounts where system_key = 'faucet_good_buyback' and world_id = '01900000-0000-7000-8000-000000000001'$$;
create temporary table before_buyback as
  select (select balance from game.accounts where id = pg_temp.faucet()) as faucet,
         (select coalesce(sum(quantity), 0) from game.stock_ledger
          where world_id = '01900000-0000-7000-8000-000000000001' and to_system = 'good_buyback') as retired;
grant select on before_buyback to oikos_service;

-- Le service écrit le rachat comme la commande : 30 blés à 4 oboles, une écriture, un mouvement lié.
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
select lives_ok($$select pg_temp.as_service($s$
  with entry as (
    insert into game.ledger_entries (id, world_id, kind) values
      ('00000000-0000-7000-8000-000000000e01', '01900000-0000-7000-8000-000000000001', 'admin.good_buyback') returning id),
  lines as (
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, line.account_id, line.amount from entry,
      (select a.id as account_id, -120::bigint as amount from game.accounts a
       where a.system_key = 'faucet_good_buyback' and a.world_id = '01900000-0000-7000-8000-000000000001'
       union all select '00000000-0000-7000-8000-0000000000aa', 120) as line)
  insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, ledger_entry_id)
  select '01900000-0000-7000-8000-000000000001', 'wheat', 30, '00000000-0000-7000-8000-0000000001a1', 'good_buyback',
         'admin.good_buyback', entry.id from entry$s$)$$,
  'le service rachète : robinet vers trésorerie, stock vers l''extrémité du rachat');
select is((select balance from game.accounts where id = pg_temp.faucet()) - (select faucet from before_buyback), -120::bigint,
  'le robinet porte exactement la monnaie créée');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000aa'), 120::bigint, 'la trésorerie la reçoit');
select is(
  (select coalesce(sum(quantity), 0) from game.stock_ledger
   where world_id = '01900000-0000-7000-8000-000000000001' and to_system = 'good_buyback') - (select retired from before_buyback),
  30::numeric, 'l''extrémité du rachat porte exactement les unités retirées');
select is((select quantity from game.inventories where id = '00000000-0000-7000-8000-0000000001a1'), 0::bigint, 'le stock de la maison est vide');
select is((select count(*) from game.inventory_quantity_check where inventory_id = '00000000-0000-7000-8000-0000000001a1' and not ok), 0::bigint,
  'et toujours égal à son journal');

-- Rien ne ressort du rachat, ni pour le service ni pour le propriétaire.
select throws_ok($$select pg_temp.as_service($s$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, 'good_buyback', '00000000-0000-7000-8000-0000000001a1', 'test')$s$)$$,
  '23514', null, 'le service ne sort aucune unité du rachat');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 1, 'good_buyback', '00000000-0000-7000-8000-0000000001a1', 'test')$$,
  '23514', null, 'ni le propriétaire');

select * from finish();
rollback;
