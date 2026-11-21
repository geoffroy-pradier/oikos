-- Journal des appels de la passerelle IA : l'usage `moderation_triage` (docs/specs/08-ia.md, 8.1 ; 15-back-office-olympe.md,
-- 15.1 ; ticket 763) entre dans la liste des usages connus. Le pré-tri des signalements est écrit par le moteur, hors de toute
-- transaction, comme les autres usages ; jamais de texte de joueur dans le journal.
-- Rejouable (la contrainte est recréée) ; le code précédent n'écrit aucun usage inconnu de l'ancienne liste.
alter table telemetry.ai_calls drop constraint if exists ai_calls_usage_check;
alter table telemetry.ai_calls add constraint ai_calls_usage_check
  check (usage in ('oracle', 'chronicle', 'steward', 'moderation_triage'));
