-- Charis des maisons (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; docs/specs/12-modele-donnees.md ;
-- ticket 265). La Charis d'une maison envers un dieu (`favor`) n'est que le cumul d'un journal en ajout seul
-- (`favor_ledger`). Cette migration n'en admet que le déclin d'une clôture ; la suivante y ajoute les
-- offrandes, les grâces (#266) et la Pythie (#270) leur nature. Rejouable (`if not exists`,
-- `create or replace`, déclencheurs et règles recréés) ; le code précédent n'écrit ni ne lit ces tables.

-- Charis d'une maison envers un dieu, en entiers, au plus le plus grand entier sûr des clients.
create table if not exists game.favor (
  house_id uuid not null,
  god_id text not null check (god_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  world_id uuid not null references game.worlds (id),
  charis bigint not null default 0,
  primary key (house_id, god_id),
  constraint favor_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint favor_charis_range check (charis between 0 and 9007199254740991)
);

-- Journal de la Charis : chaque ligne ajoute ou retire de la Charis à une maison envers un dieu. Le jour
-- d'un déclin est celui d'une clôture enregistrée, vérifié à la validation (comme `npc_population`).
create table if not exists game.favor_ledger (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  god_id text not null check (god_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  amount bigint not null check (amount <> 0),
  kind text not null check (kind ~ '^[a-z][a-z0-9_.]{1,47}$'),
  game_day integer check (game_day >= 0),
  created_at timestamptz not null default now(),
  constraint favor_ledger_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint favor_ledger_decay_on_close foreign key (world_id, game_day)
    references game.daily_closes (world_id, game_day) deferrable initially deferred
);
-- Une Charis décline une fois par jour de jeu.
create unique index if not exists favor_ledger_decay_once on game.favor_ledger (house_id, god_id, game_day)
  where kind = 'decay';

-- Une ligne du journal naît maintenant. `decay` : une perte, un jour de jeu, dans la transaction qui enregistre
-- la clôture de ce jour : à son insertion, aucune clôture de ce jour ou d'un jour postérieur n'est enregistrée
-- pour le monde (même montage et même verrou que `guard_labor_market`, migration 160). Une autre nature est
-- refusée : chaque mécanique qui touche la Charis remplace cette fonction pour y ajouter la sienne.
create or replace function game.guard_favor_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Charis movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.kind = 'decay' then
    if new.amount > 0 or new.game_day is null then
      raise exception 'a decay removes Charis on a game day' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
      raise exception 'a decay is written before its close is recorded' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Charis movement' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_favor_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists favor_ledger_guard on game.favor_ledger;
create trigger favor_ledger_guard before insert on game.favor_ledger
  for each row execute function game.guard_favor_movement();
drop trigger if exists favor_ledger_immutable on game.favor_ledger;
create trigger favor_ledger_immutable before update or delete on game.favor_ledger
  for each row execute function game.forbid_change();
drop trigger if exists favor_ledger_no_truncate on game.favor_ledger;
create trigger favor_ledger_no_truncate before truncate on game.favor_ledger
  for each statement execute function game.forbid_change();

-- Chaque ligne du journal s'ajoute à la Charis. Au nom du propriétaire et seulement sur ce journal, comme
-- `apply_stock_movement` (migration 12). La Charis est créée à zéro d'abord : la contrainte d'une ligne
-- proposée est contrôlée avant le conflit, et un mouvement négatif n'y passerait pas. Une Charis qui
-- passerait sous zéro ou au-delà des entiers sûrs est refusée (`favor_charis_range`).
create or replace function game.apply_favor_movement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.favor_ledger'::regclass then
    raise exception '% only runs on game.favor_ledger', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.favor (house_id, god_id, world_id) values (new.house_id, new.god_id, new.world_id)
  on conflict (house_id, god_id) do nothing;
  update game.favor set charis = charis + new.amount where house_id = new.house_id and god_id = new.god_id;
  return null;
end;
$$;
revoke execute on function game.apply_favor_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists favor_ledger_apply on game.favor_ledger;
create trigger favor_ledger_apply after insert on game.favor_ledger
  for each row execute function game.apply_favor_movement();

-- La Charis ne change que par son journal ; son identité ne change jamais ; elle ne se supprime pas.
create or replace function game.guard_favor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not game.written_by_owner_trigger(tg_relid) then
    raise exception 'Charis changes only through its journal' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' and (new.house_id, new.god_id, new.world_id) is distinct from (old.house_id, old.god_id, old.world_id) then
    raise exception 'Charis identity is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_favor() from public, anon, authenticated, oikos_service;
drop trigger if exists favor_guard on game.favor;
create trigger favor_guard before insert or update on game.favor
  for each row execute function game.guard_favor();
drop trigger if exists favor_no_delete on game.favor;
create trigger favor_no_delete before delete on game.favor
  for each row execute function game.forbid_change();
drop trigger if exists favor_no_truncate on game.favor;
create trigger favor_no_truncate before truncate on game.favor
  for each statement execute function game.forbid_change();

-- Le service lit, et écrit au journal sans choisir ni l'identifiant ni la date d'une ligne. Sur la Charis,
-- `update` ne sert qu'à verrouiller une ligne (`select ... for update`) : la garde refuse toute modification
-- directe. Les joueurs lisent par des vues (migration 182).
alter table game.favor enable row level security;
alter table game.favor_ledger enable row level security;
revoke all on game.favor, game.favor_ledger from public, anon, authenticated, oikos_service;
grant select on game.favor, game.favor_ledger to oikos_service;
grant insert (world_id, house_id, god_id, amount, kind, game_day) on game.favor_ledger to oikos_service;
grant update (charis) on game.favor to oikos_service;
drop policy if exists service_all on game.favor;
create policy service_all on game.favor for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.favor_ledger;
create policy service_all on game.favor_ledger for all to oikos_service using (true) with check (true);
