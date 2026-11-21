-- Banques de joueurs : prêts de banque (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ; ticket 728).
-- Un prêt de banque est une ligne de `loans` au prêteur `bank`, qui nomme sa banque et l'offre qu'il accepte, à ses
-- conditions. Sa monnaie ne se crée ni ne se détruit : du coffre à l'emprunteur (`bank.loan_disburse`), puis au coffre
-- (`bank.loan_repay`, `bank.loan_collect`, migration 0302). Garantie : migration 0303 ; défaut : avec la saisie.
-- Rejouable (`if not exists`, contraintes conditionnelles, `create or replace`) ; compatible avec le code précédent.

alter table game.loans add column if not exists bank_id uuid;
alter table game.loans add column if not exists offer_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loans_bank_lender' and conrelid = 'game.loans'::regclass) then
    alter table game.loans add constraint loans_bank_same_world foreign key (bank_id, world_id)
      references game.banks (id, world_id);
    alter table game.loans add constraint loans_offer foreign key (offer_id) references game.bank_loan_offers (id);
    alter table game.loans add constraint loans_offer_once unique (offer_id);
    alter table game.loans add constraint loans_bank_lender
      check ((lender = 'bank') = (bank_id is not null) and (bank_id is null) = (offer_id is null));
  end if;
end $$;

-- La migration 9920, plus le prêteur `bank` : sa banque et son offre font partie de ses conditions, qui ne changent
-- jamais, et seul un prêt du temple passe en défaut avant la saisie (ticket suivant).
create or replace function game.guard_loan() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.status is distinct from 'active'
       or new.principal_repaid <> 0 or new.interest_repaid <> 0 or new.defaulted_day is not null then
      raise exception 'a loan is disbursed now, with nothing repaid' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.houses h where h.id = new.borrower_house_id and h.kind = 'player') then
      raise exception 'a loan goes to a player house' using errcode = 'check_violation', constraint = 'loans_borrower_player';
    end if;
    if new.borrowed_day is distinct from game.game_day_at(now()) then
      raise exception 'a loan is borrowed on the game day of now' using errcode = 'restrict_violation';
    end if;
    if extract(epoch from new.due_at) % 900 <> 0 or game.game_day_at(new.due_at) is distinct from new.due_day
       or game.game_day_at(new.due_at - interval '15 minutes') >= new.due_day then
      raise exception 'a loan falls due at the close of its due day' using errcode = 'restrict_violation';
    end if;
    new.outstanding := new.principal + new.interest;
    return new;
  end if;
  if (new.id, new.world_id, new.lender, new.borrower_house_id, new.principal, new.rate_bps, new.term_days, new.interest,
      new.borrowed_day, new.due_day, new.due_at, new.disbursement_entry_id, new.created_at, new.bank_id, new.offer_id)
     is distinct from (old.id, old.world_id, old.lender, old.borrower_house_id, old.principal, old.rate_bps, old.term_days,
      old.interest, old.borrowed_day, old.due_day, old.due_at, old.disbursement_entry_id, old.created_at, old.bank_id,
      old.offer_id) then
    raise exception 'a loan keeps its terms' using errcode = 'restrict_violation';
  end if;
  if game.written_by_owner_trigger(tg_relid) then
    if new.defaulted_day is distinct from old.defaulted_day then
      raise exception 'a repayment keeps the day of a default' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.status <> 'active' or new.status <> 'defaulted' or new.defaulted_day is null
     or (new.principal_repaid, new.interest_repaid, new.outstanding)
        is distinct from (old.principal_repaid, old.interest_repaid, old.outstanding) then
    raise exception 'a loan changes only through its repayments' using errcode = 'restrict_violation';
  end if;
  if old.lender <> 'temple' then
    raise exception 'a bank loan defaults only with its seizure' using errcode = 'restrict_violation';
  end if;
  if now() < old.due_at or new.defaulted_day < old.due_day then
    raise exception 'a loan defaults once due' using errcode = 'restrict_violation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.defaulted_day) then
    raise exception 'a loan defaults before its close is recorded' using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from game.accounts a where a.kind = 'house' and a.house_id = new.borrower_house_id and a.balance <> 0) then
    raise exception 'a loan defaults once the collection has emptied the treasury' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Un prêt de banque accepte son offre, encore ouverte, à ses conditions exactes, et la ferme au nom du propriétaire :
