-- Grâces (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; docs/specs/12-modele-donnees.md ; ticket 266).
-- Une maison invoque une grâce (`temple.invokeGrace`) : sa Charis dépensée entre au journal de la Charis
-- (migration 180), qui admet désormais la nature `grace` ; l'invocation attend la prochaine action admise de
-- son effet, qui la consomme une fois : une récolte ou un départ (son surplus au journal des stocks : migration
-- 231). Rejouable (`if not exists`, `create or replace`, contraintes posées si absentes, déclencheurs et règles
-- recréés) ; le code précédent n'écrit ni ne lit cette table ni cette colonne.

create table if not exists game.graces_used (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  -- Grâce, effet, ampleur et dieu de la configuration en vigueur à l'invocation : l'action reçoit ce qui a
  -- été payé, même si une version plus récente change ou retire la grâce.
  grace_id text not null check (grace_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  god_id text not null check (god_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  effect text not null check (effect in ('blessed_harvest', 'inspired_workshop', 'fair_wind')),
  magnitude_bps integer not null check (magnitude_bps between 1 and 10000),
  charis_spent bigint not null check (charis_spent >= 0),
  invoked_at timestamptz not null default now(),
  -- Fin de la recharge : la clôture qui ouvre le jour de jeu de l'invocation plus la recharge, calculée par
  -- l'API (la base ne lit pas la configuration).
  ready_at timestamptz not null,
  -- Consommation : l'instant, et l'action qui l'a consommée (une récolte de ce site, ou ce voyage).
  consumed_at timestamptz,
  site_id uuid references game.sites (id),
  voyage_id uuid,
  -- Vent favorable : secondes retirées au trajet, après une éventuelle tempête.
  saved_seconds integer,
  constraint graces_used_id_world_unique unique (id, world_id),
  constraint graces_used_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint graces_used_voyage_same_world foreign key (voyage_id, world_id) references game.voyages (id, world_id),
  constraint graces_used_recharge check (ready_at > invoked_at),
  constraint graces_used_wind_bound check (effect <> 'fair_wind' or magnitude_bps <= 5000),
  constraint graces_used_consumption check (case
    when consumed_at is null then site_id is null and voyage_id is null and saved_seconds is null
    when effect = 'fair_wind' then voyage_id is not null and site_id is null and saved_seconds > 0
    else site_id is not null and voyage_id is null and saved_seconds is null end)
);
-- Une grâce attend au plus une fois par maison ; un départ, une récolte consomment au plus une grâce.
create unique index if not exists graces_used_one_pending on game.graces_used (house_id, grace_id)
  where consumed_at is null;
create unique index if not exists graces_used_voyage_once on game.graces_used (voyage_id) where voyage_id is not null;
create unique index if not exists graces_used_collect_once on game.graces_used (site_id, consumed_at)
  where site_id is not null;
create index if not exists graces_used_house_idx on game.graces_used (house_id, grace_id, ready_at);

-- Journal de la Charis : une ligne `grace` est rattachée à son invocation, une fois.
alter table game.favor_ledger add column if not exists grace_use_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'favor_ledger_grace_same_world') then
    alter table game.favor_ledger add constraint favor_ledger_grace_same_world
      foreign key (grace_use_id, world_id) references game.graces_used (id, world_id);
  end if;
end $$;
create unique index if not exists favor_ledger_grace_once on game.favor_ledger (grace_use_id)
  where grace_use_id is not null;

-- Une invocation naît maintenant, en attente, hors recharge : aucune invocation de la même grâce par la même
-- maison ne se recharge encore (l'index unique ci-dessus refuse une seconde en attente, même concurrente).
-- Puis elle ne change qu'une fois, consommée maintenant par une action de sa maison : un départ de cet
-- instant pour un vent favorable, une récolte d'un de ses sites sinon. Rien d'autre ne change.
create or replace function game.guard_grace_use() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.invoked_at is distinct from now() or new.consumed_at is not null then
      raise exception 'a grace is invoked now, pending' using errcode = 'restrict_violation';
    end if;
    if exists (select 1 from game.graces_used g
               where g.house_id = new.house_id and g.grace_id = new.grace_id and g.ready_at > now()) then
      raise exception 'this grace is recharging' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.consumed_at is not null or new.consumed_at is distinct from now()
     or (new.id, new.world_id, new.house_id, new.grace_id, new.god_id, new.effect, new.magnitude_bps,
         new.charis_spent, new.invoked_at, new.ready_at)
        is distinct from (old.id, old.world_id, old.house_id, old.grace_id, old.god_id, old.effect,
                          old.magnitude_bps, old.charis_spent, old.invoked_at, old.ready_at) then
    raise exception 'a grace is consumed once, now' using errcode = 'restrict_violation';
  end if;
  -- Sans `case` : dans un `if`, son premier `then` clôturerait la condition.
  if not ((new.effect = 'fair_wind' and exists (
             select 1 from game.voyages v
             where v.id = new.voyage_id and v.house_id = new.house_id and v.departed_at = now()))
          or (new.effect <> 'fair_wind' and exists (
             select 1 from game.sites s where s.id = new.site_id and s.house_id = new.house_id))) then
    raise exception 'a grace is consumed by an action of its house' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_grace_use() from public, anon, authenticated, oikos_service;
drop trigger if exists graces_used_guard on game.graces_used;
create trigger graces_used_guard before insert or update on game.graces_used
  for each row execute function game.guard_grace_use();
drop trigger if exists graces_used_no_delete on game.graces_used;
create trigger graces_used_no_delete before delete on game.graces_used
  for each row execute function game.forbid_change();
drop trigger if exists graces_used_no_truncate on game.graces_used;
create trigger graces_used_no_truncate before truncate on game.graces_used
  for each statement execute function game.forbid_change();

-- À la validation, une invocation a dépensé sa Charis au journal (aucune ligne si elle est gratuite). Au nom du
-- propriétaire, comme le contrôle des offrandes (migration 181). Déclenché aussi à la consommation, que la
-- migration 231 contrôle.
create or replace function game.check_grace_settled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (new.charis_spent > 0) <> exists (
       select 1 from game.favor_ledger f where f.grace_use_id = new.id) then
    raise exception 'a grace spends its Charis' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_grace_settled() from public, anon, authenticated, oikos_service;
drop trigger if exists graces_used_settled on game.graces_used;
create constraint trigger graces_used_settled after insert or update on game.graces_used
  deferrable initially deferred
  for each row execute function game.check_grace_settled();

-- Garde du journal de la Charis (migration 181), plus la nature `grace` : la Charis dépensée par une invocation
-- faite dans la même transaction, par la même maison, envers le même dieu, exactement. Une ligne d'une autre
-- nature n'a pas d'invocation.
create or replace function game.guard_favor_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Charis movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.kind = 'grace' then
    if new.game_day is not null or new.offering_id is not null or not exists (
         select 1 from game.graces_used g
         where g.id = new.grace_use_id and g.invoked_at = now()
           and (g.world_id, g.house_id, g.god_id, g.charis_spent) = (new.world_id, new.house_id, new.god_id, -new.amount)) then
      raise exception 'a grace spends its own Charis, when invoked' using errcode = 'restrict_violation';
    end if;
  elsif new.grace_use_id is not null then
    raise exception 'only a grace movement names a grace' using errcode = 'restrict_violation';
  elsif new.kind = 'offering' then
    if new.game_day is not null or not exists (
         select 1 from game.offerings o
         where o.id = new.offering_id and o.created_at = now()
           and (o.world_id, o.house_id, o.god_id, o.charis) = (new.world_id, new.house_id, new.god_id, new.amount)) then
      raise exception 'an offering adds its own Charis, when it is made' using errcode = 'restrict_violation';
    end if;
  elsif new.offering_id is not null then
    raise exception 'only an offering movement names an offering' using errcode = 'restrict_violation';
  elsif new.kind = 'decay' then
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

-- Le service lit, invoque sans choisir ni l'identifiant ni l'instant, consomme, et rattache une ligne de Charis
-- à une invocation. Aucun accès client : les joueurs lisent leurs grâces par une vue (#266).
alter table game.graces_used enable row level security;
revoke all on game.graces_used from public, anon, authenticated, oikos_service;
grant select on game.graces_used to oikos_service;
grant insert (world_id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, ready_at)
  on game.graces_used to oikos_service;
grant update (consumed_at, site_id, voyage_id, saved_seconds) on game.graces_used to oikos_service;
grant insert (grace_use_id) on game.favor_ledger to oikos_service;
drop policy if exists service_all on game.graces_used;
create policy service_all on game.graces_used for all to oikos_service using (true) with check (true);
