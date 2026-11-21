begin;
select plan(20);

-- Jeu d'essai : un monde à lui. Alice (a), sans trésorerie, et Bob (b), doté de 1 000 oboles, y ont leur maison de
-- joueur. Configuration en vigueur : l'horloge (clôture à 4 h, heure de Paris) et le Trésor du temple à 10 %.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000725f0', 'defaut-725', 'Défaut');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000725a' || n)::uuid, 'default-725-' || n || '@example.test' from unnest(array['a', 'b']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000725' || n || '1')::uuid, '01900000-0000-7000-8000-0000000725f0',
       ('00000000-0000-4000-8000-0000000725a' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes')) h (n, name);
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000725f0';
do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000725f0', 'house.starting_grant')
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then 1000 else -1000 end from game.accounts
  where house_id = '00000000-0000-7000-8000-0000000725b1'
     or (world_id = '01900000-0000-7000-8000-0000000725f0' and system_key = 'faucet_starting_grant');
end $$;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c725',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
    "templeTreasury": {"policyRateBps": 1000, "termDays": [7], "principalCaps": [{"minHonor": 0, "maxPrincipal": 9000}]}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c725', now());

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000725' || n || '1')::uuid
$$;
create function pg_temp.today() returns int language sql as $$ select game.game_day_at(now()) $$;
-- Instant de la clôture qui ouvre le jour de jeu `d` (`dailyCloseAt`) : le premier quart d'heure de ce jour.
create function pg_temp.close_at(d int) returns timestamptz language sql as $$
  select min(t) from generate_series((date '1970-01-01' + d - 1)::timestamp at time zone 'UTC',
    (date '1970-01-01' + d + 2)::timestamp at time zone 'UTC', interval '15 minutes') t
  where game.game_day_at(t) >= d
$$;
create function pg_temp.as_player(n text, statement text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000725a' || n)::text, true);
  perform set_config('role', 'authenticated', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Emprunt de 500 oboles pour 7 jours, écrit comme l'écrit la commande, au jour d'emprunt et à l'échéance donnés.
create function pg_temp.borrow(n text, p_borrowed int = null, p_due_at timestamptz = null) returns uuid
language plpgsql as $$
declare entry uuid; loan uuid; h uuid := pg_temp.house(n); day int := coalesce(p_borrowed, pg_temp.today());
  due timestamptz := coalesce(p_due_at, pg_temp.close_at(pg_temp.today() + 7));
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000725f0', 'loan.temple_disburse', jsonb_build_object('houseId', h))
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then 500 else -500 end from game.accounts
  where (house_id = h and kind = 'house') or (world_id = '01900000-0000-7000-8000-0000000725f0' and system_key = 'faucet_temple_loans');
  insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day,
    due_day, due_at, disbursement_entry_id)
  values ('01900000-0000-7000-8000-0000000725f0', 'temple', h, 500, 1000, 7, 1, day, day + 7, due, entry)
  returning id into loan;
  perform set_config('role', 'none', true);
  return loan;
end $$;
create function pg_temp.loan(n text) returns uuid language sql as $$
  select id from game.loans where borrower_house_id = pg_temp.house(n)
$$;
-- Recule un prêt de `days` jours, gardes levées : son échéance est alors passée.
create function pg_temp.age(loan uuid, days int) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  update game.loans set borrowed_day = borrowed_day - days, due_day = due_day - days,
    due_at = pg_temp.close_at(due_day - days), created_at = created_at - make_interval(days => days + 1)
  where id = loan;
  set local session_replication_role = origin;
end $$;
create function pg_temp.default_loan(n text, p_day int = null, p_status text = 'defaulted') returns void
language sql as $$
  select pg_temp.as_service(format('update game.loans set status = %L, defaulted_day = %s where id = %L', p_status,
    coalesce(p_day, pg_temp.today()), pg_temp.loan(n)))
$$;

-- Calendrier : un prêt naît le jour de jeu de maintenant et échoit à l'instant de la clôture de son jour d'échéance.
select throws_ok($$select pg_temp.borrow('a', p_borrowed => pg_temp.today() - 1,
  p_due_at => pg_temp.close_at(pg_temp.today() + 6))$$, '23001', 'a loan is borrowed on the game day of now',
  'un prêt naît le jour de jeu de maintenant, pas la veille');
select throws_ok($$select pg_temp.borrow('a', p_due_at => pg_temp.close_at(pg_temp.today() + 7) + interval '1 minute')$$,
  '23001', 'a loan falls due at the close of its due day', 'son échéance est sur un quart d''heure');
select throws_ok($$select pg_temp.borrow('a', p_due_at => pg_temp.close_at(pg_temp.today() + 7) + interval '15 minutes')$$,
  '23001', 'a loan falls due at the close of its due day', 'au premier quart d''heure de son jour d''échéance');
select throws_ok($$select pg_temp.borrow('a', p_due_at => pg_temp.close_at(pg_temp.today() + 7) - interval '15 minutes')$$,
  '23001', 'a loan falls due at the close of its due day', 'pas la veille au soir');
select lives_ok($$select pg_temp.borrow('a')$$, 'un prêt au jour et à l''échéance de l''horloge');
select lives_ok($$select pg_temp.borrow('b')$$, 'Bob emprunte aussi');
select is(game.game_day_at(pg_temp.close_at(pg_temp.today())), pg_temp.today(), 'la clôture ouvre son jour de jeu');

-- Défaut : seule la clôture le fait, une fois, d'un prêt échu dont le prélèvement a vidé la trésorerie.
select throws_ok($$select pg_temp.default_loan('a', pg_temp.today() + 7)$$, '23001', 'a loan defaults once due',
  'pas avant l''échéance');
select pg_temp.age(pg_temp.loan('a'), 10);
select pg_temp.age(pg_temp.loan('b'), 10);
select throws_ok($$select pg_temp.default_loan('a')$$, '23001', 'a loan defaults once the collection has emptied the treasury',
  'pas tant que la trésorerie couvre une part du reste dû');
-- La trésorerie d'Alice passe à un remboursement de 500 : 1 d'intérêts, 499 de principal ; il reste 1 obole due.
do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000725f0', 'loan.repay', jsonb_build_object('loanId', pg_temp.loan('a')))
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then -500 when system_key = 'sink_temple_interest' then 1 else 499 end
  from game.accounts where (house_id = pg_temp.house('a') and kind = 'house') or (world_id = '01900000-0000-7000-8000-0000000725f0'
    and system_key in ('sink_temple_interest', 'faucet_temple_loans'));
  insert into game.loan_repayments (world_id, loan_id, house_id, interest, principal, game_day, ledger_entry_id)
  values ('01900000-0000-7000-8000-0000000725f0', pg_temp.loan('a'), pg_temp.house('a'), 1, 499, pg_temp.today(), entry);
end $$;
select throws_ok($$select pg_temp.default_loan('a', pg_temp.today() - 4)$$, '23001', 'a loan defaults once due',
  'pas un jour avant son échéance');
select throws_ok($$select pg_temp.default_loan('a', p_status => 'repaid')$$, '23001',
  'a loan changes only through its repayments', 'ni remboursé autrement que par ses remboursements');
select throws_ok($$select pg_temp.as_service(format('update game.loans set outstanding = 0 where id = %L', pg_temp.loan('a')))$$,
  '42501', null, 'le service ne change ni le reste dû ni les remboursements');
select throws_ok($$select pg_temp.as_service(format('update game.loans set due_day = due_day + 1 where id = %L', pg_temp.loan('a')))$$,
  '42501', null, 'ni l''échéance');
select lives_ok($$select pg_temp.default_loan('a')$$, 'échu, non soldé, trésorerie vide : en défaut');
select is((select status || ':' || defaulted_day || ':' || outstanding from game.loans where id = pg_temp.loan('a')),
  'defaulted:' || pg_temp.today() || ':1', 'en défaut le jour de la clôture, reste dû inchangé');
select throws_ok($$select pg_temp.default_loan('a')$$, '23001', 'a loan changes only through its repayments',
  'une fois seulement');
select throws_ok('set constraints game.loans_default_on_close immediate', '23001', 'a loan defaults by the close of its day',
  'à la validation, la clôture de son jour est enregistrée');
set constraints all deferred;

select pg_temp.as_service(format('insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values (%L, %s, %L, %L)', '01900000-0000-7000-8000-0000000725f0', pg_temp.today(), pg_temp.close_at(pg_temp.today()),
  '00000000-0000-7000-8000-00000000c725'));
select lives_ok('set constraints game.loans_default_on_close immediate', 'le défaut valide avec la clôture de son jour');
set constraints all deferred;
select throws_ok($$select pg_temp.default_loan('b')$$, '23001', 'a loan defaults before its close is recorded',
  'une clôture enregistrée ne fait plus passer de prêt en défaut');
-- Un joueur ne fait passer aucun prêt en défaut, pas même le sien.
select throws_ok($$select pg_temp.as_player('b', 'update game.loans set status = ''defaulted'', defaulted_day = 0')$$,
  '42501', null, 'un joueur ne change aucun prêt');

select * from finish();
rollback;
