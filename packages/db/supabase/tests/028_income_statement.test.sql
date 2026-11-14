begin;
select plan(30);

-- Jeu d'essai : clôture à 4 h, heure de Paris, saisons de 7 jours. Le 10 novembre 2026 est le jour de
-- jeu 20767, un mardi de la saison 2966 (ouverte le lundi 9). Alice et Bob ont une maison active,
-- Chloé une maison sans aucune écriture.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c001', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}'),
  ('00000000-0000-7000-8000-00000000c002', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris"}}'),
  ('00000000-0000-7000-8000-00000000c003', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 0}}'),
  ('00000000-0000-7000-8000-00000000c004', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 28}}'),
  ('00000000-0000-7000-8000-00000000c005', '{"clock": {"dailyCloseHour": 4, "timezone": "Mars/Olympus", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c001', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'), ('00000000-0000-4000-8000-00000000000b', 'bob@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000000' || h.tag || '1')::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-4000-8000-00000000000' || h.tag)::uuid, h.name, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Boutades')) h (tag, name);
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000ae', '01900000-0000-7000-8000-000000000001', 'escrow', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000b1'),
  ('00000000-0000-7000-8000-0000000000cc', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000c1');
-- Du blé à vendre pour Alice et pour Bob.
insert into game.inventories (id, world_id, house_id, city_id, good_id)
select ('00000000-0000-7000-8000-0000000001' || h || '1')::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-7000-8000-0000000000' || h || '1')::uuid, '01900000-0000-7000-8000-000000000101', 'wheat'
from unnest(array['a', 'b']) h;
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
select '01900000-0000-7000-8000-000000000001', 'wheat', 50, 'production', id, 'site.collect' from game.inventories where id::text like '00000000-0000-7000-8000-0000000001_1';

-- Compte système du monde de test, ou trésor de sa cité (`city`).
create function pg_temp.sys(key text) returns uuid language sql as $$
  select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001'
    and (system_key = key or (key = 'city' and city_id = '01900000-0000-7000-8000-000000000101'))
$$;
-- Une écriture équilibrée datée, de la nature donnée ; rend son identifiant.
create function pg_temp.post(kind text, at timestamptz, accounts uuid[], amounts bigint[]) returns uuid language plpgsql as $$
declare
  entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, created_at) values ('01900000-0000-7000-8000-000000000001', kind, at) returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) select entry, u.account, u.amount from unnest(accounts, amounts) u (account, amount);
  return entry;
end $$;
-- Attendu, calculé sur le grand livre sans passer par les vues : par maison et par période de `seconds`
-- secondes comptées depuis `origin`, la somme des lignes des natures d'exploitation, de toutes les
-- lignes, et de celles du séquestre.
create function pg_temp.expected(origin timestamptz, seconds integer)
returns table (house_id uuid, period integer, operating bigint, total bigint, escrow bigint) language sql as $$
  select a.house_id, floor(extract(epoch from e.created_at - origin) / seconds)::integer,
         coalesce(sum(l.amount) filter (where e.kind in ('market.trade', 'npc.purchase', 'upkeep.daily', 'upkeep.restart')), 0)::bigint,
         sum(l.amount)::bigint, coalesce(sum(l.amount) filter (where a.kind = 'escrow'), 0)::bigint
  from game.ledger_lines l join game.ledger_entries e on e.id = l.entry_id join game.accounts a on a.id = l.account_id
  where a.house_id is not null group by 1, 2
$$;
-- Nombre de maisons dont la monnaie (trésorerie plus séquestre) n'est pas la somme des variations affichées, par jour ou par saison.
create function pg_temp.drift() returns bigint language sql as $$
  select count(*) from (select house_id, sum(balance) as money from game.accounts where house_id is not null group by 1) a
  where a.money <> (select coalesce(sum(s.cash_change), 0) from public.my_income_statement s where s.house_id = a.house_id)
     or a.money <> (select coalesce(sum(s.cash_change), 0) from public.my_income_statement_by_season s where s.house_id = a.house_id)
$$;

