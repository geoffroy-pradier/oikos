-- Banques de joueurs : écritures du droit et du capital (docs/specs/05-economie.md, 5.4 et 5.5 ; 12-modele-donnees.md ;
-- ticket 726). Le coffre d'une banque (migration 9940) ne reçoit ni ne verse que par les écritures des banques : le
-- capital versé ou retiré (`bank.capital_in`, `bank.capital_out`), entre la trésorerie de la maison de la banque et son
-- coffre. Le droit de fondation (`bank.charter`) va de cette trésorerie au puits `sink_bank_charter`, une fois, à la
-- fondation, pour le montant que la banque retient.
-- Rejouable (`create or replace`, contrainte, index et déclencheurs recréés) ; compatible avec le code précédent, qui
-- n'écrit aucune écriture de banque et ne débite aucun coffre.

-- À la validation, une banque a payé son droit par une écriture `bank.charter` s'il n'est pas nul, et par aucune sinon.
create or replace function game.check_bank_chartered() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from game.ledger_entries e where e.kind = 'bank.charter' and e.meta ->> 'bankId' = new.id::text)
     is distinct from (new.charter_fee > 0) then
    raise exception 'a bank pays its charter fee by its own entry' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;

-- Écritures des banques : elles nomment leur banque (`meta.bankId`, un identifiant en minuscules), une seule fois pour le
-- droit, qu'elles soient de cette migration ou des suivantes (dépôts, #727).
alter table game.ledger_entries drop constraint if exists ledger_entries_bank_meta;
alter table game.ledger_entries add constraint ledger_entries_bank_meta check (
  kind not like 'bank.%'
  or (jsonb_typeof(meta -> 'bankId') = 'string'
      and meta ->> 'bankId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') is true
);
create unique index if not exists ledger_entries_bank_charter_once on game.ledger_entries ((meta ->> 'bankId'))
  where kind = 'bank.charter';
-- À la validation, une écriture de banque a exactement deux lignes : le droit, de la trésorerie de la maison de la
-- banque au puits `sink_bank_charter` de son monde, pour le droit de la banque ; le capital, de cette trésorerie au
-- coffre de la banque (`bank.capital_in`) ou du coffre à la trésorerie (`bank.capital_out`). Le contrôle porte sur
-- l'écriture entière et se rejoue pour chaque ligne qui lui est ajoutée, même dans une transaction ultérieure : une ligne
-- ajoutée après coup à une écriture validée la refait juger (trois lignes ou plus : refusée). Il ne lit pas la date de
-- l'écriture, que le service écrit : le droit tombe à la fondation parce qu'une banque au droit non nul a son écriture de
-- droit dès la validation de sa fondation (`check_bank_chartered`), et une seule (`ledger_entries_bank_charter_once`).
create or replace function game.check_bank_entry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry game.ledger_entries;
  bank game.banks;
  moved record;
begin
  if tg_relid = 'game.ledger_lines'::regclass then
    select * into entry from game.ledger_entries e where e.id = new.entry_id;
  elsif tg_relid = 'game.ledger_entries'::regclass then
    select * into entry from game.ledger_entries e where e.id = new.id;
  else
    raise exception '% only runs on the ledger', tg_name using errcode = 'insufficient_privilege';
  end if;
  if entry.kind is null or entry.kind not in ('bank.charter', 'bank.capital_in', 'bank.capital_out') then
    return null;
  end if;
  select * into bank from game.banks b where b.id = (entry.meta ->> 'bankId')::uuid and b.world_id = entry.world_id;
  select count(*) as lines,
         coalesce(sum(l.amount) filter (where a.kind = 'house' and a.house_id = bank.house_id), 0) as treasury,
         coalesce(sum(l.amount) filter (where a.bank_id = bank.id), 0) as vault,
         coalesce(sum(l.amount) filter (where a.world_id = bank.world_id and a.system_key = 'sink_bank_charter'), 0)
           as sink,
         count(*) filter (where a.kind = 'house' and a.house_id = bank.house_id) as treasury_lines
    into moved
    from game.ledger_lines l join game.accounts a on a.id = l.account_id
    where l.entry_id = entry.id;
  if bank.id is null or moved.lines <> 2 or moved.treasury_lines <> 1
     or (entry.kind = 'bank.charter' and (moved.sink <> bank.charter_fee or moved.treasury <> -bank.charter_fee))
     or (entry.kind = 'bank.capital_in' and not (moved.vault > 0 and moved.treasury = -moved.vault))
     or (entry.kind = 'bank.capital_out' and not (moved.vault < 0 and moved.treasury = -moved.vault)) then
    raise exception 'a bank entry moves money between its house treasury and its vault, or pays its charter fee'
      using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
