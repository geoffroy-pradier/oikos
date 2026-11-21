begin;
select plan(75);

-- Jeu d'essai : un monde à lui. Alice (a) et Bob (b) y ont leur maison de joueur, les Greniers (e) une maison PNJ sans
-- compte ; Dion (d) a sa maison dans un autre monde. Trésoreries : Alice 2 000, Bob 1 000. Configuration en vigueur : taux
-- directeur de 10 %, durées de 7 et 365 jours, deux paliers de Timè.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000724f0', 'prets-724', 'Prêts'), ('01900000-0000-7000-8000-0000000724f9', 'ailleurs-724', 'Ailleurs');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000724a' || n)::uuid, 'loans-724-' || n || '@example.test' from unnest(array['a', 'b', 'd']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000724' || n || '1')::uuid, ('01900000-0000-7000-8000-0000000724' || w)::uuid,
       case when kind = 'player' then ('00000000-0000-4000-8000-0000000724a' || n)::uuid end, name, '{}', kind
from (values ('a', 'Alcméonides', 'f0', 'player'), ('b', 'Philaïdes', 'f0', 'player'), ('e', 'Greniers', 'f0', 'npc'),
             ('d', 'Eumolpides', 'f9', 'player')) h (n, name, w, kind);
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where id::text like '00000000-0000-7000-8000-0000000724%';
do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000724f0', 'house.starting_grant')
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when house_id = '00000000-0000-7000-8000-0000000724a1' then 2000
                         when kind = 'house' then 1000 else -3000 end from game.accounts
  where house_id in ('00000000-0000-7000-8000-0000000724a1', '00000000-0000-7000-8000-0000000724b1')
     or (world_id = '01900000-0000-7000-8000-0000000724f0' and system_key = 'faucet_starting_grant');
end $$;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c724',
  '{"templeTreasury": {"policyRateBps": 1000, "termDays": [7, 365],
    "principalCaps": [{"minHonor": 0, "maxPrincipal": 20000}, {"minHonor": 50, "maxPrincipal": 90000}]}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c724', now());

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000724' || n || '1')::uuid
$$;
create function pg_temp.balance(n text) returns bigint language sql as $$
  select balance from game.accounts where (kind = 'house' and house_id::text = '00000000-0000-7000-8000-0000000724' || n || '1')
    or (world_id = '01900000-0000-7000-8000-0000000724f0' and system_key = n)
$$;
-- Emprunt écrit comme l'écrit la commande, au nom du service : l'écriture du décaissement (`credit` oboles du compte
-- système `faucet` à la trésorerie de la maison), puis le prêt ; les contrôles différés sont joués aussitôt.
create function pg_temp.borrow(n text, p_principal bigint, p_rate int = 1000, p_term int = 365, p_interest bigint = null,
  credit bigint = null, faucet text = 'faucet_temple_loans', entry_kind text = 'loan.temple_disburse',
  p_lender text = 'temple', p_due_day int = null)
returns uuid language plpgsql as $$
declare entry uuid; loan uuid; h uuid := pg_temp.house(n);
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000724f0', entry_kind, jsonb_build_object('houseId', h))
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, coalesce(credit, p_principal) from game.accounts where house_id = h and kind = 'house'
  union all
  select entry, id, -coalesce(credit, p_principal) from game.accounts
  where world_id = '01900000-0000-7000-8000-0000000724f0' and system_key = faucet;
  insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day,
    due_day, due_at, disbursement_entry_id)
  values ('01900000-0000-7000-8000-0000000724f0', p_lender, h, p_principal, p_rate, p_term,
    coalesce(p_interest, ceil(p_principal::numeric * p_rate * p_term / 3650000)::bigint), 200,
    coalesce(p_due_day, 200 + p_term), now() + make_interval(days => p_term), entry)
  returning id into loan;
  set constraints game.loans_disbursed, game.ledger_entries_loan immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
  return loan;
end $$;
-- Remboursement écrit comme l'écrit la commande, au nom du service : l'écriture (intérêts au puits, principal au robinet,
-- ou aux comptes `sink` et `faucet` donnés), puis le remboursement, au nom de la maison `payer`.
create function pg_temp.repay(loan uuid, p_interest bigint, p_principal bigint, payer text = null,
  sink text = 'sink_temple_interest', faucet text = 'faucet_temple_loans', named uuid = null)
