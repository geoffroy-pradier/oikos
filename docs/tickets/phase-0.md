# Tickets — phase 0 et première tranche

À traiter dans l'ordre. Critère de sortie de la phase 0 : déploiement automatique en place (voir `docs/specs/17-feuille-de-route.md`).

---

# 1. Initialiser le monorepo et l'intégration continue

## Contexte

Créer le monorepo pnpm + Turborepo avec la structure de la section 11.3 (apps/web, admin, api, engine, site ; packages/sim, contracts, config, ui, db, ai), TypeScript strict, ESLint, Prettier, Vitest.

## Spécification liée

`docs/specs/11-architecture.md`, `docs/specs/16-developpement-agents.md`

## Critères d'acceptation

- [ ] `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` passent en local et dans GitHub Actions
- [ ] Chaque application et paquet a un test trivial qui passe
- [ ] `.env.example` et `tsconfig` de base partagés
- [ ] Node 22 et version de pnpm épinglés (`packageManager`, `.nvmrc`)

## Hors périmètre

Aucune fonctionnalité de jeu.

## Dépendances

aucune

---

# 2. Supabase en local et socle d'infrastructure

## Contexte

Mettre en place Supabase en local (CLI) pour le développement et les tests, et préparer `infra/` : docker compose de production (Supabase allégé, Caddy, API, moteur), scripts de sauvegarde pgBackRest, documentation de déploiement.

## Spécification liée

`docs/specs/14-infrastructure.md`, `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] `pnpm db:start` démarre Supabase local, `pnpm db:reset` rejoue les migrations
- [ ] Schémas `game`, `config`, `telemetry`, `admin` créés par migration ; `public` réservé aux vues
- [ ] `pnpm test:db` lance pgTAP dans l'intégration continue
- [ ] `infra/README.md` décrit pas à pas l'installation sur un VPS, sans aucun secret

## Hors périmètre

Commande et configuration réelles du VPS (label `needs-human`).

## Dépendances

#1

---

# 3. Authentification et création de maison

## Contexte

Inscription et connexion par Supabase Auth (e-mail + lien magique), puis création de la maison : nom, blason simple, cité d'accueil.

## Spécification liée

`docs/specs/03-boucles-progression.md`, `docs/specs/04-systemes-gestion.md`

## Critères d'acceptation

- [ ] Tables `houses`, `citizenships`, `cities` (une cité de test) avec règles par ligne testées en pgTAP
- [ ] Un joueur ne peut créer qu'une maison par monde ; nom unique, validé
- [ ] Parcours complet testé en Playwright à 360 px de large
- [ ] Textes en `fr` et `en`

## Hors périmètre

Fournisseurs sociaux (Google, Apple, Discord), choix du dieu protecteur.

## Dépendances

#1, #2

---

# 4. Cadre de configuration versionnée

## Contexte

`packages/config` : schémas Zod de toutes les tables d'équilibrage, stockage versionné dans le schéma `config`, chargement et mise en cache, une version figée par tick.

## Spécification liée

`docs/specs/15-back-office-olympe.md`, `docs/specs/13-moteur-anti-triche.md`

## Critères d'acceptation

- [ ] Une configuration invalide est refusée avec un message précis
- [ ] Versions immuables, une seule version active, activation programmable
- [ ] Jeu de valeurs initial : 15 biens, recettes, classes de PNJ d'une cité
- [ ] Tests : chargement, validation, bascule de version

## Hors périmètre

Interface d'édition (ticket 10).

## Dépendances

#2

---

# 5. Grand livre en partie double et journal des stocks

## Contexte

Tables `accounts`, `ledger_entries`, `ledger_lines`, `inventories`, `stock_ledger` et fonctions de `packages/sim` pour passer des écritures. Comptes système nommés pour chaque robinet et chaque puits.

## Spécification liée

`docs/specs/05-economie.md`, `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] Contrainte en base : la somme des lignes d'une écriture vaut zéro
- [ ] Montants en entiers (oboles), aucun flottant
- [ ] Tests de propriétés (fast-check) : conservation de la monnaie et des stocks, jamais de solde négatif non autorisé
- [ ] Vue de contrôle : solde = cumul des lignes, pour tout compte
- [ ] Label `sensible`

