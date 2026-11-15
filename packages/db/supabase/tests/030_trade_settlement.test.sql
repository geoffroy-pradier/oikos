begin;
select plan(37);

-- Règlement des échanges et séquestre, tenus par la base (migrations 35 et 36 ; ticket 100). Chaque écriture
-- est jouée sous le rôle de service, comme le jeu, puis les contrôles différés sont validés : un refus
-- annule l'essai entier, le jeu d'essai reste intact pour le suivant.
-- Alice (a1) achète, Bob (b1) vend, Chloé (c1) est une tierce maison. Kallistè (101) et Thalassa (199).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000000c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', 'Bacchiades', '{}');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-000000000199', '01900000-0000-7000-8000-000000000001', 'thalassa-test', 'Thalassa');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000ae', '01900000-0000-7000-8000-000000000001', 'escrow', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000b1'),
  ('00000000-0000-7000-8000-0000000000cc', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000c1');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000001b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind) values
  ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-0000000001b1', 'site.collect');

-- Compte système du monde par sa clé, ou trésor d'une cité par son numéro (`101`, `199`).
create function pg_temp.sys(key text) returns uuid language plpgsql as $$
begin
  if key ~ '^[0-9]{3}$' then
    return (select id from game.accounts where kind = 'treasury' and city_id = ('01900000-0000-7000-8000-000000000' || key)::uuid);
  end if;
  return (select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001' and system_key = key);
end $$;
-- Texte d'une écriture : identifiant `5NN`, nature, puis montant par compte.
create function pg_temp.entry(n text, kind text, accounts uuid[], amounts bigint[]) returns text language sql as $$
  select format($f$insert into game.ledger_entries (id, world_id, kind) values (%L, '01900000-0000-7000-8000-000000000001', %L);
    insert into game.ledger_lines (entry_id, account_id, amount) select %L, a, m from unnest(%L::uuid[], %L::bigint[]) u (a, m);$f$,
    '00000000-0000-7000-8000-000000000' || n, kind, '00000000-0000-7000-8000-000000000' || n, accounts, amounts)
$$;
-- Texte d'un échange `4NN` réglé par l'écriture `5NN` : vente `3SS`, achat `3BB` (nul : les PNJ).
create function pg_temp.trade(n text, sell text, buy text, price bigint, quantity bigint, entry text) returns text language sql as $$
  select format($f$insert into game.trades (id, world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id)
    values (%L, '01900000-0000-7000-8000-000000000001', %L, %L, %s, %s, %L);$f$,
    '00000000-0000-7000-8000-000000000' || n, '00000000-0000-7000-8000-000000000' || sell,
    case when buy is null then null else '00000000-0000-7000-8000-000000000' || buy end, price, quantity,
    '00000000-0000-7000-8000-000000000' || entry)
$$;
-- Joue les instructions sous le rôle de service, puis valide les contrôles différés.
create function pg_temp.as_service(statements text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statements;
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.order_sql(n text, house text, side text, price bigint, quantity bigint, city text default '101') returns text language sql as $$
  select format($f$insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining)
    values (%L, '01900000-0000-7000-8000-000000000001', %L, %L, 'wheat', %L, %s, %s, %s);$f$,
    '00000000-0000-7000-8000-000000000' || n, '01900000-0000-7000-8000-000000000' || city,
    '00000000-0000-7000-8000-0000000000' || house, side, price, quantity, quantity)
$$;

-- Jeu d'essai, sous le service : dotations ; achat d'Alice qui attend (301 : 30 à 8, 240 retenues), puis
-- deux ventes de Bob arrivées après lui (302 et 303 : 20 à 8 chacune).
select lives_ok(format($$select pg_temp.as_service(%L)$$,
  pg_temp.entry('501', 'house.starting_grant', array[pg_temp.sys('faucet_starting_grant'), '00000000-0000-7000-8000-0000000000aa']::uuid[], array[-1000, 1000])
  || pg_temp.entry('502', 'house.starting_grant', array[pg_temp.sys('faucet_starting_grant'), '00000000-0000-7000-8000-0000000000cc']::uuid[], array[-100, 100])
  || pg_temp.order_sql('301', 'a1', 'buy', 8, 30)
  || pg_temp.entry('503', 'market.escrow_hold', array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000ae']::uuid[], array[-240, 240])
  || pg_temp.order_sql('302', 'b1', 'sell', 8, 20) || pg_temp.order_sql('303', 'b1', 'sell', 8, 20)),
  'jeu d''essai valide sous le service');

-- Les contrôles s'exécutent au nom du propriétaire, et le service ne peut pas les appeler lui-même.
select ok((select bool_and(prosecdef) from pg_proc where pronamespace = 'game'::regnamespace
           and proname in ('check_trade_settlement', 'check_trade_settled', 'check_escrow_debit', 'check_escrow_matches_orders')),
  'contrôles du règlement et du séquestre en SECURITY DEFINER');
select ok(not has_function_privilege('oikos_service', 'game.check_trade_settlement(uuid)', 'execute')
          and not has_function_privilege('oikos_service', 'game.check_escrow_debit()', 'execute'),
  'le service n''exécute pas les contrôles');

-- 1. Un échange entre joueurs : un achat d'Alice arrive (304 : 5 à 9) et sert la vente 303 à son prix (brut 40),
-- payé par sa trésorerie.
create function pg_temp.arriving(lines_accounts uuid[], amounts bigint[], kind text default 'market.trade') returns text language sql as $fn$
  select format($$select pg_temp.as_service(%L)$$,
    pg_temp.order_sql('304', 'a1', 'buy', 9, 5) || pg_temp.entry('511', kind, lines_accounts, amounts)
    || pg_temp.trade('411', '303', '304', 8, 5, '511'))
$fn$;
select throws_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-30, 30]),
  '23514', 'trade 00000000-0000-7000-8000-000000000411 must be paid 40 oboles in a single debit of the buyer''s treasury',
  'un échange de 5 à 8 réglé par une écriture de 30 est refusé');
