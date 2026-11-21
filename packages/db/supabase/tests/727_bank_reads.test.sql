begin;
select plan(25);

-- Jeu d'essai : un monde à lui. Alice (a) y fonde sa banque, 1 000 oboles de capital ; Bob (b) y dépose 10 001 oboles,
-- Chloé (c) 5 000, qu'elle retire. Dion (d), d'un autre monde, a sa banque et le dépôt d'Eudore (e). Trésoreries :
-- 50 000 chacune. Configuration en vigueur : capital minimal de 1 000, ratio de réserve de 20 %.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000727e0', 'lectures-727', 'Lectures'), ('01900000-0000-7000-8000-0000000727e9', 'ailleurs-727', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000727d1', '01900000-0000-7000-8000-0000000727e0', 'k727r', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000727d9', '01900000-0000-7000-8000-0000000727e9', 'd727r', 'Delphis');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000727b' || n)::uuid, 'deposit-reads-727-' || n || '@example.test'
from unnest(array['a', 'b', 'c', 'd', 'e']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000727' || n || '2')::uuid, ('01900000-0000-7000-8000-0000000727' || w)::uuid,
       ('00000000-0000-4000-8000-0000000727b' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides', 'e0'), ('b', 'Philaïdes', 'e0'), ('c', 'Kerykes', 'e0'), ('d', 'Eumolpides', 'e9'),
             ('e', 'Eudorides', 'e9')) h (n, name, w);
insert into game.citizenships (house_id, city_id)
select id, case when world_id = '01900000-0000-7000-8000-0000000727e0' then '01900000-0000-7000-8000-0000000727d1'::uuid
                else '01900000-0000-7000-8000-0000000727d9'::uuid end
from game.houses where id::text like '00000000-0000-7000-8000-0000000727_2';
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where id::text like '00000000-0000-7000-8000-0000000727_2';
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c728',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
    "banks": {"charterFeeOboles": 0, "minCapitalOboles": 1000, "reserveRatioBps": 2000,
              "depositRateBps": {"min": 0, "max": 1500}, "loanRateBps": {"min": 300, "max": 5000}}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c728', now());

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000727' || n || '2')::uuid
$$;
create function pg_temp.treasury(n text) returns uuid language sql as $$
  select id from game.accounts where kind = 'house' and house_id = pg_temp.house(n)
$$;
-- Écriture du propriétaire : `kind`, nommant la banque `bank`, de `amount` oboles du compte `src` au compte `dst`.
create function pg_temp.post(world uuid, kind text, bank uuid, src uuid, dst uuid, amount bigint) returns uuid
language plpgsql as $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta) values (world, kind, jsonb_build_object('bankId', bank))
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, dst, amount), (entry, src, -amount);
  return entry;
end $$;
-- Dépôt (positif) ou retrait (négatif) de `n` dans la banque de `banker`, comme l'écrit la commande.
create function pg_temp.move(n text, banker text, amount bigint) returns void language plpgsql as $$
declare
  world uuid := (select world_id from game.houses where id = pg_temp.house(n));
  bank uuid := (select id from game.banks where house_id = pg_temp.house(banker));
  vault uuid := (select id from game.accounts where bank_id = (select id from game.banks where house_id = pg_temp.house(banker)));
  deposit uuid;
  entry uuid;
begin
  insert into game.bank_deposits (world_id, bank_id, house_id) values (world, bank, pg_temp.house(n)) on conflict do nothing;
  select id into deposit from game.bank_deposits where bank_id = bank and house_id = pg_temp.house(n);
  if amount > 0 then
    entry := pg_temp.post(world, 'bank.deposit', bank, pg_temp.treasury(n), vault, amount);
  else
    entry := pg_temp.post(world, 'bank.withdraw', bank, vault, pg_temp.treasury(n), -amount);
  end if;
  insert into game.bank_deposit_movements (world_id, deposit_id, bank_id, house_id, kind, amount, ledger_entry_id)
  values (world, deposit, bank, pg_temp.house(n), case when amount > 0 then 'deposit' else 'withdraw' end, abs(amount), entry);
end $$;
do $$
declare
  h record; bank uuid;
begin
  for h in select ho.id, ho.world_id, c.city_id, t.id as treasury,
                  (select id from game.accounts where world_id = ho.world_id and system_key = 'faucet_starting_grant') as faucet
           from game.houses ho join game.citizenships c on c.house_id = ho.id
           join game.accounts t on t.house_id = ho.id and t.kind = 'house'
           where ho.id::text like '00000000-0000-7000-8000-0000000727_2' loop
    perform pg_temp.post(h.world_id, 'house.starting_grant', null, h.faucet, h.treasury, 50000);
    continue when h.id not in (pg_temp.house('a'), pg_temp.house('d'));
    insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
    values (h.world_id, h.city_id, h.id, case when h.id = pg_temp.house('a') then 'Trapeza Alkmaion' else 'Trapeza Eumolpos' end,
      500, 300, 0) returning id into bank;
    perform pg_temp.post(h.world_id, 'bank.capital_in', bank, h.treasury, (select id from game.accounts where bank_id = bank),
      1000);
  end loop;
end $$;
select pg_temp.move('b', 'a', 10001);
select pg_temp.move('c', 'a', 5000);
select pg_temp.move('c', 'a', -5000);
select pg_temp.move('e', 'd', 300);
set constraints all immediate;
set constraints all deferred;