returns void language plpgsql as $$
declare entry uuid; h uuid := coalesce(pg_temp.house(payer), (select borrower_house_id from game.loans where id = loan));
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000724f0', 'loan.repay', jsonb_build_object('loanId', coalesce(named, loan)))
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, -(p_interest + p_principal) from game.accounts
  where house_id = h and kind = 'house'
  union all
  select entry, id, p_interest from game.accounts
  where world_id = '01900000-0000-7000-8000-0000000724f0' and system_key = sink and p_interest > 0
  union all
  select entry, id, p_principal from game.accounts
  where world_id = '01900000-0000-7000-8000-0000000724f0' and system_key = faucet and p_principal > 0;
  insert into game.loan_repayments (world_id, loan_id, house_id, interest, principal, game_day, ledger_entry_id)
  values ('01900000-0000-7000-8000-0000000724f0', loan, h, p_interest, p_principal,
    201, entry);
  set constraints game.loan_repayments_settled, game.ledger_entries_loan immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.loan(n text) returns uuid language sql as $$
  select id from game.loans where borrower_house_id = pg_temp.house(n) order by status = 'repaid', created_at desc limit 1
$$;
create function pg_temp.state(loan uuid) returns text language sql as $$
  select concat_ws(':', status, principal, interest, principal_repaid, interest_repaid, outstanding) from game.loans where id = loan
$$;

-- Comptes système, droits du service.
select is(
  (select string_agg(system_key || ':' || allow_negative, ' ' order by system_key) from game.accounts
   where world_id = '01900000-0000-7000-8000-0000000724f0' and system_key in ('faucet_temple_loans', 'sink_temple_interest')),
  'faucet_temple_loans:true sink_temple_interest:false', 'chaque monde a le robinet des prêts du temple et le puits de leurs intérêts');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'loans' and privilege_type = 'INSERT'),
  'borrowed_day borrower_house_id disbursement_entry_id due_at due_day interest lender principal rate_bps term_days world_id',
  'le service ne choisit ni l''identifiant, ni la date, ni l''état, ni ce qui est remboursé ou reste dû');
select is(
  (select count(*)::integer from information_schema.column_privileges where table_schema = 'game'
     and table_name = 'loans' and privilege_type in ('UPDATE', 'DELETE') and grantee in ('oikos_service', 'authenticated', 'anon')),
  0, 'personne d''autre que la base ne modifie un prêt');

-- Emprunt : seul le temple prête, à une maison de joueur, à l'intérêt de la règle, par son écriture.
select throws_ok($$select pg_temp.borrow('a', 10000, p_lender => 'bank')$$, '23001', 'only the temple lends until banks open',
  'aucune banque ne prête encore');
select throws_ok($$select pg_temp.borrow('e', 10000)$$, '23514', 'a loan goes to a player house',
  'une maison PNJ de secours n''emprunte pas');
select throws_ok($$select pg_temp.borrow('a', 10000, p_interest => 999)$$, '23514', null,
  'l''intérêt est celui de la règle, arrondi à l''obole supérieure');
select throws_ok($$select pg_temp.borrow('a', 10000, p_due_day => 300)$$, '23514', null, 'l''échéance suit la durée');
select throws_ok($$select pg_temp.borrow('a', 10000, credit => 9999)$$, '23001',
  'a temple loan is disbursed by its own entry, from faucet_temple_loans to its borrower', 'le décaissement porte le principal');
select throws_ok($$select pg_temp.borrow('a', 10000, faucet => 'faucet_starting_grant')$$, '23001',
  'a temple loan is disbursed by its own entry, from faucet_temple_loans to its borrower', 'depuis le robinet des prêts du temple');
select throws_ok($$select pg_temp.borrow('a', 10000, entry_kind => 'house.starting_grant')$$, '23001',
  'a temple loan is disbursed by its own entry, from faucet_temple_loans to its borrower', 'par une écriture de sa nature');
select throws_ok($t$
  do $do$
  declare entry uuid;
  begin
    insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000724f0', 'loan.temple_disburse')
    returning id into entry;
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry, id, case when kind = 'house' then 500 else -500 end from game.accounts
    where house_id = pg_temp.house('a') or (world_id = '01900000-0000-7000-8000-0000000724f0' and system_key = 'faucet_temple_loans');
    set constraints game.ledger_entries_loan immediate;
  end $do$$t$, '23001', 'a loan entry settles a loan', 'le robinet du temple ne crée rien sans prêt');
