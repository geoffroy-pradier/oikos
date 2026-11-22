begin;
select plan(20);

-- Jeu d'essai : un monde à lui, une cité. Alice (a) tient la banque, 20 000 oboles au coffre ; Bob (b) emprunte 5 000
-- oboles à 12 % sur 30 jours (intérêt 50), gagés sur 10 de ses 50 olives ; Chloé (c), une maison tierce, n'est partie à
-- rien. Configuration en vigueur : l'horloge.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000728f3', 'lectures-728', 'Lectures');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000728c3', '01900000-0000-7000-8000-0000000728f3', 'l728', 'Lindos');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000728c' || n)::uuid, 'reads-728-' || n || '@example.test' from unnest(array['a', 'b', 'c']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000728' || n || '3')::uuid, '01900000-0000-7000-8000-0000000728f3',
       ('00000000-0000-4000-8000-0000000728c' || n)::uuid, name, '{}', 'player'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Kerykes')) h (n, name);
insert into game.citizenships (house_id, city_id)
select id, '01900000-0000-7000-8000-0000000728c3' from game.houses where world_id = '01900000-0000-7000-8000-0000000728f3';
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000728f3';
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c738',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c738', now());
insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
values ('01900000-0000-7000-8000-0000000728f3', '01900000-0000-7000-8000-0000000728c3', '00000000-0000-7000-8000-0000000728a3',
        'Trapeza Alkmaion', 100, 800, 0);
insert into game.inventories (world_id, house_id, city_id, good_id) values
  ('01900000-0000-7000-8000-0000000728f3', '00000000-0000-7000-8000-0000000728b3', '01900000-0000-7000-8000-0000000728c3', 'olives');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
select '01900000-0000-7000-8000-0000000728f3', 'olives', 50, 'production', id, 'test' from game.inventories
where house_id = '00000000-0000-7000-8000-0000000728b3';

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000728' || n || '3')::uuid
$$;
create function pg_temp.bank() returns uuid language sql as $$ select id from game.banks where house_id = pg_temp.house('a') $$;
create function pg_temp.account(n text) returns uuid language sql as $$
  select id from game.accounts where case n when 'vault' then bank_id = pg_temp.bank() else kind = 'house' and house_id = pg_temp.house(n) end
$$;
create function pg_temp.today() returns int language sql as $$ select game.game_day_at(now()) $$;
create function pg_temp.close_at(d int) returns timestamptz language sql as $$
  select min(t) from generate_series((date '1970-01-01' + d - 1)::timestamp at time zone 'UTC',
    (date '1970-01-01' + d + 2)::timestamp at time zone 'UTC', interval '15 minutes') t
  where game.game_day_at(t) >= d
$$;
-- Écriture `kind` au nom du service, de `amount` oboles de `src` à `dst`, qui nomme la banque et le prêt `loan`.
create function pg_temp.entry(kind text, src text, dst text, amount bigint, loan uuid = null) returns uuid language plpgsql as $$
declare entry uuid; meta jsonb := jsonb_strip_nulls(jsonb_build_object('bankId', pg_temp.bank(), 'loanId', loan));
  a_src uuid := pg_temp.account(src); a_dst uuid := pg_temp.account(dst);
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-0000000728f3', kind, meta)
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, a_dst, amount), (entry, a_src, -amount);
  perform set_config('role', 'none', true);
  return entry;
end $$;
create function pg_temp.wealth(n text) returns bigint language plpgsql as $$
declare w bigint; h uuid := pg_temp.house(n);
begin
  perform set_config('role', 'oikos_service', true);
  select wealth into w from game.house_wealth('01900000-0000-7000-8000-0000000728f3') where house_id = h;
  perform set_config('role', 'none', true);
  return w;
end $$;

-- Dotations, capital, offre et prêt, comme les écrivent les commandes ; contrôles différés joués aussitôt.
do $$
declare grant_entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000728f3', 'house.starting_grant')
  returning id into grant_entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select grant_entry, id, case when kind = 'house' then 50000 else -150000 end from game.accounts
  where world_id = '01900000-0000-7000-8000-0000000728f3' and (kind = 'house' or system_key = 'faucet_starting_grant');
  perform pg_temp.entry('bank.capital_in', 'a', 'vault', 20000);
  insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days, collateral_kind,
    collateral_city_id, collateral_good_id, collateral_quantity)
  values ('01900000-0000-7000-8000-0000000728f3', pg_temp.bank(), pg_temp.house('b'), 5000, 1200, 30, 'stock',
    '01900000-0000-7000-8000-0000000728c3', 'olives', 10), ('01900000-0000-7000-8000-0000000728f3', pg_temp.bank(),
    pg_temp.house('b'), 700, 900, 7, 'stock', '01900000-0000-7000-8000-0000000728c3', 'olives', 5);
  set constraints all immediate;
  set constraints all deferred;
