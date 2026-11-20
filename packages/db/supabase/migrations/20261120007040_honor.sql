-- Timè des maisons (docs/specs/04-systemes-gestion.md, 4.1 ; docs/specs/12-modele-donnees.md ; ticket 704).
-- La Timè d'une maison (`honor`) n'est que le cumul d'un journal en ajout seul (`honor_ledger`), comme la Charis
-- (migration 180) : entière, ni monnaie ni bien, elle ne s'achète ni ne se transfère. Cette migration n'en admet
-- qu'un motif, le mandat d'archonte mené à son terme ; chaque ticket suivant remplace la garde pour y ajouter le
-- sien. Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés, vues créées une fois) ;
-- le code précédent n'écrit ni ne lit ces tables.

-- Timè d'une maison, en entiers sûrs des clients ; une maison sans ligne a une Timè nulle (`house_honor`).
create table if not exists game.honor (
  house_id uuid primary key,
  world_id uuid not null references game.worlds (id),
  honor bigint not null default 0,
  constraint honor_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint honor_range check (honor between -9007199254740991 and 9007199254740991)
);

-- Journal de la Timè : chaque ligne ajoute ou retire de la Timè à une maison, pour un motif et une référence
-- (la charge d'un mandat, par exemple), un jour de jeu.
create table if not exists game.honor_ledger (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  amount bigint not null check (amount <> 0 and amount between -9007199254740991 and 9007199254740991),
  reason text not null check (reason ~ '^[a-z][a-z0-9_]{1,31}$'),
  reference uuid not null,
  game_day integer not null check (game_day >= 0),
  created_at timestamptz not null default now(),
  constraint honor_ledger_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id)
);
-- Une ligne au plus par motif et par référence : rejoué, un crédit ne s'écrit pas deux fois.
create unique index if not exists honor_ledger_once on game.honor_ledger (reason, reference);
create index if not exists honor_ledger_house_idx on game.honor_ledger (house_id, created_at);

-- Une ligne du journal naît maintenant, d'un motif connu. `archon_term` : un gain, pour une charge de la même
-- maison et du même monde dont le mandat a pris fin, écrite avant que la clôture de son jour, ou d'un jour
-- postérieur, soit enregistrée (même verrou que le déclin de la Charis, migration 180) ; le déclencheur différé
-- `honor_ledger_on_close`, plus bas, exige à la validation que cette clôture soit enregistrée. Un autre motif est
-- refusé : chaque mécanique qui touche la Timè remplace cette fonction pour y ajouter le sien.
create or replace function game.guard_honor_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Timè movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.reason = 'archon_term' then
    if new.amount < 0 then
      raise exception 'a completed archon term raises Timè' using errcode = 'restrict_violation';
    end if;
    perform 1 from game.offices o
    where o.id = new.reference and o.house_id = new.house_id and o.world_id = new.world_id and o.ends_at <= now();
    if not found then
      raise exception 'an archon term is credited to its house once ended' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
      raise exception 'an archon term is credited before its close is recorded' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Timè reason' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_honor_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists honor_ledger_guard on game.honor_ledger;
create trigger honor_ledger_guard before insert on game.honor_ledger
  for each row execute function game.guard_honor_movement();
-- `archon_term` : à la validation, la clôture de son jour est enregistrée, donc dans la même transaction (la
-- garde l'a exigée absente à l'insertion), comme la clé étrangère différée du déclin de la Charis. Un déclencheur
-- plutôt qu'une clé étrangère : un motif écrit par une commande ne demande aucune clôture.
create or replace function game.check_honor_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.game_day) then
    raise exception 'an archon term is credited by the close of its day' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_honor_on_close() from public, anon, authenticated, oikos_service;
drop trigger if exists honor_ledger_on_close on game.honor_ledger;
create constraint trigger honor_ledger_on_close after insert on game.honor_ledger
  deferrable initially deferred for each row when (new.reason = 'archon_term')
  execute function game.check_honor_on_close();
drop trigger if exists honor_ledger_immutable on game.honor_ledger;
create trigger honor_ledger_immutable before update or delete on game.honor_ledger
  for each row execute function game.forbid_change();