select is(pg_temp.balance('faucet_temple_loans'), 0::bigint, 'aucun refus n''a rien créé');

-- Alice emprunte 10 000 oboles à 10 % pour un an : 1 000 d'intérêts.
select lives_ok($$select pg_temp.borrow('a', 10000)$$, 'Alice emprunte au temple');
select is(pg_temp.state(pg_temp.loan('a')), 'active:10000:1000:0:0:11000', 'son reste dû est le principal plus les intérêts');
select is((select created_at from game.loans where id = pg_temp.loan('a')), now(), 'la base date l''emprunt');
select is(array[pg_temp.balance('a'), pg_temp.balance('faucet_temple_loans')], array[12000, -10000]::bigint[],
  'le robinet crée le principal dans sa trésorerie');
select throws_ok($$select pg_temp.borrow('a', 100, p_term => 7)$$, '23505', null, 'un prêt du temple à la fois');
select lives_ok($$select pg_temp.borrow('b', 3650, p_rate => 1, p_term => 7)$$, 'Bob emprunte au plus petit taux');
select is(pg_temp.state(pg_temp.loan('b')), 'active:3650:1:0:0:3651', '3 650 × 1 × 7 ÷ 3 650 000 = 0,007 : une obole d''intérêts');
select is(-pg_temp.balance('faucet_temple_loans'),
  (select sum(principal - principal_repaid)::bigint from game.loans where world_id = '01900000-0000-7000-8000-0000000724f0'),
  'le robinet a créé en net le principal qui reste dû');
select throws_ok($$update game.loans set outstanding = 0, principal_repaid = 3650, status = 'repaid' where id = pg_temp.loan('b')$$,
  '23001', 'a loan changes only through its repayments', 'le reste dû ne change que par un remboursement, même pour le propriétaire');
select throws_ok($$delete from game.loans where id = pg_temp.loan('b')$$, '23001', null, 'un prêt ne se supprime pas');
select throws_ok($$select pg_temp.as_service('update game.loans set outstanding = 0')$$, '42501', null,
  'le service ne modifie pas un prêt');
select throws_ok($$select pg_temp.as_service('delete from game.loans')$$, '42501', null, 'ni ne le supprime');

-- Remboursements : les intérêts d'abord, par une écriture qui les verse au puits, le principal au robinet.
select throws_ok($$select pg_temp.repay(pg_temp.loan('a'), 0, 100)$$, '23001',
  'a repayment pays its borrower''s outstanding loan, interest first', 'pas de principal avant les intérêts');
select throws_ok($$select pg_temp.repay(pg_temp.loan('a'), 500, 1)$$, '23001',
  'a repayment pays its borrower''s outstanding loan, interest first', 'les intérêts dus passent avant le principal');
select throws_ok($$select pg_temp.repay(pg_temp.loan('a'), 600, 0, payer => 'b')$$, '23001',
  'a repayment pays its borrower''s outstanding loan, interest first', 'une autre maison ne rembourse pas le prêt d''Alice');
select throws_ok($$select pg_temp.repay(pg_temp.loan('a'), 600, 0, sink => 'sink_offerings')$$, '23001',
  'a loan repayment is paid by its own entry, interest to sink_temple_interest, principal to faucet_temple_loans',
  'les intérêts vont au puits des intérêts du temple');
select throws_ok($$select pg_temp.repay(pg_temp.loan('a'), 1000, 400, faucet => 'faucet_starting_grant')$$, '23001',
  'a loan repayment is paid by its own entry, interest to sink_temple_interest, principal to faucet_temple_loans',
  'le principal revient au robinet des prêts du temple');
select throws_ok($$select pg_temp.repay(pg_temp.loan('a'), 600, 0, named => '00000000-0000-7000-8000-000000000000')$$, '23001',
  'a loan repayment is paid by its own entry, interest to sink_temple_interest, principal to faucet_temple_loans',
  'l''écriture nomme son prêt');
