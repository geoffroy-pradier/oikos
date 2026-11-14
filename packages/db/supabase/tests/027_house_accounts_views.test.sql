begin;
select plan(41);

-- Jeu d'essai : clôture à 4 h, heure de Paris. Alice et Bob ont chacun une maison, Chloé n'en a pas.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c001', '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}, "market": {"npcMaxPriceFactor": 3}}'),
  ('00000000-0000-7000-8000-00000000c002', '{"market": {"npcMaxPriceFactor": 3}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c001', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'), ('00000000-0000-4000-8000-00000000000b', 'bob@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000ae', '01900000-0000-7000-8000-000000000001', 'escrow', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000b1');
-- Stocks : Alice 100 blés et 5 olives (jamais échangées ici : sans prix), Bob 50 blés et un stock de poisson vide.
insert into game.inventories (id, world_id, house_id, city_id, good_id)
select ('00000000-0000-7000-8000-0000000001' || s.tag)::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-7000-8000-0000000000' || left(s.tag, 1) || '1')::uuid, '01900000-0000-7000-8000-000000000101', s.good
from (values ('a1', 'wheat'), ('a2', 'olives'), ('b1', 'wheat'), ('b2', 'fish')) s (tag, good);
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
select '01900000-0000-7000-8000-000000000001', s.good, s.quantity, 'production', ('00000000-0000-7000-8000-0000000001' || s.tag)::uuid, 'site.collect'
from (values ('a1', 'wheat', 100), ('a2', 'olives', 5), ('b1', 'wheat', 50)) s (tag, good, quantity);
insert into game.observed_prices (world_id, city_id, good_id, price, volume, window_seconds, observed_at) values
  ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'wheat', 8, 20, 86400, '2026-11-11 12:00+00');

-- Compte système du monde de test, ou trésor de sa cité (`city`).
create function pg_temp.sys(key text) returns uuid language sql as $$
  select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001'
    and (system_key = key or (key = 'city' and city_id = '01900000-0000-7000-8000-000000000101'))
$$;
-- Une écriture équilibrée datée, de la nature donnée ; rend son identifiant.
create function pg_temp.post(kind text, at timestamptz, accounts uuid[], amounts bigint[], meta jsonb default '{}') returns uuid
language plpgsql as $$
declare
  entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta, created_at) values ('01900000-0000-7000-8000-000000000001', kind, meta, at)
    returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) select entry, u.account, u.amount from unnest(accounts, amounts) u (account, amount);
  return entry;
end $$;
-- Écart entre le solde d'un compte de maison et la somme de tous ses flux affichés : nombre de comptes en écart.
create function pg_temp.drift() returns bigint language sql as $$
  select count(*) from game.accounts a
  where a.house_id is not null and a.balance <> (
    select coalesce(sum(f.amount), 0) from public.my_cash_flows f
    where f.house_id = a.house_id and f.account = case a.kind when 'house' then 'treasury' else a.kind end)
$$;

-- Jour 0 (10 novembre) : dotations, Alice achète un site, puis vend 10 blés à 8 aux PNJ une seconde avant
-- la clôture (brut 80, taxe 4). Jour 1, à la clôture même : entretien ; achat en attente de 20 blés à 5.
-- Jour 2 : Bob lui en vend 12 (brut 60, taxe 3), payés par le séquestre.
select pg_temp.post('house.starting_grant', '2026-11-10 12:00+01', array[pg_temp.sys('faucet_starting_grant'), h]::uuid[], array[-3000, 3000])
from unnest(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[]) h;
select pg_temp.post('site.acquire', '2026-11-10 13:00+01', array[pg_temp.sys('sink_site_acquisition'), '00000000-0000-7000-8000-0000000000aa'], array[600, -600]);
insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining)
select ('00000000-0000-7000-8000-00000000030' || o.n)::uuid, '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
       ('00000000-0000-7000-8000-0000000000' || o.house)::uuid, 'wheat', o.side, o.price, o.quantity, o.quantity
from (values (1, 'a1', 'sell', 8, 10), (2, 'a1', 'buy', 5, 20), (3, 'b1', 'sell', 5, 12)) o (n, house, side, price, quantity) order by o.n;
insert into game.trades (world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id) values
  ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000301', null, 8, 10,
   pg_temp.post('npc.purchase', '2026-11-11 03:59:59+01',
     array[pg_temp.sys('faucet_npc_purchases'), '00000000-0000-7000-8000-0000000000aa', pg_temp.sys('sink_market_tax'), pg_temp.sys('city')], array[-80, 76, 2, 2]));
