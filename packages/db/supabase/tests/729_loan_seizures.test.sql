begin;
select plan(21);

-- Jeu d'essai : un monde à lui, une cité, Pella. Alice (a) tient la banque, 20 000 oboles au coffre et 100 en trésorerie ;
-- Bob (b), 100 olives dont 10 offertes à la vente, et Chloé (c), 20 olives, empruntent sur leurs olives. Configuration :
-- l'horloge.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000729f1', 'saisies-729', 'Saisies');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000729c2', '01900000-0000-7000-8000-0000000729f1', 'p729', 'Pella');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000729b' || n)::uuid, 'seize-729-' || n || '@example.test' from unnest(array['a', 'b', 'c']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000729' || n || '2')::uuid, '01900000-0000-7000-8000-0000000729f1',
       ('00000000-0000-4000-8000-0000000729b' || n)::uuid, name, '{}', 'player'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Kerykes')) h (n, name);
insert into game.citizenships (house_id, city_id)
select id, '01900000-0000-7000-8000-0000000729c2' from game.houses where world_id = '01900000-0000-7000-8000-0000000729f1';
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000729f1';
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c729',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c729', now());
insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
values ('01900000-0000-7000-8000-0000000729f1', '01900000-0000-7000-8000-0000000729c2', '00000000-0000-7000-8000-0000000729a2',
        'Trapeza Alkmaion', 100, 800, 0);

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000729' || n || '2')::uuid
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
-- Au nom du service, sans valider les contrôles différés : la saisie attend la clôture de son jour.
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.as_player(n text, statement text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000729b' || n)::text, true);
  perform set_config('role', 'authenticated', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- `amount` oboles du compte `src` au compte `dst`, par une écriture `kind` (méta : la banque) ; rend son identifiant.
create function pg_temp.entry(kind text, src uuid, dst uuid, amount bigint) returns uuid language plpgsql as $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000729f1', kind, jsonb_build_object('bankId', pg_temp.bank())) returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, dst, amount), (entry, src, -amount);
  return entry;
end $$;
create function pg_temp.olives(n text) returns text language sql as $$
  select quantity || '/' || reserved from game.inventories where house_id = pg_temp.house(n) and good_id = 'olives'
$$;
create function pg_temp.inventory(n text) returns uuid language sql as $$
  select id from game.inventories where house_id = pg_temp.house(n) and good_id = 'olives'
$$;
-- Prêt de la banque à `n`, gagé sur `quantity` olives à Pella, écrit comme l'écrit `loan.acceptOffer`.
create function pg_temp.lend(n text, principal bigint, quantity bigint) returns uuid language plpgsql as $$
declare offer uuid; entry uuid; loan uuid;
begin
  insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days, collateral_kind,
    collateral_city_id, collateral_good_id, collateral_quantity)
  values ('01900000-0000-7000-8000-0000000729f1', pg_temp.bank(), pg_temp.house(n), principal, 1200, 30, 'stock',
    '01900000-0000-7000-8000-0000000729c2', 'olives', quantity) returning id into offer;
  entry := pg_temp.entry('bank.loan_disburse', pg_temp.vault_id(), pg_temp.treasury(n), principal);
  insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day,
    due_day, due_at, disbursement_entry_id, bank_id, offer_id)
  values ('01900000-0000-7000-8000-0000000729f1', 'bank', pg_temp.house(n), principal, 1200, 30,
    ceil(principal::numeric * 1200 * 30 / 3650000), pg_temp.today(), pg_temp.today() + 30,
    pg_temp.close_at(pg_temp.today() + 30), entry, pg_temp.bank(), offer) returning id into loan;
  return loan;
end $$;
create function pg_temp.loan(n text) returns game.loans language sql as $$ select * from game.loans where borrower_house_id = pg_temp.house(n) $$;
-- Recule le prêt de `n` pour qu'il soit échu depuis trois jours, gardes levées.
create function pg_temp.age(n text) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  update game.loans set borrowed_day = pg_temp.today() - 33, due_day = pg_temp.today() - 3,
    due_at = pg_temp.close_at(pg_temp.today() - 3), created_at = now() - interval '34 days'
  where borrower_house_id = pg_temp.house(n);
  set local session_replication_role = origin;
