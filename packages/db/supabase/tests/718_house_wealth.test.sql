begin;
select plan(16);

-- Jeu d'essai : un monde à lui, deux cités (Kallistè, Halos). Alice (métèque de Kallistè), Bob (de Halos), une
-- maison PNJ de secours à Kallistè et Chloé, sans citoyenneté ni séquestre. Un second monde a la maison de Dion.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000718f0', 'fortune', 'Fortune'), ('01900000-0000-7000-8000-0000000718f9', 'ailleurs', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000718c1', '01900000-0000-7000-8000-0000000718f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000718c2', '01900000-0000-7000-8000-0000000718f0', 'halos', 'Halos'),
  ('01900000-0000-7000-8000-0000000718c9', '01900000-0000-7000-8000-0000000718f9', 'delphis', 'Delphis');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000718a' || n)::uuid, 'wealth-' || n || '@example.test' from unnest(array['a', 'b', 'c', 'd', 'e']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000718' || n || '1')::uuid, w::uuid, ('00000000-0000-4000-8000-0000000718a' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides', '01900000-0000-7000-8000-0000000718f0'), ('b', 'Philaïdes', '01900000-0000-7000-8000-0000000718f0'),
             ('c', 'Bacchiades', '01900000-0000-7000-8000-0000000718f0'), ('d', 'Eumolpides', '01900000-0000-7000-8000-0000000718f9')) h (n, name, w);
insert into game.houses (id, world_id, user_id, name, blazon, kind) values
  ('00000000-0000-7000-8000-0000000718e1', '01900000-0000-7000-8000-0000000718f0', '00000000-0000-4000-8000-0000000718ae', 'Greniers', '{}', 'npc');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000718a1', '01900000-0000-7000-8000-0000000718c1'),
  ('00000000-0000-7000-8000-0000000718b1', '01900000-0000-7000-8000-0000000718c2'),
  ('00000000-0000-7000-8000-0000000718e1', '01900000-0000-7000-8000-0000000718c1'),
  ('00000000-0000-7000-8000-0000000718d1', '01900000-0000-7000-8000-0000000718c9');
-- Comptes : trésorerie de chaque maison (identifiant en `…<n>a`), séquestre d'Alice (`…aae`).
insert into game.accounts (id, world_id, kind, house_id)
select ('00000000-0000-7000-8000-0000000718' || n || 'a')::uuid, w::uuid, 'house', ('00000000-0000-7000-8000-0000000718' || n || '1')::uuid
from (values ('a', '01900000-0000-7000-8000-0000000718f0'), ('b', '01900000-0000-7000-8000-0000000718f0'), ('c', '01900000-0000-7000-8000-0000000718f0'),
             ('d', '01900000-0000-7000-8000-0000000718f9'), ('e', '01900000-0000-7000-8000-0000000718f0')) h (n, w);
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-000000718aae', '01900000-0000-7000-8000-0000000718f0', 'escrow', '00000000-0000-7000-8000-0000000718a1');
create function pg_temp.post(world uuid, kind text, accounts uuid[], amounts bigint[]) returns uuid language plpgsql as $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values (world, kind) returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) select entry, u.a, u.n from unnest(accounts, amounts) u (a, n);
  return entry;
end $$;
-- Dotations : Alice 3 000, Bob 1 200, Chloé rien, la maison PNJ 50 000, Dion 999 ; Alice retient 40 pour un achat
-- en attente de 8 blés à 5.
select pg_temp.post(w::uuid, 'house.starting_grant',
  array[(select id from game.accounts where world_id = w::uuid and system_key = 'faucet_starting_grant'), ('00000000-0000-7000-8000-0000000718' || n || 'a')::uuid],
  array[-amount, amount])
from (values ('a', 3000, '01900000-0000-7000-8000-0000000718f0'), ('b', 1200, '01900000-0000-7000-8000-0000000718f0'),
             ('e', 50000, '01900000-0000-7000-8000-0000000718f0'), ('d', 999, '01900000-0000-7000-8000-0000000718f9')) g (n, amount, w);
insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining) values
  ('01900000-0000-7000-8000-0000000718f0', '01900000-0000-7000-8000-0000000718c1', '00000000-0000-7000-8000-0000000718a1', 'wheat', 'buy', 5, 8, 8);
select pg_temp.post('01900000-0000-7000-8000-0000000718f0', 'market.escrow_hold',
  array['00000000-0000-7000-8000-0000000718aa', '00000000-0000-7000-8000-000000718aae']::uuid[], array[-40, 40]);
