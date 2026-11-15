begin;
select plan(21);

-- Règlement des échanges, tenu par la base (migration 35 ; ticket 100). Chaque écriture
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

-- Le contrôle s'exécute au nom du propriétaire, et le service ne peut pas l'appeler lui-même.
select ok((select bool_and(prosecdef) from pg_proc where pronamespace = 'game'::regnamespace
           and proname in ('check_trade_settlement', 'check_trade_settled')),
  'contrôle du règlement en SECURITY DEFINER');
select ok(not has_function_privilege('oikos_service', 'game.check_trade_settlement(uuid)', 'execute'),
  'le service n''exécute pas le contrôle');

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
-- Une écriture ne règle qu'un échange : deux échanges de 5 à 8 ne sont pas payés par une écriture de 40.
select throws_ok(format($$select pg_temp.as_service(%L)$$,
    pg_temp.entry('512', 'npc.purchase', array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-40, 40])
    || pg_temp.trade('412', '303', null, 8, 5, '512') || pg_temp.trade('413', '303', null, 8, 5, '512')),
  '23514', 'ledger entry 00000000-0000-7000-8000-000000000512 settles more than one trade', 'une écriture ne règle qu''un échange');
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

select is((select string_agg(kind || ':' || balance, ' ' order by id) from game.accounts
            where house_id in ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c1')),
  'house:720 escrow:160 house:126 house:100', 'trésorerie et séquestre d''Alice, trésoreries de Bob et de Chloé : chaque oboles où le jeu l''a mise');
select * from finish();
rollback;
