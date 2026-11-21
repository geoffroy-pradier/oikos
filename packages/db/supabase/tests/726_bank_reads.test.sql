begin;
select plan(22);

-- Jeu d'essai : un monde à lui. Alice (a) et Bob (b) y ont leur maison de Kallistè ; Dion (d) la sienne dans un autre
-- monde. Alice fonde sa banque (droit de 5 000, capital de 20 000), Dion la sienne. Configuration en vigueur : capital
-- minimal de 15 000, ratio de réserve de 20 %.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000726e0', 'lectures-726', 'Lectures'), ('01900000-0000-7000-8000-0000000726e9', 'ailleurs-726', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000726d1', '01900000-0000-7000-8000-0000000726e0', 'k726r', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000726d9', '01900000-0000-7000-8000-0000000726e9', 'd726r', 'Delphis');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000726b' || n)::uuid, 'bank-reads-726-' || n || '@example.test' from unnest(array['a', 'b', 'd']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000726' || n || '2')::uuid, ('01900000-0000-7000-8000-0000000726' || w)::uuid,
       ('00000000-0000-4000-8000-0000000726b' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides', 'e0'), ('b', 'Philaïdes', 'e0'), ('d', 'Eumolpides', 'e9')) h (n, name, w);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000000726' || n || '2')::uuid, ('01900000-0000-7000-8000-0000000726' || c)::uuid
from (values ('a', 'd1'), ('b', 'd1'), ('d', 'd9')) h (n, c);
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where id::text like '00000000-0000-7000-8000-0000000726_2';
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c726',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
    "banks": {"charterFeeOboles": 5000, "minCapitalOboles": 15000, "reserveRatioBps": 2000,
              "depositRateBps": {"min": 0, "max": 1500}, "loanRateBps": {"min": 300, "max": 5000}}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c726', now());

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000726' || n || '2')::uuid
$$;
-- Écriture du propriétaire : `kind`, nommant la banque `bank`, de `amount` oboles du compte `src` au compte `dst`.
create function pg_temp.post(world uuid, kind text, bank uuid, src uuid, dst uuid, amount bigint) returns void
language plpgsql as $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta) values (world, kind, jsonb_build_object('bankId', bank))
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, dst, amount), (entry, src, -amount);
end $$;
do $$
declare
  h record; bank uuid;
begin
  for h in select ho.id, ho.world_id, c.city_id, t.id as treasury,
                  (select id from game.accounts where world_id = ho.world_id and system_key = 'faucet_starting_grant') as faucet,
                  (select id from game.accounts where world_id = ho.world_id and system_key = 'sink_bank_charter') as sink
           from game.houses ho join game.citizenships c on c.house_id = ho.id
           join game.accounts t on t.house_id = ho.id and t.kind = 'house'
           where ho.id::text like '00000000-0000-7000-8000-0000000726_2' loop
    perform pg_temp.post(h.world_id, 'house.starting_grant', null, h.faucet, h.treasury, 50000);
    continue when h.id = pg_temp.house('b');
    insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
    values (h.world_id, h.city_id, h.id, case when h.id = pg_temp.house('a') then 'Trapeza Alkmaion' else 'Trapeza Eumolpos' end,
      0, 300, 5000) returning id into bank;
    perform pg_temp.post(h.world_id, 'bank.charter', bank, h.treasury, h.sink, 5000);
    perform pg_temp.post(h.world_id, 'bank.capital_in', bank, h.treasury, (select id from game.accounts where bank_id = bank),
      20000);
  end loop;
end $$;
set constraints all immediate;
set constraints all deferred;

-- Alice : les banques de son monde, son coffre et sa réserve, ses flux.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000726ba", "role": "authenticated"}', true);
select is((select string_agg(name || ':' || deposit_rate_bps || ':' || loan_rate_bps, ' ') from public.banks),
  'Trapeza Alkmaion:0:300', 'Alice lit les banques de son monde et leurs taux, pas celle de Dion');
select is((select count(*)::integer from public.banks where house_id = '00000000-0000-7000-8000-0000000726a2' and city_id = '01900000-0000-7000-8000-0000000726d1'),
  1, 'avec leur maison et leur cité');
select throws_ok('select charter_fee from game.banks', '42501', null, 'ni le droit payé');
select is((select vault || ':' || required_reserve from public.my_bank), '20000:15000',
  'son coffre et sa réserve exigée : le capital minimal, sans dépôt');
select is((select count(*)::integer from game.accounts where kind = 'treasury'), 0, 'elle ne lit pas le coffre dans la table');
select is((select string_agg(nature || ':' || amount, ' ' order by nature) from public.my_cash_flows),
  'bank_capital:-20000 bank_charter:-5000 grant:50000', 'flux : le droit et le capital versé, chacun sous sa nature');
select is((select upkeep || ':' || operating_result || ':' || other || ':' || non_operating || ':' || cash_change
   from public.my_income_statement),
  '0:0:-25000:25000:25000', 'résultat : droit et capital hors exploitation, rien en exploitation');
select is((select charter_fee_oboles || ':' || min_capital_oboles || ':' || reserve_ratio_bps || ':' || deposit_rate_min_bps
   || ':' || deposit_rate_max_bps || ':' || loan_rate_min_bps || ':' || loan_rate_max_bps from public.bank_rules),
  '5000:15000:2000:0:1500:300:5000', 'elle lit les règles des banques : droit, capital, réserve et bornes des taux');
select throws_ok($$insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
  values ('01900000-0000-7000-8000-0000000726e0', '01900000-0000-7000-8000-0000000726d1', '00000000-0000-7000-8000-0000000726b2',
          'Trapeza Bob', 0, 0, 0)$$, '42501', null, 'un joueur ne fonde pas de banque par la table');
select throws_ok($$update game.banks set deposit_rate_bps = 9000$$, '42501', null, 'ni ne change les taux');
select throws_ok($$select * from game.lock_bank_vault((select id from public.banks limit 1))$$, '42501', null,
  'ni ne verrouille un coffre');

-- Bob : la banque d'Alice dans la vue publique, aucune banque à lui, aucun coffre.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000726bb", "role": "authenticated"}', true);
select is((select count(*)::integer from public.banks), 1, 'Bob lit la banque d''Alice');
select is((select count(*)::integer from public.my_bank), 0, 'mais ni son coffre ni sa réserve');
select is((select count(*)::integer from game.my_bank()), 0, 'ni par la fonction');
select is((select string_agg(nature || ':' || amount, ' ') from public.my_cash_flows), 'grant:50000', 'ni ses flux');
-- Dion : sa banque, dans son monde seulement.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000726bd", "role": "authenticated"}', true);
select is((select string_agg(name, ' ') from public.banks), 'Trapeza Eumolpos', 'Dion ne lit que la banque de son monde');
select is((select vault::text from public.my_bank), '20000', 'et son coffre');
reset role;

set local role anon;
select throws_ok('select * from public.banks', '42501', null, 'un visiteur anonyme ne lit aucune banque');
select throws_ok('select * from public.my_bank', '42501', null, 'ni aucun coffre');
select throws_ok('select * from public.bank_rules', '42501', null, 'ni les règles des banques');
reset role;

-- Une version en vigueur sans section `banks` : aucune règle, la réserve devient inconnue.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c727', '{}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c727', now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000726ba", "role": "authenticated"}', true);
select is((select count(*)::integer from public.bank_rules), 0, 'sans section, aucune règle des banques');
select is((select coalesce(required_reserve::text, 'inconnue') || ':' || vault from public.my_bank), 'inconnue:20000',
  'le coffre reste lisible, la réserve est inconnue');
reset role;

select * from finish();
rollback;
