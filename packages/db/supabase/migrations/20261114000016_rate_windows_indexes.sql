-- Limite de débit partagée entre répliques de l'API, et index du back-office (ticket 65).

-- Compteurs de débit : une ligne par clé (compte et commande) et par fenêtre. Tenus en base, deux
-- répliques de l'API comptent ensemble au lieu de doubler le quota. Données éphémères, sans valeur
-- d'audit : table non journalisée (vidée après un arrêt brutal de la base, ce qui rouvre simplement
-- les fenêtres en cours).
create unlogged table if not exists telemetry.rate_windows (
  key text not null check (length(key) between 3 and 160),
  window_start timestamptz not null,
  count integer not null check (count > 0),
  primary key (key, window_start)
);
create index if not exists rate_windows_start_idx on telemetry.rate_windows (window_start);

alter table telemetry.rate_windows enable row level security;
revoke all on telemetry.rate_windows from public, anon, authenticated;
grant select, insert on telemetry.rate_windows to oikos_service;
grant update (count) on telemetry.rate_windows to oikos_service;
drop policy if exists service_all on telemetry.rate_windows;
create policy service_all on telemetry.rate_windows for all to oikos_service using (true) with check (true);

-- Purge des fenêtres closes depuis plus d'une heure. Le service n'a pas le droit de supprimer : il
-- appelle cette fonction, qui ne sait rien faire d'autre.
create or replace function telemetry.prune_rate_windows() returns bigint
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from telemetry.rate_windows where window_start < now() - interval '1 hour' returning 1
  )
  select count(*) from gone
$$;
revoke execute on function telemetry.prune_rate_windows() from public, anon, authenticated;
grant execute on function telemetry.prune_rate_windows() to oikos_service;

-- Vigie : commandes des dernières 24 heures. Journal d'audit : commandes d'administration, de la plus
-- récente à la plus ancienne, par pages sur l'identifiant.
create index if not exists command_log_created_idx on game.command_log (created_at);
create index if not exists command_log_admin_idx on game.command_log (id desc) where command like 'admin.%';
