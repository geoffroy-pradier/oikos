begin;
select plan(28);

-- Jeu d'essai : clôture à 4 h, heure de Paris ; le 10 novembre 2026 est le jour de jeu 20767. Alice et
-- Bob ont chacun une maison, Chloé n'en a pas.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c001', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c001', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'), ('00000000-0000-4000-8000-00000000000b', 'bob@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000b1');

create function pg_temp.sys(key text) returns uuid language sql as $$
  select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001' and system_key = key
$$;
-- Une écriture équilibrée datée, de la nature donnée, dont chaque ligne porte le marqueur donné (nul : aucun).
create function pg_temp.post(kind text, at timestamptz, accounts uuid[], amounts bigint[], natures text[] default null, meta jsonb default '{}')
returns uuid language plpgsql as $$
declare
  entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta, created_at) values ('01900000-0000-7000-8000-000000000001', kind, meta, at)
    returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount, nature)
  select entry, u.account, u.amount, natures[u.n] from unnest(accounts, amounts) with ordinality u (account, amount, n);
  return entry;
end $$;

-- Jour 0 : dotations, puis un entretien d'avant le personnel (sans marqueur). Jour 1, à la clôture : entretien
-- 30 et salaires 12 dans la même écriture, une ligne de débit de la trésorerie par nature. Jour 2 : relance
-- (entretien 5, salaires 4).
select pg_temp.post('house.starting_grant', '2026-11-10 12:00+01', array[pg_temp.sys('faucet_starting_grant'), h]::uuid[], array[-3000, 3000])
from unnest(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[]) h;
select pg_temp.post('upkeep.daily', '2026-11-10 13:00+01', array[pg_temp.sys('sink_upkeep'), '00000000-0000-7000-8000-0000000000aa'], array[20, -20],
  null, '{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20767}');
select pg_temp.post('upkeep.daily', '2026-11-11 04:00+01',
  array['00000000-0000-7000-8000-0000000000aa', pg_temp.sys('sink_upkeep'), '00000000-0000-7000-8000-0000000000aa', pg_temp.sys('sink_npc_wages')]::uuid[],
  array[-30, 30, -12, 12], array['upkeep', null, 'wages', null], '{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20768}');
select pg_temp.post('upkeep.restart', '2026-11-12 09:00+01',
  array['00000000-0000-7000-8000-0000000000aa', pg_temp.sys('sink_upkeep'), '00000000-0000-7000-8000-0000000000aa', pg_temp.sys('sink_npc_wages')]::uuid[],
  array[-5, 5, -4, 4], array['upkeep', null, 'wages', null]);
select lives_ok('set constraints all immediate', 'jeu d''essai valide : écritures équilibrées');
set constraints all deferred;

-- Catalogue : liste fermée tenue par la base, colonne facultative.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'game.ledger_lines'::regclass and conname = 'ledger_lines_nature_known'),
  'CHECK ((nature = ANY (ARRAY[''upkeep''::text, ''wages''::text])))', 'natures d''une ligne : liste figée (LEDGER_LINE_NATURES, packages/sim)');
select is((select is_nullable from information_schema.columns where table_schema = 'game' and table_name = 'ledger_lines' and column_name = 'nature'),
  'YES', 'le marqueur est facultatif');
select is((select count(*) from game.ledger_lines where nature is null and entry_id in (select id from game.ledger_entries where kind = 'house.starting_grant')),
  4::bigint, 'une ligne écrite sans marqueur n''en a pas : les lignes d''avant la migration restent sans nature');
select throws_ok(
  $$select pg_temp.post('upkeep.restart', now(), array[pg_temp.sys('sink_upkeep'), '00000000-0000-7000-8000-0000000000aa'], array[1, -1], array[null, n])
    from unnest(array['lodging', 'Wages', '']) n$$,
  '23514', null, 'une nature hors de la liste est refusée, même à la casse près');

