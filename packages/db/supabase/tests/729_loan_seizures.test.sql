begin;
select plan(60);

-- Jeu d'essai : un monde à lui, deux cités, Pella et Dion. Alice (a) tient la banque, 20 000 oboles au coffre et 100 en
-- trésorerie ; Bob (b), 100 olives à Pella dont 10 offertes à la vente, et Chloé (c), 20 olives à Pella, empruntent sur
-- leurs olives ; Démétrios (d) emprunte sur l'un de ses deux logements de Pella, loués à Chloé et à Alice. Configuration :
-- l'horloge, et une marque de déshonneur de 28 jours.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000729f1', 'saisies-729', 'Saisies');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000729c2', '01900000-0000-7000-8000-0000000729f1', 'p729', 'Pella'),
  ('01900000-0000-7000-8000-0000000729c3', '01900000-0000-7000-8000-0000000729f1', 'd729', 'Dion');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000729b' || n)::uuid, 'seize-729-' || n || '@example.test' from unnest(array['a', 'b', 'c', 'd']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000729' || n || '2')::uuid, '01900000-0000-7000-8000-0000000729f1',
       ('00000000-0000-4000-8000-0000000729b' || n)::uuid, name, '{}', 'player'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Kerykes'), ('d', 'Eumolpides')) h (n, name);
insert into game.citizenships (house_id, city_id)
select id, '01900000-0000-7000-8000-0000000729c2' from game.houses where world_id = '01900000-0000-7000-8000-0000000729f1';
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000729f1';
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c729',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
    "templeTreasury": {"policyRateBps": 0, "termDays": [30], "principalCaps": [], "dishonorDays": 28}}');
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
create function pg_temp.olives(n text, city text = 'c2') returns text language sql as $$
  select quantity || '/' || reserved from game.inventories
  where house_id = pg_temp.house(n) and good_id = 'olives' and city_id = ('01900000-0000-7000-8000-0000000729' || city)::uuid
$$;
create function pg_temp.inventory(n text, city text = 'c2', good text = 'olives') returns uuid language sql as $$
  select id from game.inventories
  where house_id = pg_temp.house(n) and good_id = good and city_id = ('01900000-0000-7000-8000-0000000729' || city)::uuid
$$;
-- Prêt de la banque à `n`, gagé sur `quantity` olives à Pella ou sur le logement `property`, écrit comme l'écrit
-- `loan.acceptOffer`.
create function pg_temp.lend(n text, principal bigint, quantity bigint, property uuid = null) returns uuid
language plpgsql as $$
declare offer uuid; entry uuid; loan uuid;
begin
  insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days, collateral_kind,
    collateral_city_id, collateral_good_id, collateral_quantity, collateral_property_id)
  select '01900000-0000-7000-8000-0000000729f1', pg_temp.bank(), pg_temp.house(n), principal, 1200, 30, kind,
    case kind when 'stock' then '01900000-0000-7000-8000-0000000729c2'::uuid end, case kind when 'stock' then 'olives' end,
    case kind when 'stock' then quantity end, property
  from (select case when property is null then 'stock' else 'property' end as kind) k returning id into offer;
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
-- Mouvement de `quantity` olives (ou `good`) d'un stock à un autre, au nom du service (`kind`, écriture et saisie liées).
create function pg_temp.move(src uuid, dst uuid, quantity bigint, kind text = 'test', entry uuid = null, seizure uuid = null,
  good text = 'olives') returns void language sql as $$
  select pg_temp.as_service(format('insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id,
    to_inventory_id, kind, ledger_entry_id, loan_seizure_id) values (%L, %L, %s, %L, %L, %L, %L, %L)',
    '01900000-0000-7000-8000-0000000729f1', good, quantity, src, dst, kind, entry, seizure))
$$;
create function pg_temp.world_olives() returns bigint language sql as $$
  select sum(quantity)::bigint from game.inventories where world_id = '01900000-0000-7000-8000-0000000729f1'
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
select '01900000-0000-7000-8000-0000000729f1', pg_temp.house(n), c, 'olives'
from unnest(array['b', 'c']) n, unnest(array['01900000-0000-7000-8000-0000000729c2', '01900000-0000-7000-8000-0000000729c3']::uuid[]) c;
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
select throws_ok($$select pg_temp.seize('b', pg_temp.today() + 30)$$, '23001', 'a bank loan is seized once due', 'ni avant son heure');
select pg_temp.age(n) from unnest(array['b', 'c']) n;
select throws_ok($$select pg_temp.seize('b', pg_temp.today() - 4)$$, '23001', 'a bank loan is seized once due',
  'ni pour un jour d''avant l''échéance');
