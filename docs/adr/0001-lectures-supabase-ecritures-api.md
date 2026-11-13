# ADR 0001 — Lectures par Supabase, écritures par l'API de jeu

Date : 2026-11-13 · Statut : acceptée

## Contexte

Le jeu a une économie partagée entre joueurs. Toute écriture doit être validée par des règles métier,
exécutée dans une transaction et journalisée. Supabase fournit une API automatique sur Postgres, pratique
en lecture mais insuffisante pour porter ces règles.

## Décision

- Le client lit des vues du schéma `public` par l'API de Supabase, sous règles de sécurité par ligne,
  et s'abonne aux canaux Realtime.
- Le client n'écrit jamais directement. Toute action est une commande envoyée à `apps/api`, qui vérifie
  le jeton Supabase, valide l'entrée (Zod), applique les règles de `packages/sim` et écrit dans le schéma `game`.
- Un service `apps/engine` exécute les ticks, la clôture quotidienne, les tâches et les appels d'IA.
- La file de tâches est dans Postgres (pg-boss). Pas de Redis au départ.

## Conséquences

- Les formules vivent en TypeScript pur, partagées entre API, moteur, client (aperçus) et simulateur d'équilibrage.
- Deux chemins d'accès aux données à maintenir (vues de lecture, commandes d'écriture).
- Pas de logique métier dans des fonctions Edge ni dans des déclencheurs SQL, hors contraintes d'intégrité.