select pg_temp.post('upkeep.daily', '2026-11-11 04:00+01', array[pg_temp.sys('sink_upkeep'), '00000000-0000-7000-8000-0000000000aa'], array[30, -30],
  '{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20768}');
select pg_temp.post('market.escrow_hold', '2026-11-11 18:00+01', array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000ae']::uuid[], array[-100, 100]);
insert into game.trades (world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id) values
  ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000302', 5, 12,
   pg_temp.post('market.trade', '2026-11-12 09:00+01',
     array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('sink_market_tax'), pg_temp.sys('city')], array[-60, 57, 2, 1]));
select lives_ok('set constraints all immediate', 'jeu d''essai valide : écritures équilibrées, séquestre égal au reste à payer');
set constraints all deferred;

-- Catalogue : vues en lecture seule, exécutées avec les droits de l'appelant ; règles par ligne figées.
select is(
  (select string_agg(table_name || '(' || cols || ')', ' ' order by table_name)
   from (select table_name::text, string_agg(column_name::text, ',' order by ordinal_position) as cols from information_schema.columns
         where table_schema = 'public' and table_name in ('my_cash_flows', 'my_valued_stocks', 'my_balance_sheet') group by table_name) v),
  'my_balance_sheet(house_id,treasury,escrow,stock_value,unpriced_stocks) my_cash_flows(house_id,account,game_day,nature,amount) '
    || 'my_valued_stocks(house_id,city_id,good_id,quantity,unit_price,value,priced_at)', 'colonnes des trois vues : liste figée');
select is(
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'
     and relname in ('my_cash_flows', 'my_valued_stocks', 'my_balance_sheet') and reloptions @> array['security_invoker=true']),
  3::bigint, 'les trois vues s''exécutent avec les droits de l''appelant');
select is(
  (select string_agg(distinct grantee || ':' || privilege_type, ' ') from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('my_cash_flows', 'my_valued_stocks', 'my_balance_sheet') and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'lecture seule pour un joueur connecté, rien pour un visiteur');
select is(
  (select string_agg(tablename || '.' || policyname || ':' || cmd, ' ' order by tablename, policyname) from pg_policies
   where schemaname = 'game' and tablename in ('accounts', 'ledger_entries', 'ledger_lines', 'trades') and roles = '{authenticated}'),
  'accounts.accounts_read_own:SELECT ledger_entries.ledger_entries_read_own:SELECT ledger_lines.ledger_lines_read_own:SELECT trades.trades_read_seller:SELECT',
  'règles par ligne des joueurs sur la monnaie et les échanges : liste figée, lecture seule');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.clock_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés lisent l''horloge : liste figée');
select results_eq('select * from game.clock_rules()', $$values (4, 'Europe/Paris', 7)$$, 'l''horloge est celle de la configuration en vigueur');

set local role anon;
select throws_ok(format('select * from %s', o), '42501', null, format('un visiteur anonyme ne lit pas %s', o))
from unnest(array['public.my_cash_flows', 'public.my_valued_stocks', 'public.my_balance_sheet', 'game.clock_rules()']) o;

-- Alice : ses flux par compte, jour de jeu et nature. Les 80 de 03 h 59 sont du jour 0, l'entretien de 04 h 00 du jour 1.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select results_eq(
  'select account, game_day - 20767, nature, amount from public.my_cash_flows order by account, game_day, nature',
  $$values ('escrow', 1, 'escrow', 100::bigint), ('escrow', 2, 'purchases', -60),
           ('treasury', 0, 'acquisitions', -600), ('treasury', 0, 'grant', 3000), ('treasury', 0, 'sales', 80), ('treasury', 0, 'taxes', -4),
           ('treasury', 1, 'escrow', -100), ('treasury', 1, 'upkeep', -30)$$,
  'Alice lit ses flux : vente au brut et taxe à part, achat en attente payé par le séquestre');
select results_eq('select * from public.my_balance_sheet',
  $$values ('00000000-0000-7000-8000-0000000000a1'::uuid, 2346::bigint, 40::bigint, 800::bigint, 1::bigint)$$,
  'son bilan : trésorerie, séquestre de l''achat en attente, stocks valorisés, un stock sans prix');