drop trigger if exists honor_ledger_no_truncate on game.honor_ledger;
create trigger honor_ledger_no_truncate before truncate on game.honor_ledger
  for each statement execute function game.forbid_change();

-- Chaque ligne du journal s'ajoute à la Timè, au nom du propriétaire et seulement sur ce journal, comme
-- `apply_favor_movement` (migration 180) : la Timè est créée à zéro d'abord, puis la ligne s'y ajoute. Une Timè
-- qui sortirait des entiers sûrs est refusée (`honor_range`). Les bornes de la configuration, que la base ne lit
-- pas, sont tenues par qui écrit (`honorChange`), sous le verrou consultatif `honor:<maison>` de sa transaction.
create or replace function game.apply_honor_movement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.honor_ledger'::regclass then
    raise exception '% only runs on game.honor_ledger', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.honor (house_id, world_id) values (new.house_id, new.world_id) on conflict (house_id) do nothing;
  update game.honor set honor = honor + new.amount where house_id = new.house_id;
  return null;
end;
$$;
revoke execute on function game.apply_honor_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists honor_ledger_apply on game.honor_ledger;
create trigger honor_ledger_apply after insert on game.honor_ledger
  for each row execute function game.apply_honor_movement();

-- La Timè ne change que par son journal ; son identité ne change jamais ; elle ne se supprime pas.
create or replace function game.guard_honor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not game.written_by_owner_trigger(tg_relid) then
    raise exception 'Timè changes only through its journal' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' and (new.house_id, new.world_id) is distinct from (old.house_id, old.world_id) then
    raise exception 'Timè identity is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_honor() from public, anon, authenticated, oikos_service;
drop trigger if exists honor_guard on game.honor;
create trigger honor_guard before insert or update on game.honor
  for each row execute function game.guard_honor();
drop trigger if exists honor_no_delete on game.honor;
create trigger honor_no_delete before delete on game.honor
  for each row execute function game.forbid_change();
drop trigger if exists honor_no_truncate on game.honor;
create trigger honor_no_truncate before truncate on game.honor
  for each statement execute function game.forbid_change();

-- Le service lit, et écrit au journal sans choisir ni l'identifiant ni la date d'une ligne ; il ne modifie
-- jamais la Timè elle-même.
alter table game.honor enable row level security;
alter table game.honor_ledger enable row level security;
revoke all on game.honor, game.honor_ledger from public, anon, authenticated, oikos_service;
grant select on game.honor, game.honor_ledger to oikos_service;
grant insert (world_id, house_id, amount, reason, reference, game_day) on game.honor_ledger to oikos_service;
drop policy if exists service_all on game.honor;
create policy service_all on game.honor for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.honor_ledger;
create policy service_all on game.honor_ledger for all to oikos_service using (true) with check (true);

-- Lectures des joueurs connectés : la Timè de toute maison est publique (4.1), comme son nom ; les lignes du
-- journal ne se lisent que pour sa maison. Colonnes accordées une à une ; rien pour un visiteur anonyme.
drop policy if exists honor_read on game.honor;
create policy honor_read on game.honor for select to authenticated using (true);
drop policy if exists honor_ledger_read_own on game.honor_ledger;
create policy honor_ledger_read_own on game.honor_ledger for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (house_id, honor) on game.honor to authenticated;
grant select (id, house_id, amount, reason, reference, game_day, created_at) on game.honor_ledger to authenticated;

-- Vues créées une fois : rejouée ensuite, la migration ne les recrée pas, si bien qu'un ticket suivant pourra
-- leur ajouter une colonne (ADR 0006). `house_honor` a une ligne par maison, à zéro sans journal.
do $$
begin
  if to_regclass('public.house_honor') is null then
    create view public.house_honor with (security_invoker = true) as
      select h.id as house_id, coalesce(t.honor, 0)::bigint as honor
      from game.houses h left join game.honor t on t.house_id = h.id;
  end if;
  if to_regclass('public.my_honor_entries') is null then
    create view public.my_honor_entries with (security_invoker = true) as
      select id, house_id, amount, reason, reference, game_day, created_at from game.honor_ledger;
  end if;
end $$;
revoke all on public.house_honor, public.my_honor_entries from public, anon;
grant select on public.house_honor, public.my_honor_entries to authenticated;
