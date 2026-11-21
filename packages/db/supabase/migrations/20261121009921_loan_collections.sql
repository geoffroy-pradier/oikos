-- Prêts : prélèvement de la clôture et Timè du défaut (docs/specs/05-economie.md, 5.4 et 5.5 ; 12-modele-donnees.md ;
-- ticket 725).
-- À chaque clôture à partir de son échéance, un prêt non soldé prend sur la trésorerie de son emprunteur ce qu'elle
-- couvre : un remboursement de nature `collect` (les remboursements de la maison sont de nature `repay`), payé par sa
-- propre écriture `loan.collect`, intérêts d'abord, un au plus par prêt et par jour de jeu, dans la transaction qui
-- enregistre la clôture de ce jour. Un prélèvement partiel vide la trésorerie. Un remboursement de la maison est daté du
-- jour de jeu de maintenant. Le défaut (migration 9920) coûte de la Timè (`loan_defaulted`).
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et droits recréés) ; compatible avec le code précédent,
-- qui n'écrit que des remboursements `repay` (valeur par défaut), datés du jour de jeu de maintenant.

alter table game.loan_repayments
  add column if not exists kind text not null default 'repay' check (kind in ('repay', 'collect'));
-- Un prélèvement par prêt et par jour de jeu : rejouée, la clôture ne prend rien deux fois.
create unique index if not exists loan_repayments_collect_once on game.loan_repayments (loan_id, game_day)
  where kind = 'collect';

-- Un remboursement naît maintenant. Celui de la maison est du jour de jeu de maintenant ; un prélèvement, d'un prêt échu
-- (à son jour d'échéance ou après, son instant passé), par la clôture d'un jour dont l'enregistrement n'est pas encore
-- fait (même verrou que la clôture).
create or replace function game.guard_loan_repayment() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a loan repayment is written now' using errcode = 'restrict_violation';
  end if;
  if new.kind = 'repay' then
    if new.game_day is distinct from game.game_day_at(now()) then
      raise exception 'a loan repayment is made on the game day of now' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  perform 1 from game.loans o where o.id = new.loan_id and o.due_day <= new.game_day and o.due_at <= now();
  if not found then
    raise exception 'a loan is collected once due' using errcode = 'restrict_violation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
    raise exception 'a loan is collected before its close is recorded' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
-- La migration 9911, plus le prélèvement : partiel, il a vidé la trésorerie de l'emprunteur.
create or replace function game.apply_loan_repayment() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  left_owed bigint;
begin
  if tg_relid <> 'game.loan_repayments'::regclass then
    raise exception '% only runs on game.loan_repayments', tg_name using errcode = 'insufficient_privilege';
  end if;
  update game.loans l
    set interest_repaid = l.interest_repaid + new.interest,
        principal_repaid = l.principal_repaid + new.principal,
        outstanding = l.outstanding - new.interest - new.principal,
        status = case when l.outstanding = new.interest + new.principal then 'repaid' else l.status end
    where l.id = new.loan_id and l.world_id = new.world_id and l.borrower_house_id = new.house_id
      and l.status in ('active', 'defaulted')
      and new.interest = least(new.interest + new.principal, l.interest - l.interest_repaid)
    returning l.outstanding into left_owed;
  if not found then
    raise exception 'a repayment pays its borrower''s outstanding loan, interest first' using errcode = 'restrict_violation';
  end if;
  if new.kind = 'collect' and left_owed > 0 and exists (
       select 1 from game.accounts a where a.kind = 'house' and a.house_id = new.house_id and a.balance <> 0) then
    raise exception 'a collection takes the whole outstanding, or all the treasury holds' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
-- La migration 9911, plus le prélèvement : payé par sa propre écriture `loan.collect`, de mêmes lignes.
create or replace function game.check_loan_repayment() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid record;
begin
  select e.kind, e.created_at, e.world_id, e.meta ->> 'loanId' as loan_id, count(*) as lines,
         coalesce(sum(l.amount) filter (where a.kind = 'house' and a.house_id = new.house_id), 0) as debit,
         coalesce(sum(l.amount) filter (where a.world_id = new.world_id and a.system_key = 'sink_temple_interest'), 0) as interest,
         coalesce(sum(l.amount) filter (where a.world_id = new.world_id and a.system_key = 'faucet_temple_loans'), 0) as principal
    into paid
    from game.ledger_entries e
    join game.ledger_lines l on l.entry_id = e.id
    join game.accounts a on a.id = l.account_id
    where e.id = new.ledger_entry_id
    group by e.kind, e.created_at, e.world_id, e.meta ->> 'loanId';
  if (paid.kind, paid.created_at, paid.world_id, paid.loan_id, paid.lines, paid.debit, paid.interest, paid.principal)
     is distinct from (case new.kind when 'collect' then 'loan.collect' else 'loan.repay' end, new.created_at,
                       new.world_id, new.loan_id::text, 1 + (new.interest > 0)::integer + (new.principal > 0)::integer,
                       -(new.interest + new.principal), new.interest, new.principal) then
    raise exception 'a loan repayment is paid by its own entry, interest to sink_temple_interest, principal to faucet_temple_loans'
      using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
-- À la validation, un prélèvement a la clôture de son jour, enregistrée dans la même transaction.
create or replace function game.check_loan_collection_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.game_day) then
    raise exception 'a loan is collected by the close of its day' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