select lives_ok($$select pg_temp.repay(pg_temp.loan('a'), 600, 0)$$, 'Alice paie 600 oboles d''intérêts');
select is(pg_temp.state(pg_temp.loan('a')), 'active:10000:1000:0:600:10400', 'il reste 400 d''intérêts et le principal');
select lives_ok($$select pg_temp.repay(pg_temp.loan('a'), 400, 1000)$$, 'puis 1 400 : le reste des intérêts et 1 000 de principal');
select is(pg_temp.state(pg_temp.loan('a')), 'active:10000:1000:1000:1000:9000', 'les intérêts sont payés');
select is(array[pg_temp.balance('a'), pg_temp.balance('sink_temple_interest'), pg_temp.balance('faucet_temple_loans')],
  array[10000, 1000, -12650]::bigint[], 'le puits détruit les intérêts ; le robinet ne compte en net que le principal dû (9 000 et 3 650)');
select throws_ok($$select pg_temp.repay(pg_temp.loan('a'), 0, 9001)$$, '23514', null, 'jamais plus que le reste dû');
select lives_ok($$select pg_temp.repay(pg_temp.loan('a'), 0, 9000)$$, 'Alice rembourse le reste');
select is(pg_temp.state(pg_temp.loan('a')), 'repaid:10000:1000:10000:1000:0', 'le prêt est remboursé, son reste dû est nul');
select is(array[pg_temp.balance('a'), pg_temp.balance('faucet_temple_loans')], array[1000, -3650]::bigint[],
  'le robinet ne compte plus que le prêt de Bob ; Alice a payé les intérêts de sa dotation');
select throws_ok($$select pg_temp.repay(pg_temp.loan('a'), 0, 1)$$, '23001',
  'a repayment pays its borrower''s outstanding loan, interest first', 'un prêt remboursé ne se rembourse plus');
select throws_ok($$select pg_temp.repay(pg_temp.loan('b'), 1, 1, payer => 'a')$$, '23001',
  'a repayment pays its borrower''s outstanding loan, interest first', 'ni Alice celui de Bob');

-- Un prêt en défaut (#725, posé ici gardes levées) reste dû : il compte pour le prêt unique, et se rembourse.
set local session_replication_role = replica;
update game.loans set status = 'defaulted' where id = pg_temp.loan('b');
set local session_replication_role = origin;
select throws_ok($$select pg_temp.borrow('b', 100, p_term => 7)$$, '23505', null, 'un prêt en défaut empêche d''en prendre un autre');
select lives_ok($$select pg_temp.repay(pg_temp.loan('b'), 1, 3000)$$, 'Bob en rembourse l''intérêt et une part du principal');
select is(pg_temp.state(pg_temp.loan('b')), 'defaulted:3650:1:3000:1:650', 'il reste en défaut tant qu''il reste dû');
select lives_ok($$select pg_temp.repay(pg_temp.loan('b'), 0, 650)$$, 'puis le solde');
select is(pg_temp.state(pg_temp.loan('b')), 'repaid:3650:1:3650:1:0', 'il est remboursé');

-- La base tient le reste dû : décaissement et intérêts moins les remboursements, pour chaque prêt du monde.
select is(
  (select count(*)::integer from game.loans o
   where o.world_id = '01900000-0000-7000-8000-0000000724f0'
     and o.outstanding <> o.principal + o.interest
       - coalesce((select sum(r.interest + r.principal) from game.loan_repayments r where r.loan_id = o.id), 0)),
  0, 'reste dû = principal + intérêts − remboursements');
select is(array[pg_temp.balance('faucet_temple_loans'), pg_temp.balance('sink_temple_interest')], array[0, 1001]::bigint[],
  'tout remboursé : le robinet n''a rien créé en net, le puits a détruit les intérêts');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'loan_repayments' and privilege_type = 'INSERT'),
  'game_day house_id interest ledger_entry_id loan_id principal world_id', 'le service ne choisit ni l''identifiant ni la date d''un remboursement');
select throws_ok($$update game.loan_repayments set principal = 0$$, '23001', null, 'un remboursement ne change pas');
select throws_ok($$delete from game.loan_repayments$$, '23001', null, 'ni ne se supprime');
select throws_ok($$select pg_temp.as_service('update game.loan_repayments set principal = 0')$$, '42501', null,
  'le service ne le modifie pas');