select throws_ok($$select pg_temp.seize('b')$$, '23001', 'a bank loan is seized once the collection has emptied the treasury',
  'pas tant que la trésorerie couvre une part du reste dû');
select pg_temp.drain(n) from unnest(array['b', 'c']) n;
create temporary table before_seizure as select pg_temp.money() as money, pg_temp.world_olives() as olives;
select throws_ok($$select pg_temp.as_service(format('insert into game.loan_seizures (world_id, loan_id, game_day,
  bank_house_id) values (%L, %L, %s, %L)', '01900000-0000-7000-8000-0000000729f1', (pg_temp.loan('b')).id, pg_temp.today(),
  pg_temp.house('c')))$$, '42501', null, 'le service ne choisit pas la maison qui reçoit la garantie');
select lives_ok($$select pg_temp.seize('b')$$, 'échu, non soldé, trésorerie vide : la garantie est saisie');
select is((select status || ':' || outstanding || ':' || written_off || ':' || (defaulted_day = pg_temp.today())
  from game.loans where id = (pg_temp.loan('b')).id), 'repaid:0:1010:true',
  'la saisie fait passer le prêt en défaut ce jour-là et le solde, son reste dû remis');
select is((select borrower_house_id = pg_temp.house('b') and bank_house_id = pg_temp.house('a') and created_at = now()
  from game.loan_seizures), true, 'la base y pose l''emprunteur et la maison de la banque');
select is(pg_temp.olives('b') || ' ' || pg_temp.olives('a'), '60/10 40/0',
  'les 40 olives gagées passent au stock de la maison de la banque ; la vente en attente garde sa réservation');
select results_eq($$select kind, from_inventory_id = pg_temp.inventory('b'), loan_seizure_id is not null
  from game.stock_ledger where to_inventory_id = pg_temp.inventory('a')$$, $$values ('bank.loan_seize', true, true)$$,
  'par un mouvement du journal des stocks rattaché à la saisie');
select is((select count(*) from game.inventory_quantity_check
  where world_id = '01900000-0000-7000-8000-0000000729f1' and not ok), 0::bigint, 'chaque stock reste le cumul de son journal');
select is((select pg_temp.world_olives() = olives and pg_temp.money() = money from before_seizure), true,
  'la saisie ne crée ni ne détruit ni olive ni obole');
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

-- 2. Un stock ne change de maison que par un échange ou une saisie, qui ne remet que son stock gagé, une fois ; seule une
-- saisie remet un reste dû.
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('c'), 5)$$, '23514',
  'a stock changes hands only by a trade or a loan seizure', 'un stock ne passe pas d''une maison à une autre sans échange');
select lives_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('b', 'c3'), 5)$$,
  'd''un stock à un autre de la même maison, rien ne change de main');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a'), 40, 'bank.loan_seize', null,
  (select id from game.loan_seizures))$$, '23505', null, 'une saisie ne livre qu''une fois');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a'), 41, 'bank.loan_seize', null,
  (select id from game.loan_seizures))$$, '23514', 'a stock changes hands only by a trade or a loan seizure',
  'ni autre chose que son stock gagé');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('c'), 5, 'market.trade',
  (select disbursement_entry_id from game.loans where id = (pg_temp.loan('b')).id))$$, '23514',
  'a stock changes hands only by a trade or a loan seizure', 'un mouvement d''échange suit l''écriture d''un échange');
select throws_ok($$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-0000000729f1', 'olives', 5, 'production', pg_temp.inventory('a'), 'bank.loan_seize')$$,
  '23514', null, 'un mouvement de saisie est rattaché à sa saisie');
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

-- 3. Saisie d'un logement : il passe à la maison de la banque avec son bail en cours, dont elle devient le bailleur.
-- Deux logements de Démétrios, nés gardes levées (les achats ont leurs propres tests).
set local session_replication_role = replica;
insert into game.properties (world_id, city_id, size_id, lot, owner_house_id, acquired_at)
select '01900000-0000-7000-8000-0000000729f1', '01900000-0000-7000-8000-0000000729c2', 'townhouse', n, pg_temp.house('d'),
  now() - interval '1 day' from generate_series(1, 2) n;
