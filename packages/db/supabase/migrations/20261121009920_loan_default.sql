-- Prêts : calendrier et défaut (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ; ticket 725).
-- Un prêt naît le jour de jeu de l'instant présent, et son échéance est l'instant de la clôture de son jour d'échéance,
-- à l'horloge de la configuration en vigueur, comme les calcule `@oikos/sim` (`gameDayAt`, `dailyCloseAt`). Échu et non
-- soldé, il passe en défaut, une fois, par la clôture de son jour. Les prélèvements de la clôture et la Timè perdue
-- (`loan_defaulted`) viennent avec la migration suivante (9921), les lectures avec la 9922.
-- Rejouable (`if not exists`, `create or replace`, contraintes conditionnelles, déclencheurs recréés) ; compatible avec
-- le code précédent, qui écrit déjà le jour et l'échéance de l'horloge et ne fait passer aucun prêt en défaut.

-- Jour de jeu d'un instant, à l'horloge de la configuration en vigueur maintenant : le jour civil local dont la clôture
-- l'a ouvert (`gameDayAt`). Nul sans horloge, ce qu'aucune garde n'admet.
create or replace function game.game_day_at(p_at timestamptz) returns integer
language sql stable security definer
set search_path = ''
as $$
  select (((p_at at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date - date '1970-01-01')::integer
  from game.clock_rules() c
$$;
revoke all on function game.game_day_at(timestamptz) from public, anon, authenticated;
grant execute on function game.game_day_at(timestamptz) to oikos_service;

-- Jour de jeu du défaut : la clôture qui l'a constaté. Ajoutée sans vérifier les lignes existantes (`not valid`) : un
-- prêt remboursé avant #725 n'a pas de défaut, et aucun n'y était en défaut hors des tests, posé gardes levées.
alter table game.loans add column if not exists defaulted_day integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loans_default_rule') then
    alter table game.loans add constraint loans_default_rule check (
      (status = 'active' and defaulted_day is null)
      or (status = 'defaulted' and defaulted_day is not null and defaulted_day >= due_day)
      or (status = 'repaid' and (defaulted_day is null or defaulted_day >= due_day))) not valid;
  end if;
end $$;

-- La migration 9910, plus le calendrier à l'emprunt et le défaut. Un prêt naît le jour de jeu de maintenant, et son
-- échéance est le premier instant de son jour d'échéance, sur un quart d'heure, comme `dailyCloseAt`. Ensuite, ses
-- remboursements le changent (au nom du propriétaire), ou la clôture le fait passer en défaut, une fois : en cours et
-- échu, son jour de défaut au plus tôt celui de l'échéance, par une clôture dont l'enregistrement n'est pas encore fait
-- (même verrou que la clôture), sans rien changer d'autre, la trésorerie de l'emprunteur vidée par le prélèvement.
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
    if new.lender <> 'temple' then
      raise exception 'only the temple lends until banks open' using errcode = 'restrict_violation';
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
      new.borrowed_day, new.due_day, new.due_at, new.disbursement_entry_id, new.created_at)
     is distinct from (old.id, old.world_id, old.lender, old.borrower_house_id, old.principal, old.rate_bps, old.term_days,
      old.interest, old.borrowed_day, old.due_day, old.due_at, old.disbursement_entry_id, old.created_at) then
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
-- À la validation, un défaut a la clôture de son jour, enregistrée dans la même transaction.
create or replace function game.check_loan_default_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.defaulted_day) then
    raise exception 'a loan defaults by the close of its day' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_loan(), game.check_loan_default_on_close()
  from public, anon, authenticated, oikos_service;
drop trigger if exists loans_default_on_close on game.loans;
create constraint trigger loans_default_on_close after update on game.loans
  deferrable initially deferred for each row when (old.status = 'active' and new.status = 'defaulted')
  execute function game.check_loan_default_on_close();
-- Le service fait passer un prêt en défaut sans rien choisir d'autre que son état et son jour.
grant update (status, defaulted_day) on game.loans to oikos_service;
