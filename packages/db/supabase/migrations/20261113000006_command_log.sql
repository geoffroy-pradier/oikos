-- Journal des commandes et événements de domaine (docs/specs/11-architecture.md, 11.4 ; ticket 6).
-- Le journal sert à la fois d'audit (docs/specs/13-moteur-anti-triche.md) et de mémoire d'idempotence :
-- rejouer une commande avec la même clé rend la réponse enregistrée, sans second effet.

create table if not exists game.command_log (
  id uuid primary key default game.uuid_v7(),
  user_id uuid not null,
  command text not null check (command ~ '^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$'),
  -- Absente pour une erreur inattendue : la commande peut alors être retentée avec la même clé.
  idempotency_key text check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  input jsonb not null,
  -- `ok` : effets appliqués. `rejected` : erreur métier, aucun effet. `failed` : erreur inattendue, aucun effet.
  status text not null check (status in ('ok', 'rejected', 'failed')),
  error_code text,
  -- Réponse rendue au client, restituée telle quelle lors d'un rejeu.
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  constraint command_log_idempotency unique (user_id, idempotency_key),
  constraint command_log_error_code check ((status = 'ok') = (error_code is null)),
  -- Seule une erreur inattendue est sans clé, et elle l'est toujours : elle ne consomme jamais la clé.
  constraint command_log_key_unless_failed check ((status = 'failed') = (idempotency_key is null))
);
create index if not exists command_log_user_created_idx on game.command_log (user_id, created_at desc);

-- Événements de domaine produits par les commandes réussies (temps réel, télémétrie, chronique).
create table if not exists game.domain_events (
  id uuid primary key default game.uuid_v7(),
  -- Ordre d'émission, y compris entre événements d'une même commande.
  seq bigint generated always as identity unique,
  command_id uuid references game.command_log (id),
  type text not null check (type ~ '^[A-Z][A-Za-z]+$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists domain_events_type_created_idx on game.domain_events (type, created_at desc);
create index if not exists domain_events_command_idx on game.domain_events (command_id);

-- Journal d'audit inaltérable : ajout seul. (La purge à 90 jours se fera par partitions, pas par `delete`.)
drop trigger if exists command_log_immutable on game.command_log;
create trigger command_log_immutable before update or delete on game.command_log
  for each row execute function game.forbid_change();
drop trigger if exists command_log_no_truncate on game.command_log;
create trigger command_log_no_truncate before truncate on game.command_log
  for each statement execute function game.forbid_change();
drop trigger if exists domain_events_immutable on game.domain_events;
create trigger domain_events_immutable before update or delete on game.domain_events
  for each row execute function game.forbid_change();
drop trigger if exists domain_events_no_truncate on game.domain_events;
create trigger domain_events_no_truncate before truncate on game.domain_events
  for each statement execute function game.forbid_change();

-- Non exposés aux clients : règles par ligne actives, aucune règle, aucun droit.
alter table game.command_log enable row level security;
alter table game.domain_events enable row level security;