set local session_replication_role = origin;
create function pg_temp.property(lot int) returns uuid language sql as $$
  select id from game.properties where world_id = '01900000-0000-7000-8000-0000000729f1' and lot = $1
$$;
-- Le logement `lot` de Démétrios loué à `n`, 5 oboles par jour, comme l'écrivent `property.offerLease` et `property.lease`.
create function pg_temp.lease_to(lot int, n text) returns void language plpgsql as $$
declare listing uuid;
begin
  insert into game.property_listings (world_id, property_id, house_id, kind, price_oboles)
  values ('01900000-0000-7000-8000-0000000729f1', pg_temp.property(lot), pg_temp.house('d'), 'lease', 5) returning id into listing;
  insert into game.leases (world_id, property_id, listing_id, landlord_house_id, tenant_house_id, rent_oboles)
  values ('01900000-0000-7000-8000-0000000729f1', pg_temp.property(lot), listing, pg_temp.house('d'), pg_temp.house(n), 5);
  update game.property_listings set outcome = 'leased' where id = listing;
end $$;
select pg_temp.lease_to(1, 'c'), pg_temp.lease_to(2, 'a');
select throws_ok($$select pg_temp.lend('d', 300, null, pg_temp.property(2))$$, '23514',
  'a bank loan pledges collateral its borrower holds free', 'un logement loué à la maison de la banque ne la garantit pas');
select pg_temp.lend('d', 300, null, pg_temp.property(1));
select lives_ok('select game.check_no_pledge_leased_to_lender()', 'un gage loué à une autre maison que la banque laisse passer 0602');
select pg_temp.age('d');
select pg_temp.drain('d');
select throws_ok($$select pg_temp.as_service(format('update game.leases set landlord_house_id = %L where property_id = %L',
  pg_temp.house('a'), pg_temp.property(1)))$$, '42501', null, 'le service ne change pas le bailleur d''un bail');
select throws_ok($$update game.leases set landlord_house_id = pg_temp.house('a') where property_id = pg_temp.property(1)$$,
  '23001', 'a lease changes landlord only with the seizure of its property', 'un bail ne change de bailleur que par la saisie');
select lives_ok($$select pg_temp.seize('d')$$, 'le logement gagé et loué est saisi');
select is((select owner_house_id = pg_temp.house('a') and acquired_at = now() from game.properties where id = pg_temp.property(1)),
  true, 'il passe à la maison de la banque, à l''instant de la saisie');
select results_eq($$select landlord_house_id = pg_temp.house('a'), tenant_house_id = pg_temp.house('c'), rent_oboles, ended_at
  from game.leases where property_id = pg_temp.property(1)$$, $$values (true, true, 5::bigint, null::timestamptz)$$,
  'son bail court toujours, au même loyer, la maison de la banque pour bailleur');
select is((pg_temp.loan('d')).status || ':' || (pg_temp.loan('d')).written_off, 'repaid:303', 'la saisie solde le prêt');
select throws_ok($$update game.properties set owner_house_id = pg_temp.house('c') where id = pg_temp.property(1)$$, '23001',
  'a leased property does not change hands', 'la saisie ne remet le logement qu''à la maison de la banque');
select throws_ok($$update game.leases set landlord_house_id = pg_temp.house('c') where property_id = pg_temp.property(1)$$,
  '23001', 'a lease changes landlord only with the seizure of its property', 'ni son bail');

-- 4. Timè perdue et marque de déshonneur : un prêt saisi est en défaut et soldé le jour de sa saisie.
create function pg_temp.honor(n text, p_day int = null) returns void language sql as $$
  select pg_temp.as_service(format('insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day)
    values (%L, %L, -40, ''loan_defaulted'', %L, %s)', '01900000-0000-7000-8000-0000000729f1', pg_temp.house(n),
    (pg_temp.loan(n)).id, coalesce(p_day, pg_temp.today())))
$$;
select lives_ok($$select pg_temp.honor('b')$$, 'Bob perd la Timè d''un défaut le jour de la saisie');
select throws_ok($$select pg_temp.honor('d', pg_temp.today() + 1)$$, '23001',
  'a defaulted loan is charged to its borrower the day it defaults', 'pas un autre jour');
