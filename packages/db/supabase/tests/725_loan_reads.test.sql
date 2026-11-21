begin;
select plan(13);

-- Jeu d'essai : un monde à lui, où Alice (a), Bob (b) et Cimon (c) ont leur maison de joueur ; Dion (d) a la sienne dans
-- un autre monde. Configuration en vigueur : l'horloge et une marque de 28 jours après le solde. États posés gardes
-- levées (la clôture les écrit ailleurs, 725_loan_default) : Alice a un prêt en défaut ; Bob a soldé il y a 5 jours un
-- prêt en défaut, Cimon il y a 30 jours ; Dion a soldé un prêt sans défaut.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000725e0', 'marque-725', 'Marque'), ('01900000-0000-7000-8000-0000000725e9', 'loin-725', 'Loin');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000725c' || n)::uuid, 'reads-725-' || n || '@example.test' from unnest(array['a', 'b', 'c', 'd']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000725' || n || '2')::uuid, ('01900000-0000-7000-8000-0000000725' || w)::uuid,
       ('00000000-0000-4000-8000-0000000725c' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides', 'e0'), ('b', 'Philaïdes', 'e0'), ('c', 'Cimonides', 'e0'), ('d', 'Eumolpides', 'e9')) h (n, name, w);
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id::text like '01900000-0000-7000-8000-0000000725e%';
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000d725',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
    "templeTreasury": {"policyRateBps": 1000, "termDays": [7], "principalCaps": [], "dishonorDays": 28}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000d725', now());

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000725' || n || '2')::uuid
$$;
create function pg_temp.loan(n text) returns uuid language sql as $$
  select id from game.loans where borrower_house_id = pg_temp.house(n)
$$;
create function pg_temp.as_player(n text, statement text) returns setof record language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000725c' || n)::text, true);
  perform set_config('role', 'authenticated', true);
  return query execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.marks(n text) returns text language sql as $$
  select string_agg(right(house_id::text, 2) || ':' || dishonored || ':' || coalesce((dishonored_until_day
    - game.game_day_at(now()))::text, '-'), ' ' order by house_id)
  from pg_temp.as_player(n, 'select house_id, dishonored, dishonored_until_day from public.house_honor')
    as r (house_id uuid, dishonored boolean, dishonored_until_day integer)
$$;

-- Chaque maison emprunte 500 oboles pour 7 jours, comme l'écrit la commande.
do $$
declare entry uuid; h uuid; today int := game.game_day_at(now()); due timestamptz;
begin
  due := (select min(t) from generate_series(date_trunc('hour', now()), now() + interval '9 days', interval '15 minutes') t
          where game.game_day_at(t) >= today + 7);
  for h in select id from game.houses where world_id::text like '01900000-0000-7000-8000-0000000725e%' loop
    insert into game.ledger_entries (world_id, kind) select world_id, 'loan.temple_disburse' from game.houses where id = h
    returning id into entry;
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry, a.id, case when a.kind = 'house' then 500 else -500 end from game.accounts a join game.houses o on o.id = h
    where (a.house_id = h and a.kind = 'house') or (a.world_id = o.world_id and a.system_key = 'faucet_temple_loans');
    insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day,
      due_day, due_at, disbursement_entry_id)
    select world_id, 'temple', h, 500, 1000, 7, 1, today, today + 7, due, entry from game.houses where id = h;
  end loop;
end $$;
-- La clôture a prélevé 10 oboles à Alice (4 d'intérêts, 6 de principal) ; puis les états, gardes levées.
do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000725e0', 'loan.collect', jsonb_build_object('loanId', pg_temp.loan('a')))
  returning id into entry;
  set local session_replication_role = replica;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then -10 when system_key = 'sink_temple_interest' then 4 else 6 end
  from game.accounts where (house_id = pg_temp.house('a') and kind = 'house') or (world_id = '01900000-0000-7000-8000-0000000725e0'
    and system_key in ('sink_temple_interest', 'faucet_temple_loans'));
  insert into game.loan_repayments (world_id, loan_id, house_id, interest, principal, game_day, ledger_entry_id, kind)
  values ('01900000-0000-7000-8000-0000000725e0', pg_temp.loan('a'), pg_temp.house('a'), 4, 6, game.game_day_at(now()), entry, 'collect');
  update game.loans set status = 'defaulted', defaulted_day = due_day where id = pg_temp.loan('a');
  update game.loans set status = 'repaid', principal_repaid = 500, interest_repaid = 1, outstanding = 0,
    defaulted_day = case when borrower_house_id <> pg_temp.house('d') then due_day end
  where borrower_house_id in (pg_temp.house('b'), pg_temp.house('c'), pg_temp.house('d'));
  insert into game.loan_repayments (world_id, loan_id, house_id, interest, principal, game_day, ledger_entry_id)
  select o.world_id, o.id, o.borrower_house_id, 1, 500, game.game_day_at(now()) - case o.borrower_house_id
    when pg_temp.house('c') then 30 else 5 end, gen_random_uuid()
  from game.loans o where o.borrower_house_id in (pg_temp.house('b'), pg_temp.house('c'), pg_temp.house('d'));
  set local session_replication_role = origin;
end $$;

-- La marque est publique, dans les mondes du joueur : Alice en défaut, sans fin ; Bob jusqu'à la clôture dans 23 jours ;
-- Cimon n'est plus marqué, 30 jours après son solde ; Dion, soldé sans défaut, ne l'a jamais été.
select is(pg_temp.marks('b'), 'a2:true:- b2:true:23 c2:false:-', 'Bob lit la marque de chaque maison de son monde');
select is(pg_temp.marks('a'), pg_temp.marks('b'), 'Alice la lit de même, la sienne comprise');
select is(pg_temp.marks('d'), 'd2:false:-', 'Dion ne lit que son monde : la marque d''une autre maison n''en sort pas');
select is((select count(*)::integer from pg_temp.as_player('d', 'select house_id from game.house_dishonor()') as r (h uuid)), 0,
  'ni par la fonction elle-même');
set local role anon;
select throws_ok('select * from public.house_honor', '42501', null, 'un visiteur anonyme ne lit aucune Timè');
select throws_ok('select * from game.house_dishonor()', '42501', null, 'ni aucune marque');
reset role;

-- Jour du défaut : la maison le lit pour ses prêts, et rien de ceux d'une autre.
select is((select string_agg(right(house_id::text, 2) || ':' || status || ':' || coalesce((defaulted_day - due_day)::text, '-'), ' ')
  from pg_temp.as_player('a', 'select house_id, status, defaulted_day, due_day from public.my_loans')
    as r (house_id uuid, status text, defaulted_day integer, due_day integer)), 'a2:defaulted:0',
  'Alice lit son prêt en défaut et son jour de défaut, rien d''autre');
select is((select count(*)::integer from pg_temp.as_player('b', 'select id from game.loans where defaulted_day is not null')
  as r (id uuid)), 1, 'Bob ne lit que le sien');

-- Comptes : le prélèvement se range comme un remboursement, principal dans `loans`, intérêts dans `interest`.
select is((select string_agg(nature || ':' || amount, ' ' order by nature)
  from pg_temp.as_player('a', 'select nature, amount from public.my_cash_flows') as r (nature text, amount bigint)),
  'interest:-4 loans:494', 'Alice : 500 empruntés, 6 de principal et 4 d''intérêts prélevés');
select is((select upkeep || ':' || other from pg_temp.as_player('a',
  'select upkeep, other from public.my_income_statement') as r (upkeep bigint, other bigint)), '-4:494',
  'les intérêts prélevés sont des charges courantes, le principal hors exploitation');
select is((select count(*)::integer from pg_temp.as_player('b', 'select nature from public.my_cash_flows where house_id = '
  || quote_literal(pg_temp.house('a'))) as r (nature text)), 0, 'Bob ne lit rien des comptes d''Alice');
select is((select string_agg(column_name, ' ' order by ordinal_position) from information_schema.columns
  where table_schema = 'public' and table_name = 'house_honor'), 'house_id honor dishonored dishonored_until_day',
  'la vue de la Timè garde ses colonnes, la marque en fin (ADR 0006)');

-- Une version sans durée de marque (publiée avant #725) : zéro jour, la marque est levée au solde ; Alice, en défaut,
-- reste marquée.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000d726',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
    "templeTreasury": {"policyRateBps": 1000, "termDays": [7], "principalCaps": []}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000d726', now());
select is(pg_temp.marks('b'), 'a2:true:- b2:false:- c2:false:-', 'sans durée dans la version, Bob n''est plus marqué');

select * from finish();
rollback;
