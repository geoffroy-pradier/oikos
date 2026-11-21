begin;
select plan(59);

-- Jeu d'essai : un monde à lui, une cité. Alice (a) fonde la banque, taux de dépôt de 10 % l'an, 1 000 oboles de capital ;
-- Bob (b) et Chloé (c) déposent ; les Greniers (e) sont une maison PNJ. Trésoreries : 50 000 chacune. Configuration en
-- vigueur : l'horloge, qui date les jours de jeu et les clôtures.
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
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
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
create function pg_temp.vault() returns bigint language sql as $$
  select balance from game.accounts where bank_id = pg_temp.bank()
$$;
create function pg_temp.cash(n text) returns bigint language sql as $$
  select balance from game.accounts where kind = 'house' and house_id = pg_temp.house(n)
$$;
-- Écriture de banque au nom du service : `kind`, de `amount` oboles de la trésorerie de `src` (ou du coffre, `vault`) à
-- celle de `dst` ; son mouvement `movement` (aucun si nul) pour le dépôt de `n`, de `moved` oboles ; contrôles différés
-- joués aussitôt.
create function pg_temp.post(p_kind text, src text, dst text, amount bigint, n text = null, movement text = null,
  moved bigint = null) returns void language plpgsql as $$
declare entry uuid; deposit uuid; bank uuid := pg_temp.bank(); depositor uuid := pg_temp.house(n);
  acc_src uuid := case when src = 'vault' then (select id from game.accounts where bank_id = pg_temp.bank())
                       else (select id from game.accounts where kind = 'house' and house_id = pg_temp.house(src)) end;
  acc_dst uuid := case when dst = 'vault' then (select id from game.accounts where bank_id = pg_temp.bank())
                       else (select id from game.accounts where kind = 'house' and house_id = pg_temp.house(dst)) end;
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000727f0', p_kind, jsonb_build_object('bankId', bank)) returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, acc_dst, amount), (entry, acc_src, -amount);
  if movement is not null then
    insert into game.bank_deposits (world_id, bank_id, house_id)
    values ('01900000-0000-7000-8000-0000000727f0', bank, depositor) on conflict do nothing;
    select id into deposit from game.bank_deposits where house_id = depositor;
    insert into game.bank_deposit_movements (world_id, deposit_id, bank_id, house_id, kind, amount, ledger_entry_id)
    values ('01900000-0000-7000-8000-0000000727f0', deposit, bank, depositor, movement, coalesce(moved, amount), entry);
  end if;
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
-- Lignes ajoutées après coup, au nom du service, à la dernière écriture `kind` de la banque déjà validée : `amount`
-- oboles de la trésorerie de `src` au coffre ; contrôles différés joués aussitôt.
create function pg_temp.append(p_kind text, src text, amount bigint) returns void language plpgsql as $$
declare entry uuid := (select e.id from game.ledger_entries e where e.kind = p_kind
                         and e.meta ->> 'bankId' = pg_temp.bank()::text order by e.created_at desc, e.id desc limit 1);
  vault uuid := (select id from game.accounts where bank_id = pg_temp.bank());
  payer uuid := (select id from game.accounts where kind = 'house' and house_id = pg_temp.house(src));
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, vault, amount), (entry, payer, -amount);
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
-- Dépôt ou retrait comme l'écrit la commande.
create function pg_temp.deposit(n text, amount bigint) returns void language sql as $$
  select pg_temp.post('bank.deposit', n, 'vault', amount, n, 'deposit')
$$;
create function pg_temp.withdraw(n text, amount bigint) returns void language sql as $$
  select pg_temp.post('bank.withdraw', 'vault', n, amount, n, 'withdraw')
$$;
create function pg_temp.held(n text) returns bigint language sql as $$
  select balance from game.bank_deposits where house_id = pg_temp.house(n)