-- Jour 0 : dotations, Alice achète un site, puis vend 10 blés à 8 aux PNJ une seconde avant la clôture
-- (brut 80, taxe 4). Jour 1, à la clôture même : relance d'un site. Jour 2 : achat en attente de 20 blés à 5,
-- rien d'autre. Jour 3 : Bob lui en vend 12 (brut 60, taxe 3), payés par le séquestre, et elle annule
-- le reste. Bascule de saison du lundi 16 : une écriture une seconde avant la clôture, une à la clôture.
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
select pg_temp.post('upkeep.restart', '2026-11-11 04:00+01', array[pg_temp.sys('sink_upkeep'), '00000000-0000-7000-8000-0000000000aa'], array[30, -30]);
select pg_temp.post('market.escrow_hold', '2026-11-12 18:00+01', array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000ae']::uuid[], array[-100, 100]);
insert into game.trades (world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id) values
  ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000302', 5, 12,
   pg_temp.post('market.trade', '2026-11-13 09:00+01',
     array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000bb', pg_temp.sys('sink_market_tax'), pg_temp.sys('city')], array[-60, 57, 2, 1]));
update game.orders set status = 'cancelled' where id = '00000000-0000-7000-8000-000000000302';
select pg_temp.post('market.escrow_release', '2026-11-13 10:00+01', array['00000000-0000-7000-8000-0000000000ae', '00000000-0000-7000-8000-0000000000aa']::uuid[], array[-40, 40]);
select pg_temp.post('test.unknown', '2026-11-16 03:59:59+01', array[pg_temp.sys('faucet_rewards'), '00000000-0000-7000-8000-0000000000aa'], array[-7, 7]);
select pg_temp.post('upkeep.restart', '2026-11-16 04:00+01', array[pg_temp.sys('sink_upkeep'), '00000000-0000-7000-8000-0000000000aa'], array[5, -5]);
-- Bob : 150 écritures tirées au sort sur trois semaines, de natures connues ou non, dans les deux sens,
-- dont des mouvements de séquestre sans contrepartie dans la maison (aucune commande n'en passe : ils
-- doivent tomber dans « other ») ; et une écriture du dimanche 4 janvier 1970, avant le lundi de
-- référence des saisons.
select setseed(0.73);
select count(pg_temp.post(r.kind, timestamptz '2026-11-17 03:00+00' + random() * interval '21 days',
         array[pg_temp.sys('faucet_rewards'), '00000000-0000-7000-8000-0000000000bb'], array[-r.amount, r.amount]))
from (select d.kind, case when d.kind in ('market.trade', 'site.acquire', 'upkeep.restart') then -d.oboles else d.oboles end as amount
      from (select (array['npc.purchase', 'house.starting_grant', 'test.unknown', 'market.trade', 'site.acquire', 'upkeep.restart', 'market.escrow_release'])[1 + floor(random() * 7)::integer] as kind,
                   1 + floor(random() * 10)::bigint as oboles
            from generate_series(1, 150)) d) r;
select pg_temp.post('test.unknown', '1970-01-04 12:00+01', array[pg_temp.sys('faucet_rewards'), '00000000-0000-7000-8000-0000000000bb'], array[-1, 1]);
select lives_ok('set constraints all immediate', 'jeu d''essai valide : écritures équilibrées, séquestre vidé avec l''achat annulé');
set constraints all deferred;

-- Catalogue : vues en lecture seule, exécutées avec les droits de l'appelant.
select is(
  (select string_agg(table_name || '(' || cols || ')', ' ' order by table_name)
   from (select table_name::text, string_agg(column_name::text, ',' order by ordinal_position) as cols from information_schema.columns
         where table_schema = 'public' and table_name like 'my_income_statement%' group by table_name) v),
  'my_income_statement(house_id,game_day,season,sales,purchases,taxes,upkeep,operating_result,acquisitions,grants,other,non_operating,cash_change,escrow_change) '
    || 'my_income_statement_by_season(house_id,season,first_game_day,last_game_day,sales,purchases,taxes,upkeep,operating_result,acquisitions,grants,other,non_operating,cash_change,escrow_change)',
  'colonnes des deux vues : liste figée');
select is(
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'
     and relname like 'my_income_statement%' and reloptions @> array['security_invoker=true']),
  2::bigint, 'les deux vues s''exécutent avec les droits de l''appelant');
select is(
  (select string_agg(distinct grantee || ':' || privilege_type, ' ') from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'my_income_statement%' and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'lecture seule pour un joueur connecté, rien pour un visiteur');

set local role anon;
select throws_ok(format('select * from public.%s', v), '42501', null, format('un visiteur anonyme ne lit pas %s', v))
from unnest(array['my_income_statement', 'my_income_statement_by_season']) v;

-- Alice. Colonnes : jour, saison, ventes, achats, taxes, entretien, résultat, acquisitions, dotation,
-- autres, hors exploitation, variation de la monnaie, dont séquestre.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select results_eq(
  $$select game_day - 20767, season - 2966, sales, purchases, taxes, upkeep, operating_result, acquisitions, grants, other, non_operating, cash_change, escrow_change
    from public.my_income_statement order by game_day$$,
  $$values (0, 0, 80::bigint, 0::bigint, -4::bigint, 0::bigint, 76::bigint, -600::bigint, 3000::bigint, 0::bigint, 2400::bigint, 2476::bigint, 0::bigint),
           (1, 0, 0, 0, 0, -30, -30, 0, 0, 0, 0, -30, 0),
           (2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100),
           (3, 0, 0, -60, 0, 0, -60, 0, 0, 0, 0, -60, -100),
           (5, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 7, 0),
           (6, 1, 0, 0, 0, -5, -5, 0, 0, 0, 0, -5, 0)$$,
  'Alice lit son compte de résultat par jour : achat en attente compté le jour où il est servi, séquestre sans effet sur le résultat');
select results_eq(
  $$select season, date '1970-01-01' + first_game_day, date '1970-01-01' + last_game_day,
           sales, purchases, taxes, upkeep, operating_result, acquisitions, grants, other, non_operating, cash_change, escrow_change
    from public.my_income_statement_by_season order by season$$,
  $$values (2966, date '2026-11-09', date '2026-11-15', 80::bigint, -60::bigint, -4::bigint, -30::bigint, -14::bigint, -600::bigint, 3000::bigint, 7::bigint, 2407::bigint, 2393::bigint, 0::bigint),
           (2967, '2026-11-16', '2026-11-22', 0, 0, 0, -5, -5, 0, 0, 0, 0, -5, 0)$$,
  'et par saison, du lundi au dimanche : l''écriture de 03 h 59 est de la saison qui finit, celle de 04 h 00 de la suivante');
select is((select sum(cash_change) from public.my_income_statement_by_season),
  (select treasury + escrow from public.my_balance_sheet)::numeric, 'la somme des variations est sa monnaie au bilan');
select is(
  (select count(*) from public.my_income_statement where house_id <> '00000000-0000-7000-8000-0000000000a1')
  + (select count(*) from public.my_income_statement_by_season where house_id <> '00000000-0000-7000-8000-0000000000a1'),
  0::bigint, 'elle ne lit rien de la maison de Bob');
-- Aucune écriture par les vues.
select throws_ok($$insert into public.my_income_statement (house_id, game_day, sales) values ('00000000-0000-7000-8000-0000000000a1', 20767, 1000000)$$,
  '55000', null, 'pas de produit inventé par la vue');
select throws_ok('update public.my_income_statement set cash_change = 1000000', '55000', null, 'pas de variation modifiée');
select throws_ok('delete from public.my_income_statement', '55000', null, 'pas de jour supprimé');
select throws_ok($$insert into public.my_income_statement_by_season (house_id, season, sales) values ('00000000-0000-7000-8000-0000000000a1', 2966, 1000000)$$,
  '55000', null, 'pas de saison inventée');
select throws_ok('update public.my_income_statement_by_season set purchases = 0', '55000', null, 'pas de charge effacée');
select throws_ok('delete from public.my_income_statement_by_season', '55000', null, 'pas de saison supprimée');

-- Bob : sa vente au brut et sa taxe, rien d'Alice. Chloé, maison sans écriture : aucune ligne.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq('select sales, taxes, operating_result, cash_change from public.my_income_statement where game_day = 20770',
  $$values (60::bigint, -3::bigint, 57::bigint, 57::bigint)$$, 'Bob lit sa vente à Alice : 60 de brut, 3 de taxe');
select results_eq('select house_id from public.my_income_statement union select house_id from public.my_income_statement_by_season',
  $$values ('00000000-0000-7000-8000-0000000000b1'::uuid)$$, 'il ne lit que sa maison, par jour comme par saison');
select results_eq('select game_day, season, date ''1970-01-01'' + first_game_day, last_game_day from public.my_income_statement
    join public.my_income_statement_by_season using (season) where game_day < 20000',
  $$values (3, -1, date '1969-12-29', 3)$$, 'avant le lundi de référence, l''indice de saison est arrondi vers le bas, comme dans le moteur');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.my_income_statement) + (select count(*) from public.my_income_statement_by_season), 0::bigint,
  'une maison sans écriture ne lit aucune ligne, ni les siennes ni celles des autres');
