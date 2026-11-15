-- Programmation et annulation d'une activation : marge à l'inscription, contrôle à la validation
-- (ticket 130, suite de la migration 37).
--
-- Jusqu'ici, la marge d'une minute de l'annulation (migration 29) était mesurée à l'inscription : une
-- transaction validée plus d'une minute après aurait encore annulé une version déjà en vigueur, et une
-- programmation n'avait aucune marge. Désormais :
-- - une programmation est refusée à moins d'une minute de son échéance, comme une annulation, avec le
--   nom de contrainte `activations_scheduled_ahead`, que l'API traduit en erreur métier ;
-- - à la validation, des déclencheurs de contrainte différés comparent l'horloge de la base à l'échéance :
--   une programmation ou une annulation dont l'échéance est passée au moment de valider est refusée, sous
--   le même nom de contrainte que le refus immédiat. Toute la transaction est alors annulée.
-- Une activation immédiate (échéance omise : l'heure de la transaction, celle de sa création) n'est pas une
-- programmation : elle sert à la configuration initiale, et la marge ne la vise pas. Mais son effet est daté
-- du début de sa transaction : validée tard, elle ferait relire avec une autre version le temps écoulé
-- depuis. Elle est donc refusée à la validation plus de cinq secondes après ce début
-- (`activations_not_backdated`). Ces cinq secondes sont une limite technique, pas un réglage du jeu : une
-- activation immédiate tient en une instruction ou deux, un tick dure bien plus.

-- Garde des activations (migration 37), plus la marge à l'inscription.
create or replace function config.guard_activation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := pg_catalog.now();
  if new.activate_at > new.created_at
     and new.activate_at <= pg_catalog.clock_timestamp() + interval '1 minute' then
    raise exception 'an activation is scheduled at least a minute ahead'
      using errcode = 'check_violation', constraint = 'activations_scheduled_ahead';
  end if;
  return new;
end;
$$;

-- À la validation : une programmation est toujours à venir ; une activation immédiate est validée aussitôt.
create or replace function config.check_activation_ahead() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.activate_at > new.created_at and new.activate_at <= pg_catalog.clock_timestamp() then
    raise exception 'the close passed before the scheduling was committed'
      using errcode = 'check_violation', constraint = 'activations_scheduled_ahead';
  elsif new.activate_at = new.created_at and pg_catalog.clock_timestamp() > new.created_at + interval '5 seconds' then
    raise exception 'an immediate activation committed late would take effect in the past'
      using errcode = 'check_violation', constraint = 'activations_not_backdated';
  end if;
  return null;
end;
$$;

drop trigger if exists activations_ahead_at_commit on config.activations;
-- Toute activation est contrôlée : une programmation (`activate_at > created_at`) comme une activation
-- immédiate (`activate_at = created_at`, la contrainte `activations_not_backdated` excluant le reste).
create constraint trigger activations_ahead_at_commit after insert on config.activations
  deferrable initially deferred
  for each row execute function config.check_activation_ahead();

-- À la validation : l'activation annulée n'est toujours pas en vigueur.
create or replace function config.check_cancellation_before_activation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from config.activations a
             where a.id = new.activation_id and a.activate_at <= pg_catalog.clock_timestamp()) then
    raise exception 'the activation came into force before the cancellation was committed'
      using errcode = 'check_violation', constraint = 'activation_cancellations_before_activation';
  end if;
  return null;
end;
$$;

drop trigger if exists activation_cancellations_before_activation_at_commit on config.activation_cancellations;
create constraint trigger activation_cancellations_before_activation_at_commit
  after insert on config.activation_cancellations
  deferrable initially deferred
  for each row execute function config.check_cancellation_before_activation();

-- Le droit d'exécuter une fonction de déclencheur suffit à l'attacher à une table qu'on possède.
revoke execute on function config.check_activation_ahead(), config.check_cancellation_before_activation()
  from public, anon, authenticated, service_role, oikos_service;