-- Stocks : Alice 100 blés à Kallistè (prix 8), 30 blés à Halos (prix 11), 5 olives à Kallistè (jamais échangées) et un
-- stock de sel vidé ; Bob 7 olives à Halos (prix 20) ; Chloé 4 laines (sans prix) ; la maison PNJ 900 blés à Kallistè.
insert into game.inventories (id, world_id, house_id, city_id, good_id)
select ('00000000-0000-7000-8000-00000718' || s.tag)::uuid, '01900000-0000-7000-8000-0000000718f0',
       ('00000000-0000-7000-8000-0000000718' || left(s.tag, 1) || '1')::uuid, ('01900000-0000-7000-8000-0000000718' || s.city)::uuid, s.good
from (values ('a001', 'c1', 'wheat'), ('a002', 'c2', 'wheat'), ('a003', 'c1', 'olives'), ('a004', 'c1', 'salt'),
             ('b001', 'c2', 'olives'), ('c001', 'c1', 'wool'), ('e001', 'c1', 'wheat')) s (tag, city, good);
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
select '01900000-0000-7000-8000-0000000718f0', i.good_id, s.quantity, 'production', i.id, 'site.collect'
from (values ('a001', 100), ('a002', 30), ('a003', 5), ('a004', 2), ('b001', 7), ('c001', 4), ('e001', 900)) s (tag, quantity)
join game.inventories i on i.id = ('00000000-0000-7000-8000-00000718' || s.tag)::uuid;
insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind) values
  ('01900000-0000-7000-8000-0000000718f0', 'salt', 2, '00000000-0000-7000-8000-00000718a004', 'consumption', 'npc.consume');
insert into game.observed_prices (world_id, city_id, good_id, price, volume, window_seconds, observed_at) values
  ('01900000-0000-7000-8000-0000000718f0', '01900000-0000-7000-8000-0000000718c1', 'wheat', 8, 20, 86400, now()),
  ('01900000-0000-7000-8000-0000000718f0', '01900000-0000-7000-8000-0000000718c2', 'wheat', 11, 20, 86400, now()),
  ('01900000-0000-7000-8000-0000000718f0', '01900000-0000-7000-8000-0000000718c2', 'olives', 20, 3, 86400, now()),
  ('01900000-0000-7000-8000-0000000718f0', '01900000-0000-7000-8000-0000000718c1', 'salt', 2, 3, 86400, now());
select lives_ok('set constraints all immediate', 'jeu d''essai valide : écritures équilibrées, séquestre égal au reste à payer');
set constraints all deferred;

