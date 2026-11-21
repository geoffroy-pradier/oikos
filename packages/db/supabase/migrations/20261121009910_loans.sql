-- Prêts : emprunt au Trésor du temple (docs/specs/05-economie.md, 5.4 et 5.5 ; 04-systemes-gestion.md, 4.1 ;
-- 12-modele-donnees.md ; ticket 724).
-- Un prêt est une ligne de `loans` : prêteur, emprunteur, principal, taux, durée, intérêt simple fixé à l'emprunt,
-- échéance, remboursements cumulés, reste dû et état. Prête pour les prêts de banque (#728), la table n'admet encore
-- qu'un prêteur, le temple. Le principal vient du robinet `faucet_temple_loans` par l'écriture du décaissement. La base
-- tient le reste dû : principal plus intérêts moins remboursements, jamais négatif ; les remboursements viennent avec la
-- migration suivante (9911), l'échéance et le défaut avec #725.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés) ; le code précédent n'écrit ni ne
-- lit cette table.

create table if not exists game.loans (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  -- Prêteur : le Trésor du temple ; une banque de joueur avec #728, qui ajoutera la banque et ouvrira la garde.
  lender text not null check (lender in ('temple', 'bank')),
  borrower_house_id uuid not null,
  -- Principal décaissé et intérêt fixé à l'emprunt, en oboles, dans les entiers sûrs des clients.
  principal bigint not null check (principal between 1 and 9007199254740991),
  rate_bps integer not null check (rate_bps between 0 and 1000000),
  term_days integer not null check (term_days between 1 and 3660),
  interest bigint not null check (interest between 0 and 9007199254740991),
  -- Jour de jeu de l'emprunt et échéance : la clôture `due_day`, à l'instant `due_at`.
  borrowed_day integer not null check (borrowed_day >= 0),
  due_day integer not null,
  due_at timestamptz not null,
  -- Remboursements cumulés et reste dû, tenus par la base (`apply_loan_repayment`, migration 9911).
  principal_repaid bigint not null default 0,
  interest_repaid bigint not null default 0,
  outstanding bigint not null default 0,
  -- En cours, remboursé, ou en défaut (#725).
  status text not null default 'active' check (status in ('active', 'repaid', 'defaulted')),
  disbursement_entry_id uuid not null references game.ledger_entries (id),
  created_at timestamptz not null default now(),
  constraint loans_borrower_same_world foreign key (borrower_house_id, world_id) references game.houses (id, world_id),
  constraint loans_calendar check (due_day = borrowed_day + term_days and due_at > created_at),
  -- Intérêt simple : principal × taux × jours ÷ (10 000 × 365), arrondi à l'obole supérieure (`templeLoanInterest`).
  constraint loans_interest_rule check (interest = ceil(principal::numeric * rate_bps * term_days / 3650000)),
  constraint loans_repaid_bounds check (principal_repaid between 0 and principal and interest_repaid between 0 and interest),
  -- Le reste dû est le décaissement et les intérêts moins les remboursements, jamais négatif.
  constraint loans_outstanding_rule check (
    outstanding = principal + interest - principal_repaid - interest_repaid and outstanding between 0 and 9007199254740991),
  -- Intérêts d'abord : aucun principal remboursé tant qu'il reste des intérêts.
  constraint loans_interest_first check (principal_repaid = 0 or interest_repaid = interest),
  constraint loans_status_rule check ((status = 'repaid') = (outstanding = 0))
);
-- Un prêt du temple à la fois par maison : un prêt remboursé ne compte plus, un prêt en défaut si.
create unique index if not exists loans_one_temple_loan on game.loans (borrower_house_id)
  where lender = 'temple' and status <> 'repaid';
-- Une écriture ne décaisse qu'un prêt.
create unique index if not exists loans_disbursement_once on game.loans (disbursement_entry_id);
create index if not exists loans_borrower_idx on game.loans (borrower_house_id, created_at);
-- Prêts à échoir d'un monde, par échéance (#725).
create index if not exists loans_due_idx on game.loans (world_id, due_day) where status <> 'repaid';

-- Un prêt naît maintenant, en cours, sans rien de remboursé, du temple, pour une maison de joueur (une maison PNJ de
-- secours ne reçoit rien d'un robinet après sa dotation, 8.3) ; son reste dû est son principal plus ses intérêts. Ensuite
-- seuls ses remboursements le changent : la mise à jour vient du seul déclencheur du propriétaire, et ses conditions ne
-- changent jamais.
create or replace function game.guard_loan() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.status is distinct from 'active'
       or new.principal_repaid <> 0 or new.interest_repaid <> 0 then
      raise exception 'a loan is disbursed now, with nothing repaid' using errcode = 'restrict_violation';
    end if;
    if new.lender <> 'temple' then
      raise exception 'only the temple lends until banks open' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.houses h where h.id = new.borrower_house_id and h.kind = 'player') then
      raise exception 'a loan goes to a player house' using errcode = 'check_violation', constraint = 'loans_borrower_player';
    end if;
    new.outstanding := new.principal + new.interest;
    return new;
  end if;
  if not game.written_by_owner_trigger(tg_relid) then
    raise exception 'a loan changes only through its repayments' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.world_id, new.lender, new.borrower_house_id, new.principal, new.rate_bps, new.term_days, new.interest,
      new.borrowed_day, new.due_day, new.due_at, new.disbursement_entry_id, new.created_at)
     is distinct from (old.id, old.world_id, old.lender, old.borrower_house_id, old.principal, old.rate_bps, old.term_days,
      old.interest, old.borrowed_day, old.due_day, old.due_at, old.disbursement_entry_id, old.created_at) then
    raise exception 'a loan keeps its terms' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
-- À la validation, un prêt du temple est décaissé par sa propre écriture `loan.temple_disburse`, datée de lui, de deux
-- lignes : du robinet `faucet_temple_loans` de son monde à la trésorerie de son emprunteur, pour le principal.
create or replace function game.check_loan_disbursed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid record;
begin
  select e.kind, e.created_at, e.world_id, count(*) as lines,
         coalesce(sum(l.amount) filter (where a.kind = 'house' and a.house_id = new.borrower_house_id), 0) as credit,
         coalesce(sum(l.amount) filter (where a.world_id = new.world_id and a.system_key = 'faucet_temple_loans'), 0) as debit
    into paid
    from game.ledger_entries e
    join game.ledger_lines l on l.entry_id = e.id
    join game.accounts a on a.id = l.account_id
    where e.id = new.disbursement_entry_id
    group by e.kind, e.created_at, e.world_id;
  if (paid.kind, paid.created_at, paid.world_id, paid.lines, paid.credit, paid.debit)
     is distinct from ('loan.temple_disburse', new.created_at, new.world_id, 2::bigint, new.principal, -new.principal) then
    raise exception 'a temple loan is disbursed by its own entry, from faucet_temple_loans to its borrower'
      using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;

-- En sens inverse, à la validation, une écriture de décaissement décaisse un prêt : le robinet du temple ne crée de
-- monnaie par elle que pour un prêt. La migration 9911 y ajoute les remboursements.
create or replace function game.check_loan_entry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'loan.temple_disburse' and not exists (select 1 from game.loans o where o.disbursement_entry_id = new.id) then
    raise exception 'a loan entry settles a loan' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_loan(), game.check_loan_disbursed(), game.check_loan_entry()
  from public, anon, authenticated, oikos_service;

drop trigger if exists loans_guard on game.loans;
create trigger loans_guard before insert or update on game.loans
  for each row execute function game.guard_loan();
drop trigger if exists loans_disbursed on game.loans;
create constraint trigger loans_disbursed after insert on game.loans
  deferrable initially deferred for each row execute function game.check_loan_disbursed();
drop trigger if exists loans_no_delete on game.loans;
create trigger loans_no_delete before delete on game.loans
  for each row execute function game.forbid_change();
drop trigger if exists loans_no_truncate on game.loans;
create trigger loans_no_truncate before truncate on game.loans
  for each statement execute function game.forbid_change();
drop trigger if exists ledger_entries_loan on game.ledger_entries;
create constraint trigger ledger_entries_loan after insert on game.ledger_entries
  deferrable initially deferred for each row when (new.kind = 'loan.temple_disburse')
  execute function game.check_loan_entry();

-- Le service lit et décaisse sans choisir ni l'identifiant, ni la date, ni l'état, ni ce qui est remboursé ou reste dû ;
-- il ne modifie ni ne supprime rien. Les lectures des joueurs viennent avec la migration 9912.
alter table game.loans enable row level security;
revoke all on game.loans from public, anon, authenticated, oikos_service;
grant select on game.loans to oikos_service;
grant insert (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day, due_day, due_at,
  disbursement_entry_id) on game.loans to oikos_service;
drop policy if exists service_all on game.loans;
create policy service_all on game.loans for all to oikos_service using (true) with check (true);
