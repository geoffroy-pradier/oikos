-- Grand livre en partie double (docs/specs/05-economie.md, 12-modele-donnees.md ; ticket 5).
-- Les soldes ne sont que des cumuls vérifiables des journaux, qui sont en ajout seul.

-- Clés composées : un compte ou un stock ne peut référencer qu'une maison ou une cité de son propre monde.
alter table game.houses drop constraint if exists houses_id_world_unique;
alter table game.houses add constraint houses_id_world_unique unique (id, world_id);
alter table game.cities drop constraint if exists cities_id_world_unique;
alter table game.cities add constraint cities_id_world_unique unique (id, world_id);

create or replace function game.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'game.% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;

-- ---------------------------------------------------------------- Monnaie (montants en oboles entières)

create table if not exists game.accounts (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  kind text not null check (kind in ('house', 'system')),
  house_id uuid,
  -- Compte système : un par robinet et par puits (5.5), nommé.
  system_key text check (system_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  -- Seuls les comptes système peuvent être débiteurs : un robinet crée de la monnaie en passant en négatif.
  allow_negative boolean not null default false,
  balance bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint accounts_owner check (
    (kind = 'house' and house_id is not null and system_key is null and not allow_negative)
    or (kind = 'system' and house_id is null and system_key is not null)
  ),
  constraint accounts_no_overdraft check (balance >= 0 or allow_negative),
  constraint accounts_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint accounts_one_per_house unique (house_id),
  constraint accounts_system_key_unique unique (world_id, system_key)
);

create table if not exists game.ledger_entries (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  -- Nature de l'écriture (code stable, par exemple `npc_purchase`, `market_trade`).
  kind text not null check (kind ~ '^[a-z][a-z0-9_.]{1,47}$'),
  meta jsonb not null default '{}' check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists game.ledger_lines (
  id uuid primary key default game.uuid_v7(),
  entry_id uuid not null references game.ledger_entries (id),
  account_id uuid not null references game.accounts (id),
  -- Positif : crédit du compte. Négatif : débit. Jamais nul, jamais de flottant.
  amount bigint not null check (amount <> 0)
);
create index if not exists ledger_lines_entry_id_idx on game.ledger_lines (entry_id);
create index if not exists ledger_lines_account_id_idx on game.ledger_lines (account_id);

-- Une écriture est équilibrée : au moins deux lignes, somme nulle, comptes du même monde.
-- Contrôlé à la validation de la transaction, à la création de l'écriture comme à l'ajout de toute ligne :
-- une ligne ajoutée après coup à une écriture existante est donc soumise au même contrôle.
create or replace function game.check_entry_balanced() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  checked_entry uuid;
  total numeric;
  line_count integer;
  foreign_count integer;
begin
  if tg_table_name = 'ledger_entries' then
    checked_entry := new.id;
  else
    checked_entry := new.entry_id;
  end if;
  select coalesce(sum(l.amount), 0), count(l.id), count(*) filter (where a.world_id <> e.world_id)
    into total, line_count, foreign_count
  from game.ledger_entries e
  left join game.ledger_lines l on l.entry_id = e.id
  left join game.accounts a on a.id = l.account_id
  where e.id = checked_entry
  group by e.id;
  if line_count < 2 or total <> 0 or foreign_count > 0 then
    raise exception 'ledger entry % is not balanced (lines: %, sum: %, foreign accounts: %)',
      checked_entry, line_count, total, foreign_count using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists ledger_entries_balanced on game.ledger_entries;
create constraint trigger ledger_entries_balanced after insert on game.ledger_entries
  deferrable initially deferred for each row execute function game.check_entry_balanced();
drop trigger if exists ledger_lines_balanced on game.ledger_lines;
create constraint trigger ledger_lines_balanced after insert on game.ledger_lines
  deferrable initially deferred for each row execute function game.check_entry_balanced();

-- Chaque ligne insérée met à jour le solde de son compte, dans la même transaction. Le déclencheur est
-- placé APRÈS l'insertion : une ligne écartée (ON CONFLICT DO NOTHING) ne touche donc aucun solde.
create or replace function game.apply_ledger_line() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update game.accounts set balance = balance + new.amount where id = new.account_id;
  return null;
end;
$$;

drop trigger if exists ledger_lines_apply on game.ledger_lines;
create trigger ledger_lines_apply after insert on game.ledger_lines
  for each row execute function game.apply_ledger_line();

-- Un compte naît à zéro, son identité ne change jamais, et son solde ne se modifie que par une ligne.
create or replace function game.guard_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.balance <> 0 then
      raise exception 'an account starts with a zero balance' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.kind, new.house_id, new.system_key, new.allow_negative, new.created_at)
     is distinct from (old.id, old.world_id, old.kind, old.house_id, old.system_key, old.allow_negative, old.created_at) then
    raise exception 'account identity is immutable' using errcode = 'restrict_violation';
  end if;
  if pg_trigger_depth() < 2 and new.balance is distinct from old.balance then
    raise exception 'account balance changes only through ledger lines' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_guard on game.accounts;
create trigger accounts_guard before insert or update on game.accounts
  for each row execute function game.guard_account();

drop trigger if exists ledger_entries_immutable on game.ledger_entries;
create trigger ledger_entries_immutable before update or delete on game.ledger_entries
  for each row execute function game.forbid_change();
drop trigger if exists ledger_lines_immutable on game.ledger_lines;
create trigger ledger_lines_immutable before update or delete on game.ledger_lines
  for each row execute function game.forbid_change();
drop trigger if exists ledger_entries_no_truncate on game.ledger_entries;
create trigger ledger_entries_no_truncate before truncate on game.ledger_entries
  for each statement execute function game.forbid_change();
drop trigger if exists ledger_lines_no_truncate on game.ledger_lines;
create trigger ledger_lines_no_truncate before truncate on game.ledger_lines
  for each statement execute function game.forbid_change();

-- Vue de contrôle : pour tout compte, solde = cumul des lignes.
create or replace view game.account_balance_check with (security_invoker = true) as
  select a.id as account_id, a.world_id, a.balance, coalesce(sum(l.amount), 0)::bigint as lines_total,
         a.balance = coalesce(sum(l.amount), 0) as ok
  from game.accounts a
  left join game.ledger_lines l on l.account_id = a.id
  group by a.id;

alter table game.accounts enable row level security;
alter table game.ledger_entries enable row level security;
alter table game.ledger_lines enable row level security;