-- Écrit à l'insertion seulement : ni le service ni le propriétaire ne le changent ensuite.
select ok(has_column_privilege('oikos_service', 'game.ledger_lines', 'nature', 'insert'), 'le service écrit le marqueur à l''insertion');
select ok(not has_column_privilege('oikos_service', 'game.ledger_lines', 'nature', 'update'), 'et ne peut pas le modifier');
select throws_ok($$update game.ledger_lines set nature = 'upkeep' where nature = 'wages'$$, '23001', null,
  'même le propriétaire ne requalifie pas une ligne : le grand livre est en ajout seul');
select throws_ok($$update game.ledger_lines set nature = null where nature is not null$$, '23001', null, 'ni ne lui retire son marqueur');
set local role oikos_service;
select throws_ok($$update game.ledger_lines set nature = 'upkeep' where nature = 'wages'$$, '42501', null, 'le service est refusé avant même la garde');
reset role;

-- Joueurs : lecture de la nature de leurs seules lignes, aucune écriture.
select is(
  (select string_agg(p, ' ' order by p) from unnest(array['select', 'insert', 'update']) p
   where has_column_privilege('authenticated', 'game.ledger_lines', 'nature', p)),
  'select', 'un joueur lit le marqueur, ne l''écrit ni ne le change');
select ok(not has_column_privilege('anon', 'game.ledger_lines', 'nature', 'select'), 'un visiteur ne le lit pas');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select results_eq(
  'select nature, amount from game.ledger_lines where nature is not null order by amount',
  $$values ('upkeep', -30::bigint), ('wages', -12), ('upkeep', -5), ('wages', -4)$$,
  'Alice lit la nature de ses lignes ; les lignes des puits lui restent cachées');
select results_eq(
  'select account, game_day - 20767, nature, amount from public.my_cash_flows order by game_day, nature',
  $$values ('treasury', 0, 'grant', 3000::bigint), ('treasury', 0, 'upkeep', -20),
           ('treasury', 1, 'upkeep', -30), ('treasury', 1, 'wages', -12),
           ('treasury', 2, 'upkeep', -5), ('treasury', 2, 'wages', -4)$$,
  'ses flux : une ligne marquée prend sa nature, une ligne sans marqueur celle de son écriture');
select results_eq(
  'select game_day - 20767, upkeep, operating_result, other, non_operating, cash_change from public.my_income_statement order by game_day',
  $$values (0, -20::bigint, -20::bigint, 0::bigint, 3000::bigint, 2980::bigint), (1, -42, -42, 0, 0, -42), (2, -9, -9, 0, 0, -9)$$,
  'son compte de résultat : salaires en charge d''exploitation, avec l''entretien (dû des sites), jamais dans « autres »');
select results_eq(
  'select upkeep, operating_result, other, cash_change from public.my_income_statement_by_season',
  $$values (-71::bigint, -71::bigint, 0::bigint, 2929::bigint)$$, 'et par saison');
select is(
  (select string_agg(table_name || '(' || cols || ')', ' ' order by table_name)
   from (select table_name::text, string_agg(column_name::text, ',' order by ordinal_position) as cols from information_schema.columns
         where table_schema = 'public' and table_name in ('my_cash_flows', 'my_income_statement') group by table_name) v),
  'my_cash_flows(house_id,account,game_day,nature,amount) '
    || 'my_income_statement(house_id,game_day,season,sales,purchases,taxes,upkeep,operating_result,acquisitions,grants,other,non_operating,cash_change,escrow_change)',
  'colonnes inchangées : le rejeu des migrations 32 et 33 reste possible, le code précédent reste servi');
select throws_ok($$insert into game.ledger_lines (entry_id, account_id, amount, nature) select entry_id, account_id, -1, 'wages' from game.ledger_lines limit 1$$,
  '42501', null, 'pas de ligne marquée ajoutée par un joueur');

-- Bob ne lit rien des lignes ni des flux d'Alice ; Chloé, sans maison, rien du tout.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select is((select count(*) from game.ledger_lines where nature is not null), 0::bigint, 'Bob ne lit aucune ligne marquée d''Alice');
select results_eq('select nature, amount from public.my_cash_flows', $$values ('grant', 3000::bigint)$$, 'ni ses salaires dans les flux');
select is((select count(*) from public.my_income_statement where upkeep <> 0), 0::bigint, 'ni dans le compte de résultat');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}';
select is((select count(*) from game.ledger_lines) + (select count(*) from public.my_cash_flows) + (select count(*) from public.my_income_statement),
  0::bigint, 'un compte sans maison ne lit rien');
