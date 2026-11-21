-- Prêts : remboursement (docs/specs/05-economie.md, 5.4 et 5.5 ; 12-modele-donnees.md ; ticket 724).
-- Chaque remboursement est une ligne de `loan_repayments`, payée par sa propre écriture `loan.repay` : les intérêts
-- d'abord, au puits `sink_temple_interest`, puis le principal, qui recrédite le robinet `faucet_temple_loans`. La base
-- l'applique au prêt (migration 9910), dont le reste dû baisse d'autant, jusqu'à zéro au remboursement complet.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés) ; le code précédent n'écrit ni ne
-- lit cette table.

create table if not exists game.loan_repayments (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  loan_id uuid not null references game.loans (id),
  -- L'emprunteur, qui paie : pour sa règle de lecture.
  house_id uuid not null,
  -- Part des intérêts, puis part du principal, en oboles.
  interest bigint not null check (interest between 0 and 9007199254740991),
  principal bigint not null check (principal between 0 and 9007199254740991),
  game_day integer not null check (game_day >= 0),
  ledger_entry_id uuid not null references game.ledger_entries (id),
  created_at timestamptz not null default now(),
  constraint loan_repayments_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint loan_repayments_amount check (interest + principal > 0)
);
-- Une écriture ne paie qu'un remboursement.
create unique index if not exists loan_repayments_entry_once on game.loan_repayments (ledger_entry_id);
create index if not exists loan_repayments_loan_idx on game.loan_repayments (loan_id);

-- Un remboursement naît maintenant. Il s'applique au prêt, au nom du propriétaire : à un prêt en cours ou en défaut de son
-- emprunteur, les intérêts d'abord (sa part d'intérêts est ce qui en reste, ou tout le remboursement s'il est moindre),
-- au plus le reste dû (`loans_outstanding_rule`), qui atteint zéro au remboursement complet. La condition est relue sur la
-- ligne verrouillée : deux remboursements concurrents ne paient pas deux fois les mêmes intérêts.
create or replace function game.guard_loan_repayment() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a loan repayment is written now' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create or replace function game.apply_loan_repayment() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
      and new.interest = least(new.interest + new.principal, l.interest - l.interest_repaid);
  if not found then
    raise exception 'a repayment pays its borrower''s outstanding loan, interest first' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
-- À la validation, un remboursement est payé par sa propre écriture `loan.repay`, datée de lui, qui nomme son prêt : de
-- la trésorerie de l'emprunteur, les intérêts au puits `sink_temple_interest` et le principal au robinet
-- `faucet_temple_loans` de son monde, une ligne par part non nulle.
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
     is distinct from ('loan.repay', new.created_at, new.world_id, new.loan_id::text,
                       1 + (new.interest > 0)::integer + (new.principal > 0)::integer,
                       -(new.interest + new.principal), new.interest, new.principal) then
    raise exception 'a loan repayment is paid by its own entry, interest to sink_temple_interest, principal to faucet_temple_loans'
      using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
-- En sens inverse, à la validation, une écriture de décaissement ou de remboursement règle un prêt : la migration 9910,
-- plus les remboursements.
create or replace function game.check_loan_entry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.kind = 'loan.temple_disburse' and not exists (select 1 from game.loans o where o.disbursement_entry_id = new.id))
     or (new.kind = 'loan.repay' and not exists (select 1 from game.loan_repayments r where r.ledger_entry_id = new.id)) then
    raise exception 'a loan entry settles a loan' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_loan_repayment(), game.apply_loan_repayment(), game.check_loan_repayment(),
  game.check_loan_entry() from public, anon, authenticated, oikos_service;

drop trigger if exists loan_repayments_guard on game.loan_repayments;
create trigger loan_repayments_guard before insert on game.loan_repayments
  for each row execute function game.guard_loan_repayment();
drop trigger if exists loan_repayments_apply on game.loan_repayments;
create trigger loan_repayments_apply after insert on game.loan_repayments
  for each row execute function game.apply_loan_repayment();
drop trigger if exists loan_repayments_settled on game.loan_repayments;
create constraint trigger loan_repayments_settled after insert on game.loan_repayments
  deferrable initially deferred for each row execute function game.check_loan_repayment();
drop trigger if exists loan_repayments_immutable on game.loan_repayments;
create trigger loan_repayments_immutable before update or delete on game.loan_repayments
  for each row execute function game.forbid_change();
drop trigger if exists loan_repayments_no_truncate on game.loan_repayments;
create trigger loan_repayments_no_truncate before truncate on game.loan_repayments
  for each statement execute function game.forbid_change();
drop trigger if exists ledger_entries_loan on game.ledger_entries;
create constraint trigger ledger_entries_loan after insert on game.ledger_entries
  deferrable initially deferred for each row when (new.kind in ('loan.temple_disburse', 'loan.repay'))
  execute function game.check_loan_entry();

-- Le service lit et rembourse sans choisir ni l'identifiant ni la date d'un remboursement ; il ne modifie ni ne
-- supprime rien.
alter table game.loan_repayments enable row level security;
revoke all on game.loan_repayments from public, anon, authenticated, oikos_service;
grant select on game.loan_repayments to oikos_service;
grant insert (world_id, loan_id, house_id, interest, principal, game_day, ledger_entry_id) on game.loan_repayments
  to oikos_service;
drop policy if exists service_all on game.loan_repayments;
create policy service_all on game.loan_repayments for all to oikos_service using (true) with check (true);
