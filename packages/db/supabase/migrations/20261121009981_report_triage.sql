-- Pré-tri des signalements par l'IA (docs/specs/15-back-office-olympe.md, 15.1, 15.4 ; 08-ia.md, 8.1 ; ticket 763) :
-- la catégorie et le résumé qu'un message signalé a reçus, un essai par message. Le moteur est seul à l'écrire, sous le rôle
-- de service, après la validation de la sortie du modèle par le schéma (règle 6) : le modèle n'écrit jamais en base.
-- Ce n'est qu'une indication pour la file de la modération : aucune commande de sanction ne la lit.
-- Un message sans catégorie (IA coupée, sortie rejetée, délai, plafond) a une ligne sans catégorie ni résumé, qui garde
-- l'issue de l'essai : le message n'est pas payé deux fois au fournisseur, et la file garde son ordre de la phase 2.
-- La ligne suit son message : la purge de la rétention (migration 92) emporte aussi le résumé, qui reprend son texte.
-- Lecture : le service seul (l'API, qui vérifie le rôle de modération de l'appelant, jamais Supabase : un modérateur peut
-- être un joueur bénévole), comme `game.reports` et `admin.sanctions`. Les règles par ligne sont actives ; aucun droit
-- aux clients. Rejouable (`if not exists`, politique et droits redonnés) ; le code précédent ne lit ni n'écrit cette table.
create table if not exists game.report_triage (
  message_id uuid primary key references game.messages (id) on delete cascade,
  category text,
  summary text,
  -- Issue de la passerelle IA (`AiOutcome`) : `ok`, ou la raison du repli.
  outcome text not null,
  triaged_at timestamptz not null default now(),
  constraint report_triage_category_known check (category in ('likely_violation', 'doubtful', 'likely_unfounded')),
  constraint report_triage_outcome_known check (outcome in ('ok', 'capped', 'timeout', 'invalid', 'error')),
  constraint report_triage_summary_length check (char_length(summary) between 1 and 500 and summary ~ '[^[:space:]]'),
  -- Une catégorie et un résumé vont ensemble, et seulement avec une sortie acceptée.
  constraint report_triage_whole check ((category is not null) = (summary is not null) and (category is not null) = (outcome = 'ok'))
);

alter table game.report_triage enable row level security;
revoke all on game.report_triage from public, anon, authenticated, oikos_service;
grant select on game.report_triage to oikos_service;
grant insert (message_id, category, summary, outcome) on game.report_triage to oikos_service;
drop policy if exists service_all on game.report_triage;
create policy service_all on game.report_triage for all to oikos_service using (true) with check (true);