reset role;

-- Conservation, sur 200 écritures tirées au sort sur six jours : une nature d'écriture connue ou non, la
-- ligne de la maison marquée ou non, dans les deux sens.
select setseed(0.255);
select count(pg_temp.post(r.kind, timestamptz '2026-11-13 03:00+00' + random() * interval '144 hours',
         array[pg_temp.sys('faucet_rewards'), r.house]::uuid[], array[-r.amount, r.amount], array[null, r.nature]))
from (select (array['upkeep.restart', 'site.acquire', 'house.starting_grant', 'test.unknown'])[1 + floor(random() * 4)::integer] as kind,
             (array[null, 'upkeep', 'wages'])[1 + floor(random() * 3)::integer] as nature,
             (array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb'])[1 + floor(random() * 2)::integer]::uuid as house,
             (1 + floor(random() * 20)::bigint) * (case when random() < 0.7 then -1 else 1 end) as amount
      from generate_series(1, 200)) r
where r.amount <> 0;
select lives_ok('set constraints all immediate', 'écritures toujours valides');
set constraints all deferred;
select results_eq(
  $$select house_id, game_day, sum(amount)::bigint from public.my_cash_flows group by 1, 2 having sum(amount) <> 0 order by 1, 2$$,
  $$select a.house_id, 20767 + floor(extract(epoch from e.created_at - timestamptz '2026-11-10 03:00+00') / 86400)::integer, sum(l.amount)::bigint
    from game.ledger_lines l join game.ledger_entries e on e.id = l.entry_id join game.accounts a on a.id = l.account_id
    where a.house_id is not null group by 1, 2 having sum(l.amount) <> 0 order by 1, 2$$,
  'par maison et par jour de jeu, la somme des flux est la variation du solde');
select results_eq(
  $$select house_id, game_day, operating_result, upkeep, cash_change from public.my_income_statement order by 1, 2$$,
  $$select a.house_id, 20767 + floor(extract(epoch from e.created_at - timestamptz '2026-11-10 03:00+00') / 86400)::integer,
           coalesce(sum(l.amount) filter (where l.nature is not null or e.kind in ('upkeep.daily', 'upkeep.restart')), 0)::bigint,
           coalesce(sum(l.amount) filter (where l.nature is not null or e.kind in ('upkeep.daily', 'upkeep.restart')), 0)::bigint,
           sum(l.amount)::bigint
    from game.ledger_lines l join game.ledger_entries e on e.id = l.entry_id join game.accounts a on a.id = l.account_id
    where a.house_id is not null group by 1, 2 order by 1, 2$$,
  'compte de résultat : exploitation, dû des sites et variation recalculés sur le grand livre, sans les vues');
select is(
  (select count(*) from game.accounts a where a.house_id is not null
     and a.balance <> (select coalesce(sum(s.cash_change), 0) from public.my_income_statement s where s.house_id = a.house_id)),
  0::bigint, 'pour chaque maison, la somme des variations du compte de résultat est son solde');
select is(
  (select count(*) from public.my_income_statement
   where sales + purchases + taxes + upkeep <> operating_result or acquisitions + grants + other <> non_operating
      or operating_result + non_operating <> cash_change),
  0::bigint, 'sur chaque ligne, les détails font les sous-totaux et les sous-totaux la variation');

-- L'achat d'un navire (migration 51, ticket 251) reste une acquisition : cette redéfinition le garde.
select pg_temp.post('ship.acquire', '2026-10-01 12:00+02', array[pg_temp.sys('sink_site_acquisition'), '00000000-0000-7000-8000-0000000000bb'], array[7, -7]);
select results_eq($$select nature, amount from public.my_cash_flows where game_day = date '2026-10-01' - date '1970-01-01'$$,
  $$values ('acquisitions', -7::bigint)$$, 'un navire acheté est une acquisition');

select * from finish();
rollback;