select throws_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-50, 50]),
  '23514', 'trade 00000000-0000-7000-8000-000000000411 must be paid 40 oboles in a single debit of the buyer''s treasury',
  'ni par une écriture de 50');
select throws_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000cc', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-40, 40]),
  '23514', 'trade 00000000-0000-7000-8000-000000000411 must be paid 40 oboles in a single debit of the buyer''s treasury',
  'ni payé par une autre maison que l''acheteur');
select throws_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-40, 40]),
  '23514', 'escrow of house 00000000-0000-7000-8000-0000000000a1 holds 200 for 240 owed by its open buy orders',
  'ni par son séquestre quand son achat arrive : le séquestre ne retiendrait plus ce que doivent ses achats en attente');
select throws_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-20, -20, 40]),
  '23514', 'trade 00000000-0000-7000-8000-000000000411 must be paid 40 oboles in a single debit of the buyer''s treasury',
  'en une seule ligne de débit');
select throws_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb', '00000000-0000-7000-8000-0000000000cc']::uuid[], array[-40, 30, 10]),
  '23514', 'trade 00000000-0000-7000-8000-000000000411 credits only the seller''s treasury, the market tax sink and the city treasury',
  'le brut ne va qu''au vendeur et aux comptes de la taxe, pas à une autre maison');
select throws_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('199')]::uuid[], array[-40, 38, 2]),
  '23514', 'trade 00000000-0000-7000-8000-000000000411 credits only the seller''s treasury, the market tax sink and the city treasury',
  'ni au trésor d''une autre cité que celle du marché');
select throws_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-40, 40], 'npc.purchase'),
  '23514', 'trade 00000000-0000-7000-8000-000000000411 is settled by a npc.purchase entry, not market.trade',
  'l''écriture d''un échange entre joueurs est de nature market.trade');
