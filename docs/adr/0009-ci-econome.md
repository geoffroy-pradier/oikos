# ADR 0009 — Contrôle `ci` économe : suite complète sur la demande de fusion seulement

Date : 2026-11-18 · Statut : acceptée

## Contexte

La dépense de GitHub Actions atteignait près de 30 € par jour.
Chaque partie fusionnée coûtait environ 45 minutes facturées : 26 sur la demande de fusion, 17 de nouveau sur `main` après la fusion, et 3 de construction et de publication des images par le flux `deploy`, alors qu'aucun serveur n'existe.
La suite rejouée sur `main` ne testait rien de plus que la demande de fusion, à condition que celle-ci contienne déjà `main`.

## Décision

- **Sur `main`, après une fusion, seuls `changes` et `static` tournent.**
  `changes` garde la règle des migrations publiées immuables (ADR 0004), et `static` garde le cache de Turborepo chaud pour les demandes suivantes.
- **Une demande de fusion n'est fusionnée qu'à jour de `main`.**
  Sur `pull_request`, GitHub teste le commit de fusion avec `main` tel qu'il était au démarrage de l'exécution.
  Si `main` avance ensuite, le résultat de la fusion n'est testé par personne : la demande doit alors être remise à jour, et son contrôle `ci` doit tourner de nouveau.
  `scripts/fusionner.sh` le vérifie, avec la tête attendue et le contrôle `ci` vert, avant de fusionner ; CLAUDE.md (boucle de travail, étape 8) l'impose.
  `scripts/test-fusionner.sh` le teste avec un faux `gh`, dans le job `static`.
- **Interfaces seules : ni base ni intégration.**
  Une demande qui ne touche que `apps/web`, `apps/admin` et des documents saute `database` et `integration`, qui ne lisent aucun de ces fichiers ; le bout en bout et la construction tournent.
- **Le flux `deploy` ne fait rien tant que la variable de dépôt `DEPLOY_ENABLED` ne vaut pas `true`.**

## Conséquences

- Une partie coûte environ 26 minutes au lieu de 45, et environ 16 si elle ne touche que les interfaces.
- Deux demandes de fusion ouvertes en parallèle se fusionnent l'une après l'autre : la seconde est remise à jour et repasse le contrôle `ci`.
  Les piles de demandes de fusion se traitent donc une à la fois.
- Une fusion faite à la main, sans le script et sans remise à jour, peut casser `main` sans signal.
- Avant d'activer `DEPLOY_ENABLED`, le flux `deploy` devra attendre un contrôle vert sur le commit déployé : il n'attend pas `ci` aujourd'hui.
