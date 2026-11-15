-- Journal des appels de la passerelle IA (docs/specs/08-ia.md 8.4, 8.5 ; ADR 0005 ; ticket 268).
-- Une ligne par appel tenté : usage, modèle, jetons, coût estimé, issue, durée. Jamais de consigne, de
-- donnée ni de réponse : aucun texte de joueur n'y entre. La passerelle y lit la dépense du mois de chaque
-- usage pour couper un usage à son plafond ; la Vigie y lit coûts et rejets.
-- Rejouable ; le code précédent n'écrit pas dans cette table et ne la lit pas.
create table if not exists telemetry.ai_calls (
  id uuid primary key default game.uuid_v7(),
  usage text not null check (usage in ('oracle', 'chronicle', 'steward')),
  model text not null check (length(model) between 1 and 100),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  -- Coût estimé, en millionièmes d'euro (configuration `ai`), jamais la facture du fournisseur.
  cost_micro_euros bigint not null check (cost_micro_euros >= 0),
  outcome text not null check (outcome in ('ok', 'capped', 'timeout', 'invalid', 'error')),
  duration_ms integer not null check (duration_ms >= 0),
  -- Instant de l'appel selon le moteur ; le mois du plafond est le mois civil UTC de cet instant.
  called_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_calls_usage_called_idx on telemetry.ai_calls (usage, called_at desc);

-- Ajout seul, comme `close_runs` : seule la purge du propriétaire supprime (migration 41).
drop trigger if exists ai_calls_immutable on telemetry.ai_calls;
create trigger ai_calls_immutable before update or delete on telemetry.ai_calls
  for each row execute function telemetry.forbid_change();
drop trigger if exists ai_calls_no_truncate on telemetry.ai_calls;
create trigger ai_calls_no_truncate before truncate on telemetry.ai_calls
  for each statement execute function telemetry.forbid_change();

-- Non exposée aux clients : règles par ligne actives, aucun droit. Le moteur l'écrit, l'API la lit.
alter table telemetry.ai_calls enable row level security;
revoke all on telemetry.ai_calls from public, anon, authenticated;
grant select, insert on telemetry.ai_calls to oikos_service;
drop policy if exists service_all on telemetry.ai_calls;
create policy service_all on telemetry.ai_calls for all to oikos_service using (true) with check (true);

-- Purge à la rétention de la télémétrie (`telemetry.retentionDays`), par le propriétaire, comme les
-- passages de tick et de clôture. Jamais moins de 32 jours : la dépense du mois en cours en dépend.
create or replace function telemetry.purge_ai_calls(before timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged bigint;
begin
  if before is null or before > pg_catalog.clock_timestamp() - interval '32 days' then
    raise exception 'AI calls of the last 32 days cannot be purged'
      using errcode = 'check_violation', constraint = 'ai_calls_purge_keeps_one_month';
  end if;
  perform pg_catalog.set_config('oikos.telemetry_purge', 'on', true);
  delete from telemetry.ai_calls c where c.called_at < before;
  get diagnostics purged = row_count;
  perform pg_catalog.set_config('oikos.telemetry_purge', 'off', true);
  return purged;
end;
$$;
revoke execute on function telemetry.purge_ai_calls(timestamptz) from public, anon, authenticated;
grant execute on function telemetry.purge_ai_calls(timestamptz) to oikos_service;