end $$;
-- Vide la trésorerie de `n` vers le robinet de départ, comme l'aurait fait le prélèvement de l'échéance.
create function pg_temp.drain(n text) returns void language plpgsql as $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000729f1', 'test.drain')
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, a.id, case when a.kind = 'house' then -t.balance else t.balance end
  from game.accounts a, game.accounts t
  where t.id = pg_temp.treasury(n) and (a.id = t.id or (a.world_id = '01900000-0000-7000-8000-0000000729f1'
    and a.system_key = 'faucet_starting_grant'));
end $$;
create function pg_temp.seize(n text, p_day int = null) returns void language sql as $$
  select pg_temp.as_service(format('insert into game.loan_seizures (world_id, loan_id, game_day) values (%L, %L, %s)',
    '01900000-0000-7000-8000-0000000729f1', (pg_temp.loan(n)).id, coalesce(p_day, pg_temp.today())))
$$;
create function pg_temp.money() returns bigint language sql as $$
  select sum(balance)::bigint from game.accounts where world_id = '01900000-0000-7000-8000-0000000729f1' and system_key is null
$$;

do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000729f1', 'house.starting_grant')
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then 20100 else -20100 end from game.accounts
  where house_id = pg_temp.house('a') or (world_id = '01900000-0000-7000-8000-0000000729f1' and system_key = 'faucet_starting_grant');
  perform pg_temp.entry('bank.capital_in', pg_temp.treasury('a'), pg_temp.vault_id(), 20000);
end $$;
insert into game.inventories (world_id, house_id, city_id, good_id)
select '01900000-0000-7000-8000-0000000729f1', pg_temp.house(n), '01900000-0000-7000-8000-0000000729c2', 'olives'
from unnest(array['b', 'c']) n;
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
values ('01900000-0000-7000-8000-0000000729f1', 'olives', 100, 'production', pg_temp.inventory('b'), 'test'),
       ('01900000-0000-7000-8000-0000000729f1', 'olives', 20, 'production', pg_temp.inventory('c'), 'test');
insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining)
values ('01900000-0000-7000-8000-0000000729f1', '01900000-0000-7000-8000-0000000729c2', pg_temp.house('b'), 'olives', 'sell',
        7, 10, 10);
select pg_temp.lend('b', 1000, 40);
select pg_temp.lend('c', 500, 20);
set constraints all immediate;
set constraints all deferred;

-- 1. La saisie : un prêt de banque échu, encore dû, dont le prélèvement a vidé la trésorerie.
select throws_ok($$select pg_temp.seize('b')$$, '23001', 'a bank loan is seized once due', 'pas avant l''échéance');
select pg_temp.age(n) from unnest(array['b', 'c']) n;
select throws_ok($$select pg_temp.seize('b', pg_temp.today() - 4)$$, '23001', 'a bank loan is seized once due',
  'ni pour un jour d''avant l''échéance');
select throws_ok($$select pg_temp.seize('b')$$, '23001', 'a bank loan is seized once the collection has emptied the treasury',
  'pas tant que la trésorerie couvre une part du reste dû');
select pg_temp.drain(n) from unnest(array['b', 'c']) n;
create temporary table before_seizure as select pg_temp.money() as money;
select throws_ok($$select pg_temp.as_service(format('insert into game.loan_seizures (world_id, loan_id, game_day,
  bank_house_id) values (%L, %L, %s, %L)', '01900000-0000-7000-8000-0000000729f1', (pg_temp.loan('b')).id, pg_temp.today(),
  pg_temp.house('c')))$$, '42501', null, 'le service ne choisit pas la maison qui reçoit la garantie');
select lives_ok($$select pg_temp.seize('b')$$, 'échu, non soldé, trésorerie vide : la garantie est saisie');
select is((select status || ':' || outstanding || ':' || written_off || ':' || (defaulted_day = pg_temp.today())
  from game.loans where id = (pg_temp.loan('b')).id), 'repaid:0:1010:true',
  'la saisie fait passer le prêt en défaut ce jour-là et le solde, son reste dû remis');
select is((select borrower_house_id = pg_temp.house('b') and bank_house_id = pg_temp.house('a') and created_at = now()
  from game.loan_seizures), true, 'la base y pose l''emprunteur et la maison de la banque');