## Hors périmètre

Banques, prêts.

## Dépendances

#2

---

# 6. Squelette de l'API de jeu

## Contexte

`apps/api` (Hono, Zod, Kysely) : vérification du jeton Supabase, registre de commandes, clé d'idempotence, transaction unique, journal d'audit, émission d'événements de domaine, limitation de débit.

## Spécification liée

`docs/specs/11-architecture.md` (11.4)

## Critères d'acceptation

- [ ] Une commande d'exemple `house.rename` de bout en bout
- [ ] Rejouer une commande avec la même clé d'idempotence ne produit qu'un effet
- [ ] Erreurs métier typées, partagées avec le client par `packages/contracts`
- [ ] Tests d'intégration contre Supabase local
- [ ] Label `sensible`

## Hors périmètre

Commandes de jeu réelles.

## Dépendances

#3, #5

---

# 7. Squelette du moteur

## Contexte

`apps/engine` : horloge (tick de 10 minutes, clôture quotidienne à 04 h 00 Europe/Paris, bascule de saison), file de tâches pg-boss, aléa déterministe à graine enregistrée, tick rejouable.

## Spécification liée

`docs/specs/13-moteur-anti-triche.md`

## Critères d'acceptation

- [ ] Un tick lit une seule version de configuration
- [ ] Rejouer un tick avec la même graine et le même état donne le même résultat (test)
- [ ] Un tick qui échoue est repris sans double effet
- [ ] Durée de chaque tick enregistrée dans `telemetry`

## Hors périmètre

Règles économiques (ticket 9).

## Dépendances

#4, #5

---

# 8. Système de design et coquille de navigation

## Contexte

`packages/ui` (Tailwind, shadcn/ui) avec la palette et la typographie de la direction artistique, thèmes clair et sombre. `apps/web` : coquille PWA avec les cinq onglets, barre du bas sur mobile, barre latérale sur ordinateur.

## Spécification liée

`docs/specs/10-ux-ui.md`

## Critères d'acceptation

- [ ] Utilisable à 360 px et à 1440 px, navigation au clavier, contrastes AA
- [ ] Application installable (manifeste, service worker)
- [ ] i18n en place, aucun texte en dur
- [ ] Catalogue de composants consultable en local

## Hors périmètre

Écrans de jeu.

## Dépendances

#1

---

# 9. Première tranche verticale : du champ à l'agora

## Contexte

Un joueur possède un champ qui produit du blé (évaluation paresseuse par horodatage), le stocke, le vend à l'agora par un ordre à cours limité. La demande des PNJ achète au tick selon la formule de la section 5.2.

## Spécification liée

`docs/specs/04-systemes-gestion.md`, `docs/specs/05-economie.md`

## Critères d'acceptation

- [ ] Commandes `site.collect` et `market.placeOrder`, avec appariement dans la transaction
- [ ] La demande des PNJ crée de la monnaie par le compte système prévu ; tout passe par le grand livre
- [ ] Écrans : fiche de site, carnet d'ordres du blé, trésorerie
- [ ] Test de bout en bout : produire, vendre, voir son solde augmenter
- [ ] Test de simulation sur 30 jours : pas de dérive de la masse monétaire hors des robinets attendus
- [ ] Label `sensible`

## Hors périmètre

Autres biens, ateliers, transport.

## Dépendances

#6, #7, #8

---

# 10. Back-office v0

## Contexte

`apps/admin` : connexion réservée au rôle administrateur avec double authentification, module Vigie (joueurs, durée des ticks, erreurs, file de tâches), éditeur de paramètres branché sur `packages/config` avec comparaison de versions et retour arrière.

## Spécification liée

`docs/specs/15-back-office-olympe.md`

## Critères d'acceptation

- [ ] Aucun accès direct aux tables : commandes d'administration journalisées
- [ ] Un compte non administrateur est refusé (test)
- [ ] Modifier une valeur crée une nouvelle version, activable à la prochaine clôture
- [ ] Journal d'audit consultable

## Hors périmètre

Modération, simulateur, fiche joueur.

## Dépendances

#4, #6, #7