-- Une ligne ajoutée après coup à l'écriture d'un échange valide est contrôlée comme les autres.
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.order_sql('304', 'a1', 'buy', 9, 5)
    || pg_temp.entry('511', 'market.trade', array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-40, 40])
    || pg_temp.trade('411', '303', '304', 8, 5, '511')
    || $s$insert into game.ledger_lines (entry_id, account_id, amount) values
         ('00000000-0000-7000-8000-000000000511', '00000000-0000-7000-8000-0000000000bb', -10),
         ('00000000-0000-7000-8000-000000000511', '00000000-0000-7000-8000-0000000000cc', 10);$s$),
  '23514', 'trade 00000000-0000-7000-8000-000000000411 must be paid 40 oboles in a single debit of the buyer''s treasury',
  'une ligne ajoutée à l''écriture d''un échange ne détourne pas son montant');
-- Une écriture ne règle qu'un échange (index unique, migration 42) : deux échanges de 5 à 8 ne sont pas
-- payés par une écriture de 40. Le refus vient de l'index, sans attendre la validation.
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('512', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-40, 40])
    || pg_temp.trade('412', '303', null, 8, 5, '512') || pg_temp.trade('413', '303', null, 8, 5, '512')),
  '23505', 'duplicate key value violates unique constraint "trades_ledger_entry_unique"', 'une écriture ne règle qu''un échange');
-- Règlement exact, taxe comprise : 36 au vendeur, 2 détruites, 2 au trésor de Kallistè.
select lives_ok(pg_temp.arriving(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('sink_market_tax'), pg_temp.sys('101')]::uuid[], array[-40, 36, 2, 2]),
  'brut = net + part détruite + part du trésor : accepté');

-- Achat des PNJ (303, 2 à 8 : brut 16), payé par le robinet des achats des PNJ.
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('513', 'npc.purchase', array[pg_temp.sys('faucet_starting_grant'), '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-16, 16])
    || pg_temp.trade('414', '303', null, 8, 2, '513')),
  '23514', 'trade 00000000-0000-7000-8000-000000000414 must be paid 16 oboles in a single debit of the NPC purchases faucet',
  'un achat des PNJ n''est payé par aucun autre robinet');
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('513', 'market.trade', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-16, 16])
    || pg_temp.trade('414', '303', null, 8, 2, '513')),
  '23514', 'trade 00000000-0000-7000-8000-000000000414 is settled by a market.trade entry, not npc.purchase',
  'l''écriture d''un achat des PNJ est de nature npc.purchase');
select lives_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('513', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('sink_market_tax'), pg_temp.sys('101')]::uuid[], array[-16, 14, 1, 1])
    || pg_temp.trade('414', '303', null, 8, 2, '513')),
  'achat des PNJ réglé, taxe comprise');
-- Une part nulle n'a pas de ligne : taxe nulle, taxe tout entière détruite ou versée au trésor, net nul
-- (vente 307 d'une obole, que la taxe prend entière : le vendeur n'a pas de ligne).
select lives_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('514', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-8, 8])
    || pg_temp.trade('417', '303', null, 8, 1, '514')),
  'taxe nulle : le brut va entier au vendeur');
select lives_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('515', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('sink_market_tax')]::uuid[], array[-16, 15, 1])
    || pg_temp.trade('418', '303', null, 8, 2, '515')),
  'une seule ligne de taxe : tout détruit');
select lives_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('516', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('101')]::uuid[], array[-16, 15, 1])
    || pg_temp.trade('419', '303', null, 8, 2, '516')),
  'une seule ligne de taxe : tout au trésor de la cité');
select lives_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.order_sql('307', 'b1', 'sell', 1, 1)
    || pg_temp.entry('517', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), pg_temp.sys('sink_market_tax')]::uuid[], array[-1, 1])
    || pg_temp.trade('420', '307', null, 1, 1, '517')),
  'net nul : le vendeur n''a pas de ligne');

-- Coût du règlement (migration 42) : un contrôle par échange, plus un par ligne écrite après lui. Les
-- appels sont comptés dans la transaction ; un contrôle qui échoue n'est pas compté.
set local track_functions = 'pl';
create function pg_temp.checks_during(statements text) returns bigint language plpgsql as $$
declare
  calls bigint := coalesce(pg_stat_get_xact_function_calls('game.check_trade_settlement(uuid)'::regprocedure), 0);
