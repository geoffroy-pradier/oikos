begin;
select plan(6);

-- Jeu d'essai : Alice reçoit sa dotation, achète un bien à la cité, le rénove (débit marqué `upkeep`) et
-- paie son entretien à la clôture (ligne marquée `upkeep` vers le puits des biens). Bob n'a rien.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c911', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c911', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000091aa', 'cash-alice@example.test'), ('00000000-0000-4000-8000-0000000091ab', 'cash-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000091a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000091aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000091b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000091ab', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000091a2', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000091a1'),
  ('00000000-0000-7000-8000-0000000091b2', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000091b1');

create function pg_temp.post(kind text, accounts uuid[], amounts bigint[], natures text[] default null, meta jsonb default '{}')
returns void language sql as $$
  with entry as (insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', kind, meta) returning id)
  insert into game.ledger_lines (entry_id, account_id, amount, nature)
  select entry.id, u.account, u.amount, natures[u.n] from entry, unnest(accounts, amounts) with ordinality u (account, amount, n);
$$;
create function pg_temp.sys(key text) returns uuid language sql as
  $$select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001' and system_key = key$$;

select pg_temp.post('house.starting_grant', array[pg_temp.sys('faucet_starting_grant'), '00000000-0000-7000-8000-0000000091a2'], array[-5000, 5000]);
select pg_temp.post('property.buy', array['00000000-0000-7000-8000-0000000091a2', pg_temp.sys('sink_property_purchase')], array[-3000, 3000]);
select pg_temp.post('property.renovate', array['00000000-0000-7000-8000-0000000091a2', pg_temp.sys('sink_property_works')],
  array[-300, 300], array['upkeep', null]);
-- Une rénovation sans marqueur (écrite par un code qui l'oublierait) reste de l'entretien.
select pg_temp.post('property.renovate', array['00000000-0000-7000-8000-0000000091a2', pg_temp.sys('sink_property_works')],
  array[-200, 200]);
select pg_temp.post('upkeep.daily', array['00000000-0000-7000-8000-0000000091a2', pg_temp.sys('sink_property_upkeep')],
  array[-40, 40], array['upkeep', null], '{"houseId": "00000000-0000-7000-8000-0000000091a1", "gameDay": 20771}');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000091aa", "role": "authenticated"}';
select results_eq('select nature, amount from public.my_cash_flows order by nature',
  $$values ('acquisitions', -3000::bigint), ('grant', 5000::bigint), ('upkeep', -540::bigint)$$,
  'l''achat d''un bien est une acquisition ; rénovation et entretien des biens, de l''entretien');
select results_eq('select sum(amount)::bigint from public.my_cash_flows', $$values (1460::bigint)$$,
  'chaque ligne comptée une fois et en entier : les flux font la variation de la trésorerie');
select results_eq('select upkeep, operating_result, acquisitions, other, non_operating, cash_change from public.my_income_statement',
  $$values (-540::bigint, -540::bigint, -3000::bigint, 0::bigint, 2000::bigint, 1460::bigint)$$,
  'rénovation et entretien : charges d''exploitation ; achat : hors exploitation, rien dans « autre »');
select results_eq('select upkeep, acquisitions, cash_change from public.my_income_statement_by_season',
  $$values (-540::bigint, -3000::bigint, 1460::bigint)$$, 'la vue par saison suit');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000091ab", "role": "authenticated"}';
select is((select count(*) from public.my_cash_flows), 0::bigint, 'Bob ne voit rien des biens d''Alice');
reset role;
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'my_cash_flows'),
  array['house_id', 'account', 'game_day', 'nature', 'amount'], 'colonnes des flux inchangées (ADR 0006)');

select * from finish();
rollback;
