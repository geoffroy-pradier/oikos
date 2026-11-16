# ADR 0006 — Une vue recréée sans condition ne gagne pas de colonne

Date : 2026-11-15 · Statut : acceptée

## Contexte

La règle 9 de `CLAUDE.md` et l'ADR 0004 exigent que la suite des migrations reste rejouable : `ci` la rejoue deux fois après `db:reset`, puis sur la base remplie par les tests d'intégration (`pnpm test:db:replay`).
Plusieurs migrations anciennes créent une vue ou une fonction de lecture par un `create or replace` sans condition : ainsi `game.site_rules()` et `public.site_rules` (migration 18), `public.my_income_statement` et `public.my_income_statement_by_season` (migration 33).
Au rejeu, cette migration ancienne recrée l'objet tel qu'elle le définit, sur la base où les migrations suivantes sont déjà passées.
Postgres admet qu'un `create or replace view` ajoute des colonnes en fin de liste, jamais qu'il en retire ; il refuse qu'un `create or replace function` change le type rendu.
Le ticket 255 demandait une colonne de salaires dans le compte de résultat et le salaire du jour dans `site_rules` : la première version de sa migration a fait échouer le rejeu de la migration 33 (« cannot drop columns from view »).
Une migration publiée ne se modifie plus (ADR 0004) : la migration ancienne ne peut pas devenir conditionnelle après coup.

## Décision

- Une vue ou une fonction qu'une migration ancienne crée par un `create or replace` sans condition garde ses colonnes et son type rendu.
  Une migration nouvelle peut en changer la définition, à colonnes égales.
- Une donnée nouvelle passe :
  - soit par une colonne existante, quand elle en a le sens (les salaires dans la colonne `upkeep` du compte de résultat, le dû quotidien des sites) ou quand la colonne est un `jsonb` lu par un schéma souple (le salaire du jour sous la clé `staff` de la colonne `sites` de `site_rules`) ;
  - soit par une vue ou une fonction nouvelle.
- Une vue créée désormais, et que l'on prévoit d'étendre, se crée sous condition (`if to_regclass(...) is null`, comme `market_rules` en migration 21), ou rend une forme qui s'étend sans colonne nouvelle (une ligne par nature, ou un `jsonb`).

## Conséquences

- Le rejeu reste vert, et le code précédent reste servi pendant un déploiement : il lit les mêmes colonnes.
- Les tickets qui ajoutent une nature au compte de résultat (loyers, hébergement) la rangent dans une colonne existante ou ajoutent une vue nouvelle, par exemple une vue du compte de résultat par nature.
- Une colonne `jsonb` porte une clé qu'un client ancien ignore ; le client nouveau la lit avec une valeur par défaut, comme pour une version de configuration antérieure.
- La même limite vaut pour une contrainte recréée sans condition : la migration 60 recrée `ledger_lines_nature_known` avec la seule liste (`upkeep`, `wages`), vérifiée sur les lignes existantes.
  Une nature nouvelle ne prend donc pas de marqueur de ligne : l'hébergement (#258) a sa propre écriture, `lodging.daily` ou `lodging.restart`, de la même transaction que l'entretien qu'il accompagne.