begin
  perform pg_temp.as_service(statements);
  return coalesce(pg_stat_get_xact_function_calls('game.check_trade_settlement(uuid)'::regprocedure), 0) - calls;
end $$;
select is(pg_temp.checks_during(
    pg_temp.entry('518', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('sink_market_tax'), pg_temp.sys('101')]::uuid[], array[-16, 14, 1, 1])
    || pg_temp.trade('421', '303', null, 8, 2, '518')),
  1::bigint, 'quatre lignes écrites avant l''échange : un seul contrôle, celui de l''échange');
select is(pg_temp.checks_during(
    pg_temp.entry('519', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-16, 15])
    || pg_temp.trade('422', '303', null, 8, 2, '519')
    || $s$insert into game.ledger_lines (entry_id, account_id, amount)
         select '00000000-0000-7000-8000-000000000519', id, 1 from game.accounts where system_key = 'sink_market_tax'
           and world_id = '01900000-0000-7000-8000-000000000001';$s$),
  2::bigint, 'une ligne écrite après l''échange : contrôlé de nouveau');
-- Contrôle forcé entre l'échange et une ligne ajoutée après lui : la ligne reste contrôlée.
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('526', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-8, 8])
    || pg_temp.trade('423', '303', null, 8, 1, '526')
    || $s$set constraints all immediate; set constraints all deferred;
       insert into game.ledger_lines (entry_id, account_id, amount) values
         ('00000000-0000-7000-8000-000000000526', '00000000-0000-7000-8000-0000000000bb', -8),
         ('00000000-0000-7000-8000-000000000526', '00000000-0000-7000-8000-0000000000cc', 8);$s$),
  '23514', 'trade 00000000-0000-7000-8000-000000000423 must be paid 8 oboles in a single debit of the NPC purchases faucet',
  'forcer le contrôle de l''échange avant d''ajouter une ligne ne la soustrait pas au contrôle');

-- Achat qui attendait (301) servi par une vente arrivée après lui (302, 10 à 8 : brut 80) : payé par le séquestre.
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('525', 'market.trade', array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-80, 80])
    || pg_temp.trade('416', '302', '301', 8, 10, '525')),
  '23514', 'trade 00000000-0000-7000-8000-000000000416 must be paid 80 oboles in a single debit of the buyer''s escrow',
  'un achat qui attendait ne paie pas de sa trésorerie');
select lives_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('525', 'market.trade', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('sink_market_tax'), pg_temp.sys('101')]::uuid[], array[-80, 76, 2, 2])
    || pg_temp.trade('416', '302', '301', 8, 10, '525')),
  'payé par son séquestre, taxe comprise');

-- La fonction de déclencheur du règlement ne s'attache pas à une autre table que les siennes.
create table pg_temp.owner_trades (id uuid, ledger_entry_id uuid);
create trigger t after insert on pg_temp.owner_trades for each row execute function game.check_trade_settled();
select throws_ok($$insert into pg_temp.owner_trades values (null, null)$$, '42501',
  't only runs on game.trades and game.ledger_lines', 'check_trade_settled ne s''exécute que sur les échanges et les lignes');

-- 2. Le séquestre d'Alice (160, pour le reste de 301) ne paie qu'elle : son échange, ou sa trésorerie.
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('521', 'market.escrow_release', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-5, 5])),
  '23514', 'escrow of house 00000000-0000-7000-8000-0000000000a1 pays only for its own trades or back to its own treasury',
  'un séquestre ne crédite pas une autre maison hors d''un échange');
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('521', 'market.escrow_release', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa', pg_temp.sys('sink_market_tax')]::uuid[], array[-5, 4, 1])),
  '23514', 'escrow of house 00000000-0000-7000-8000-0000000000a1 pays only for its own trades or back to its own treasury',
  'ni un puits, hors d''un échange');