$$;
create function pg_temp.today() returns int language sql as $$ select game.game_day_at(now()) $$;
-- Instant de la clôture qui ouvre le jour de jeu `d` (`dailyCloseAt`) : le premier quart d'heure de ce jour.
create function pg_temp.close_at(d int) returns timestamptz language sql as $$
  select min(t) from generate_series((date '1970-01-01' + d - 1)::timestamp at time zone 'UTC',
    (date '1970-01-01' + d + 2)::timestamp at time zone 'UTC', interval '15 minutes') t
  where game.game_day_at(t) >= d
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
-- Intérêt du jour `day` (aujourd'hui sinon) du dépôt de `n`, au nom du service, sans jouer les contrôles différés.
create function pg_temp.interest(n text, amount bigint, day int = null) returns void language plpgsql as $$
begin
  perform pg_temp.as_service(format('insert into game.bank_deposit_movements (world_id, deposit_id, bank_id, house_id,
      kind, amount, game_day) select world_id, id, bank_id, house_id, ''interest'', %s, %s from game.bank_deposits
    where house_id = %L', amount, coalesce(day, pg_temp.today()), pg_temp.house(n)));
end $$;

-- Droits : le service n'écrit ni identifiant, ni date, ni solde ; les joueurs n'écrivent rien.
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'bank_deposits' and privilege_type = 'INSERT'),
  'bank_id house_id world_id', 'le service ouvre un dépôt sans choisir ni son identifiant, ni sa date, ni son solde');
select ok(not has_table_privilege('authenticated', 'game.bank_deposits', 'insert,update,delete')
          and not has_table_privilege('anon', 'game.bank_deposits', 'select,insert,update,delete'),
  'les joueurs n''écrivent aucun dépôt');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'bank_deposit_movements'
     and privilege_type = 'INSERT'),
  'amount bank_id deposit_id game_day house_id kind ledger_entry_id world_id',
  'ni le taux, ni la date d''un mouvement');
select ok(not has_table_privilege('authenticated', 'game.bank_deposit_movements', 'select')
          and not has_table_privilege('anon', 'game.bank_deposit_movements', 'select'), 'les joueurs ne lisent pas les mouvements');

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

-- Dépôt et retrait : la monnaie passe de la trésorerie au coffre et revient ; la créance suit.
select lives_ok($$select pg_temp.post('bank.capital_in', 'a', 'vault', 1000)$$, 'Alice verse 1 000 de capital');
select lives_ok($$select pg_temp.deposit('b', 10000)$$, 'Bob dépose 10 000');
select is(array[pg_temp.cash('b'), pg_temp.vault(), pg_temp.held('b')], array[40000, 11000, 10000]::bigint[],
  'sa trésorerie baisse, le coffre monte, sa créance aussi');
select is(
  (select concat_ws(':', m.kind, m.amount, m.rate_bps, m.game_day = game.game_day_at(now()), m.created_at = now())
   from game.bank_deposit_movements m where m.house_id = pg_temp.house('b')),
  'deposit:10000:1000:t:t', 'la base date le mouvement et y écrit le taux affiché');
select lives_ok($$select pg_temp.withdraw('b', 3000)$$, 'Bob retire 3 000');
select is(array[pg_temp.cash('b'), pg_temp.vault(), pg_temp.held('b')], array[43000, 8000, 7000]::bigint[],
  'le retrait refait le chemin inverse');
select throws_ok($$select pg_temp.withdraw('b', 7001)$$, '23514', null, 'pas au-delà du solde du dépôt');
select lives_ok($$select pg_temp.post('bank.capital_out', 'vault', 'a', 8000)$$, 'Alice vide le coffre');
select throws_ok($$select pg_temp.withdraw('b', 1)$$, '23514', null,
  'un retrait que le coffre ne couvre pas est refusé : la ruée est possible');