-- deux acceptations de la même offre se suivent sur sa ligne, et la seconde la trouve fermée.
create or replace function game.accept_bank_loan_offer() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.loans'::regclass then
    raise exception '% only runs on game.loans', tg_name using errcode = 'insufficient_privilege';
  end if;
  update game.bank_loan_offers o set status = 'accepted'
    where o.id = new.offer_id and o.status = 'open' and o.world_id = new.world_id and o.bank_id = new.bank_id
      and o.borrower_house_id = new.borrower_house_id and o.principal = new.principal and o.rate_bps = new.rate_bps
      and o.term_days = new.term_days;
  if not found then
    raise exception 'a bank loan accepts an open offer, on its terms' using errcode = 'check_violation',
      constraint = 'loans_offer_open';
  end if;
  return null;
end;
$$;

-- La migration 9910, plus le prêt de banque : décaissé par sa propre écriture `bank.loan_disburse`, datée de lui, qui
-- nomme sa banque, de deux lignes, du coffre de sa banque à la trésorerie de son emprunteur.
create or replace function game.check_loan_disbursed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid record;
begin
  select e.kind, e.created_at, e.world_id, e.meta ->> 'bankId' as bank_id, count(*) as lines,
         coalesce(sum(l.amount) filter (where a.kind = 'house' and a.house_id = new.borrower_house_id), 0) as credit,
         coalesce(sum(l.amount) filter (where case new.lender when 'bank' then a.bank_id = new.bank_id
           else a.world_id = new.world_id and a.system_key = 'faucet_temple_loans' end), 0) as debit
    into paid
    from game.ledger_entries e
    join game.ledger_lines l on l.entry_id = e.id
    join game.accounts a on a.id = l.account_id
    where e.id = new.disbursement_entry_id
    group by e.kind, e.created_at, e.world_id, e.meta ->> 'bankId';
  if (paid.kind, paid.created_at, paid.world_id, paid.bank_id, paid.lines, paid.credit, paid.debit)
     is distinct from (case new.lender when 'bank' then 'bank.loan_disburse' else 'loan.temple_disburse' end,
                       new.created_at, new.world_id, new.bank_id::text, 2::bigint, new.principal, -new.principal) then
    raise exception using errcode = 'restrict_violation', message = case new.lender
      when 'bank' then 'a bank loan is disbursed by its own entry, from its vault to its borrower'
      else 'a temple loan is disbursed by its own entry, from faucet_temple_loans to its borrower' end;
  end if;
  return null;
end;
$$;

-- Écritures des banques (migration 9991), plus les prêts : deux lignes, entre l'emprunteur et le coffre ; le principal
-- de son prêt, ou la somme du remboursement qu'elle paie. Rejoué pour chaque ligne ajoutée, même plus tard.
create or replace function game.check_bank_entry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry game.ledger_entries;
  bank game.banks;
  movement game.bank_deposit_movements;
  repayment game.loan_repayments;
  lent game.loans;
  payer uuid;
  moved record;
