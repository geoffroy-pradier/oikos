-- Hybris des maisons (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; docs/specs/12-modele-donnees.md ; ticket 734).
-- La jauge d'Hybris d'une maison de joueur (`hubris`) n'est que le cumul d'un journal en ajout seul (`hubris_ledger`),
-- comme la Timè (migration 7040) : entière, entre zéro et le plus grand entier sûr des clients, ni monnaie ni bien.
-- Seule la clôture l'écrit, une ligne au plus par maison, cause et jour de jeu ; aucun client ne lit ni la jauge ni
-- son journal (la migration 101 rend le seul palier d'une maison à son joueur). Une maison PNJ n'a pas de jauge.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés) ; le code précédent n'écrit ni ne lit
-- ces tables.

create table if not exists game.hubris (
  house_id uuid primary key,
  world_id uuid not null references game.worlds (id),
  gauge bigint not null default 0,
  constraint hubris_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint hubris_gauge_range check (gauge between 0 and 9007199254740991)
);

-- Journal de l'Hybris : chaque ligne ajoute (gain) ou retire (baisse) de la jauge d'une maison, pour une cause, à la
-- clôture d'un jour de jeu. Les causes et leur signe sont tenus par la garde, qu'un ticket suivant remplace pour y
-- ajouter les siennes (les ententes sur les prix) : une contrainte de table recréée sans condition ne s'étendrait pas.
create table if not exists game.hubris_ledger (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  amount bigint not null check (amount <> 0 and amount between -9007199254740991 and 9007199254740991),
  cause text not null check (cause ~ '^[a-z][a-z0-9_]{1,31}$'),
  game_day integer not null check (game_day >= 0),
  created_at timestamptz not null default now(),
  constraint hubris_ledger_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id)
);
-- Une ligne au plus par maison, cause et jour : une clôture rejouée n'écrit rien deux fois.
create unique index if not exists hubris_ledger_once on game.hubris_ledger (house_id, cause, game_day);
create index if not exists hubris_ledger_world_day_idx on game.hubris_ledger (world_id, game_day);

-- Une ligne naît maintenant, d'une cause connue et de son signe, pour une maison de joueur de son monde, avant que la
-- clôture de son jour, ou d'un jour postérieur, soit enregistrée (même verrou que la clôture, comme la Timè d'un
-- mandat) ; le déclencheur différé `hubris_ledger_on_close` exige à la validation que cette clôture le soit.
-- La base ne lit pas la configuration : le montant est celui que calcule le moteur (`hubrisDelta`).
create or replace function game.guard_hubris_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Hybris movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.cause in ('market_share', 'wealth', 'liturgy_levied') then
    if new.amount < 0 then
      raise exception 'a Hybris gain raises the gauge' using errcode = 'restrict_violation';
    end if;
  elsif new.cause in ('offering', 'liturgy_performed', 'decay') then
    if new.amount > 0 then
      raise exception 'a Hybris relief lowers the gauge' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Hybris cause' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from game.houses h
                 where h.id = new.house_id and h.world_id = new.world_id and h.kind = 'player') then
    raise exception 'only a player house has a Hybris gauge'
      using errcode = 'check_violation', constraint = 'hubris_player_house';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
    raise exception 'a Hybris movement is written before its close is recorded' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_hubris_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists hubris_ledger_guard on game.hubris_ledger;
create trigger hubris_ledger_guard before insert on game.hubris_ledger
  for each row execute function game.guard_hubris_movement();

-- À la validation, la clôture du jour de la ligne est enregistrée, donc dans la même transaction.
create or replace function game.check_hubris_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.game_day) then
    raise exception 'a Hybris movement is written by the close of its day' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_hubris_on_close() from public, anon, authenticated, oikos_service;
drop trigger if exists hubris_ledger_on_close on game.hubris_ledger;
create constraint trigger hubris_ledger_on_close after insert on game.hubris_ledger
  deferrable initially deferred for each row execute function game.check_hubris_on_close();
drop trigger if exists hubris_ledger_immutable on game.hubris_ledger;
create trigger hubris_ledger_immutable before update or delete on game.hubris_ledger
  for each row execute function game.forbid_change();
drop trigger if exists hubris_ledger_no_truncate on game.hubris_ledger;
create trigger hubris_ledger_no_truncate before truncate on game.hubris_ledger
  for each statement execute function game.forbid_change();

-- Chaque ligne s'ajoute à la jauge, au nom du propriétaire et seulement sur ce journal, comme `apply_honor_movement` :
-- la jauge est créée à zéro d'abord, puis la ligne s'y ajoute. Une jauge qui passerait sous zéro, ou hors des entiers
-- sûrs, est refusée (`hubris_gauge_range`) : le moteur rogne chaque variation (`hubrisDelta`).
create or replace function game.apply_hubris_movement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.hubris_ledger'::regclass then
    raise exception '% only runs on game.hubris_ledger', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.hubris (house_id, world_id) values (new.house_id, new.world_id) on conflict (house_id) do nothing;
  update game.hubris set gauge = gauge + new.amount where house_id = new.house_id;
  return null;
end;
$$;
revoke execute on function game.apply_hubris_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists hubris_ledger_apply on game.hubris_ledger;
create trigger hubris_ledger_apply after insert on game.hubris_ledger
  for each row execute function game.apply_hubris_movement();

-- La jauge ne change que par son journal ; son identité ne change jamais ; elle ne se supprime pas.
create or replace function game.guard_hubris() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not game.written_by_owner_trigger(tg_relid) then
    raise exception 'Hybris changes only through its journal' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' and (new.house_id, new.world_id) is distinct from (old.house_id, old.world_id) then
    raise exception 'Hybris identity is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_hubris() from public, anon, authenticated, oikos_service;
drop trigger if exists hubris_guard on game.hubris;
create trigger hubris_guard before insert or update on game.hubris
  for each row execute function game.guard_hubris();
drop trigger if exists hubris_no_delete on game.hubris;
create trigger hubris_no_delete before delete on game.hubris
  for each row execute function game.forbid_change();
drop trigger if exists hubris_no_truncate on game.hubris;
create trigger hubris_no_truncate before truncate on game.hubris
  for each statement execute function game.forbid_change();

-- Le service lit, et écrit au journal sans choisir ni l'identifiant ni la date d'une ligne ; il ne modifie jamais la
-- jauge elle-même. Aucun droit ni aucune règle pour un joueur connecté ou un visiteur : ni la jauge ni le journal ne se
-- lisent hors du serveur.
alter table game.hubris enable row level security;
alter table game.hubris_ledger enable row level security;
revoke all on game.hubris, game.hubris_ledger from public, anon, authenticated, oikos_service;
grant select on game.hubris, game.hubris_ledger to oikos_service;
grant insert (world_id, house_id, amount, cause, game_day) on game.hubris_ledger to oikos_service;
drop policy if exists service_all on game.hubris;
create policy service_all on game.hubris for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.hubris_ledger;
create policy service_all on game.hubris_ledger for all to oikos_service using (true) with check (true);
