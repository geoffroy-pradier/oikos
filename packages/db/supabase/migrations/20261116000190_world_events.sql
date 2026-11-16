-- Événements du monde planifiés (docs/specs/07-dieux-faveur-evenements.md, 7.3 et 7.4 ; 13 : aléa déterministe ;
-- ticket 267) : graine du monde, événements planifiés par la clôture et effets appliqués. Rejouable (`if not
-- exists`, `create or replace` aux colonnes inchangées, contraintes et déclencheurs recréés, vue créée une fois,
-- ADR 0006) ; le code précédent ne lit ni n'écrit ces tables ni cette colonne, et ne lit pas `seed`.

-- Graine du monde : tirée par la base à la création (générateur sûr), sauf graine donnée ; jamais modifiée. Un
-- monde antérieur reçoit la sienne ici, une fois. Les joueurs ne la lisent pas : elle ferait prévoir l'avenir.
alter table game.worlds add column if not exists seed text not null
  default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
alter table game.worlds drop constraint if exists worlds_seed_length;
alter table game.worlds add constraint worlds_seed_length check (length(seed) between 16 and 128);
revoke select on game.worlds from authenticated;
grant select (id, slug, name, created_at) on game.worlds to authenticated;

create or replace function game.guard_world_seed() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seed is distinct from old.seed then
    raise exception 'the seed of a world never changes' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_world_seed() from public, anon, authenticated, oikos_service;
drop trigger if exists worlds_seed_immutable on game.worlds;
create trigger worlds_seed_immutable before update on game.worlds
  for each row execute function game.guard_world_seed();

