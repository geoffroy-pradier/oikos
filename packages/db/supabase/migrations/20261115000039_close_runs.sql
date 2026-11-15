-- Télémétrie des clôtures quotidiennes (docs/specs/03-boucles-progression.md, 15.1 ; ticket 145).
-- Une ligne par tentative de clôture d'un monde, réussie ou non, avec sa durée, comme pour les ticks
-- (migration 7). Une clôture se joue en une transaction pour tout le monde : une maison en erreur la
-- fait échouer entière, et elle est reprise au passage suivant. Ces lignes rendent l'échec compté (la
-- Vigie en affiche le nombre sur 24 heures) et visible (le message nomme la maison en cause).
-- Rejouable ; le code précédent n'écrit pas dans cette table et ne la lit pas.
create table if not exists telemetry.close_runs (
  id uuid primary key default game.uuid_v7(),
  -- Sans clé étrangère : la télémétrie s'écrit hors transaction et doit survivre à tout.
  world_id uuid not null,
  game_day integer not null check (game_day >= 0),
  -- `done` : clôture appliquée. `skipped` : déjà jouée, rien n'a été refait. `failed` : rien n'a été écrit.
  status text not null check (status in ('done', 'skipped', 'failed')),
  duration_ms integer not null check (duration_ms >= 0),
  error text,
  created_at timestamptz not null default now(),
  constraint close_runs_error_iff_failed check ((status = 'failed') = (error is not null))
);
create index if not exists close_runs_created_idx on telemetry.close_runs (created_at desc);
-- Garde d'ajout seul propre au schéma, comme `config.forbid_change` : son message nomme la table
-- dans son schéma (`game.forbid_change` dirait « game.close_runs »).
create or replace function telemetry.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'telemetry.% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;
revoke execute on function telemetry.forbid_change() from public, anon, authenticated, oikos_service;
drop trigger if exists close_runs_immutable on telemetry.close_runs;
create trigger close_runs_immutable before update or delete on telemetry.close_runs
  for each row execute function telemetry.forbid_change();
drop trigger if exists close_runs_no_truncate on telemetry.close_runs;
create trigger close_runs_no_truncate before truncate on telemetry.close_runs
  for each statement execute function telemetry.forbid_change();

-- Non exposée aux clients : règles par ligne actives, aucun droit. Le moteur l'écrit, l'API la lit.
alter table telemetry.close_runs enable row level security;
revoke all on telemetry.close_runs from public, anon, authenticated;
grant select, insert on telemetry.close_runs to oikos_service;
drop policy if exists service_all on telemetry.close_runs;
create policy service_all on telemetry.close_runs for all to oikos_service using (true) with check (true);
