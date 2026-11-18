# ADR 0004 — Historique des migrations appliquées

Date : 2026-11-15 · Statut : acceptée

## Contexte

Jusqu'au ticket 218, `infra/deploy.sh` rejouait toutes les migrations à chaque déploiement, une
transaction par fichier, pendant que l'API de la version précédente servait les joueurs. Entre deux
fichiers, des définitions et des droits anciens revenaient brièvement (par exemple la règle `service_all`
de `game.accounts` en `with check (true)`), et une migration en échec laissait cet état en place.
`pnpm test:db:replay` garantit l'état final de la suite entière, pas les états intermédiaires.

## Décision

- Le déploiement n'applique que les migrations absentes de `supabase_migrations.schema_migrations`, la
  table de la CLI Supabase (colonnes `version`, `name`, `statements`, plus `oikos_md5`), par
  `infra/apply-migrations.sh` : une transaction par migration, qui contient son enregistrement, sous un
  verrou consultatif.
- Une base déployée avant cette table est reconnue à ce qu'aucune migration n'y est enregistrée alors que
  le schéma `game` existe : les migrations inchangées de la version précédente y sont enregistrées sans
  être rejouées.
- Une migration publiée est immuable ; on corrige par une migration nouvelle. `ci` refuse toute
  modification, suppression ou renommage d'un fichier de migration, et le script compare au fichier
  l'empreinte md5 qu'il a enregistrée dans sa propre colonne `oikos_md5` (la CLI, qui découpe
  `statements` en instructions, la laisse vide).
- La rejouabilité (CLAUDE.md, règle 9) reste exigée comme filet : `ci` rejoue la suite entière après
  `db:reset`, puis sur la base remplie par les tests d'intégration.

## Conséquences

- Plus d'état intermédiaire exposé par un rejeu ; un retour arrière vers une version antérieure ne rejoue
  ni n'annule aucune migration.
- Corriger une migration publiée coûte un fichier de plus ; l'historique des migrations devient celui de
  la base.
- Une version poussée deux fois avec le même numéro de migration est refusée au déploiement.
- Le rejeu pose un `lock_timeout` et reprend la suite entière, au plus trois fois, quand une session de Supabase tient un verrou sur une table que la migration modifie.
- Toute autre erreur le fait échouer tout de suite, et l'empreinte du schéma reste comparée à celle d'avant le premier essai.