-- Un événement : son modèle (catalogue fermé), sa portée (une cité ; une route, entre `city_id` et
-- `other_city_id` ; une cité et un bien), ses jours de jeu (`end_day` exclu) et leurs instants, son ampleur en
-- points de base et la graine de son jour (dérivée de celle du monde, à sens unique). Au plus un événement d'un
-- modèle commence un jour donné ; il est planifié par la clôture de `planned_day`, avant ce jour.
create table if not exists game.world_events (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  model text not null,
  city_id uuid not null,
  other_city_id uuid,
  good_id text,
  planned_day integer not null check (planned_day >= 0),
  start_day integer not null,
  end_day integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  magnitude_bps integer not null check (magnitude_bps between 0 and 10000),
  seed text not null check (seed ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint world_events_model_known check (model in ('drought', 'good_year', 'storm', 'caravan')),
  constraint world_events_once unique (world_id, model, start_day),
  constraint world_events_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint world_events_other_city_same_world foreign key (other_city_id, world_id)
    references game.cities (id, world_id),
  constraint world_events_days check (planned_day < start_day and start_day < end_day),
  constraint world_events_instants check (starts_at < ends_at),
  constraint world_events_scope check (case model
    when 'storm' then other_city_id is not null and other_city_id <> city_id and good_id is null
    when 'caravan' then other_city_id is null and good_id is not null
    else other_city_id is null and good_id is null end),
  constraint world_events_played_close foreign key (world_id, planned_day)
    references game.daily_closes (world_id, game_day) deferrable initially deferred
);
create index if not exists world_events_city_idx on game.world_events (city_id, model, ends_at);
create index if not exists world_events_world_start_idx on game.world_events (world_id, starts_at);

-- Un événement naît maintenant, dans la transaction de la clôture de son jour de planification (même montage
-- que `guard_labor_market`), et commence plus tard : un effet n'est jamais rétroactif. Il ne change plus.
create or replace function game.guard_world_event() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a world event is planned now' using errcode = 'restrict_violation';
  end if;
  if new.starts_at <= now() then
    raise exception 'a world event is planned before it starts' using errcode = 'restrict_violation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.planned_day) then
    raise exception 'a world event is planned before its close is recorded' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_world_event() from public, anon, authenticated, oikos_service;
drop trigger if exists world_events_guard on game.world_events;
create trigger world_events_guard before insert on game.world_events
  for each row execute function game.guard_world_event();
drop trigger if exists world_events_immutable on game.world_events;
create trigger world_events_immutable before update or delete on game.world_events
  for each row execute function game.forbid_change();
drop trigger if exists world_events_no_truncate on game.world_events;
create trigger world_events_no_truncate before truncate on game.world_events
  for each statement execute function game.forbid_change();

-- Effet appliqué d'un événement, pour l'audit et la chronique : l'écart de rendement d'un extrant à une récolte
-- (unités, signé) ou le retard d'un départ (secondes). La quantité récoltée elle-même passe par le journal des
-- stocks ; cette table n'en est que l'explication. La demande des PNJ relevée par une caravane n'a pas de ligne :
-- ses achats sont déjà des échanges.
create table if not exists game.event_effects (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  event_id uuid not null references game.world_events (id),
  kind text not null,
  site_id uuid references game.sites (id),
  voyage_id uuid references game.voyages (id),
  good_id text,
  quantity bigint,
  delay_seconds integer,
  created_at timestamptz not null default now(),
  constraint event_effects_shape check (case kind
    when 'site_yield' then site_id is not null and good_id is not null and quantity <> 0
      and voyage_id is null and delay_seconds is null
    when 'voyage_delay' then voyage_id is not null and delay_seconds > 0
      and site_id is null and good_id is null and quantity is null
    else false end)
);
create index if not exists event_effects_event_idx on game.event_effects (event_id);

-- Un effet est écrit maintenant, dans le monde de son événement, par le modèle qui le produit et sur sa portée :
-- une récolte d'un site de la cité, du signe du modèle ; un départ sur la route, pendant la tempête.
create or replace function game.guard_event_effect() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ev game.world_events%rowtype;
  follows boolean;
begin
  select * into ev from game.world_events e where e.id = new.event_id;
  -- Calculé à part : dans un `if`, le premier `then` d'un `case` clôturerait la condition.
  follows := new.created_at = now() and ev.world_id = new.world_id and case new.kind
    when 'site_yield' then ev.model in ('drought', 'good_year')
      and (new.quantity < 0) = (ev.model = 'drought')
      and exists (select 1 from game.sites s where s.id = new.site_id and s.city_id = ev.city_id)
    when 'voyage_delay' then ev.model = 'storm'
      and exists (select 1 from game.voyages v where v.id = new.voyage_id
        and array[v.from_city_id, v.to_city_id] <@ array[ev.city_id, ev.other_city_id]
        and v.departed_at >= ev.starts_at and v.departed_at < ev.ends_at)
    else false end;
  if follows is not true then
    raise exception 'an event effect follows its event' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_event_effect() from public, anon, authenticated, oikos_service;
drop trigger if exists event_effects_guard on game.event_effects;
create trigger event_effects_guard before insert on game.event_effects
  for each row execute function game.guard_event_effect();
drop trigger if exists event_effects_immutable on game.event_effects;
create trigger event_effects_immutable before update or delete on game.event_effects
  for each row execute function game.forbid_change();
drop trigger if exists event_effects_no_truncate on game.event_effects;
create trigger event_effects_no_truncate before truncate on game.event_effects
  for each statement execute function game.forbid_change();

alter table game.world_events enable row level security;
alter table game.event_effects enable row level security;
revoke all on game.world_events, game.event_effects from public, anon, authenticated, oikos_service;
grant select on game.world_events, game.event_effects to oikos_service;
grant insert (world_id, model, city_id, other_city_id, good_id, planned_day, start_day, end_day, starts_at, ends_at,
  magnitude_bps, seed) on game.world_events to oikos_service;
grant insert (world_id, event_id, kind, site_id, voyage_id, good_id, quantity, delay_seconds)
  on game.event_effects to oikos_service;
drop policy if exists service_all on game.world_events;
create policy service_all on game.world_events for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.event_effects;
create policy service_all on game.event_effects for all to oikos_service using (true) with check (true);

-- Les joueurs lisent les événements commencés, sans graine ni jour de planification ; ni ceux à venir (la
-- Pythie, #270, en vendra l'annonce), ni les effets.
grant select (id, world_id, model, city_id, other_city_id, good_id, start_day, end_day, starts_at, ends_at,
  magnitude_bps) on game.world_events to authenticated;
drop policy if exists world_events_started on game.world_events;
create policy world_events_started on game.world_events for select to authenticated using (starts_at <= now());
do $$
begin
  if to_regclass('public.world_events') is null then
    create view public.world_events with (security_invoker = true) as
      select id, world_id, model, city_id, other_city_id, good_id, start_day, end_day, starts_at, ends_at,
             magnitude_bps
      from game.world_events;
  end if;
end $$;
revoke all on public.world_events from public, anon;
grant select on public.world_events to authenticated;