end $$;
create temporary table wealth_before as select pg_temp.wealth('a') as a, pg_temp.wealth('b') as b;
do $$
declare disbursed uuid := pg_temp.entry('bank.loan_disburse', 'vault', 'b', 5000);
  offer uuid := (select id from game.bank_loan_offers where principal = 5000 and bank_id = pg_temp.bank());
  borrower uuid := pg_temp.house('b'); bank uuid := pg_temp.bank(); today int := pg_temp.today();
  due timestamptz := pg_temp.close_at(pg_temp.today() + 30);
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day,
    due_day, due_at, disbursement_entry_id, bank_id, offer_id)
  values ('01900000-0000-7000-8000-0000000728f3', 'bank', borrower, 5000, 1200, 30, 50, today, today + 30, due, disbursed,
    bank, offer);
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;

-- 1. Fortune : le prêt compte pour la banque, intérêts compris, et se déduit de l'emprunteur ; le total ne change pas.
select is(pg_temp.wealth('a') - (select a from wealth_before), 50::bigint,
  'la banque compte son prêt : le principal sort du coffre, le reste dû lui est dû');
select is(pg_temp.wealth('b') - (select b from wealth_before), -50::bigint,
  'l''emprunteur déduit son reste dû du principal reçu');

-- 2. L'emprunteur : ses offres reçues, son prêt et sa banque, ses flux ; rien de la banque.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000728cb", "role": "authenticated"}', true);
select results_eq($$select principal::bigint, interest, status, bank_name from public.my_loan_offers order by principal$$,
  $$values (700::bigint, 2::bigint, 'open', 'Trapeza Alkmaion'), (5000::bigint, 50::bigint, 'accepted', 'Trapeza Alkmaion')$$,
  'l''emprunteur lit les offres reçues, leur banque et leur intérêt');
select results_eq($$select lender, outstanding::bigint, bank_id = (select id from public.banks) from public.my_loans$$,
  $$values ('bank', 5050::bigint, true)$$, 'l''emprunteur lit son prêt et sa banque');
select results_eq($$select nature, amount from public.my_cash_flows where nature = 'loans'$$,
  $$values ('loans', 5000::bigint)$$, 'le décaissement d''un prêt de banque est de nature loans');
select is((select count(*)::integer from public.my_bank_loan_offers), 0, 'l''emprunteur ne lit pas les offres d''une banque');
select is((select count(*)::integer from public.my_bank_loans), 0, 'l''emprunteur ne lit pas les prêts d''une banque');
select is((select count(*)::integer from game.bank_loan_offers where borrower_house_id <> '00000000-0000-7000-8000-0000000728b3'::uuid), 0,
  'la règle par ligne ne lui rend que ses offres');

-- 3. Le banquier : les offres faites et les prêts de sa banque, son reste dû total ; ni les prêts ni les offres reçues
-- d'une autre maison par leur vue d'emprunteur.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000728ca", "role": "authenticated"}', true);
select results_eq($$select borrower_house_id, principal::bigint, status from public.my_bank_loan_offers order by principal$$,
  $$values ('00000000-0000-7000-8000-0000000728b3'::uuid, 700::bigint, 'open'), ('00000000-0000-7000-8000-0000000728b3'::uuid, 5000::bigint, 'accepted')$$,
  'le banquier lit les offres de sa banque');
select results_eq($$select borrower_house_id, outstanding, status, collateral_kind, collateral_quantity from public.my_bank_loans$$,
  $$values ('00000000-0000-7000-8000-0000000728b3'::uuid, 5050::bigint, 'active', 'stock', 10::bigint)$$, 'le banquier lit les prêts de sa banque et leur garantie');
select results_eq($$select vault, loans from public.my_bank$$, $$values (15000::bigint, 5050::bigint)$$,
  'my_bank donne le coffre et le reste dû des prêts');
select is((select count(*)::integer from public.my_loans), 0, 'le banquier ne lit pas les prêts de ses emprunteurs comme les siens');
select is((select count(*)::integer from public.my_loan_offers), 0, 'ni leurs offres reçues');

-- 4. Une maison tierce ne lit rien d'une offre ni d'un prêt, même par la table ; un visiteur anonyme rien.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000728cc", "role": "authenticated"}', true);
select is((select count(*)::integer from public.my_loan_offers), 0, 'une maison tierce ne lit pas les offres reçues d''une autre');
select is((select count(*)::integer from public.my_bank_loan_offers), 0, 'ni les offres d''une banque qui n''est pas la sienne');
select is((select count(*)::integer from public.my_bank_loans), 0, 'ni ses prêts');
select is((select count(*)::integer from game.bank_loan_offers) + (select count(*)::integer from game.loans), 0,
  'ni par les tables');
select throws_ok($$update game.bank_loan_offers set status = 'withdrawn'$$, '42501', null, 'un joueur ne retire aucune offre');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.my_loan_offers$$, '42501', null, 'un visiteur ne lit pas les offres');
select throws_ok($$select count(*) from public.my_bank_loans$$, '42501', null, 'ni les prêts d''une banque');
reset role;

select * from finish();
rollback;