reset role;

-- Conservation, lue par le propriétaire pour toutes les maisons : résultat et variation affichés sont
-- ceux du grand livre, par jour (tranches de 24 heures depuis la clôture du 10 novembre) et par saison
-- (tranches de 7 jours depuis celle du lundi 9), sans passer par les vues pour l'attendu.
select results_eq(
  $$select house_id, game_day, operating_result, operating_result + non_operating, escrow_change from public.my_income_statement order by 1, 2$$,
  $$select house_id, 20767 + period, operating, total, escrow from pg_temp.expected('2026-11-10 03:00+00', 86400) order by 1, 2$$,
  'par jour de jeu, résultat plus hors exploitation font la variation de la monnaie de la maison');
select results_eq(
  $$select house_id, season, operating_result, operating_result + non_operating, escrow_change from public.my_income_statement_by_season order by 1, 2$$,
  $$select house_id, 2966 + period, operating, total, escrow from pg_temp.expected('2026-11-09 03:00+00', 604800) order by 1, 2$$,
  'par saison aussi');
select is(
  (select count(*) from (select * from public.my_income_statement union all
                         select house_id, null, season, sales, purchases, taxes, upkeep, operating_result, acquisitions, grants, other,
                                non_operating, cash_change, escrow_change from public.my_income_statement_by_season) s
   where s.sales + s.purchases + s.taxes + s.upkeep <> s.operating_result or s.acquisitions + s.grants + s.other <> s.non_operating
      or s.operating_result + s.non_operating <> s.cash_change),
  0::bigint, 'sur chaque ligne, les colonnes de détail font les sous-totaux et les sous-totaux la variation');
