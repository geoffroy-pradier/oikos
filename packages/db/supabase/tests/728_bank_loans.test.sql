begin;
select plan(8);

-- Jeu d'essai : un monde à lui, une cité. Alice (a) tient la banque, 20 000 oboles de capital au coffre ; Bob (b) et
-- Chloé (c) empruntent. Trésoreries : 50 000 chacune. Configuration en vigueur : l'horloge, qui date les prêts.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000728f1', 'prets-728', 'Prêts');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000728c2', '01900000-0000-7000-8000-0000000728f1', 'p728', 'Pella');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000728b' || n)::uuid, 'loans-728-' || n || '@example.test' from unnest(array['a', 'b', 'c']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000728' || n || '2')::uuid, '01900000-0000-7000-8000-0000000728f1',
       ('00000000-0000-4000-8000-0000000728b' || n)::uuid, name, '{}', 'player'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Kerykes')) h (n, name);
insert into game.citizenships (house_id, city_id)
select id, '01900000-0000-7000-8000-0000000728c2' from game.houses where world_id = '01900000-0000-7000-8000-0000000728f1';
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000728f1';
do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000728f1', 'house.starting_grant')
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then 50000 else -150000 end from game.accounts
  where world_id = '01900000-0000-7000-8000-0000000728f1' and (kind = 'house' or system_key = 'faucet_starting_grant');
end $$;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c728',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c728', now());
insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
values ('01900000-0000-7000-8000-0000000728f1', '01900000-0000-7000-8000-0000000728c2', '00000000-0000-7000-8000-0000000728a2',
        'Trapeza Alkmaion', 100, 800, 0);

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000728' || n || '2')::uuid
$$;
create function pg_temp.bank() returns uuid language sql as $$ select id from game.banks where house_id = pg_temp.house('a') $$;
create function pg_temp.vault_id() returns uuid language sql as $$ select id from game.accounts where bank_id = pg_temp.bank() $$;
create function pg_temp.treasury(n text) returns uuid language sql as $$
  select id from game.accounts where kind = 'house' and house_id = pg_temp.house(n)
$$;
create function pg_temp.today() returns int language sql as $$ select game.game_day_at(now()) $$;
create function pg_temp.close_at(d int) returns timestamptz language sql as $$
  select min(t) from generate_series((date '1970-01-01' + d - 1)::timestamp at time zone 'UTC',
    (date '1970-01-01' + d + 2)::timestamp at time zone 'UTC', interval '15 minutes') t
  where game.game_day_at(t) >= d
$$;
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
-- Écriture `kind` de la banque, au nom du service : `amount` oboles du compte `src` au compte `dst` ; rend son identifiant.
create function pg_temp.entry(kind text, src uuid, dst uuid, amount bigint, loan uuid = null) returns uuid language plpgsql as $$
declare entry uuid; meta jsonb := jsonb_strip_nulls(jsonb_build_object('bankId', pg_temp.bank(), 'loanId', loan));
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-0000000728f1', kind, meta)
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, dst, amount), (entry, src, -amount);
  perform set_config('role', 'none', true);
  return entry;
end $$;
-- Offre de la banque à `n` : principal, 12 % l'an, 30 jours, gagée sur le logement (la garantie vient en migration 0303).
create function pg_temp.offer(n text, principal bigint) returns uuid language plpgsql as $$
declare offer uuid;
begin
  insert into game.properties (world_id, city_id, size_id, lot) select '01900000-0000-7000-8000-0000000728f1',
    '01900000-0000-7000-8000-0000000728c2', 'townhouse', count(*) + 1 from game.properties;
  insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days, collateral_kind,
    collateral_property_id)
  values ('01900000-0000-7000-8000-0000000728f1', pg_temp.bank(), pg_temp.house(n), principal, 1200, 30, 'property',
    (select id from game.properties where world_id = '01900000-0000-7000-8000-0000000728f1' order by lot desc limit 1))
  returning id into offer;
  return offer;
end $$;
-- Prêt de l'offre, comme l'écrit la commande : décaissement `src` → `dst`, puis le prêt (`p` : principal écrit).
create function pg_temp.lend(offer uuid, src uuid = null, dst uuid = null, p bigint = null) returns void language plpgsql as $$
declare o game.bank_loan_offers; entry uuid;
begin
  select * into o from game.bank_loan_offers where id = offer;
  entry := pg_temp.entry('bank.loan_disburse', coalesce(src, pg_temp.vault_id()),
    coalesce(dst, (select id from game.accounts where kind = 'house' and house_id = o.borrower_house_id)), o.principal);
  perform pg_temp.as_service(format(
    'insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day,
       due_day, due_at, disbursement_entry_id, bank_id, offer_id)
     values (%L, %L, %L, %s, %s, %s, %s, %s, %s, %L, %L, %L, %L)', o.world_id, 'bank', o.borrower_house_id,
    coalesce(p, o.principal), o.rate_bps, o.term_days, ceil(coalesce(p, o.principal)::numeric * o.rate_bps * o.term_days / 3650000),
    pg_temp.today(), pg_temp.today() + o.term_days, pg_temp.close_at(pg_temp.today() + o.term_days), entry, o.bank_id, o.id));
end $$;
create function pg_temp.loan(n text) returns game.loans language sql as $$
  select * from game.loans where borrower_house_id = pg_temp.house(n) order by created_at desc, id desc limit 1
$$;
do $$ begin perform pg_temp.entry('bank.capital_in', pg_temp.treasury('a'), pg_temp.vault_id(), 20000); end $$;
set constraints all immediate;
set constraints all deferred;
create temporary table offers (n text primary key, id uuid);
insert into offers values ('b', pg_temp.offer('b', 5000)), ('c', pg_temp.offer('c', 3000)), ('w', pg_temp.offer('c', 1000));
update game.bank_loan_offers set status = 'withdrawn' where id = (select id from offers where n = 'w');

-- 1. Décaissement : du coffre à l'emprunteur, à l'acceptation de l'offre ouverte, à ses conditions.
select lives_ok($$select pg_temp.lend((select id from offers where n = 'b'))$$, 'un prêt de banque est décaissé du coffre');
select results_eq($$select lender, outstanding::bigint, interest::bigint, bank_id = pg_temp.bank() from game.loans
  where offer_id = (select id from offers where n = 'b')$$, $$values ('bank', 5050::bigint, 50::bigint, true)$$,
  'le prêt nomme sa banque ; son reste dû est le principal et l''intérêt simple');
select results_eq($$select balance from game.accounts where id in (pg_temp.vault_id(), pg_temp.treasury('b')) order by kind$$, $$values (55000::bigint), (15000::bigint)$$,
  'le principal passe du coffre à la trésorerie de l''emprunteur');
select throws_ok($$select pg_temp.lend((select id from offers where n = 'b'))$$, '23505', null,
  'une offre ne fait naître qu''un prêt');
select throws_ok($$select pg_temp.lend((select id from offers where n = 'w'))$$, '23514', null,
  'une offre retirée ne fait naître aucun prêt');
select throws_ok($$select pg_temp.lend((select id from offers where n = 'c'), p => 2999)$$, '23514', null,
  'un prêt qui n''a pas les conditions de son offre est refusé');
select lives_ok($$select pg_temp.lend((select id from offers where n = 'c'))$$, 'un second emprunteur, de la même banque');
select throws_ok($$update game.loans set offer_id = null where borrower_house_id = '00000000-0000-7000-8000-0000000728c2'$$,
  '23001', null, 'un prêt de banque garde son offre');
select * from finish();
rollback;