select is(pg_temp.olives('b'), '100/10', 'les 40 olives gagées se libèrent ; la vente en attente garde sa réservation');
select is((select pg_temp.money() = money from before_seizure), true, 'la saisie ne crée ni ne détruit d''obole');
select throws_ok($$select pg_temp.seize('b')$$, '23001', 'a seizure settles an outstanding bank loan',
  'un prêt soldé ne se saisit pas deux fois');
-- Prêt du temple d'Alice, de 100 oboles pour 30 jours, échu : il passe en défaut, il ne se saisit pas.
with entry as (insert into game.ledger_entries (world_id, kind)
    values ('01900000-0000-7000-8000-0000000729f1', 'loan.temple_disburse') returning id),
  lines as (insert into game.ledger_lines (entry_id, account_id, amount) select entry.id, a.id, case a.kind when 'house'
    then 100 else -100 end from entry, game.accounts a where a.id = pg_temp.treasury('a') or (a.system_key = 'faucet_temple_loans'
    and a.world_id = '01900000-0000-7000-8000-0000000729f1'))
insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day, due_day,
  due_at, disbursement_entry_id) select '01900000-0000-7000-8000-0000000729f1', 'temple', pg_temp.house('a'), 100, 0, 30, 0,
  pg_temp.today(), pg_temp.today() + 30, pg_temp.close_at(pg_temp.today() + 30), entry.id from entry;
select pg_temp.age('a');
select throws_ok($$select pg_temp.seize('a')$$, '23001', 'a seizure settles an outstanding bank loan',
  'un prêt du temple ne se saisit pas');
select throws_ok($$update game.loan_seizures set game_day = game_day + 1$$, '23001', 'a seizure does not change',
  'une saisie ne change pas');
select throws_ok($$delete from game.loan_seizures$$, '23001', null, 'ni ne se supprime');
select throws_ok('set constraints game.loan_seizures_on_close immediate', '23503', null,
  'à la validation, la clôture de son jour est enregistrée');
set constraints all deferred;

-- 2. Seule une saisie remet un reste dû.
-- Même le propriétaire, par un déclencheur, ne remet pas le reste dû d'un prêt sans sa saisie.
create temporary table forged (loan uuid);
create function pg_temp.write_off() returns trigger language plpgsql as $$
begin
  update game.loans set status = 'repaid', defaulted_day = pg_temp.today(), written_off = outstanding, outstanding = 0
  where id = new.loan;
  return null;
end $$;
create trigger forged after insert on forged for each row execute function pg_temp.write_off();
select throws_ok($$insert into forged select (pg_temp.loan('c')).id$$, '23001',
  'a loan defaults with its seizure, or keeps the day of its default', 'un reste dû ne se remet que par une saisie');

-- 3. Lectures : aucun joueur, ni l'emprunteur ni la banque, ne lit ni n'écrit une saisie.
select throws_ok($$select pg_temp.as_player('b', 'select count(*) from game.loan_seizures')$$, '42501', null,
  'l''emprunteur ne lit pas les saisies');
select throws_ok($$select pg_temp.as_player('c', 'select count(*) from game.loan_seizures')$$, '42501', null,
  'une autre maison non plus');
select throws_ok($$select pg_temp.as_player('a', format('insert into game.loan_seizures (world_id, loan_id, game_day)
  values (%L, %L, %s)', '01900000-0000-7000-8000-0000000729f1', (pg_temp.loan('c')).id, pg_temp.today()))$$, '42501', null,
  'ni la maison de la banque n''en écrit');

-- 4. La clôture du jour enregistrée, la saisie valide avec elle ; ensuite, plus de saisie pour ce jour.
select pg_temp.as_service(format('insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values (%L, %s, %L, %L)', '01900000-0000-7000-8000-0000000729f1', pg_temp.today(), pg_temp.close_at(pg_temp.today()),
  '00000000-0000-7000-8000-00000000c729'));
select lives_ok('set constraints all immediate', 'la saisie valide avec la clôture de son jour');
set constraints all deferred;
select throws_ok($$select pg_temp.seize('c')$$, '23001', 'a bank loan is seized before its close is recorded',
  'une clôture enregistrée ne saisit plus');
select is(pg_temp.olives('c'), '20/20', 'le stock de Chloé reste gagé');

select * from finish();
rollback;
