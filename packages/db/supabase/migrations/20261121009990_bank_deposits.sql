-- Banques de joueurs : dépôts (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ; ticket 727).
-- Un dépôt est une créance d'une maison de joueur sur une banque de son monde, qui n'est pas la sienne : une ligne de
-- `bank_deposits`, en oboles, jamais négative, une par banque et par maison. Son solde ne bouge que par ses mouvements,
-- qui viennent avec la migration 9991 : avant elle, un dépôt reste vide.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs, règles et droits recréés) ; compatible avec le code
-- précédent, qui n'écrit ni ne lit cette table.

create table if not exists game.bank_deposits (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  bank_id uuid not null,
  -- Le déposant.
  house_id uuid not null,
  -- Créance du déposant, intérêts compris, en oboles, dans les entiers sûrs des clients.
  balance bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint bank_deposits_balance_bounds check (balance between 0 and 9007199254740991),
  constraint bank_deposits_bank_same_world foreign key (bank_id, world_id) references game.banks (id, world_id),
  constraint bank_deposits_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint bank_deposits_one_per_house unique (bank_id, house_id),
  constraint bank_deposits_identity unique (id, bank_id, house_id, world_id)
);
create index if not exists bank_deposits_house_idx on game.bank_deposits (house_id);

-- Un dépôt s'ouvre maintenant, vide, pour une maison de joueur, dans une banque qui n'est pas la sienne ; ensuite seuls
-- ses mouvements changent son solde, par le déclencheur du propriétaire.
create or replace function game.guard_bank_deposit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.balance <> 0 or new.created_at is distinct from now() then
      raise exception 'a deposit opens now, empty' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.houses h where h.id = new.house_id and h.kind = 'player') then
      raise exception 'a deposit belongs to a player house' using errcode = 'check_violation',
        constraint = 'bank_deposits_player';
    end if;
    if exists (select 1 from game.banks b where b.id = new.bank_id and b.house_id = new.house_id) then
      raise exception 'a house does not deposit in its own bank' using errcode = 'check_violation',
        constraint = 'bank_deposits_not_own_bank';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.bank_id, new.house_id, new.created_at)
     is distinct from (old.id, old.world_id, old.bank_id, old.house_id, old.created_at) then
    raise exception 'a deposit keeps its identity' using errcode = 'restrict_violation';
  end if;
  if new.balance is distinct from old.balance and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'a deposit balance changes only through its movements' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

revoke execute on function game.guard_bank_deposit() from public, anon, authenticated, oikos_service;

drop trigger if exists bank_deposits_guard on game.bank_deposits;
create trigger bank_deposits_guard before insert or update on game.bank_deposits
  for each row execute function game.guard_bank_deposit();
drop trigger if exists bank_deposits_no_delete on game.bank_deposits;
create trigger bank_deposits_no_delete before delete on game.bank_deposits
  for each row execute function game.forbid_change();
drop trigger if exists bank_deposits_no_truncate on game.bank_deposits;
create trigger bank_deposits_no_truncate before truncate on game.bank_deposits
  for each statement execute function game.forbid_change();

-- Le service ouvre un dépôt sans choisir ni l'identifiant, ni la date, ni le solde ; il le verrouille (droit sur
-- `balance`, que la garde refuse de changer). Rien ne se modifie ni ne se supprime. Les lectures des joueurs viennent
-- avec la migration 9993.
alter table game.bank_deposits enable row level security;
revoke all on game.bank_deposits from public, anon, authenticated, oikos_service;
grant select on game.bank_deposits to oikos_service;
grant insert (world_id, bank_id, house_id), update (balance) on game.bank_deposits to oikos_service;
drop policy if exists service_all on game.bank_deposits;
create policy service_all on game.bank_deposits for all to oikos_service using (true) with check (true);