select results_eq('select good_id, quantity, unit_price, value, priced_at from public.my_valued_stocks order by good_id',
  $$values ('olives', 5::bigint, null::bigint, null::bigint, null::timestamptz), ('wheat', 100, 8, 800, '2026-11-11 12:00+00')$$,
  'ses stocks au dernier prix observé, daté ; sans prix observé, ni prix ni valeur');
select is(
  (select count(*) from public.my_cash_flows where house_id <> '00000000-0000-7000-8000-0000000000a1')
  + (select count(*) from public.my_valued_stocks where house_id <> '00000000-0000-7000-8000-0000000000a1')
  + (select count(*) from public.my_balance_sheet where house_id <> '00000000-0000-7000-8000-0000000000a1'),
  0::bigint, 'elle ne lit rien de la maison de Bob');
-- En direct dans `game` : ses seules lignes, la nature et la date de ses seules écritures, ses seules ventes.
select results_eq(
  $$select count(*), count(*) filter (where account_id in ('00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000ae')) from game.ledger_lines$$,
  $$values (7::bigint, 7::bigint)$$, 'du grand livre, elle ne lit que les lignes de sa trésorerie et de son séquestre');
select is((select count(*) from game.ledger_entries), 6::bigint, 'et les écritures où elle a une ligne, pas la dotation de Bob');
select results_eq('select price, quantity from game.trades', $$values (8::bigint, 10::bigint)$$, 'des échanges, sa seule vente');
select throws_ok('select meta from game.ledger_entries', '42501', null, 'le détail d''une écriture reste illisible');
select throws_ok('select id, buy_order_id from game.trades', '42501', null, 'comme l''ordre d''achat d''un échange');
-- Aucune écriture : ni par les vues, ni par les tables qu'elles lisent.
select throws_ok($$insert into public.my_cash_flows (house_id, account, game_day, nature, amount) values ('00000000-0000-7000-8000-0000000000a1', 'treasury', 20767, 'grant', 1000000)$$,
  '55000', null, 'pas de flux inventé par la vue');
select throws_ok('update public.my_balance_sheet set treasury = 1000000', '55000', null, 'pas de trésorerie modifiée par le bilan');
select throws_ok('delete from public.my_valued_stocks', '55000', null, 'pas de stock supprimé par la vue');
select throws_ok($$insert into game.ledger_lines (entry_id, account_id, amount) select entry_id, account_id, 1000000 from game.ledger_lines limit 1$$,
  '42501', null, 'pas de ligne ajoutée au grand livre');
select throws_ok($$update game.ledger_entries set kind = 'house.starting_grant'$$, '42501', null, 'pas d''écriture requalifiée');
select throws_ok('delete from game.trades', '42501', null, 'pas d''échange supprimé');