-- Lectures, natures et fortune (#724, migration 9912). Alice emprunte 5 000 oboles pour 7 jours : 10 d'intérêts
-- (9,59 arrondi), dont elle paie 4.
select is((select wealth from game.house_wealth('01900000-0000-7000-8000-0000000724f0') where house_id = pg_temp.house('a')),
  1000::bigint, 'sans dette, la fortune d''Alice est sa trésorerie');
select lives_ok($$select pg_temp.borrow('a', 5000, p_term => 7)$$, 'Alice emprunte de nouveau');
select is((select wealth from game.house_wealth('01900000-0000-7000-8000-0000000724f0') where house_id = pg_temp.house('a')),
  990::bigint, 'emprunter ne coûte à sa fortune que les intérêts : le reste dû se déduit');
select lives_ok($$select pg_temp.repay(pg_temp.loan('a'), 4, 0)$$, 'elle paie 4 oboles d''intérêts');
select is(
  (select string_agg(right(house_id::text, 2) || ':' || treasury || ':' || wealth, ' ' order by house_id)
   from game.house_wealth('01900000-0000-7000-8000-0000000724f0') where not npc),
  'a1:5996:990 b1:999:999', 'la fortune déduit le reste dû, et rien d''un prêt remboursé');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000724aa", "role": "authenticated"}', true);
select is((select string_agg(status || ':' || outstanding, ' ' order by principal) from public.my_loans),
  'active:5006 repaid:0', 'Alice lit ses prêts et leur reste dû');
select is((select string_agg(interest || '+' || principal, ' ' order by interest, principal) from game.loan_repayments),
  '0+9000 4+0 400+1000 600+0', 'et ses remboursements, intérêts d''abord');
select is((select string_agg(nature || ':' || amount, ' ' order by nature) from public.my_cash_flows),
  'grant:2000 interest:-1004 loans:5000', 'flux : principal emprunté et remboursé en `loans`, intérêts en `interest`');
select is((select upkeep || ':' || operating_result || ':' || other || ':' || non_operating || ':' || cash_change
   from public.my_income_statement),
  '-1004:-1004:5000:7000:5996', 'résultat : intérêts en charges courantes, principal hors exploitation');
select is((select upkeep || ':' || non_operating || ':' || cash_change from public.my_income_statement_by_season),
  '-1004:7000:5996', 'de même par saison');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000724ab", "role": "authenticated"}', true);
select is((select string_agg(status, ' ') from public.my_loans), 'repaid', 'Bob lit son seul prêt');
select is((select count(*)::integer from game.loans where borrower_house_id = '00000000-0000-7000-8000-0000000724a1'), 0,
  'aucun prêt d''Alice');
select is((select count(*)::integer from game.loan_repayments where house_id = '00000000-0000-7000-8000-0000000724a1'), 0,
  'ni ses remboursements');
select is((select string_agg(nature || ':' || amount, ' ' order by nature) from public.my_cash_flows),
  'grant:1000 interest:-1', 'ses flux, sans ceux d''Alice ; son principal remboursé s''annule');
select throws_ok($$insert into game.loan_repayments (world_id, loan_id, house_id, interest, principal, game_day, ledger_entry_id)
  select world_id, id, borrower_house_id, 0, 1, 201, disbursement_entry_id from game.loans$$, '42501', null,
  'un joueur ne rembourse pas par la table');
select throws_ok($$update game.loans set outstanding = 0$$, '42501', null, 'ni ne change un prêt');
select throws_ok($$select * from game.house_wealth()$$, '42501', null, 'ni ne lit la fortune');
select is((select policy_rate_bps || ':' || term_days::text from public.temple_treasury_rules), '1000:[7, 365]',
  'il lit le taux directeur et les durées admises');
select is((select principal_caps -> 1 ->> 'maxPrincipal' from public.temple_treasury_rules), '90000', 'et les paliers de Timè');
reset role;
set local role anon;
select throws_ok('select * from public.my_loans', '42501', null, 'un visiteur anonyme ne lit aucun prêt');
select throws_ok('select * from public.temple_treasury_rules', '42501', null, 'ni les règles du temple');
select throws_ok('select * from game.temple_treasury_rules()', '42501', null, 'ni par la fonction');
reset role;

-- Une version en vigueur sans section `templeTreasury` : le temple ne prête pas, ses règles n'ont aucune ligne.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c725', '{}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c725', now());
set local role authenticated;
select is((select count(*)::integer from public.temple_treasury_rules), 0, 'sans section, aucune règle du temple');
reset role;

select * from finish();
rollback;