select throws_ok($$select pg_temp.honor('c')$$, '23001', 'a defaulted loan is charged to its borrower the day it defaults',
  'ni pour un prêt en cours');
-- Marques lues par Chloé (`house_honor`) : maison, jours restants à compter de `today`.
create function pg_temp.marks(today int) returns text language plpgsql as $$
declare marks text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000729bc')::text, true);
  perform set_config('role', 'authenticated', true);
  select string_agg(right(house_id::text, 2) || ':' || (dishonored_until_day - today), ' ' order by house_id) into marks
  from public.house_honor where dishonored;
  perform set_config('role', 'none', true);
  return marks;
end $$;
select is(pg_temp.marks(pg_temp.today()), 'b2:28 d2:28', 'Bob et Démétrios, saisis, sont marqués 28 jours après la saisie');

-- 5. Lectures : aucun joueur, ni l'emprunteur ni la banque, ne lit ni n'écrit une saisie.
select throws_ok($$select pg_temp.as_player('b', 'select count(*) from game.loan_seizures')$$, '42501', null,
  'l''emprunteur ne lit pas les saisies');
select throws_ok($$select pg_temp.as_player('c', 'select count(*) from game.loan_seizures')$$, '42501', null,
  'une autre maison non plus');
select throws_ok($$select pg_temp.as_player('a', format('insert into game.loan_seizures (world_id, loan_id, game_day)
  values (%L, %L, %s)', '01900000-0000-7000-8000-0000000729f1', (pg_temp.loan('c')).id, pg_temp.today()))$$, '42501', null,
  'ni la maison de la banque n''en écrit');

-- 6. La clôture du jour enregistrée, la saisie valide avec elle ; ensuite, plus de saisie pour ce jour.
select pg_temp.as_service(format('insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values (%L, %s, %L, %L)', '01900000-0000-7000-8000-0000000729f1', pg_temp.today(), pg_temp.close_at(pg_temp.today()),
  '00000000-0000-7000-8000-00000000c729'));
select lives_ok('set constraints all immediate', 'la saisie valide avec la clôture de son jour');
set constraints all deferred;
select throws_ok($$select pg_temp.seize('c')$$, '23001', 'a bank loan is seized before its close is recorded',
  'une clôture enregistrée ne saisit plus');
select is(pg_temp.olives('c'), '20/20', 'le stock de Chloé reste gagé');

-- 7. Un échange de l'agora livre une fois, du vendeur à l'acheteur de son écriture.
create temporary table trade_entry as select pg_temp.entry('market.trade', pg_temp.treasury('a'), pg_temp.treasury('b'), 35) as id;
insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining)
values ('01900000-0000-7000-8000-0000000729f1', '01900000-0000-7000-8000-0000000729c2', pg_temp.house('a'), 'olives', 'buy',
        7, 5, 5);
insert into game.trades (world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id)
select '01900000-0000-7000-8000-0000000729f1', s.id, b.id, 7, 5, (select id from trade_entry)
from game.orders s, game.orders b
where s.house_id = pg_temp.house('b') and s.side = 'sell' and b.house_id = pg_temp.house('a') and b.side = 'buy';
-- Témoins : un stock d'olives d'Alice à Dion, un stock de blé de Bob et d'Alice à Pella, 5 blés à Bob, 5 olives libres à Chloé.
insert into game.inventories (world_id, house_id, city_id, good_id)
select '01900000-0000-7000-8000-0000000729f1', pg_temp.house(n), ('01900000-0000-7000-8000-0000000729' || c)::uuid, g
from (values ('a', 'c3', 'olives'), ('a', 'c2', 'wheat'), ('b', 'c2', 'wheat')) v (n, c, g);
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
values ('01900000-0000-7000-8000-0000000729f1', 'wheat', 5, 'production', pg_temp.inventory('b', 'c2', 'wheat'), 'test'),
       ('01900000-0000-7000-8000-0000000729f1', 'olives', 5, 'production', pg_temp.inventory('c'), 'test');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('c'), 5, 'market.trade',
  (select id from trade_entry))$$, '23514', 'a stock changes hands only by a trade or a loan seizure',
  'un échange ne livre pas à une autre maison que son acheteur');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a'), 5, 'market.trade',
  (select disbursement_entry_id from game.loans where id = (pg_temp.loan('b')).id))$$, '23514',
  'a stock changes hands only by a trade or a loan seizure', 'ni par l''écriture d''un autre que lui');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a'), 4, 'market.trade',
  (select id from trade_entry))$$, '23514', 'a stock changes hands only by a trade or a loan seizure',
  'ni une autre quantité');