select lives_ok($$select pg_temp.post('bank.capital_in', 'a', 'vault', 8000)$$, 'Alice remet son capital');
select lives_ok($$select pg_temp.withdraw('b', 7000)$$, 'Bob retire tout');
select is(pg_temp.held('b'), 0::bigint, 'un dépôt soldé reste, à zéro');
select lives_ok($$select pg_temp.deposit('b', 7000)$$, 'et se remplit de nouveau');

-- L'écriture et le mouvement s'accordent : montant, déposant, sens, banque ; deux lignes.
select throws_ok($$select pg_temp.post('bank.deposit', 'b', 'vault', 99, 'b', 'deposit', 100)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee', 'l''écriture paie tout le dépôt');
select throws_ok($$select pg_temp.post('bank.deposit', 'c', 'vault', 100, 'b', 'deposit')$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'Chloé ne paie pas le dépôt de Bob');
select throws_ok($$select pg_temp.post('bank.withdraw', 'vault', 'c', 100, 'b', 'withdraw')$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'ni ne touche son retrait');
select throws_ok($$select pg_temp.post('bank.withdraw', 'b', 'vault', 100, 'b', 'deposit')$$, '23001',
  'a deposit or a withdrawal is paid by its own bank entry', 'un dépôt n''est pas payé par une écriture de retrait');
select throws_ok($$select pg_temp.post('bank.deposit', 'vault', 'b', 100, 'b', 'withdraw')$$, '23001',
  'a deposit or a withdrawal is paid by its own bank entry', 'ni un retrait par une écriture de dépôt');
select throws_ok($$select pg_temp.post('bank.deposit', 'b', 'vault', 100)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'une écriture de dépôt a son mouvement');
select throws_ok($$select pg_temp.post('bank.withdraw', 'vault', 'b', 100)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'une écriture de retrait aussi : le coffre ne paie personne sans créance');
select throws_ok($$select pg_temp.as_service(format('insert into game.bank_deposit_movements (world_id, deposit_id, bank_id,
    house_id, kind, amount, ledger_entry_id) select world_id, id, bank_id, house_id, ''deposit'', 7000, %L
    from game.bank_deposits where house_id = %L', (select ledger_entry_id from game.bank_deposit_movements
      where house_id = pg_temp.house('b') order by id desc limit 1), pg_temp.house('b')))$$, '23505', null,
  'une écriture ne paie qu''un mouvement');
-- Une ligne ajoutée après coup à une écriture de dépôt validée la refait juger : trois lignes, refusée.
select throws_ok($$select pg_temp.append('bank.deposit', 'c', 1)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'ligne ajoutée après coup à un dépôt : refusée');
select throws_ok($$select pg_temp.append('bank.withdraw', 'b', 1)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'même du déposant, à un retrait');

-- Le solde ne bouge que par les mouvements ; dépôts et mouvements ne se suppriment pas.
select throws_ok($$update game.bank_deposits set balance = 1 where house_id = pg_temp.house('b')$$, '23001',
  'a deposit balance changes only through its movements', 'le propriétaire ne change pas un solde');
select throws_ok($$select pg_temp.as_service(format('update game.bank_deposits set balance = 1 where house_id = %L',
  pg_temp.house('b')))$$, '23001', 'a deposit balance changes only through its movements', 'le service non plus');
select throws_ok($$update game.bank_deposits set house_id = pg_temp.house('c') where house_id = pg_temp.house('b')$$,
  '23001', 'a deposit keeps its identity', 'un dépôt garde son déposant');
select throws_ok($$delete from game.bank_deposits where house_id = pg_temp.house('b')$$, '23001', null,
  'un dépôt ne se supprime pas');
select throws_ok($$update game.bank_deposit_movements set amount = 1 where house_id = pg_temp.house('b')$$, '23001',
  'game.bank_deposit_movements is append-only', 'un mouvement ne se modifie pas');
select throws_ok($$delete from game.bank_deposit_movements$$, '23001', 'game.bank_deposit_movements is append-only',
  'ni ne se supprime');
