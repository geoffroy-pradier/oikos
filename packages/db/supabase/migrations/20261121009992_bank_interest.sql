-- Banques de joueurs : intérêt des dépôts et taux affichés (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ;
-- ticket 727).
-- L'intérêt du jour d'un dépôt s'ajoute à son solde par la clôture, sans écriture au grand livre : la dette de la banque
-- grossit, pas la masse monétaire. Le service change les taux affichés d'une banque (`bank.setRates`, qui les borne à
-- la configuration en vigueur ; la garde de la migration 9940 ne laisse changer qu'eux).
-- Rejouable (`create or replace`, déclencheurs et droits recréés) ; compatible avec le code précédent, qui n'écrit aucun
-- intérêt et ne change aucun taux.

-- Un mouvement naît maintenant, au taux affiché par sa banque. Un dépôt ou un retrait est du jour de jeu de maintenant et
-- nomme sa propre écriture de banque (ses lignes sont jugées à la validation, `check_bank_entry`). L'intérêt est celui du
-- jour du solde verrouillé, au taux affiché, arrondi à l'obole inférieure et rogné aux entiers sûrs
-- (`bankDepositInterest`), écrit par la clôture d'un jour dont l'enregistrement n'est pas encore fait (même verrou que
-- la clôture).
create or replace function game.guard_bank_deposit_movement() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rate integer;
  entry game.ledger_entries;
  held bigint;
begin
  if new.created_at is distinct from now() then
    raise exception 'a deposit movement is written now' using errcode = 'restrict_violation';
  end if;
  select b.deposit_rate_bps into rate from game.banks b where b.id = new.bank_id;
  new.rate_bps := rate;
  if new.kind <> 'interest' then
    new.game_day := game.game_day_at(now());
    select * into entry from game.ledger_entries e where e.id = new.ledger_entry_id;
    if entry.kind is distinct from 'bank.' || new.kind or entry.world_id is distinct from new.world_id
       or entry.meta ->> 'bankId' is distinct from new.bank_id::text then
      raise exception 'a deposit or a withdrawal is paid by its own bank entry' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  select d.balance into held from game.bank_deposits d where d.id = new.deposit_id for update;
  if new.amount is distinct from least(floor(held::numeric * rate / 3650000), 9007199254740991 - held)::bigint then
    raise exception 'a deposit earns the interest of its day at its bank''s displayed rate, rounded down'
      using errcode = 'restrict_violation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
    raise exception 'a deposit earns interest before its close is recorded' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
-- À la validation, l'intérêt a la clôture de son jour, enregistrée dans la même transaction.
create or replace function game.check_bank_interest_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.game_day) then
    raise exception 'a deposit earns interest by the close of its day' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;

revoke execute on function game.guard_bank_deposit_movement(), game.check_bank_interest_on_close()
  from public, anon, authenticated, oikos_service;

drop trigger if exists bank_deposit_movements_on_close on game.bank_deposit_movements;
create constraint trigger bank_deposit_movements_on_close after insert on game.bank_deposit_movements
  deferrable initially deferred for each row when (new.kind = 'interest')
  execute function game.check_bank_interest_on_close();

-- Le service change les taux d'une banque, et rien d'autre (`guard_bank`, migration 9940).
grant update (deposit_rate_bps, loan_rate_bps) on game.banks to oikos_service;