select throws_ok($$select pg_temp.move(pg_temp.inventory('c'), pg_temp.inventory('a'), 5, 'market.trade',
  (select id from trade_entry))$$, '23514', 'a stock changes hands only by a trade or a loan seizure',
  'ni depuis le stock d''une autre maison que son vendeur');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b', 'c3'), pg_temp.inventory('a'), 5, 'market.trade',
  (select id from trade_entry))$$, '23514', 'a stock changes hands only by a trade or a loan seizure',
  'ni depuis le stock du vendeur dans une autre cité que celle de son ordre');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a', 'c3'), 5, 'market.trade',
  (select id from trade_entry))$$, '23514', 'a stock changes hands only by a trade or a loan seizure',
  'ni vers le stock de l''acheteur dans une autre cité que celle de son ordre');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b', 'c2', 'wheat'), pg_temp.inventory('a', 'c2', 'wheat'), 5,
  'market.trade', (select id from trade_entry), null, 'wheat')$$, '23514', 'a stock changes hands only by a trade or a loan seizure',
  'ni un autre bien');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a'), 5, 'test', (select id from trade_entry))$$,
  '23514', 'a stock changes hands only by a trade or a loan seizure', 'ni par un mouvement d''un autre type');
select lives_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a'), 5, 'market.trade',
  (select id from trade_entry))$$, 'l''échange livre le vendeur à l''acheteur');
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a'), 5, 'market.trade',
  (select id from trade_entry))$$, '23505', null, 'une fois');

-- 8. Une saisie ne remet que de l'emprunteur à la maison de la banque, et dans sa transaction. Le logement de Démétrios
-- lui revient et le gage de Chloé passe sur son logement 2, loué à Alice, gardes levées.
set local session_replication_role = replica;
update game.properties set owner_house_id = pg_temp.house('d') where id = pg_temp.property(1);
update game.bank_loan_offers set collateral_kind = 'property', collateral_city_id = null, collateral_good_id = null,
  collateral_quantity = null, collateral_property_id = pg_temp.property(2) where id = (pg_temp.loan('c')).offer_id;
set local session_replication_role = origin;
select throws_ok('select game.check_no_pledge_leased_to_lender()', '23514', format('bank loan %s is pledged on a property '
  || 'leased to its bank: review it before migration 0602', (pg_temp.loan('c')).id), 'elle s''arrête sinon, en le disant');
select throws_ok($$update game.properties set owner_house_id = pg_temp.house('c') where id = pg_temp.property(1)$$, '23001',
  'a leased property does not change hands', 'la saisie ne remet pas le logement à une autre maison que la banque');
set local session_replication_role = replica;
update game.properties set owner_house_id = pg_temp.house('c') where id = pg_temp.property(1);
set local session_replication_role = origin;
select throws_ok($$update game.properties set owner_house_id = pg_temp.house('a') where id = pg_temp.property(1)$$, '23001',
  'a leased property does not change hands', 'ni d''une autre maison que l''emprunteur');
-- Les saisies, reculées d'un jour, gardes levées ; le logement revient à Démétrios.
set local session_replication_role = replica;
update game.loan_seizures set created_at = now() - interval '1 day';
update game.properties set owner_house_id = pg_temp.house('d') where id = pg_temp.property(1);
set local session_replication_role = origin;
select throws_ok($$select pg_temp.move(pg_temp.inventory('b'), pg_temp.inventory('a'), 40, 'bank.loan_seize', null,
  (select id from game.loan_seizures where loan_id = (pg_temp.loan('b')).id))$$, '23514',
  'a stock changes hands only by a trade or a loan seizure', 'une saisie ancienne ne remet plus de stock');
select throws_ok($$select pg_temp.as_service(format('update game.properties set owner_house_id = %L where id = %L',
  pg_temp.house('a'), pg_temp.property(1)))$$, '23001', 'a leased property does not change hands', 'ni le logement');
select throws_ok($$update game.leases set landlord_house_id = pg_temp.house('d') where property_id = pg_temp.property(1)$$,
  '23001', 'a lease changes landlord only with the seizure of its property', 'ni son bail');

select * from finish();
rollback;