-- Fortune : un dépôt compte pour le déposant et se déduit du coffre de la banque ; déposer ne change aucune fortune.
select is(
  (select string_agg(right(house_id::text, 2) || ':' || treasury || ':' || wealth, ' ' order by house_id)
   from game.house_wealth('01900000-0000-7000-8000-0000000727e0')),
  'a2:49000:50000 b2:39999:50000 c2:50000:50000', 'chaque fortune reste de 50 000 : la créance compte, la dette se déduit');
select is((select sum(balance)::bigint from game.bank_vaults() where world_id = '01900000-0000-7000-8000-0000000727e0'),
  11001::bigint, 'le coffre d''Alice tient capital et dépôts, que la masse monétaire compte');

-- Bob : son dépôt, sa banque, ses flux ; aucun autre dépôt.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000727bb", "role": "authenticated"}', true);
select is((select string_agg(concat_ws(':', bank_name, deposit_rate_bps, balance, house_id = '00000000-0000-7000-8000-0000000727b2'), ' ')
   from public.my_deposits), 'Trapeza Alkmaion:500:10001:t', 'Bob lit son dépôt, sa banque et son taux affiché');
select is((select count(*)::integer from game.bank_deposits), 1, 'et une seule ligne de la table, la sienne');
select is((select count(*)::integer from public.my_bank), 0, 'ni le coffre ni les dépôts de la banque d''Alice');
select is((select string_agg(nature || ':' || amount, ' ' order by nature) from public.my_cash_flows),
  'bank_deposits:-10001 grant:50000', 'flux : son dépôt sous sa nature');
select is((select operating_result || ':' || other || ':' || cash_change from public.my_income_statement),
  '0:-10001:39999', 'résultat : le dépôt hors exploitation');
select throws_ok('select * from game.bank_deposit_movements', '42501', null, 'il ne lit pas les mouvements');
select throws_ok($$insert into game.bank_deposits (world_id, bank_id, house_id)
  select world_id, bank_id, house_id from game.bank_deposits$$, '42501', null, 'ni n''ouvre un dépôt par la table');
select throws_ok($$update game.bank_deposits set balance = 1$$, '42501', null, 'ni n''en change le solde');

-- Chloé : un dépôt soldé, qui reste à zéro ; dépôt et retrait du même jour s'annulent dans ses flux.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000727bc", "role": "authenticated"}', true);
select is((select string_agg(bank_name || ':' || balance, ' ') from public.my_deposits), 'Trapeza Alkmaion:0',
  'Chloé lit son dépôt soldé, à zéro');
select is((select string_agg(nature || ':' || amount, ' ' order by nature) from public.my_cash_flows), 'grant:50000',
  'dépôt et retrait se compensent dans ses flux du jour');

-- Alice : le total et le nombre des dépôts de sa banque, sa réserve, sans le nom d'aucun déposant.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000727ba", "role": "authenticated"}', true);
select is((select concat_ws(':', vault, required_reserve, deposits, depositors) from public.my_bank), '11001:2001:10001:1',
  'Alice lit son coffre, sa réserve (20 % de 10 001, à l''obole supérieure), le total et le nombre des dépôts non vides');
select is(
  (select string_agg(column_name, ' ' order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'my_bank'),
  'id world_id city_id house_id name deposit_rate_bps loan_rate_bps founded_at vault required_reserve deposits depositors',
  'my_bank ne nomme aucun déposant');
select is((select count(*)::integer from public.my_deposits), 0, 'elle ne lit aucun dépôt de sa banque');
select is((select count(*)::integer from game.bank_deposits), 0, 'ni dans la table');
select is((select string_agg(nature || ':' || amount, ' ' order by nature) from public.my_cash_flows),
  'bank_capital:-1000 grant:50000', 'les dépôts de ses clients ne sont pas ses flux');
-- Dion et Eudore, dans l'autre monde.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000727bd", "role": "authenticated"}', true);
select is((select concat_ws(':', vault, required_reserve, deposits, depositors) from public.my_bank), '1300:1000:300:1',
  'Dion lit sa banque et ses dépôts : sa réserve est le capital minimal, au-dessus de 20 % de 300');
select is((select count(*)::integer from public.my_deposits), 0, 'aucun dépôt du monde d''Alice');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000727be", "role": "authenticated"}', true);
select is((select string_agg(bank_name || ':' || balance, ' ') from public.my_deposits), 'Trapeza Eumolpos:300',
  'Eudore lit son dépôt chez Dion');
reset role;

set local role anon;
select throws_ok('select * from public.my_deposits', '42501', null, 'un visiteur anonyme ne lit aucun dépôt');
select throws_ok('select * from game.bank_deposits', '42501', null, 'ni la table');
reset role;
select ok(not has_table_privilege('authenticated', 'game.bank_deposits', 'insert,update,delete'),
  'les joueurs n''écrivent aucun dépôt');

-- Une version en vigueur sans section `banks` : la réserve devient inconnue, les dépôts restent lisibles.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c729', '{}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c729', now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000727ba", "role": "authenticated"}', true);
select is((select coalesce(required_reserve::text, 'inconnue') || ':' || deposits from public.my_bank), 'inconnue:10001',
  'sans section, la réserve est inconnue, le total des dépôts reste');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000727bb", "role": "authenticated"}', true);
select is((select balance from public.my_deposits), 10001::bigint, 'et Bob lit toujours son dépôt');
reset role;

select * from finish();
rollback;
