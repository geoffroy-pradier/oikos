begin;
select plan(13);

-- Jeu d'essai : un monde à lui, une cité. Alice (a) fonde la banque, taux de dépôt de 10 % l'an, 1 000 oboles de capital ;
-- Bob (b) et Chloé (c) déposent ; les Greniers (e) sont une maison PNJ. Trésoreries : 50 000 chacune. Configuration en
-- vigueur : l'horloge et des banques ouvertes, taux de dépôt de 0 à 15 %, de prêt de 3 à 50 %.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000727f0', 'depots-727', 'Dépôts');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000727c1', '01900000-0000-7000-8000-0000000727f0', 'k727', 'Kallistè');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000727a' || n)::uuid, 'deposits-727-' || n || '@example.test' from unnest(array['a', 'b', 'c']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000727' || n || '1')::uuid, '01900000-0000-7000-8000-0000000727f0',
       case when kind = 'player' then ('00000000-0000-4000-8000-0000000727a' || n)::uuid end, name, '{}', kind
from (values ('a', 'Alcméonides', 'player'), ('b', 'Philaïdes', 'player'), ('c', 'Kerykes', 'player'),
             ('e', 'Greniers', 'npc')) h (n, name, kind);
insert into game.citizenships (house_id, city_id)
select id, '01900000-0000-7000-8000-0000000727c1' from game.houses where world_id = '01900000-0000-7000-8000-0000000727f0';
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000727f0';
do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000727f0', 'house.starting_grant')
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then 50000 else -200000 end from game.accounts
  where (world_id = '01900000-0000-7000-8000-0000000727f0' and kind = 'house')
     or (world_id = '01900000-0000-7000-8000-0000000727f0' and system_key = 'faucet_starting_grant');
end $$;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c727',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
    "banks": {"charterFeeOboles": 0, "minCapitalOboles": 1000, "reserveRatioBps": 2000,
              "depositRateBps": {"min": 0, "max": 1500}, "loanRateBps": {"min": 300, "max": 5000}}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c727', now());
insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
values ('01900000-0000-7000-8000-0000000727f0', '01900000-0000-7000-8000-0000000727c1', '00000000-0000-7000-8000-0000000727a1',
        'Trapeza Alkmaion', 1000, 300, 0);

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000727' || n || '1')::uuid
$$;
create function pg_temp.bank() returns uuid language sql as $$
  select id from game.banks where house_id = pg_temp.house('a')
$$;
create function pg_temp.held(n text) returns bigint language sql as $$
  select balance from game.bank_deposits where house_id = pg_temp.house(n)
$$;
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Ouverture du dépôt de `n` dans la banque d'Alice, comme l'écrit la commande, au nom du service.
create function pg_temp.open(n text) returns void language plpgsql as $$
begin
  perform pg_temp.as_service(format('insert into game.bank_deposits (world_id, bank_id, house_id) values (%L, %L, %L)',
    '01900000-0000-7000-8000-0000000727f0', pg_temp.bank(), pg_temp.house(n)));
end $$;

-- Droits : le service n'écrit ni identifiant, ni date, ni solde ; les joueurs n'écrivent rien.
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'bank_deposits' and privilege_type = 'INSERT'),
  'bank_id house_id world_id', 'le service ouvre un dépôt sans choisir ni son identifiant, ni sa date, ni son solde');
select ok(not has_table_privilege('authenticated', 'game.bank_deposits', 'insert,update,delete')
          and not has_table_privilege('anon', 'game.bank_deposits', 'select,insert,update,delete'),
  'les joueurs n''écrivent aucun dépôt');

-- Ouverture : une maison de joueur, dans une banque qui n'est pas la sienne, vide.
select throws_ok($$select pg_temp.open('e')$$, '23514', 'a deposit belongs to a player house', 'une maison PNJ ne dépose pas');
select throws_ok($$select pg_temp.open('a')$$, '23514', 'a house does not deposit in its own bank',
  'le banquier ne dépose pas dans sa banque : il y verse du capital');
select throws_ok($$insert into game.bank_deposits (world_id, bank_id, house_id, balance)
  values ('01900000-0000-7000-8000-0000000727f0', pg_temp.bank(), pg_temp.house('b'), 5)$$, '23001',
  'a deposit opens now, empty', 'un dépôt s''ouvre vide, même pour le propriétaire');
select is((select count(*) from game.bank_deposits where bank_id = pg_temp.bank()), 0::bigint, 'aucun refus n''a ouvert de dépôt');
select lives_ok($$select pg_temp.open('b')$$, 'Bob ouvre son dépôt');
select is((select concat_ws(':', balance, created_at = now()) from game.bank_deposits where house_id = pg_temp.house('b')),
  '0:t', 'vide, daté par la base');
select throws_ok($$select pg_temp.open('b')$$, '23505', null, 'un dépôt par banque et par maison');

-- Le solde ne bouge que par les mouvements (migration 9991) ; un dépôt garde son identité et ne se supprime pas.
select throws_ok($$update game.bank_deposits set balance = 1 where house_id = pg_temp.house('b')$$, '23001',
  'a deposit balance changes only through its movements', 'le propriétaire ne change pas un solde');
select throws_ok($$select pg_temp.as_service(format('update game.bank_deposits set balance = 1 where house_id = %L',
  pg_temp.house('b')))$$, '23001', 'a deposit balance changes only through its movements', 'le service non plus');
select throws_ok($$update game.bank_deposits set house_id = pg_temp.house('c') where house_id = pg_temp.house('b')$$,
  '23001', 'a deposit keeps its identity', 'un dépôt garde son déposant');
select throws_ok($$delete from game.bank_deposits where house_id = pg_temp.house('b')$$, '23001', null,
  'un dépôt ne se supprime pas');

select * from finish();
rollback;
