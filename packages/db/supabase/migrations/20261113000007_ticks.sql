-- Ticks du moteur et télémétrie de leurs exécutions (docs/specs/13-moteur-anti-triche.md ; ticket 7).

-- Un tick joué : une ligne par monde et par indice, écrite dans la transaction qui applique ses effets.
-- La clé primaire garantit qu'un tick n'est appliqué qu'une fois ; la graine et la version de configuration
-- enregistrées permettent de le rejouer et de l'auditer.
create table if not exists game.ticks (
  world_id uuid not null references game.worlds (id),
  -- Indice du tick : rang de l'intervalle depuis l'époque Unix, pour la durée de tick en vigueur.
  index bigint not null check (index >= 0),
  -- Début de l'intervalle : l'instant de jeu du tick, quel que soit le moment réel de son exécution.
  scheduled_at timestamptz not null,
  seed text not null check (length(seed) >= 16),
  -- Un tick lit une version de configuration et une seule.
  config_version_id uuid not null references config.versions (id),
  daily_close boolean not null,
  season_switch boolean not null,
  -- Résumé déterministe des effets du tick, comparé lors d'un rejeu.
  summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
  finished_at timestamptz not null default now(),
  primary key (world_id, index),
  -- Une bascule de saison a toujours lieu à une clôture quotidienne.
  constraint ticks_season_switch_at_close check (daily_close or not season_switch)
);

drop trigger if exists ticks_immutable on game.ticks;
create trigger ticks_immutable before update or delete on game.ticks
  for each row execute function game.forbid_change();
drop trigger if exists ticks_no_truncate on game.ticks;
create trigger ticks_no_truncate before truncate on game.ticks
  for each statement execute function game.forbid_change();

-- Télémétrie : une ligne par tentative d'exécution, réussie ou non, avec sa durée.
create table if not exists telemetry.tick_runs (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null,
  tick_index bigint not null,
  -- `done` : tick appliqué. `skipped` : déjà joué, rien n'a été refait. `failed` : erreur, rien n'a été écrit.
  status text not null check (status in ('done', 'skipped', 'failed')),
  duration_ms integer not null check (duration_ms >= 0),
  error text,
  created_at timestamptz not null default now(),
  constraint tick_runs_error_iff_failed check ((status = 'failed') = (error is not null))
);
create index if not exists tick_runs_world_tick_idx on telemetry.tick_runs (world_id, tick_index);
create index if not exists tick_runs_created_idx on telemetry.tick_runs (created_at desc);

-- Non exposés aux clients : règles par ligne actives, aucune règle, aucun droit.
alter table game.ticks enable row level security;
alter table telemetry.tick_runs enable row level security;
