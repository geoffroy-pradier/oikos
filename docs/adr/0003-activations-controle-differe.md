# ADR 0003 — Activations de configuration : contournement du contrôle différé assumé

Date : 2026-11-15 · Statut : acceptée

## Contexte

Une activation de configuration ne doit pas changer la version vue par un tick, une clôture ou une
commande déjà joués. La base le contrôle à la validation (migration 38), par des déclencheurs de
contrainte différés : une programmation ou une annulation validée après son échéance est refusée, une
activation immédiate validée plus de cinq secondes après le début de sa transaction aussi.

Or PostgreSQL ne rejoue pas à la validation un contrôle différé déjà joué. Un appelant qui force ses
contrôles (`SET CONSTRAINTS ALL IMMEDIATE`, qui ne demande aucun droit) puis attend avant de valider les
contourne ; `PREPARE TRANSACTION` suivi d'un `COMMIT PREPARED` tardif aussi. Le cas suppose un code
fautif ou compromis qui écrit sous le rôle de service (ticket 208).

## Décision

La limite est assumée ; aucune garantie côté lecture n'est ajoutée.

- **Verrou écarté.** Le tick et la clôture pourraient prendre `config.activations` et ses annulations en
  mode `SHARE` jusqu'à leur validation. Toute programmation attendrait alors la fin de chaque tick et de
  chaque clôture (jusqu'à cinq minutes), et une programmation en attente ferait attendre derrière elle,
  dans la file des verrous, les ticks et clôtures de tous les mondes. La configuration devrait être lue
  dans la transaction du tick, ce que le moteur évite pour ne pas épuiser le pool de connexions. Les
  commandes ne seraient pas couvertes, et l'exception des cinq secondes de l'activation immédiate resterait.
- **Effet borné à l'audit.** Ticks, clôtures et commandes enregistrent la version lue
  (`config_version_id`), qui fait foi pour les rejouer : une activation validée en retard ne change aucun
  résultat déjà joué, seulement ce que le journal des activations dit en vigueur. Le rapprochement entre
  version enregistrée et `config.active_version_at` de l'instant révèle l'écart (spécification 13).
- **Menace déjà présente.** Le service fautif ou compromis que suppose le contournement peut déjà écrire
  des mouvements que la base ne refuse pas (débits hors échange, spécification 12).

## Conséquences

- Aucun code du jeu n'émet `SET CONSTRAINTS` ; le lint le refuse dans les chaînes littérales du code
  TypeScript hors des tests. Le SQL des migrations et le corps des fonctions (`security definer` compris)
  restent gardés par la relecture.
- Le serveur garde `max_prepared_transactions = 0` (valeur par défaut) : sans transactions préparées, la
  seconde voie est fermée. Le relever impose de revoir cette décision.
- Le rapprochement des commandes donne des faux positifs près d'une échéance (version chargée à l'horloge
  de l'API avant la transaction) et ne porte que sur 90 jours (ADR 0002).
- Le test pgTAP `035_config_activation_set_constraints` fixe le comportement retenu : contrôles forcés puis
  validation tardive acceptée, contrôle non forcé refusé à la validation.