begin
  if tg_relid = 'game.ledger_lines'::regclass then
    select * into entry from game.ledger_entries e where e.id = new.entry_id;
  elsif tg_relid = 'game.ledger_entries'::regclass then
    select * into entry from game.ledger_entries e where e.id = new.id;
  else
    raise exception '% only runs on the ledger', tg_name using errcode = 'insufficient_privilege';
  end if;
  if entry.kind is null
     or entry.kind not in ('bank.charter', 'bank.capital_in', 'bank.capital_out', 'bank.deposit', 'bank.withdraw',
                           'bank.loan_disburse', 'bank.loan_repay', 'bank.loan_collect') then
    return null;
  end if;
  select * into bank from game.banks b where b.id = (entry.meta ->> 'bankId')::uuid and b.world_id = entry.world_id;
  payer := bank.house_id;
  if entry.kind in ('bank.deposit', 'bank.withdraw') then
    select * into movement from game.bank_deposit_movements m where m.ledger_entry_id = entry.id;
    payer := movement.house_id;
  elsif entry.kind = 'bank.loan_disburse' then
    select * into lent from game.loans o where o.disbursement_entry_id = entry.id;
    payer := lent.borrower_house_id;
  elsif entry.kind in ('bank.loan_repay', 'bank.loan_collect') then
    select * into repayment from game.loan_repayments r where r.ledger_entry_id = entry.id;
    select * into lent from game.loans o where o.id = repayment.loan_id;
    payer := repayment.house_id;
  end if;
  select count(*) as lines,
         coalesce(sum(l.amount) filter (where a.kind = 'house' and a.house_id = payer), 0) as treasury,
         coalesce(sum(l.amount) filter (where a.bank_id = bank.id), 0) as vault,
         coalesce(sum(l.amount) filter (where a.world_id = bank.world_id and a.system_key = 'sink_bank_charter'), 0)
           as sink,
         count(*) filter (where a.kind = 'house' and a.house_id = payer) as treasury_lines
    into moved
    from game.ledger_lines l join game.accounts a on a.id = l.account_id
    where l.entry_id = entry.id;
  if bank.id is null or moved.lines <> 2 or moved.treasury_lines <> 1
     or (entry.kind = 'bank.charter' and (moved.sink <> bank.charter_fee or moved.treasury <> -bank.charter_fee))
     or (entry.kind = 'bank.capital_in' and not (moved.vault > 0 and moved.treasury = -moved.vault))
     or (entry.kind = 'bank.capital_out' and not (moved.vault < 0 and moved.treasury = -moved.vault))
     or (entry.kind in ('bank.deposit', 'bank.withdraw')
         and (movement.id is null or movement.bank_id is distinct from bank.id
              or 'bank.' || movement.kind is distinct from entry.kind or moved.treasury <> -moved.vault
              or moved.vault <> case movement.kind when 'deposit' then movement.amount else -movement.amount end))
     or (entry.kind like 'bank.loan_%'
         and (lent.id is null or lent.bank_id is distinct from bank.id or moved.treasury <> -moved.vault
              or moved.vault is distinct from case entry.kind when 'bank.loan_disburse' then -lent.principal
                                                else repayment.interest + repayment.principal end
              or (entry.kind <> 'bank.loan_disburse' and 'bank.loan_' || repayment.kind <> entry.kind))) then
    raise exception 'a bank entry moves money between its house treasury and its vault, or pays its charter fee'
      using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
-- Coffre (migration 9991) : il verse et reçoit aussi par les prêts de sa banque.
create or replace function game.check_bank_vault_line() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vault_bank uuid;
  entry game.ledger_entries;
begin
  if tg_relid <> 'game.ledger_lines'::regclass then
    raise exception '% only runs on game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  select a.bank_id into vault_bank from game.accounts a where a.id = new.account_id;
  if vault_bank is null then
    return null;
  end if;
  select * into entry from game.ledger_entries e where e.id = new.entry_id;
  if entry.kind is null
     or entry.kind not in ('bank.capital_in', 'bank.capital_out', 'bank.deposit', 'bank.withdraw', 'bank.loan_disburse',
                           'bank.loan_repay', 'bank.loan_collect')
     or entry.meta ->> 'bankId' is distinct from vault_bank::text then
    raise exception 'the vault of bank % moves only by its own bank entries', vault_bank using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_loan(), game.accept_bank_loan_offer(), game.check_loan_disbursed(),
  game.check_bank_entry(), game.check_bank_vault_line()
  from public, anon, authenticated, oikos_service;

drop trigger if exists loans_accept_offer on game.loans;
create trigger loans_accept_offer after insert on game.loans
  for each row when (new.lender = 'bank') execute function game.accept_bank_loan_offer();
drop trigger if exists ledger_entries_bank on game.ledger_entries;
create constraint trigger ledger_entries_bank after insert on game.ledger_entries
  deferrable initially deferred for each row
  when (new.kind in ('bank.charter', 'bank.capital_in', 'bank.capital_out', 'bank.deposit', 'bank.withdraw',
                     'bank.loan_disburse', 'bank.loan_repay', 'bank.loan_collect'))
  execute function game.check_bank_entry();

-- Le service nomme la banque et l'offre d'un prêt, en plus des colonnes de la migration 9910.
grant insert (bank_id, offer_id) on game.loans to oikos_service;