-- À l'insertion d'une ligne, sans report possible, quel que soit le rôle : un coffre ne reçoit ni ne verse que par les
-- écritures de capital de sa propre banque. Jamais débiteur : contrainte du compte (`accounts_no_overdraft`).
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
  if entry.kind is null or entry.kind not in ('bank.capital_in', 'bank.capital_out')
     or entry.meta ->> 'bankId' is distinct from vault_bank::text then
    raise exception 'the vault of bank % moves only by its own bank entries', vault_bank using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

-- Trésor d'une cité (migration 1110) : un coffre n'en est pas un, ses débits sont tenus ci-dessus.
create or replace function game.check_treasury_debit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  treasury_city uuid;
  purse boolean;
  entry game.ledger_entries;
  decree game.decrees;
begin
  if tg_relid <> 'game.ledger_lines'::regclass then
    raise exception '% only runs on game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  select a.city_id, a.npc_purse into treasury_city, purse from game.accounts a
    where a.id = new.account_id and a.kind = 'treasury' and a.bank_id is null;
  if treasury_city is null then
    return null;
  end if;
  select * into entry from game.ledger_entries e where e.id = new.entry_id;
  if purse then
    if entry.kind <> 'npc.purchase' or not exists (select 1 from game.trades t where t.ledger_entry_id = entry.id) then
      raise exception 'the NPC purse of city % pays only NPC purchases', treasury_city using errcode = 'check_violation';
    end if;
    return null;
  end if;
  if entry.kind in ('city.public_works', 'city.festival')
     and entry.meta ->> 'decreeId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into decree from game.decrees d where d.id = (entry.meta ->> 'decreeId')::uuid;
  end if;
  if decree.id is null or decree.city_id <> treasury_city or decree.status <> 'applied'
     or entry.kind <> 'city.' || decree.model
     or (select -sum(l.amount) from game.ledger_lines l where l.entry_id = entry.id and l.account_id = new.account_id)
        > (decree.params ->> 'amountOboles')::bigint
     or exists (select 1 from game.ledger_lines l join game.accounts a on a.id = l.account_id
                where l.entry_id = entry.id and l.account_id <> new.account_id
                  and not (l.amount > 0 and a.kind = 'system' and a.world_id = decree.world_id
                           and a.system_key = case decree.model when 'public_works' then 'sink_public_works'
                                                                 else 'sink_festivals' end)) then
    raise exception 'the treasury of city % pays only the spending of its applied decrees', treasury_city
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_bank_chartered(), game.check_bank_entry(), game.check_bank_vault_line(),
  game.check_treasury_debit() from public, anon, authenticated, oikos_service;

drop trigger if exists banks_chartered on game.banks;
create constraint trigger banks_chartered after insert on game.banks
  deferrable initially deferred for each row execute function game.check_bank_chartered();
drop trigger if exists ledger_entries_bank on game.ledger_entries;
create constraint trigger ledger_entries_bank after insert on game.ledger_entries
  deferrable initially deferred for each row when (new.kind in ('bank.charter', 'bank.capital_in', 'bank.capital_out'))
  execute function game.check_bank_entry();
-- Toute ligne d'une écriture de banque, insérée avec elle ou après : la fonction écarte les autres écritures.
drop trigger if exists ledger_lines_bank_entry on game.ledger_lines;
create constraint trigger ledger_lines_bank_entry after insert on game.ledger_lines
  deferrable initially deferred for each row execute function game.check_bank_entry();
drop trigger if exists ledger_lines_bank_vault on game.ledger_lines;
create trigger ledger_lines_bank_vault after insert on game.ledger_lines
  for each row execute function game.check_bank_vault_line();