-- Chloé achète 5 à 8 (305), servie aussitôt par une vente de Bob (306) : rien n'est retenu pour elle.
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.order_sql('305', 'c1', 'buy', 8, 5) || pg_temp.order_sql('306', 'b1', 'sell', 8, 5)
    || pg_temp.entry('523', 'market.trade', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-40, 40])
    || pg_temp.trade('415', '306', '305', 8, 5, '523')),
  '23514', 'escrow of house 00000000-0000-7000-8000-0000000000a1 pays only for its own trades or back to its own treasury',
  'ni l''échange d''une autre maison');
select lives_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('520', 'market.escrow_hold', array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000ae']::uuid[], array[-5, 5])
    || pg_temp.entry('521', 'market.escrow_release', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa']::uuid[], array[-5, 5])),
  'il rend à la trésorerie de sa maison ce qu''il retiendrait de trop');

-- 3. Séquestre = restes à payer, quoi que le rôle appelant puisse lire : le service ne voit plus les
-- ordres d'Alice, et rend à sa trésorerie le prix de son achat en attente sans l'annuler.
create policy hide_alice_orders on game.orders as restrictive for select to oikos_service
  using (house_id <> '00000000-0000-7000-8000-0000000000a1');
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('524', 'market.escrow_release', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa']::uuid[], array[-160, 160])),
  '23514', 'escrow of house 00000000-0000-7000-8000-0000000000a1 holds 0 for 160 owed by its open buy orders',
  'un rôle qui ne voit pas les achats en attente ne vide pas le séquestre en silence');
drop policy hide_alice_orders on game.orders;
create table pg_temp.owner_lines (entry_id uuid, account_id uuid, amount bigint);
create trigger t after insert on pg_temp.owner_lines for each row execute function game.check_escrow_debit();
select throws_ok($$insert into pg_temp.owner_lines values (null, null, -1)$$, '42501',
  't only runs on game.ledger_lines', 'check_escrow_debit ne s''exécute que sur les lignes du grand livre');
create table pg_temp.owner_orders (house_id uuid, account_id uuid);
create trigger t after insert on pg_temp.owner_orders for each row execute function game.check_escrow_matches_orders();
select throws_ok($$insert into pg_temp.owner_orders values (null, null)$$, '42501',
  't only runs on game.orders and game.ledger_lines', 'check_escrow_matches_orders ne s''exécute que sur les ordres et les lignes');

-- 4. Ce que seule la garde des débits du séquestre refuse : dans une même transaction, Alice met 5 sous
-- séquestre puis son séquestre les verse à Bob. Il retient toujours ses restes à payer (160).
-- `verdict` valide les contrôles nommés, puis annule tout : il rend « accepted » ou le message du refus.
create function pg_temp.verdict(statements text, checks text) returns text language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statements;
  perform set_config('role', 'none', true);
  execute format('set constraints %s immediate', checks);
  raise exception 'accepted';
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.hold_then_pay_bob() returns text language sql as $$
  select pg_temp.entry('527', 'market.escrow_hold', array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000ae']::uuid[], array[-5, 5])
    || pg_temp.entry('528', 'market.escrow_release', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-5, 5])
$$;
select is(pg_temp.verdict(pg_temp.hold_then_pay_bob(), 'game.ledger_lines_escrow_matches, game.ledger_lines_balanced'), 'accepted',
  'le séquestre retient ses restes à payer : le contrôle du montant retenu laisse passer');
select is(pg_temp.verdict(pg_temp.hold_then_pay_bob(), 'all'),
  'escrow of house 00000000-0000-7000-8000-0000000000a1 pays only for its own trades or back to its own treasury',
  'la garde des débits du séquestre refuse qu''il paie une autre maison');

select is((select string_agg(kind || ':' || balance, ' ' order by id) from game.accounts
            where house_id in ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c1')),
  'house:720 escrow:160 house:193 house:100', 'trésorerie et séquestre d''Alice, trésoreries de Bob et de Chloé : chaque oboles où le jeu l''a mise');
select * from finish();
rollback;
