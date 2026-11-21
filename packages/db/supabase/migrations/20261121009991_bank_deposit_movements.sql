-- Banques de joueurs : dépôts et retraits (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ; ticket 727).
-- Le solde d'un dépôt (migration 9990) ne bouge que par ses mouvements (`bank_deposit_movements`, en ajout seul) : un
-- dépôt ou un retrait, payé par sa propre écriture `bank.deposit` ou `bank.withdraw` entre la trésorerie du déposant et le
-- coffre de la banque, ou, avec la migration 9992, l'intérêt du jour. Le coffre reste jamais débiteur
-- (`accounts_no_overdraft`) : un retrait qu'il ne couvre pas est refusé, ce qui rend la ruée possible.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs, règles et droits recréés) ; compatible avec le code
-- précédent, qui n'écrit ni ne lit cette table ni aucune écriture de dépôt.

create table if not exists game.bank_deposit_movements (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null,
  deposit_id uuid not null,
  bank_id uuid not null,
  house_id uuid not null,
  kind text not null check (kind in ('deposit', 'withdraw', 'interest')),
  amount bigint not null check (amount between 1 and 9007199254740991),
  -- Taux de dépôt affiché par la banque à l'instant du mouvement, que la base écrit.
  rate_bps integer not null check (rate_bps between 0 and 1000000),
  -- Jour de jeu : celui de maintenant pour un dépôt ou un retrait, que la base écrit ; celui de la clôture pour l'intérêt.
  game_day integer check (game_day >= 0),
  ledger_entry_id uuid references game.ledger_entries (id),
  created_at timestamptz not null default now(),
  constraint bank_deposit_movements_deposit foreign key (deposit_id, bank_id, house_id, world_id)
    references game.bank_deposits (id, bank_id, house_id, world_id),
  -- Un dépôt ou un retrait a son écriture ; l'intérêt n'en a pas, mais un jour.
  constraint bank_deposit_movements_entry check ((kind = 'interest') = (ledger_entry_id is null)),
  constraint bank_deposit_movements_day check (kind <> 'interest' or game_day is not null)
);
-- Une écriture ne paie qu'un mouvement ; un intérêt par dépôt et par jour de jeu : rejouée, la clôture ne crédite rien
-- deux fois.
create unique index if not exists bank_deposit_movements_entry_once on game.bank_deposit_movements (ledger_entry_id);
create unique index if not exists bank_deposit_movements_interest_once on game.bank_deposit_movements (deposit_id, game_day)
  where kind = 'interest';
create index if not exists bank_deposit_movements_deposit_idx on game.bank_deposit_movements (deposit_id, created_at);

-- Un mouvement naît maintenant, au taux affiché par sa banque. Un dépôt ou un retrait est du jour de jeu de maintenant et
-- nomme sa propre écriture de banque (ses lignes sont jugées à la validation, `check_bank_entry`). L'intérêt vient avec
-- la migration 9992.
create or replace function game.guard_bank_deposit_movement() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rate integer;
  entry game.ledger_entries;
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
  raise exception 'deposits earn no interest yet' using errcode = 'restrict_violation';
end;
$$;
-- Le mouvement s'applique au dépôt, au nom du propriétaire : jamais négatif (`bank_deposits_balance_bounds`).
create or replace function game.apply_bank_deposit_movement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.bank_deposit_movements'::regclass then
    raise exception '% only runs on game.bank_deposit_movements', tg_name using errcode = 'insufficient_privilege';
  end if;
  update game.bank_deposits d
    set balance = d.balance + case new.kind when 'withdraw' then -new.amount else new.amount end
    where d.id = new.deposit_id;
  return null;
end;
$$;
-- Écritures des banques (migration 9941), plus le dépôt et le retrait : deux lignes, de la trésorerie du déposant au
-- coffre de la banque (`bank.deposit`) ou l'inverse (`bank.withdraw`), du montant de leur mouvement. Rejoué pour chaque
-- ligne ajoutée à l'écriture, même dans une transaction ultérieure.
create or replace function game.check_bank_entry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry game.ledger_entries;
  bank game.banks;
  movement game.bank_deposit_movements;
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
     or entry.kind not in ('bank.charter', 'bank.capital_in', 'bank.capital_out', 'bank.deposit', 'bank.withdraw') then
    return null;
  end if;
  select * into bank from game.banks b where b.id = (entry.meta ->> 'bankId')::uuid and b.world_id = entry.world_id;
  payer := bank.house_id;
  if entry.kind in ('bank.deposit', 'bank.withdraw') then
    select * into movement from game.bank_deposit_movements m where m.ledger_entry_id = entry.id;
    payer := movement.house_id;
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
              or moved.vault <> case movement.kind when 'deposit' then movement.amount else -movement.amount end)) then
    raise exception 'a bank entry moves money between its house treasury and its vault, or pays its charter fee'
      using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
-- Coffre (migration 9941) : il reçoit et verse aussi par les dépôts et les retraits de sa banque.
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
  if entry.kind is null or entry.kind not in ('bank.capital_in', 'bank.capital_out', 'bank.deposit', 'bank.withdraw')
     or entry.meta ->> 'bankId' is distinct from vault_bank::text then
    raise exception 'the vault of bank % moves only by its own bank entries', vault_bank using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke execute on function game.guard_bank_deposit_movement(), game.apply_bank_deposit_movement(),
  game.check_bank_entry(), game.check_bank_vault_line() from public, anon, authenticated, oikos_service;

drop trigger if exists bank_deposit_movements_guard on game.bank_deposit_movements;
create trigger bank_deposit_movements_guard before insert on game.bank_deposit_movements
  for each row execute function game.guard_bank_deposit_movement();
drop trigger if exists bank_deposit_movements_apply on game.bank_deposit_movements;
create trigger bank_deposit_movements_apply after insert on game.bank_deposit_movements
  for each row execute function game.apply_bank_deposit_movement();
drop trigger if exists bank_deposit_movements_immutable on game.bank_deposit_movements;
create trigger bank_deposit_movements_immutable before update or delete on game.bank_deposit_movements
  for each row execute function game.forbid_change();
drop trigger if exists bank_deposit_movements_no_truncate on game.bank_deposit_movements;
create trigger bank_deposit_movements_no_truncate before truncate on game.bank_deposit_movements
  for each statement execute function game.forbid_change();
-- Les écritures de dépôt et de retrait, jugées à la validation comme celles de la migration 9941.
drop trigger if exists ledger_entries_bank on game.ledger_entries;
create constraint trigger ledger_entries_bank after insert on game.ledger_entries
  deferrable initially deferred for each row
  when (new.kind in ('bank.charter', 'bank.capital_in', 'bank.capital_out', 'bank.deposit', 'bank.withdraw'))
  execute function game.check_bank_entry();

-- Le service écrit les mouvements sans choisir ni l'identifiant, ni la date, ni le taux ; rien ne se modifie ni ne se
-- supprime.
alter table game.bank_deposit_movements enable row level security;
revoke all on game.bank_deposit_movements from public, anon, authenticated, oikos_service;
grant select on game.bank_deposit_movements to oikos_service;
grant insert (world_id, deposit_id, bank_id, house_id, kind, amount, game_day, ledger_entry_id)
  on game.bank_deposit_movements to oikos_service;
drop policy if exists service_all on game.bank_deposit_movements;
create policy service_all on game.bank_deposit_movements for all to oikos_service using (true) with check (true);
