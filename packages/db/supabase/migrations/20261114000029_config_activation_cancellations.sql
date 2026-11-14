-- Annulation d'une programmation à venir (docs/specs/15-back-office-olympe.md, 15.2 ; ticket 77).
-- Le journal des activations reste en ajout seul : annuler, c'est ajouter une ligne ici. Une activation
-- annulée est ignorée par `config.active_version_at`, donc par tout ce qui lit la configuration en vigueur.
-- Seule une activation à venir s'annule : la version vue par un tick déjà joué ne change jamais.

create table if not exists config.activation_cancellations (
  activation_id uuid primary key references config.activations (id),
  cancelled_by uuid,
  -- Toujours l'horloge de la base, posée par la garde ci-dessous.
  cancelled_at timestamptz not null default now()
);

-- Garde : l'instant d'annulation n'est pas choisi par l'appelant, et il précède l'échéance. Le refus porte
-- un nom de contrainte, que l'API traduit en erreur métier.
create or replace function config.guard_activation_cancellation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.cancelled_at := pg_catalog.clock_timestamp();
  if exists (select 1 from config.activations a where a.id = new.activation_id and a.activate_at <= new.cancelled_at) then
    raise exception 'an activation already in force cannot be cancelled'
      using errcode = 'check_violation', constraint = 'activation_cancellations_before_activation';
  end if;
  return new;
end;
$$;

drop trigger if exists activation_cancellations_guard on config.activation_cancellations;
create trigger activation_cancellations_guard before insert on config.activation_cancellations
  for each row execute function config.guard_activation_cancellation();
drop trigger if exists activation_cancellations_immutable on config.activation_cancellations;
create trigger activation_cancellations_immutable before update or delete on config.activation_cancellations
  for each row execute function config.forbid_change();
drop trigger if exists activation_cancellations_no_truncate on config.activation_cancellations;
create trigger activation_cancellations_no_truncate before truncate on config.activation_cancellations
  for each statement execute function config.forbid_change();

-- Version active à l'instant donné : dernière activation échue et non annulée. À égalité d'échéance, la
-- décision enregistrée en dernier parmi celles qui restent l'emporte.
create or replace function config.active_version_at(at timestamptz) returns uuid
language sql stable
set search_path = ''
as $$
  select a.version_id
  from config.activations a
  where a.activate_at <= at
    and not exists (select 1 from config.activation_cancellations c where c.activation_id = a.id)
  order by a.activate_at desc, a.seq desc
  limit 1;
$$;

-- Non exposé aux clients : règles par ligne actives, aucun droit pour `anon`, `authenticated`, `service_role`.
-- Le service lit et ajoute ; il ne modifie ni ne supprime.
alter table config.activation_cancellations enable row level security;
revoke all on config.activation_cancellations from public, anon, authenticated, service_role;
grant select, insert on config.activation_cancellations to oikos_service;
drop policy if exists service_all on config.activation_cancellations;
create policy service_all on config.activation_cancellations for all to oikos_service using (true) with check (true);
revoke execute on function config.guard_activation_cancellation() from public, anon, authenticated, service_role, oikos_service;
