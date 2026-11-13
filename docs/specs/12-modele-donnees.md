# 12. Modèle de données

La base est découpée en cinq schémas Postgres, et seuls des vues et des canaux en lecture sont exposés au client. Deux journaux en partie double, l'un pour la monnaie, l'autre pour les stocks, font foi : les soldes ne sont que des cumuls vérifiables.

| Schéma | Rôle | Accès |
| --- | --- | --- |
| `game` | Tables de vérité du jeu | Écriture : API de jeu et moteur uniquement. Lecture cliente : seulement à travers les vues de `public`, sur des colonnes accordées une à une et sous règles par ligne ; le schéma n'est jamais exposé par l'API de Supabase |
| `public` | Vues de lecture pour le client | Joueurs, filtré par règles par ligne |
| `config` | Paramètres d'équilibrage versionnés | Lecture pour tous, écriture par le back-office |
| `telemetry` | Événements et agrégats, partitionnés par jour | Moteur en écriture, back-office en lecture |
| `admin` | Sanctions, audit, tickets, rôles | Back-office uniquement |

## Tables principales

| Domaine | Tables |
| --- | --- |
| Monde | `worlds`, `cities`, `districts`, `parcels`, `routes`, `calendar` |
| Maison | `houses`, `house_members`, `skills`, `reputation`, `titles` |
| Sites | `sites`, `buildings`, `recipes_running`, `workers`, `artisans`, `stewards`, `steward_rules` |
| Stocks | `inventories`, `stock_ledger`, `warehouses` |
| Monnaie | `accounts`, `ledger_entries`, `ledger_lines` |
| Marchés | `orders`, `trades`, `price_candles`, `contracts`, `auctions`, `bids`, `tenders` |
| Logistique | `ships`, `voyages`, `cargo`, `freight_offers` |
| Immobilier | `properties`, `leases`, `renovations` |
| Finance | `banks`, `deposits`, `loans`, `collaterals`, `companies`, `shares` |
| Cité | `citizenships`, `offices`, `elections`, `ballots`, `decrees`, `city_budget`, `public_works`, `leagues` |
| Sacré | `favor`, `offerings`, `graces_used`, `hubris`, `oracles`, `festivals` |
| Événements | `world_events`, `event_effects`, `quests`, `domain_events` |
| IA | `npcs`, `npc_memories`, `ai_calls`, `prompts` |
| Social | `channels`, `messages`, `reports`, `friendships`, `chronicle_articles` |
| Commerce réel | `purchases`, `subscriptions`, `entitlements` |

## Règles de conception

- Identifiants UUID v7, horodatages en UTC, montants en entiers (oboles) pour éviter les arrondis.
- Toute écriture de monnaie crée une écriture équilibrée : la somme des lignes vaut zéro, contrôlée par contrainte. La création et la destruction de monnaie passent par des comptes système nommés (un par robinet et par puits).
- Règles de sécurité par ligne activées sur toutes les tables exposées, testées en pgTAP : un joueur lit ses données privées et les données publiques, rien d'autre.
- Les données privées d'un concurrent (stocks, trésorerie, règles d'intendant) ne quittent jamais le serveur.
- Tables volumineuses partitionnées par mois (`trades`, `ledger_lines`, `messages`, `domain_events`), agrégats en vues matérialisées rafraîchies par le moteur.
- Migrations SQL versionnées dans le dépôt, jamais de modification manuelle en production.