-- Alice annule le reste de son achat : le séquestre lui rend 40. Bob reçoit ensuite 120 écritures tirées
-- au sort sur quatre jours, de natures connues ou non, dans les deux sens.
reset role;
update game.orders set status = 'cancelled' where id = '00000000-0000-7000-8000-000000000302';
select pg_temp.post('market.escrow_release', '2026-11-12 10:00+01', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa']::uuid[], array[-40, 40]);
select setseed(0.73);
select count(pg_temp.post(r.kind, timestamptz '2026-11-13 03:00+00' + random() * interval '96 hours',
         array[pg_temp.sys('faucet_rewards'), '00000000-0000-7000-8000-0000000000bb'], array[-r.amount, r.amount]))
from (select d.kind, case when d.kind in ('market.trade', 'site.acquire', 'upkeep.restart') then -d.oboles else d.oboles end as amount
      from (select (array['npc.purchase', 'house.starting_grant', 'test.unknown', 'market.trade', 'site.acquire', 'upkeep.restart'])[1 + floor(random() * 6)::integer] as kind,
                   1 + floor(random() * 10)::bigint as oboles
            from generate_series(1, 120)) d) r;
select lives_ok('set constraints all immediate', 'écritures toujours valides, séquestre vidé avec l''achat annulé');
set constraints all deferred;

-- Conservation, lue par le propriétaire pour toutes les maisons : la somme des flux affichés d'une
-- période est la variation du solde sur cette période. Le jour attendu est compté ici en tranches de
-- 24 heures depuis la clôture du 10 novembre (03 h 00 en temps universel), sans passer par la vue.
select results_eq(
  $$select house_id, account, game_day, sum(amount)::bigint from public.my_cash_flows group by 1, 2, 3 having sum(amount) <> 0 order by 1, 2, 3$$,
  $$select a.house_id, case a.kind when 'house' then 'treasury' else a.kind end,
           20767 + floor(extract(epoch from e.created_at - timestamptz '2026-11-10 03:00+00') / 86400)::integer, sum(l.amount)::bigint
    from game.ledger_lines l join game.ledger_entries e on e.id = l.entry_id join game.accounts a on a.id = l.account_id
    where a.house_id is not null group by 1, 2, 3 having sum(l.amount) <> 0 order by 1, 2, 3$$,
  'par compte et par jour de jeu, la somme des flux affichés est la variation du solde');
select is((select count(distinct game_day) from public.my_cash_flows), 7::bigint, 'sur sept jours de jeu, dont quatre tirés au sort');
select is(pg_temp.drift(), 0::bigint, 'pour chaque compte, la somme de tous ses flux est son solde');
select is((select count(*) from public.my_cash_flows where amount = 0), 0::bigint, 'aucun flux nul n''est affiché');

-- Passages à l'heure d'été et d'hiver : la journée de jeu commence toujours à 4 h, heure locale.
select count(pg_temp.post('test.unknown', at, array[pg_temp.sys('faucet_rewards'), '00000000-0000-7000-8000-0000000000bb'], array[-1, 1]))
from unnest(array['2026-03-29 01:59:59+00', '2026-03-29 02:00+00', '2026-10-25 02:59:59+00', '2026-10-25 03:00+00']::timestamptz[]) at;
select results_eq(
  $$select date '1970-01-01' + game_day, nature, amount from public.my_cash_flows where game_day < 20767 order by 1$$,
  $$values (date '2026-03-28', 'other', 1::bigint), ('2026-03-29', 'other', 1), ('2026-10-24', 'other', 1), ('2026-10-25', 'other', 1)$$,
  'le jour de jeu suit l''heure locale au changement d''heure ; une nature inconnue est rangée dans « other »');

-- Bob : sa vente au brut et la taxe, rien d'Alice ; son stock vide n'a pas de ligne, son séquestre est nul.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq(
  'select account, game_day - 20767, nature, amount from public.my_cash_flows where game_day between 20767 and 20769 order by 2, 3',
  $$values ('treasury', 0, 'grant', 3000::bigint), ('treasury', 2, 'sales', 60), ('treasury', 2, 'taxes', -3)$$,
  'Bob lit sa vente à Alice : 60 de brut, 3 de taxe');
select results_eq(
  $$select house_id, treasury = (select balance from public.my_treasury), escrow, stock_value, unpriced_stocks from public.my_balance_sheet$$,
  $$values ('00000000-0000-7000-8000-0000000000b1'::uuid, true, 0::bigint, 400::bigint, 0::bigint)$$,
  'son bilan : séquestre nul sans compte de séquestre, 50 blés à 8 ; son stock vide n''est ni valorisé ni compté sans prix');
select results_eq('select distinct house_id from public.my_cash_flows union select house_id from public.my_valued_stocks',
  $$values ('00000000-0000-7000-8000-0000000000b1'::uuid)$$, 'il ne lit que sa maison, flux comme stocks');
select is((select count(*) from game.trades), 1::bigint, 'des échanges, il ne lit que sa vente, pas celle d''Alice');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select results_eq('select treasury, escrow from public.my_balance_sheet', $$values (2386::bigint, 0::bigint)$$,
  'Alice : séquestre vidé et rendu à la trésorerie');
select is((select sum(amount) from public.my_cash_flows where account = 'treasury' and game_day <= 20768), 2346::numeric,
  'la somme de ses flux jusqu''à la fin du jour 1 est son solde à cette date');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}';
select is(
  (select count(*) from public.my_cash_flows) + (select count(*) from public.my_valued_stocks) + (select count(*) from public.my_balance_sheet)
  + (select count(*) from game.ledger_lines) + (select count(*) from game.ledger_entries) + (select count(*) from game.trades),
  0::bigint, 'un compte sans maison ne lit rien');
reset role;

-- Version de configuration sans horloge : le jour est inconnu, mais aucun flux ne disparaît.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c002', now());
select is((select count(*) from public.my_cash_flows where game_day is not null), 0::bigint, 'sans horloge en vigueur, le jour de jeu est nul');
select is(pg_temp.drift(), 0::bigint, 'et la somme des flux reste le solde de chaque compte');

select * from finish();
rollback;
