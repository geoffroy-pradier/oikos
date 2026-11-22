-- Banques de joueurs : remboursement des prêts de banque (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ;
-- ticket 728).
-- Un remboursement d'un prêt de banque (migration 0301), de la maison ou prélevé par la clôture, va tout entier au coffre
-- de sa banque : ni le puits des intérêts du temple ni son robinet n'y prennent part. La base l'applique au prêt comme
-- pour le temple (migrations 9911 et 9921), intérêts d'abord.
-- Rejouable (`create or replace`, droits recréés) ; compatible avec le code précédent, qui ne rembourse que le temple,
-- par les mêmes écritures.

-- La migration 9921, plus le prêt de banque : chaque remboursement est payé par sa propre écriture `bank.loan_repay`
-- (`bank.loan_collect` pour un prélèvement), datée de lui, qui nomme son prêt et sa banque, de deux lignes : de la
-- trésorerie de l'emprunteur au coffre, intérêts et principal ensemble ; le temple n'y prend rien.
create or replace function game.check_loan_repayment() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lent game.loans;
  paid record;
begin
  select * into lent from game.loans o where o.id = new.loan_id;
  select e.kind, e.created_at, e.world_id, e.meta ->> 'loanId' as loan_id, e.meta ->> 'bankId' as bank_id,
         count(*) as lines,
         coalesce(sum(l.amount) filter (where a.kind = 'house' and a.house_id = new.house_id), 0) as debit,
         coalesce(sum(l.amount) filter (where a.world_id = new.world_id and a.system_key = 'sink_temple_interest'), 0) as interest,
         coalesce(sum(l.amount) filter (where a.world_id = new.world_id and a.system_key = 'faucet_temple_loans'), 0) as principal,
         coalesce(sum(l.amount) filter (where a.bank_id = lent.bank_id), 0) as vault
    into paid
    from game.ledger_entries e
    join game.ledger_lines l on l.entry_id = e.id
    join game.accounts a on a.id = l.account_id
    where e.id = new.ledger_entry_id
    group by e.kind, e.created_at, e.world_id, e.meta ->> 'loanId', e.meta ->> 'bankId';
  if lent.lender = 'bank' then
    if (paid.kind, paid.created_at, paid.world_id, paid.loan_id, paid.bank_id, paid.lines, paid.debit, paid.vault,
        paid.interest, paid.principal)
       is distinct from ('bank.loan_' || new.kind, new.created_at, new.world_id, new.loan_id::text, lent.bank_id::text,
                         2::bigint, -(new.interest + new.principal), new.interest + new.principal, 0::numeric, 0::numeric) then
      raise exception 'a bank loan repayment is paid by its own entry, from its borrower to its vault'
        using errcode = 'restrict_violation';
    end if;
    return null;
  end if;
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
revoke execute on function game.check_loan_repayment() from public, anon, authenticated, oikos_service;
