-- Une activation de configuration ne s'antidate pas, quel que soit l'appelant (ticket 130).
-- Jusqu'ici, `activations_not_backdated` (migration 3) comparait l'échéance à une date de création que
-- l'appelant pouvait fournir : une activation antidatée ferait relire le passé (ticks et clôtures déjà
-- joués) avec une autre version. Même durcissement que pour les échanges (migration 25) et les clôtures
-- (migration 27) : la date de création est posée par la base, jamais par l'appelant.
--
-- - Garde : à l'insertion, `created_at` est l'heure de la transaction, quoi que fournisse l'appelant,
--   propriétaire compris. C'est aussi le défaut de `activate_at` : une activation immédiate (échéance
--   omise) prend effet à cette heure même. La contrainte existante refuse alors, en se nommant, toute
--   échéance antérieure à l'heure de la base.
-- - Droits par colonnes : le service n'écrit ni `created_at` ni le rang `seq`. Le code en place n'écrit
--   ni l'un ni l'autre (`scheduleActivation`, `ensureInitialConfig`) : la migration lui est compatible.
--
-- Limite, traitée par la migration 38 : l'heure retenue est celle du début de la transaction. Une
-- transaction longue pourrait encore poser une échéance déjà passée à l'horloge réelle, ou dater du passé
-- une activation immédiate. La migration 38 contrôle l'échéance à la validation, et refuse une activation
-- immédiate validée plus de cinq secondes après le début de sa transaction.

create or replace function config.guard_activation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists activations_guard on config.activations;
create trigger activations_guard before insert on config.activations
  for each row execute function config.guard_activation();
-- Le droit d'exécuter une fonction de déclencheur suffit à l'attacher à une table qu'on possède.
revoke execute on function config.guard_activation() from public, anon, authenticated, service_role, oikos_service;

revoke insert on config.activations from oikos_service;
grant insert (id, version_id, activate_at, created_by) on config.activations to oikos_service;