select results_eq('select count(distinct game_day), count(distinct season) from public.my_income_statement', $$values (28::bigint, 6::bigint)$$,
  'sur 28 jours de jeu et 6 saisons, dont une avant 1970');
select is(pg_temp.drift(), 0::bigint, 'pour chaque maison, la somme des variations est sa monnaie, par jour comme par saison');

-- Durée de saison absente, puis nulle : la saison est inconnue, les jours restent, rien ne disparaît.
prepare seasonless as
  select (select count(*) filter (where season is null and game_day is not null) from public.my_income_statement),
         (select count(*) filter (where season is null and first_game_day is null and last_game_day is null) from public.my_income_statement_by_season),
         (select count(*) from public.my_income_statement_by_season), pg_temp.drift();
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c002', now());
select results_eq('seasonless', $$values (30::bigint, 2::bigint, 2::bigint, 0::bigint)$$,
  'sans durée de saison : jours inchangés, une seule ligne sans saison par maison, sommes conservées');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c003', now());
select results_eq('seasonless', $$values (30::bigint, 2::bigint, 2::bigint, 0::bigint)$$, 'durée de saison nulle : de même, sans division par zéro');
-- Saisons de 28 jours : l'indice et les bornes suivent la configuration.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c004', now());
select results_eq(
  $$select season, date '1970-01-01' + first_game_day, date '1970-01-01' + last_game_day, cash_change
    from public.my_income_statement_by_season where house_id = '00000000-0000-7000-8000-0000000000a1'$$,
  $$values (741, date '2026-10-26', date '2026-11-22', 2388::bigint)$$, 'saisons de 28 jours : une seule saison pour Alice, d''un lundi à un dimanche');
-- Fuseau inconnu de Postgres : le jour et la saison sont inconnus, mais aucune vue n'échoue.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c005', now());
select results_eq($$select c.*, p.prorows from game.clock_rules() c, pg_proc p where p.oid = 'game.clock_rules()'::regprocedure$$,
  $$values (4, null::text, 7, 1::real)$$, 'un fuseau inconnu de la base est rendu nul ; l''horloge est annoncée au planificateur comme une seule ligne');
select results_eq(
  $$select (select count(*) from public.my_cash_flows where game_day is not null),
           (select count(*) from public.my_income_statement where game_day is not null or season is not null),
           (select count(*) from public.my_income_statement), pg_temp.drift()$$,
  $$values (0::bigint, 0::bigint, 2::bigint, 0::bigint)$$, 'les flux et le compte de résultat restent lisibles, sans jour ni saison, sommes conservées');

select * from finish();
rollback;
