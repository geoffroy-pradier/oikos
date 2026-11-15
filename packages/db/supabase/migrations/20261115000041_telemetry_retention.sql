-- Rétention de la télémétrie des ticks et des clôtures, activations à l'horloge différente
-- (docs/specs/03-boucles-progression.md, 15.1 ; ticket 213). Rejouable ; le code précédent n'appelle
-- aucune de ces fonctions, et la garde de `close_runs` reste la même pour lui.

-- 1. Purge des passages plus anciens que la rétention de la configuration (`telemetry.retentionDays`).
-- `close_runs` reste en ajout seul pour tous : le service n'a ni DELETE ni TRUNCATE, et la garde ne
-- laisse supprimer une ligne qu'à la fonction de purge ci-dessous, qui pose un réglage local à sa
-- transaction le temps de sa suppression. Le réglage seul ne donne rien : il faut aussi le droit DELETE,
-- que seul le propriétaire a.
create or replace function telemetry.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_catalog.current_setting('oikos.telemetry_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'telemetry.% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;
revoke execute on function telemetry.forbid_change() from public, anon, authenticated, oikos_service;

-- Supprime les passages de tick et de clôture enregistrés avant `before`, et rend leur nombre. Borne
-- technique, pas un réglage du jeu : jamais moins d'un jour d'historique, ce que lit la Vigie (24 heures).
create or replace function telemetry.purge_runs(before timestamptz)
returns table (purged_tick_runs bigint, purged_close_runs bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  ticks bigint;
  closes bigint;
begin
  if before is null or before > pg_catalog.clock_timestamp() - interval '1 day' then
    raise exception 'telemetry younger than one day cannot be purged'
      using errcode = 'check_violation', constraint = 'telemetry_purge_keeps_one_day';
  end if;
  delete from telemetry.tick_runs t where t.created_at < before;
  get diagnostics ticks = row_count;
  perform pg_catalog.set_config('oikos.telemetry_purge', 'on', true);
  delete from telemetry.close_runs c where c.created_at < before;
  get diagnostics closes = row_count;
  perform pg_catalog.set_config('oikos.telemetry_purge', 'off', true);
  return query select ticks, closes;
end;
$$;
revoke execute on function telemetry.purge_runs(timestamptz) from public, anon, authenticated;
grant execute on function telemetry.purge_runs(timestamptz) to oikos_service;

-- 2. Activations programmées avant le refus des changements d'horloge (#123) : une activation à venir
-- dont la version change la durée du tick, l'heure ou le fuseau de clôture de la version en vigueur est
-- annulée ici, au déploiement et à chaque démarrage du moteur. L'annulation porte l'identifiant nul
-- comme auteur : ce n'est pas un compte, c'est cette fonction. Une activation à moins d'une minute de son
-- échéance ne peut plus être annulée (garde de la migration 29) : elle est rendue sans être annulée,
-- pour que le moteur le signale.
create or replace function config.cancel_clock_changing_activations()
returns table (activation_id uuid, version_number bigint, activate_at timestamptz, cancelled boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  now_ timestamptz := pg_catalog.clock_timestamp();
  in_force jsonb;
  pending record;
begin
  select v.payload -> 'clock' into in_force
  from config.versions v
  where v.id = config.active_version_at(now_);
  if in_force is null then
    return;
  end if;
  for pending in
    select a.id, v.number::bigint as number, a.activate_at as at
    from config.activations a
    join config.versions v on v.id = a.version_id
    where a.activate_at > now_
      and not exists (select 1 from config.activation_cancellations c where c.activation_id = a.id)
      and (v.payload -> 'clock' -> 'tickMinutes' is distinct from in_force -> 'tickMinutes'
        or v.payload -> 'clock' -> 'dailyCloseHour' is distinct from in_force -> 'dailyCloseHour'
        or v.payload -> 'clock' -> 'timezone' is distinct from in_force -> 'timezone')
    order by a.activate_at, a.seq
  loop
    activation_id := pending.id;
    version_number := pending.number;
    activate_at := pending.at;
    -- Marge de la garde d'annulation, plus une seconde pour le temps de cette boucle.
    cancelled := pending.at > pg_catalog.clock_timestamp() + interval '61 seconds';
    if cancelled then
      insert into config.activation_cancellations (activation_id, cancelled_by)
      values (pending.id, '00000000-0000-0000-0000-000000000000');
    end if;
    return next;
  end loop;
end;
$$;
revoke execute on function config.cancel_clock_changing_activations() from public, anon, authenticated;
grant execute on function config.cancel_clock_changing_activations() to oikos_service;

select * from config.cancel_clock_changing_activations();
