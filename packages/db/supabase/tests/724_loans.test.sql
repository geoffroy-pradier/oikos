begin;
select plan(24);

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
create function pg_temp.loan(n text) returns uuid language sql as $$
  select id from game.loans where borrower_house_id = pg_temp.house(n) order by created_at desc, id desc limit 1
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

select * from finish();
rollback;
