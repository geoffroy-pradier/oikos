-- Configuration d'équilibrage versionnée (docs/specs/15-back-office-olympe.md, 15.2 ; ticket 4).
-- Une version est un instantané complet et immuable. L'activation est un journal en ajout seul :
-- la version active à un instant donné est celle de la dernière activation échue. Il y a donc toujours
-- au plus une version active, une activation future se programme, et un retour arrière est une nouvelle
-- activation d'une version antérieure.

create table if not exists config.versions (
  id uuid primary key default game.uuid_v7(),
  number integer generated always as identity unique,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists config.activations (
  id uuid primary key default game.uuid_v7(),
  version_id uuid not null references config.versions (id),
  activate_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists activations_activate_at_idx on config.activations (activate_at desc, created_at desc);

-- Intégrité : ni modification ni suppression, quel que soit le rôle.
create or replace function config.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'config.% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists versions_immutable on config.versions;
create trigger versions_immutable before update or delete on config.versions
  for each row execute function config.forbid_change();
drop trigger if exists versions_no_truncate on config.versions;
create trigger versions_no_truncate before truncate on config.versions
  for each statement execute function config.forbid_change();
drop trigger if exists activations_immutable on config.activations;
create trigger activations_immutable before update or delete on config.activations
  for each row execute function config.forbid_change();
drop trigger if exists activations_no_truncate on config.activations;
create trigger activations_no_truncate before truncate on config.activations
  for each statement execute function config.forbid_change();

-- Version active à l'instant donné, ou null si aucune activation n'est encore échue.
-- À égalité d'échéance, la décision la plus récente l'emporte.
create or replace function config.active_version_at(at timestamptz) returns uuid
language sql stable
set search_path = ''
as $$
  select version_id
  from config.activations
  where activate_at <= at
  order by activate_at desc, created_at desc, id desc
  limit 1;
$$;

-- Non exposé aux clients : règles par ligne actives, aucune règle, aucun droit.
alter table config.versions enable row level security;
alter table config.activations enable row level security;