-- En sens inverse, une écriture de prêt règle un prêt : la migration 9911, plus le prélèvement.
create or replace function game.check_loan_entry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.kind = 'loan.temple_disburse' and not exists (select 1 from game.loans o where o.disbursement_entry_id = new.id))
     or (new.kind in ('loan.repay', 'loan.collect')
         and not exists (select 1 from game.loan_repayments r where r.ledger_entry_id = new.id)) then
    raise exception 'a loan entry settles a loan' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_loan_repayment(), game.apply_loan_repayment(), game.check_loan_repayment(),
  game.check_loan_collection_on_close(), game.check_loan_entry() from public, anon, authenticated, oikos_service;
drop trigger if exists loan_repayments_collect_on_close on game.loan_repayments;
create constraint trigger loan_repayments_collect_on_close after insert on game.loan_repayments
  deferrable initially deferred for each row when (new.kind = 'collect')
  execute function game.check_loan_collection_on_close();
drop trigger if exists ledger_entries_loan on game.ledger_entries;
create constraint trigger ledger_entries_loan after insert on game.ledger_entries
  deferrable initially deferred for each row when (new.kind in ('loan.temple_disburse', 'loan.repay', 'loan.collect'))
  execute function game.check_loan_entry();
grant insert (kind) on game.loan_repayments to oikos_service;

-- Timè : la migration 9731, plus le motif `loan_defaulted` : une perte, pour un prêt de la même maison et du même monde
-- passé en défaut le jour de jeu de la ligne, écrite par la clôture (même verrou que la clôture) ; à la validation, la
-- clôture de son jour est enregistrée.
create or replace function game.guard_honor_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Timè movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.reason = 'archon_term' then
    if new.amount < 0 then
      raise exception 'a completed archon term raises Timè' using errcode = 'restrict_violation';
    end if;
    perform 1 from game.offices o
    where o.id = new.reference and o.house_id = new.house_id and o.world_id = new.world_id and o.ends_at <= now();
    if not found then
      raise exception 'an archon term is credited to its house once ended' using errcode = 'restrict_violation';
    end if;
  elsif new.reason = 'liturgy_performed' then
    if new.amount < 0 then
      raise exception 'a performed liturgy raises Timè' using errcode = 'restrict_violation';
    end if;
    perform 1 from game.liturgies l
    where l.id = new.reference and l.house_id = new.house_id and l.world_id = new.world_id
      and l.status = 'performed' and l.settled_at = now();
    if not found then
      raise exception 'a liturgy is credited to its house when performed' using errcode = 'restrict_violation';
    end if;
    return new;
  elsif new.reason = 'liturgy_evaded' then
    if new.amount > 0 then
      raise exception 'an evaded liturgy lowers Timè' using errcode = 'restrict_violation';
    end if;
    perform 1 from game.liturgies l
    where l.id = new.reference and l.house_id = new.house_id and l.world_id = new.world_id
      and l.status = 'assigned' and l.due_at <= now();
    if not found then
      raise exception 'an evaded liturgy is charged to its house once due' using errcode = 'restrict_violation';
    end if;
  elsif new.reason = 'loan_defaulted' then
    if new.amount > 0 then
      raise exception 'a defaulted loan lowers Timè' using errcode = 'restrict_violation';
    end if;
    perform 1 from game.loans o
    where o.id = new.reference and o.borrower_house_id = new.house_id and o.world_id = new.world_id
      and o.status = 'defaulted' and o.defaulted_day = new.game_day;
    if not found then
      raise exception 'a defaulted loan is charged to its borrower the day it defaults' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Timè reason' using errcode = 'restrict_violation';
  end if;
  -- Les motifs de la clôture : écrits avant que la clôture de leur jour, ou d'un jour postérieur, soit enregistrée.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
    raise exception using errcode = 'restrict_violation', message = case new.reason
      when 'archon_term' then 'an archon term is credited before its close is recorded'
      when 'liturgy_evaded' then 'an evaded liturgy is charged before its close is recorded'
      else 'a defaulted loan is charged before its close is recorded' end;
  end if;
  return new;
end;
$$;
create or replace function game.check_honor_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.game_day) then
    raise exception using errcode = 'restrict_violation', message = case new.reason
      when 'archon_term' then 'an archon term is credited by the close of its day'
      when 'liturgy_evaded' then 'an evaded liturgy is charged by the close of its day'
      else 'a defaulted loan is charged by the close of its day' end;
  end if;
  if new.reason = 'liturgy_evaded' and not exists (
       select 1 from game.liturgies l where l.id = new.reference and l.status = 'levied' and l.settled_day = new.game_day) then
    raise exception 'an evaded liturgy is levied by the close that charges it' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_honor_movement(), game.check_honor_on_close() from public, anon, authenticated, oikos_service;
drop trigger if exists honor_ledger_on_close on game.honor_ledger;
create constraint trigger honor_ledger_on_close after insert on game.honor_ledger
  deferrable initially deferred for each row when (new.reason in ('archon_term', 'liturgy_evaded', 'loan_defaulted'))
  execute function game.check_honor_on_close();
