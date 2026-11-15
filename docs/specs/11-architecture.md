# 11. Architecture technique

Tout le projet est en TypeScript, dans un seul dépôt, au-dessus de Supabase auto-hébergé : le client lit par Supabase, écrit par une API de jeu, et un moteur séparé fait tourner la simulation. Un seul langage du navigateur à la base de données simplifie le travail des agents et permet de partager les formules entre client, serveur et simulateur.

> Schéma « architecture · 2 clients, 3 services, 1 base » : voir le document source (non exporté en Markdown).

Les lectures et le temps réel passent par Supabase, toute action de jeu par l'API ; seul le moteur parle au fournisseur d'IA.

## 11.1 Principe : lectures par Supabase, écritures par l'API de jeu

- **Lectures** : le client interroge des vues exposées par l'API automatique de Supabase, protégées par les règles de sécurité par ligne. Les mises à jour en direct passent par Supabase Realtime.
- **Écritures** : aucune table de jeu n'est modifiable depuis le client. Toute action passe par une commande de l'API de jeu, qui vérifie le jeton Supabase, valide, applique les règles dans une transaction et écrit.
- **Simulation** : un service moteur exécute les ticks, la clôture quotidienne, les événements et les appels IA, via une file de tâches stockée dans Postgres.
- **Configuration versionnée** : les versions sont immuables et leurs activations, programmées, sont tenues en ajout seul (`config.activations`).
  Un tick ou une clôture lit la version en vigueur à son instant avant d'ouvrir sa transaction, sans verrou sur les activations, et l'enregistre : c'est elle qui fait foi pour le rejouer.
  Garanties de la base sur les activations et limite assumée : 13 (ticket 208).

## 11.2 Choix techniques

| Couche | Choix | Raison |
| --- | --- | --- |
| Dépôt | Monorepo pnpm et Turborepo | Types et schémas partagés, une seule intégration continue |
| Client joueur | React, Vite, TypeScript, TanStack Router et Query, Tailwind CSS, composants shadcn/ui | Application statique légère à servir, écosystème très bien maîtrisé par les agents de code |
| Hors ligne et installation | PWA avec service worker (Workbox), push web | Une seule base de code web et mobile |
| Carte | PixiJS sur canvas, données vectorielles | Fluide sur mobile avec des centaines de parcelles |
| Graphiques | Lightweight Charts pour les prix, Recharts pour les comptes | Chandeliers et séries temporelles natifs |
| Magasins d'applications | Capacitor, en phase 4 | Emballe la même application web |
| Site vitrine | Astro, statique | Référencement, coût nul |
| API de jeu | Node.js 22, Hono, Zod, Kysely | Commandes typées, transactions SQL explicites |
| Moteur | Node.js 22, pg-boss pour les tâches et pour l'horloge (une tâche planifiée chaque minute joue les ticks échus) | Pas de Redis à exploiter au départ |
| Cœur de simulation | Paquet TypeScript pur, sans entrée-sortie | Testé, rejouable, partagé avec le simulateur d'équilibrage |
| Données | PostgreSQL de Supabase, extensions pgvector, pg\_cron, pg\_partman | Une seule base, sauvegarde simple |
| Authentification | Supabase Auth : e-mail, lien magique, Google, Apple, Discord | Standard, double authentification pour le back-office |
| Temps réel | Supabase Realtime en mode diffusion par canal | Discussion, tickers de marché, notifications |
| Fichiers | Supabase Storage | Blasons, illustrations |
| IA | Passerelle interne vers une API de modèles, pgvector pour la mémoire | Fournisseur interchangeable |
| Paiement | Stripe Checkout et webhooks | TVA et factures gérées |
| Back-office | Application React séparée, mêmes composants | Isolement de sécurité |
| Tests | Vitest, fast-check, pgTAP, Playwright, k6 | Unitaires, propriétés, sécurité par ligne, bout en bout, charge |

## 11.3 Structure du dépôt

```text
oikos/
  apps/
    web/          client joueur (PWA)
    admin/        back-office Olympe
    api/          API de jeu (commandes)
    engine/       moteur : ticks, taches, IA
    site/         site vitrine
  packages/
    sim/          coeur de simulation pur
    contracts/    schemas Zod des commandes et evenements
    config/       schemas et valeurs d'equilibrage
    ui/           systeme de design
    db/           migrations SQL, types generes, tests pgTAP
    ai/           passerelle IA, prompts versionnes
  infra/          docker compose, Caddy, sauvegardes
  docs/           specifications par systeme, decisions d'architecture
```

## 11.4 Contrat d'une commande

Chaque action de jeu est une commande nommée (`market.placeOrder`, `site.startRecipe`, `city.castVote`), décrite par un schéma d'entrée, un schéma de sortie et une liste d'erreurs métier.
Une commande porte une clé d'idempotence, s'exécute dans une seule transaction et produit des événements de domaine (`OrderMatched`, `ShipArrived`) qui alimentent le temps réel, la télémétrie et la chronique.
Le tick en produit aussi, sans commande, dans sa propre transaction : un `TradeExecuted` par achat des PNJ, par exemple.
Le lancement compte environ 90 commandes.
