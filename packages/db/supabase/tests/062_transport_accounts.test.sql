begin;
select plan(7);

-- Jeu d'essai : Alice reçoit sa dotation, achète un navire, le fait partir (provisions et droit de port)
-- et paie son entretien à la clôture. Bob a une maison et rien d'autre.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c801', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c801', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000008aa', 'transport-alice@example.test'), ('00000000-0000-4000-8000-0000000008ab', 'transport-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000008a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000008aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000008b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000008ab', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000008a2', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000008a1'),
  ('00000000-0000-7000-8000-0000000008b2', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000008b1');

create function pg_temp.post(kind text, accounts uuid[], amounts bigint[], natures text[] default null, meta jsonb default '{}')
returns void language sql as $$
  with entry as (insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', kind, meta) returning id)
  insert into game.ledger_lines (entry_id, account_id, amount, nature)
  select entry.id, u.account, u.amount, natures[u.n] from entry, unnest(accounts, amounts) with ordinality u (account, amount, n);
$$;
create function pg_temp.sys(key text) returns uuid language sql as
  $$select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001' and system_key = key$$;

select pg_temp.post('house.starting_grant', array[pg_temp.sys('faucet_starting_grant'), '00000000-0000-7000-8000-0000000008a2'], array[-3000, 3000]);
select pg_temp.post('ship.acquire', array['00000000-0000-7000-8000-0000000008a2', pg_temp.sys('sink_ship_purchase')], array[-2400, 2400]);
-- Départ : 30 de provisions, 52 de droit de port dont 26 détruites et 26 au trésor d'Elaia.
select pg_temp.post('voyage.departure',
  array['00000000-0000-7000-8000-0000000008a2', pg_temp.sys('sink_voyage_provisions'), '00000000-0000-7000-8000-0000000008a2',
        pg_temp.sys('sink_port_dues'), (select id from game.accounts where city_id = '01900000-0000-7000-8000-000000000103' and not npc_purse)],
  array[-30, 30, -52, 26, 26]);
-- Clôture : l'entretien du navire, une ligne marquée `upkeep` vers le puits des navires.
select pg_temp.post('upkeep.daily', array['00000000-0000-7000-8000-0000000008a2', pg_temp.sys('sink_ship_upkeep')], array[-25, 25],
  array['upkeep', null], '{"houseId": "00000000-0000-7000-8000-0000000008a1", "gameDay": 20771}');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000008aa", "role": "authenticated"}';
select results_eq('select nature, amount from public.my_cash_flows order by nature',
  $$values ('acquisitions', -2400::bigint), ('grant', 3000::bigint), ('transport', -82::bigint), ('upkeep', -25::bigint)$$,
  'le départ d''un voyage est du transport, l''entretien du navire de l''entretien');
select results_eq('select sum(amount)::bigint from public.my_cash_flows', $$values (493::bigint)$$,
  'chaque ligne comptée une fois et en entier : les flux font la variation de la trésorerie');
select results_eq('select upkeep, operating_result, other, non_operating, cash_change from public.my_income_statement',
  $$values (-107::bigint, -107::bigint, 0::bigint, 600::bigint, 493::bigint)$$,
  'transport et entretien des navires : charges d''exploitation, dans la colonne des charges courantes');
select results_eq('select upkeep, other, cash_change from public.my_income_statement_by_season',
  $$values (-107::bigint, 0::bigint, 493::bigint)$$, 'la vue par saison suit');
select results_eq('select balance from public.my_treasury', $$values (493::bigint)$$, 'et la trésorerie suit le grand livre');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000008ab", "role": "authenticated"}';
select is((select count(*) from public.my_cash_flows), 0::bigint, 'Bob ne voit rien des voyages d''Alice');
reset role;
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'my_income_statement'),
  array['house_id', 'game_day', 'season', 'sales', 'purchases', 'taxes', 'upkeep', 'operating_result',
        'acquisitions', 'grants', 'other', 'non_operating', 'cash_change', 'escrow_change'],
  'colonnes du compte de résultat inchangées (ADR 0006)');

select * from finish();
rollback;