select is(
  pg_temp.held('b'),
  (select sum(case kind when 'withdraw' then -amount else amount end)::bigint from game.bank_deposit_movements
   where house_id = pg_temp.house('b')),
  'le solde est la somme des mouvements');
select is(pg_temp.cash('a') + pg_temp.cash('b') + pg_temp.cash('c') + pg_temp.vault(), 150000::bigint,
  'conservation : trésoreries et coffre gardent toute la monnaie, aucun refus n''en a créé');

-- Intérêt du jour : 10 % l'an de 7 000 oboles, 1,91…, une obole ; 36 500 de Chloé, 10 oboles juste.
select lives_ok($$select pg_temp.deposit('c', 36500)$$, 'Chloé dépose 36 500');
select throws_ok($$select pg_temp.interest('b', 2)$$, '23001',
  'a deposit earns the interest of its day at its bank''s displayed rate, rounded down', 'pas d''arrondi au-dessus');
select throws_ok($$select pg_temp.interest('c', 11)$$, '23001',
  'a deposit earns the interest of its day at its bank''s displayed rate, rounded down', 'ni d''obole de plus');
select throws_ok($$select pg_temp.interest('c', 9)$$, '23001',
  'a deposit earns the interest of its day at its bank''s displayed rate, rounded down', 'ni d''obole de moins');
select lives_ok($$select pg_temp.interest('b', 1)$$, 'Bob gagne une obole');
select lives_ok($$select pg_temp.interest('c', 10)$$, 'Chloé dix');
select is(array[pg_temp.held('b'), pg_temp.held('c'), pg_temp.vault()], array[7001, 36510, 44500]::bigint[],
  'l''intérêt grossit la créance, pas le coffre : aucune monnaie créée');
select is((select count(*) from game.bank_deposit_movements where kind = 'interest' and ledger_entry_id is null
           and world_id = '01900000-0000-7000-8000-0000000727f0'), 2::bigint,
  'sans écriture au grand livre');
select throws_ok($$select pg_temp.interest('b', 1)$$, '23505', null, 'un intérêt par dépôt et par jour');
select throws_ok('set constraints game.bank_deposit_movements_on_close immediate', '23001',
  'a deposit earns interest by the close of its day', 'à la validation, la clôture de son jour est enregistrée');
set constraints all deferred;
select pg_temp.as_service(format('insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values (%L, %s, %L, %L)', '01900000-0000-7000-8000-0000000727f0', pg_temp.today(), pg_temp.close_at(pg_temp.today()),
  '00000000-0000-7000-8000-00000000c727'));
select lives_ok('set constraints all immediate', 'les intérêts valident avec la clôture de leur jour');
set constraints all deferred;
select throws_ok($$select pg_temp.interest('c', 10)$$, '23001',
  'a deposit earns interest before its close is recorded', 'une clôture enregistrée ne crédite plus d''intérêt');
select throws_ok($$select pg_temp.interest('c', 10, pg_temp.today() - 1)$$, '23001',
  'a deposit earns interest before its close is recorded', 'ni pour un jour passé');

-- Taux affichés : le service les change ; le dépôt suivant les porte.
select lives_ok($$select pg_temp.as_service(format('update game.banks set deposit_rate_bps = 1500, loan_rate_bps = 5000
  where id = %L', pg_temp.bank()))$$, 'Alice affiche 15 % et 50 %');
select throws_ok($$select pg_temp.as_service(format('update game.banks set name = ''Trapeza Nea'' where id = %L',
  pg_temp.bank()))$$, '42501', null, 'le service ne change rien d''autre d''une banque');
select lives_ok($$select pg_temp.deposit('b', 10)$$, 'Bob dépose de nouveau');
select is((select string_agg(amount || ':' || rate_bps, ' ' order by amount) from game.bank_deposit_movements
           where house_id = pg_temp.house('b') and kind = 'deposit'),
  '10:1500 7000:1000 10000:1000', 'chaque dépôt au taux affiché à son instant');

select * from finish();
rollback;
