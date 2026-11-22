-- Banques de joueurs : défaut et saisie de la garantie (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ; #729).
-- À l'échéance, un prêt de banque que le prélèvement ne solde pas passe en défaut par la saisie de sa garantie, qui le
-- solde quelle que soit sa valeur : `loan_seizures`, en ajout seul, une par prêt, écrite par la clôture de son jour. Un
-- déclencheur du propriétaire fait passer le prêt en défaut et le solde, son reste dû remis (`written_off`) ; la remise
-- de la garantie à la maison de la banque vient avec les migrations 0601 (stock) et 0602 (logement).
-- Rejouable (`if not exists`, contraintes conditionnelles, `create or replace`, déclencheurs et droits recréés) ;
-- compatible avec le code précédent, qui ne saisit rien et n'écrit `written_off` nulle part.

-- Reste dû remis par la saisie : nul pour tout prêt qui n'a pas été saisi.
alter table game.loans add column if not exists written_off bigint not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loans_written_off_rule') then
    alter table game.loans drop constraint if exists loans_outstanding_rule;
    alter table game.loans add constraint loans_outstanding_rule check (
      outstanding = principal + interest - principal_repaid - interest_repaid - written_off
      and outstanding between 0 and 9007199254740991);
    alter table game.loans add constraint loans_written_off_rule check (
      written_off >= 0 and (written_off = 0 or (lender = 'bank' and status = 'repaid' and defaulted_day is not null)));
  end if;
end $$;

-- Saisie : le prêt, le jour de la clôture qui la fait, enregistrée dans sa transaction, et les maisons, posées par la base.
create table if not exists game.loan_seizures (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  loan_id uuid not null references game.loans (id),
  game_day integer not null,
  borrower_house_id uuid not null,
  bank_house_id uuid not null,
  created_at timestamptz not null default now(),
  constraint loan_seizures_once unique (loan_id),
  constraint loan_seizures_id_world_unique unique (id, world_id),
  constraint loan_seizures_borrower_same_world foreign key (borrower_house_id, world_id) references game.houses (id, world_id),
  constraint loan_seizures_bank_house_same_world foreign key (bank_house_id, world_id) references game.houses (id, world_id),
  constraint loan_seizures_on_close foreign key (world_id, game_day)
    references game.daily_closes (world_id, game_day) deferrable initially deferred
);

-- Une saisie naît maintenant, d'un prêt de banque en cours, échu et encore dû, dont le prélèvement de la clôture a vidé la
-- trésorerie de l'emprunteur, avant que la clôture de son jour soit enregistrée (même verrou que la clôture) ; la base y
-- pose l'emprunteur et la maison de la banque. Elle ne change ni ne se supprime ensuite.
create or replace function game.guard_loan_seizure() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lent game.loans;
begin
  if tg_op <> 'INSERT' then
    raise exception 'a seizure does not change' using errcode = 'restrict_violation';
  end if;
  select * into lent from game.loans o where o.id = new.loan_id for update;
  -- En cours, il est encore dû (`loans_status_rule`) ; son monde est celui de ses maisons (clés étrangères).
  if lent.lender is distinct from 'bank' or lent.status <> 'active' then
    raise exception 'a seizure settles an outstanding bank loan' using errcode = 'restrict_violation';
  end if;
  if now() < lent.due_at or new.game_day < lent.due_day then
    raise exception 'a bank loan is seized once due' using errcode = 'restrict_violation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
    raise exception 'a bank loan is seized before its close is recorded' using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from game.accounts a where a.kind = 'house' and a.house_id = lent.borrower_house_id and a.balance <> 0) then
    raise exception 'a bank loan is seized once the collection has emptied the treasury' using errcode = 'restrict_violation';
  end if;
  new.created_at := now();
  new.borrower_house_id := lent.borrower_house_id;
  new.bank_house_id := (select b.house_id from game.banks b where b.id = lent.bank_id);
  return new;
end;
$$;

-- La saisie, au nom du propriétaire : le prêt passe en défaut le jour de la saisie et se solde, son reste dû remis ; le
-- déclencheur du solde (migration 0303) libère son stock gagé.
create or replace function game.apply_loan_seizure() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.loan_seizures'::regclass then
    raise exception '% only runs on game.loan_seizures', tg_name using errcode = 'insufficient_privilege';
  end if;
  update game.loans o set status = 'repaid', defaulted_day = new.game_day, written_off = o.outstanding, outstanding = 0
    where o.id = new.loan_id and o.status = 'active';
  return null;
end;
$$;

-- La migration 0301, plus la saisie : seul le déclencheur de la saisie, au nom du propriétaire, fait passer un prêt de
-- banque en défaut, le jour de sa saisie, et le solde en remettant tout son reste dû, sans rien rembourser.
create or replace function game.guard_loan() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.status is distinct from 'active'
       or new.principal_repaid <> 0 or new.interest_repaid <> 0 or new.defaulted_day is not null or new.written_off <> 0 then
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
    if (new.defaulted_day, new.written_off) is not distinct from (old.defaulted_day, old.written_off) then
      return new;
    end if;
    -- Remboursements inchangés et prêt soldé : le reste dû entier est remis (`loans_outstanding_rule`).
    if old.status <> 'active' or new.status <> 'repaid'
       or (new.principal_repaid, new.interest_repaid) is distinct from (old.principal_repaid, old.interest_repaid)
       or not exists (select 1 from game.loan_seizures z
                      where z.loan_id = new.id and z.game_day = new.defaulted_day and z.created_at = now()) then
      raise exception 'a loan defaults with its seizure, or keeps the day of its default' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.status <> 'active' or new.status <> 'defaulted' or new.defaulted_day is null
     or (new.principal_repaid, new.interest_repaid, new.outstanding, new.written_off)
        is distinct from (old.principal_repaid, old.interest_repaid, old.outstanding, old.written_off) then
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

revoke execute on function game.guard_loan_seizure(), game.apply_loan_seizure(), game.guard_loan()
  from public, anon, authenticated, oikos_service;
drop trigger if exists loan_seizures_guard on game.loan_seizures;
create trigger loan_seizures_guard before insert or update on game.loan_seizures
  for each row execute function game.guard_loan_seizure();
drop trigger if exists loan_seizures_apply on game.loan_seizures;
create trigger loan_seizures_apply after insert on game.loan_seizures
  for each row execute function game.apply_loan_seizure();
drop trigger if exists loan_seizures_no_delete on game.loan_seizures;
create trigger loan_seizures_no_delete before delete on game.loan_seizures
  for each row execute function game.forbid_change();
drop trigger if exists loan_seizures_no_truncate on game.loan_seizures;
create trigger loan_seizures_no_truncate before truncate on game.loan_seizures
  for each statement execute function game.forbid_change();

-- Le service saisit sans choisir ni identifiant, ni date, ni maisons ; aucun joueur ne lit ni n'écrit les saisies.
alter table game.loan_seizures enable row level security;
revoke all on game.loan_seizures from public, anon, authenticated, oikos_service;
grant select on game.loan_seizures to oikos_service;
grant insert (world_id, loan_id, game_day) on game.loan_seizures to oikos_service;
drop policy if exists service_all on game.loan_seizures;
create policy service_all on game.loan_seizures for all to oikos_service using (true) with check (true);