create function pg_temp.as_service(statement text) returns setof text language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  return query execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.wealths(world text) returns text language sql as $$
  select string_agg(r, ' ') from pg_temp.as_service(format(
    'select concat_ws(%L, right(house_id::text, 2), coalesce(right(city_id::text, 2), %L), npc, treasury, escrow, stock_value, unpriced_stocks, wealth)
     from game.house_wealth(%s)', ':', '', coalesce(quote_literal(world) || '::uuid', 'null'))) r
$$;

-- Droits : le seul service exécute la fonction ; un joueur connecté ou un visiteur ne l'appelle pas.
select ok(not has_function_privilege('authenticated', 'game.house_wealth(uuid)', 'execute'), 'un joueur connecté n''exécute pas la fonction');
select ok(not has_function_privilege('anon', 'game.house_wealth(uuid)', 'execute'), 'un visiteur n''exécute pas la fonction');
select ok(has_function_privilege('oikos_service', 'game.house_wealth(uuid)', 'execute'), 'le service exécute la fonction');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000718ab", "role": "authenticated"}', true);
select throws_ok('select * from game.house_wealth(null)', '42501', null, 'Bob ne lit pas la fortune des maisons, ni la sienne');
select throws_ok($$select * from game.house_wealth('01900000-0000-7000-8000-0000000718f0')$$, '42501', null, 'ni celle de son monde');
select throws_ok('select kind from game.houses', '42501', null, 'un joueur connecté ne lit pas la nature d''une maison');
reset role;

-- Valeurs : trésorerie, séquestre, stocks au prix de leur cité (Alice : 800 + 330, le sel vidé ne compte pas),
-- stocks sans prix comptés à part ; Chloé, sans séquestre ni citoyenneté, a une fortune nulle.
select is(pg_temp.wealths('01900000-0000-7000-8000-0000000718f0'),
  'a1:c1:f:2960:40:1130:1:4130 b1:c2:f:1200:0:140:0:1340 c1::f:0:0:0:1:0 e1:c1:t:50000:0:7200:0:57200',
  'fortune de chaque maison du monde, la maison PNJ marquée comme telle');
select is(pg_temp.wealths('01900000-0000-7000-8000-0000000718f9'), 'd1:c9:f:999:0:0:0:999', 'un monde : ses seules maisons');
select is((select count(*)::integer from pg_temp.as_service($$select house_id::text from game.house_wealth(null)
  where house_id::text like '00000000-0000-7000-8000-0000000718%'$$)), 5, 'sans monde : les maisons de tous les mondes');
-- Accord avec le bilan de chaque maison, que la fonction ne recopie pas.
select is((select count(*)::integer from public.my_balance_sheet b
  join game.house_wealth('01900000-0000-7000-8000-0000000718f0') w on w.house_id = b.house_id
  where (b.treasury, b.escrow, b.stock_value, b.unpriced_stocks) is distinct from (w.treasury, w.escrow, w.stock_value, w.unpriced_stocks::bigint)), 0,
  'trésorerie, séquestre, valeur des stocks et stocks sans prix égaux à ceux du bilan');

-- Nature d'une maison : `player` par défaut, une liste fermée, que le service ne change pas.
select is((select string_agg(kind, ' ' order by name) from game.houses where world_id = '01900000-0000-7000-8000-0000000718f0'),
  'player player npc player', 'une maison fondée sans nature est une maison de joueur');
select throws_ok($$update game.houses set kind = 'god' where id = '00000000-0000-7000-8000-0000000718a1'$$, '23514', null, 'nature hors de la liste refusée');
select ok(not has_column_privilege('oikos_service', 'game.houses', 'kind', 'update'), 'le service ne change pas la nature d''une maison');

-- Aucune lecture exposée au client ne rend la fortune. Une fuite passerait par une vue ou une vue matérialisée lisible
-- par un joueur ou un visiteur qui appelle la fonction, par une colonne de fortune ou de Gini d'une telle relation, ou
-- par une fonction qu'ils exécutent et dont le corps (texte ou corps SQL standard) cite la fonction. Les objets
-- temporaires du test sont écartés : `pg_temp.leaks` elle-même cite la fonction.
create function pg_temp.leaks() returns text language sql as $$
  select string_agg(item, ' ' order by item) from (
    select 'relation:' || n.nspname || '.' || c.relname as item
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm') and n.nspname !~ '^pg_temp' and pg_get_viewdef(c.oid) like '%house\_wealth%'
      and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select'))
    union all
    select 'column:' || n.nspname || '.' || c.relname || '.' || a.attname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('v', 'm') and n.nspname !~ '^pg_temp' and a.attname ~ '(wealth|fortune|gini)'
      and (has_column_privilege('authenticated', c.oid, a.attnum, 'select') or has_column_privilege('anon', c.oid, a.attnum, 'select'))
    union all
    select 'function:' || n.nspname || '.' || p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname !~ '^pg_temp' and p.prokind in ('f', 'p')
      and (p.prosrc || coalesce(pg_get_function_sqlbody(p.oid), '')) like '%house\_wealth%'
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
  ) l
$$;
select is(pg_temp.leaks(), null, 'aucune vue, vue matérialisée ni fonction exposée au client ne rend la fortune');
-- Le contrôle voit chaque forme de fuite : une vue, une vue matérialisée, une fonction au corps texte et une au corps
-- SQL standard, posées ici et effacées avec la transaction.
create view public.leak_view as select house_id, wealth from game.house_wealth(null);
grant select on public.leak_view to authenticated;
create materialized view public.leak_matview as select 1 as gini;
grant select on public.leak_matview to anon;
create function public.leak_text() returns bigint language sql security definer set search_path = '' as
  'select sum(wealth)::bigint from game.house_wealth(null)';
create function public.leak_atomic() returns bigint language sql security definer set search_path = ''
  begin atomic select sum(w.wealth)::bigint from game.house_wealth(null) w; end;
-- Les droits par défaut du schéma `public` ne donnent rien aux clients (migration 1) : la fuite est un droit accordé.
grant execute on function public.leak_text() to authenticated;
grant execute on function public.leak_atomic() to anon;
select is(pg_temp.leaks(),
  'column:public.leak_matview.gini column:public.leak_view.wealth function:public.leak_atomic function:public.leak_text relation:public.leak_view',
  'le contrôle voit une vue, une vue matérialisée et une fonction, au corps texte ou SQL standard');

select * from finish();
rollback;
