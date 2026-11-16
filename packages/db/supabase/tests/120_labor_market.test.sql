begin;
select plan(25);

-- Jeu d'essai : un monde à lui, deux cités, deux maisons ; Alice reçoit sa dotation. Les lignes du marché du
-- travail et les écritures de l'hébergement sont posées sous le rôle de service, comme par le moteur et l'API.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c120', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c120', now());
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000120f0', 'travail', 'Travail');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000120f1', '01900000-0000-7000-8000-0000000120f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000120f2', '01900000-0000-7000-8000-0000000120f0', 'elaia', 'Elaia');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000120aa', 'travail-alice@example.test'),
  ('00000000-0000-4000-8000-0000000120ab', 'travail-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000120a1', '01900000-0000-7000-8000-0000000120f0', '00000000-0000-4000-8000-0000000120aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000120b1', '01900000-0000-7000-8000-0000000120f0', '00000000-0000-4000-8000-0000000120ab', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000120a2', '01900000-0000-7000-8000-0000000120f0', 'house', '00000000-0000-7000-8000-0000000120a1'),
  ('00000000-0000-7000-8000-0000000120b2', '01900000-0000-7000-8000-0000000120f0', 'house', '00000000-0000-7000-8000-0000000120b1');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.svc(statement text) returns text language sql as $$
  select 'select pg_temp.as_service(' || quote_literal(statement) || ')'
$$;
create function pg_temp.sys(key text) returns uuid language sql as $$
  select id from game.accounts where world_id = '01900000-0000-7000-8000-0000000120f0' and system_key = key
$$;
-- Écriture `kind` de la maison d'Alice vers le puits `sink`, de `amount` oboles, avec `meta`.
create function pg_temp.post(kind text, sink text, amount bigint, meta jsonb) returns text language sql as $$
  select pg_temp.svc(format($s$with entry as (insert into game.ledger_entries (world_id, kind, meta)
      values ('01900000-0000-7000-8000-0000000120f0', %L, %L) returning id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, a, m from entry, (values (%L::uuid, %s::bigint), (%L::uuid, %s::bigint)) l (a, m)$s$,
    kind, meta, '00000000-0000-7000-8000-0000000120a2', -amount, pg_temp.sys(sink), amount))
$$;
create function pg_temp.market(city text, day integer) returns text language sql as $$
  select pg_temp.svc(format($s$insert into game.labor_market
      (world_id, city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles)
    values ('01900000-0000-7000-8000-0000000120f0', %L, %s, 1000, 40, 12, 9, 4)$s$, city, day))
$$;
create function pg_temp.record(day integer) returns void language sql as $$
  insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-0000000120f0', day, '2026-11-14 03:00+00', '00000000-0000-7000-8000-00000000c120')
$$;

with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000120f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a, m from entry,
  (values ('00000000-0000-7000-8000-0000000120a2'::uuid, 5000::bigint), (pg_temp.sys('faucet_starting_grant'), -5000)) l (a, m);

-- Le puits, dans chaque monde, jamais débiteur.
select is((select count(*) from game.worlds w
           where not exists (select 1 from game.accounts a where a.world_id = w.id and a.system_key = 'sink_npc_lodging'
                             and not a.allow_negative)),
  0::bigint, 'le puits de l''hébergement existe dans chaque monde, jamais débiteur');

-- Droits, lus dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.labor_market'::regclass), 'règles par ligne actives');
select is(
  (select string_agg(column_name || ':' || privilege_type, ' ' order by column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'labor_market' and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'city_id:INSERT employed:INSERT game_day:INSERT lodging_oboles:INSERT supply:INSERT unhoused:INSERT '
    || 'wage_oboles:INSERT world_id:INSERT',
  'le service crée une ligne sans en choisir la date, et n''en modifie rien : liste figée');
select ok(not has_table_privilege('oikos_service', 'game.labor_market', 'delete')
  and not has_table_privilege('oikos_service', 'game.labor_market', 'update')
  and not has_any_column_privilege('anon', 'game.labor_market', 'select')
  and not has_any_column_privilege('authenticated', 'game.labor_market', 'insert, update'),
  'ni suppression, ni modification, ni écriture d''un client');
select ok(not exists (select 1 from pg_roles r where has_function_privilege(r.oid, 'game.guard_labor_market()', 'execute')
  and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')), 'personne n''exécute la garde');

-- Une ligne par cité et par jour, dans la transaction qui enregistre la clôture de ce jour.
select lives_ok(pg_temp.market('01900000-0000-7000-8000-0000000120f1', 20000), 'la clôture fixe le marché du jour d''une cité');
select lives_ok(pg_temp.market('01900000-0000-7000-8000-0000000120f2', 20000), 'et celui d''une autre cité');
select throws_ok(pg_temp.market('01900000-0000-7000-8000-0000000120f1', 20000), '23505', null, 'une fois par cité et par jour');
select throws_ok(pg_temp.svc($s$insert into game.labor_market (world_id, city_id, game_day, employed, unhoused, wage_oboles, lodging_oboles)
  values ('01900000-0000-7000-8000-0000000120f0', '01900000-0000-7000-8000-0000000120f1', 20001, 3, 4, 0, 0)$s$),
  '23514', null, 'pas plus de non logés que d''employés');
select is((select supply from game.labor_market where city_id = '01900000-0000-7000-8000-0000000120f1'), 1000::bigint,
  'l''offre est enregistrée ; nulle, elle est sans limite');
select pg_temp.record(20000);
select throws_ok(pg_temp.market('01900000-0000-7000-8000-0000000120f2', 20000), '23001',
  'a labor market is set before its close is recorded', 'pas pour un jour dont la clôture est déjà enregistrée');
select throws_ok(pg_temp.market('01900000-0000-7000-8000-0000000120f1', 19999), '23001',
  'a labor market is set before its close is recorded', 'pas pour un jour passé, dont une clôture postérieure est enregistrée');
select lives_ok(pg_temp.market('01900000-0000-7000-8000-0000000120f1', 20001), 'le jour suivant, à sa clôture');
select throws_ok(pg_temp.svc($s$update game.labor_market set wage_oboles = 1$s$), '42501', null, 'le service ne modifie rien');
select throws_ok($$update game.labor_market set wage_oboles = 1$$, '23001', null, 'personne ne modifie une ligne');
select throws_ok($$delete from game.labor_market$$, '23001', null, 'ni ne la supprime');

-- Écritures de l'hébergement : la maison et le jour pour la clôture, une fois ; la maison et le site pour la relance.
select lives_ok(pg_temp.post('lodging.daily', 'sink_npc_lodging', 12,
  '{"houseId": "00000000-0000-7000-8000-0000000120a1", "gameDay": 20001}'), 'hébergement d''une clôture');
select throws_ok(pg_temp.post('lodging.daily', 'sink_npc_lodging', 12,
  '{"houseId": "00000000-0000-7000-8000-0000000120a1", "gameDay": 20001}'), '23505', null, 'une fois par maison et par jour');
select throws_ok(pg_temp.post('lodging.daily', 'sink_npc_lodging', 12,
  '{"houseId": "00000000-0000-7000-8000-0000000120a1", "gameDay": 20001.0}'), '23514', null, 'jour de jeu typé');
select throws_ok(pg_temp.post('lodging.restart', 'sink_npc_lodging', 4, '{"houseId": "00000000-0000-7000-8000-0000000120a1"}'),
  '23514', null, 'la relance désigne son site');
select lives_ok(pg_temp.post('lodging.restart', 'sink_npc_lodging', 4,
  '{"houseId": "00000000-0000-7000-8000-0000000120a1", "siteId": "00000000-0000-7000-8000-0000000120c1"}'),
  'hébergement d''une relance');

-- Comptes de la maison : nature `lodging`, charge courante du compte de résultat.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000120aa", "role": "authenticated"}';
select results_eq('select nature, amount from public.my_cash_flows order by nature',
  $$values ('lodging', -16::bigint), ('other', 5000::bigint)$$, 'l''hébergement est rangé sous sa nature');
select results_eq('select upkeep, operating_result, cash_change from public.my_income_statement',
  $$values (-16::bigint, -16::bigint, 4984::bigint)$$, 'une charge courante, dans la colonne de l''entretien');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000120ab", "role": "authenticated"}';
select is((select count(*) from public.my_cash_flows), 0::bigint, 'Bob ne voit rien de l''hébergement d''Alice');
reset role;
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'my_income_statement'),
  array['house_id', 'game_day', 'season', 'sales', 'purchases', 'taxes', 'upkeep', 'operating_result', 'acquisitions',
        'grants', 'other', 'non_operating', 'cash_change', 'escrow_change'], 'colonnes du compte de résultat inchangées (ADR 0006)');

select * from finish();
rollback;
