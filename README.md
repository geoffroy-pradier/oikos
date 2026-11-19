# OIKOS

Jeu de gestion multijoueur persistant, jouable sur web et mobile, dans une Grèce mythologique.
Chaque joueur dirige une maison (un *oikos*) : domaines, ateliers, flotte, finance, politique de sa cité
et faveur des dieux.

## Où lire quoi

| Fichier | Contenu |
| --- | --- |
| `CLAUDE.md` | Règles de travail des agents, boucle autonome, définition de terminé |
| `docs/specs/` | Cahier des charges, une spécification par système |
| `docs/glossary.md` | Lexique du jeu |
| `docs/adr/` | Décisions d'architecture |
| `docs/tickets/` | Tickets par phase |
| `docs/etat.md` | État du projet : ce qui est jouable, décisions, points en suspens |

## État

Phase 2 (alpha fermée) : en cours.
Ce qui est jouable, les décisions prises et les points en suspens sont dans `docs/etat.md` ; les tickets dans `docs/tickets/phase-2.md`.

## Démarrer

Le jeu complet en local, ce sont quatre processus : Supabase (base, comptes, courriels de test), l'API de
jeu, le moteur (ticks) et le client web. Ce qui est jouable est décrit dans `docs/etat.md`.

### Sous Windows (PowerShell)

Prérequis, à installer une fois :

- **Git** ;
- **Node.js 22** (la version exacte est dans `.nvmrc`) ;
- **Docker Desktop**, démarré, avec le moteur WSL 2 ;
- **pnpm**, activé par `corepack enable` (la version est épinglée dans `package.json`).

1. Récupérer le dépôt et ses dépendances :

   ```powershell
   git clone https://github.com/geoffroy-pradier/oikos.git
   cd oikos
   corepack enable
   pnpm install
   ```

2. Démarrer Supabase, puis créer la base (le premier démarrage télécharge les images Docker, plusieurs
   minutes) :

   ```powershell
   pnpm db:start
   pnpm db:reset
   ```

3. Créer le fichier d'environnement, à la racine du dépôt :

   ```powershell
   Copy-Item .env.example .env
   pnpm exec supabase status --workdir packages/db
   ```

   Dans la sortie de la seconde commande, copier la valeur « Publishable key » (ou « anon key » selon la
   version de la CLI) et la coller dans `.env`, à la ligne `VITE_SUPABASE_PUBLISHABLE_KEY=`. Les autres
   valeurs de `.env.example` conviennent telles quelles en local.

4. Lancer les trois services, chacun dans son terminal PowerShell, depuis la racine du dépôt. L'API et le
   moteur lisent le fichier `.env` de la racine :

   ```powershell
   pnpm local:api
   ```

   ```powershell
   pnpm local:engine
   ```

   ```powershell
   pnpm local:web
   ```

   L'API répond sur `http://127.0.0.1:8787/api/health` et affiche « OIKOS API listening on :8787 » ; le
   moteur affiche « OIKOS engine started ». Au premier démarrage, l'API publie la configuration initiale
   du jeu.

5. Ouvrir `http://127.0.0.1:5173` (cette adresse exactement, pas `localhost` : le lien de connexion y
   renvoie).

### Compte de test

Il n'y a pas de mot de passe : la connexion se fait par un lien envoyé par courriel, et en local aucun
courriel ne sort de la machine.

1. Sur la page de connexion, saisir une adresse quelconque, par exemple `joueur1@example.test`.
2. Ouvrir la boîte de test de Supabase, `http://127.0.0.1:54324`, puis le message reçu, et suivre le lien.
3. Créer sa maison (nom, blason, cité de Kallistè) : elle reçoit 3 000 oboles et un champ de blé.

Pour un second joueur (acheter ce que le premier vend à l'agora), refaire ces étapes avec une autre
adresse dans une fenêtre de navigation privée.

Le temps du jeu est réel : un champ de blé donne sa première récolte après quatre heures, et les PNJ
achètent toutes les dix minutes. Pour essayer sans attendre, avancer les sites de huit heures, **en local
uniquement** (la commande s'exécute dans le conteneur de la base ; elle lève le temps d'une transaction la
garde qui interdit de modifier ces dates) :

```powershell
docker exec supabase_db_oikos psql -U postgres -c "begin; alter table game.sites disable trigger sites_guard; update game.sites set created_at = created_at - interval '8 hours', cycle_started_at = cycle_started_at - interval '8 hours'; alter table game.sites enable trigger sites_guard; commit;"
```

Puis recharger la page : le champ a deux récoltes en attente.

Pour regarder la base locale, Supabase Studio est ouvert sur `http://127.0.0.1:54323` (tables, requêtes
SQL, utilisateurs d'Auth). Il a tous les droits sur la base : en local seulement. Si Supabase tournait
déjà avant cette version du dépôt, `pnpm db:stop` puis `pnpm db:start` le font apparaître.

Supabase local démarre aussi Realtime, par qui les messages de l'onglet Messages arrivent sans recharger la
page (ADR 0008). Sa CLI crée le schéma de Realtime avant de rejouer les migrations, qui y posent les règles
d'abonnement. Si Supabase tournait déjà avant cette version du dépôt (Realtime alors désactivé),
`pnpm db:stop`, `pnpm db:start` puis `pnpm db:reset` le mettent en place ; sans cela, l'onglet Messages relit
les messages à intervalle régulier et le dit, et `pnpm test:db` échoue sur les tests de la diffusion.

Pour arrêter : `Ctrl+C` dans chaque terminal, puis `pnpm db:stop`. `pnpm db:reset` efface toutes les
données locales et rejoue les migrations.

### Mettre à jour après de nouvelles fusions

Pour récupérer ce qui a été fusionné sur `main` en gardant ses comptes, ses maisons et sa partie en cours :

1. Arrêter l'API, le moteur et les clients (`Ctrl+C` dans chaque terminal).
   L'API et le moteur ne se rechargent pas seuls : sans redémarrage, ils gardent l'ancien code, et un écran récent peut alors se voir refuser une lecture qu'ils ne connaissent pas encore.
2. Récupérer le code et les dépendances :

   ```powershell
   git pull
   pnpm install
   ```

3. Appliquer à la base locale les seules migrations nouvelles, sans rien effacer :

   ```powershell
   pnpm db:migrate
   ```

   Supabase local doit tourner (`pnpm db:start` s'il a été arrêté).
   Supabase tient le registre des migrations déjà appliquées et n'applique que les autres.
   L'option `--include-all` du script applique aussi une migration fusionnée après une autre plus récente qu'elle ; les migrations sont écrites pour être rejouables (règle 9 de `CLAUDE.md`).
   Si la commande n'annonce aucune migration appliquée, la base était déjà à jour.
4. Relancer `pnpm local:api`, `pnpm local:engine`, `pnpm local:web` (et `pnpm local:admin`), chacun dans son terminal.
   La configuration en vigueur dans la base ne change pas : l'API et le moteur ne publient la configuration initiale (`packages/config/src/values/initial.json`) que dans une base qui n'en a aucune.
   Une section nouvelle de la configuration prend sa valeur par défaut seulement si son schéma en déclare une (`packages/config/src/schema.ts`).
   Sinon, le système qu'elle règle reste coupé dans une base créée avant lui : c'est le cas des intendants, de la vie politique, des décrets, des événements du monde et de la Pythie.
   Pour les ouvrir sans effacer la base, publier une version nouvelle de la configuration depuis le module Paramètres d'Olympe : ouvrir la version en vigueur, recopier dans son champ « Configuration (JSON) » les sections manquantes de `initial.json`, « Enregistrer comme nouvelle version », puis la programmer.
   L'auteur d'une version ne peut pas la programmer lui-même (revue par une seconde personne, 15.2) : seul en local, mettre `OLYMPE_ALLOW_SELF_REVIEW=true` dans `.env` et redémarrer l'API, ou faire programmer la version par un second compte d'Olympe.
   La version entre en vigueur à la clôture quotidienne suivante.
   Sinon, `pnpm db:reset` repart de zéro avec la configuration complète.

`pnpm db:reset` reste le recours si la base locale est dans un état incohérent : il efface toutes les données locales, comptes compris.
Après un `pnpm db:reset`, une session ouverte avant la remise à zéro désigne un compte qui n'existe plus : l'API la refuse (`UNAUTHENTICATED`) dès la première commande du jeu (la fondation de la maison, par exemple) ou la première lecture d'Olympe, et l'application ferme alors la session et revient à la connexion, avec un message qui dit pourquoi (#565).
Avant cela, le jeu montre l'écran de fondation et Olympe peut demander le second facteur, que Supabase Auth refuse : se déconnecter (ou effacer les données du site `127.0.0.1` dans le navigateur) évite ce détour.
Le rôle de super-administrateur est à inscrire de nouveau en base (voir « Back-office »).

### Back-office (facultatif)

`pnpm local:admin`, puis `http://127.0.0.1:5174`. À la première
connexion, le compte enrôle un second facteur (application d'authentification), puis lit son identifiant.
Il lui faut ensuite un rôle dans la table `admin.roles` : le premier super-administrateur est inscrit à
la main en base, les suivants reçoivent leur rôle dans l'écran « Accès ». Procédure complète, appareil
perdu et retrait d'accès compris : `docs/exploitation/acces-olympe.md` (en local, ses instructions SQL se
lancent comme ci-dessus, par `docker exec supabase_db_oikos psql -U postgres -c "…"`).

### Sous Linux ou macOS

Les mêmes commandes, avec `cp .env.example .env` à l'étape 3.

### Vérifications

```
pnpm lint
pnpm typecheck
pnpm test               # tests unitaires et de propriétés
pnpm test:db            # pgTAP sur Supabase local
pnpm test:integration   # API et moteur contre Supabase local
pnpm test:balance       # banc d'équilibrage des quatre cités, contre Supabase local
pnpm test:e2e           # Playwright : parcours web complet, sur la construction de production
```

### Banc d'équilibrage

Le banc d'équilibrage joue des maisons scriptées dans un monde à part, avec les vraies commandes et le moteur, pour mesurer l'économie.
Le banc à une cité (#78) est un test d'intégration ordinaire : `apps/api/src/balance.integration.test.ts`, avec ses bornes.
Le banc des quatre cités (#281) est à part : `apps/api/src/balance-world.bench.ts`, que `pnpm test:balance` lance contre Supabase local (`DATABASE_URL`, comme les tests d'intégration).
Son monde a une graine fixe, écrite dans `apps/api/src/balance/world.ts` : tant que la probabilité des événements est nulle (configuration initiale), il n'en joue aucun.
Il joue 10 jours de mise en route et 30 jours mesurés dans les quatre cités de la configuration initiale, dont la population est divisée par quatre pour que sa demande totale soit celle d'une cité du banc de #78.
Le banc pose des salaires de scénario, nuls dans la configuration initiale, pour que les travailleurs PNJ et les intendants soient payés (`WAGES` dans `world.ts`).
Ses maisons sont fondées selon le terroir de chaque cité, avec trois négociants qui achètent dans une cité, transportent par mer et vendent dans une autre (`apps/api/src/balance/trade.ts`), et des intendants à qui sept maisons confient la vente de leurs récoltes (`apps/api/src/balance/steward.ts`) ; leurs paramètres de scénario sont des constantes nommées du banc, jamais des valeurs du jeu, qui restent dans `packages/config`.
Le banc joue aussi le logement et la vie civique (#282) : les maisons louent, achètent, rénovent et mettent en location des logements (`apps/api/src/balance/housing.ts`), et dans chaque cité deux maisons se portent candidates à l'archonte, les citoyens votent, l'archonte élu fait voter des grands travaux et une fête bornés par le trésor de sa cité (`apps/api/src/balance/politics.ts`).
Ces stratégies passent par les commandes du jeu ; leurs seuils viennent de la configuration jouée, ou sont des constantes nommées et commentées de la stratégie.
Le banc pose des paramètres de scénario pour que ces puits jouent : hébergement chez les PNJ, entretien et vétusté des biens, prix d'achat et de rénovation divisés par cinq, rénovation au blé (`HOUSING` dans `world.ts`).
Les commandes datent leurs écritures de l'instant réel de la base et la clôture les juge à l'instant de jeu : le banc ne réécrit que des dates, gardes coupées puis rétablies dans la même transaction (`balance/dates.ts` et `balance/calendar.ts`).
Il ne borne pas l'économie, que #283 calibre : il vérifie que le grand livre, les puits (immobiliers et publics compris), les robinets et le trésor de chaque cité se rapprochent des flux comptés, que chaque cité a tourné, que des voyages sont arrivés avec leur cargaison, que les salaires ont été payés, que les intendants ont exécuté leurs règles, que les élections et les décrets ont l'issue que leurs votes imposent et que des logements ont été achetés, loués et rénovés.
Le test publie ses mesures dans son journal, et dans le fichier JSON que `BALANCE_REPORT` désigne ; le job `balance` le conserve comme pièce jointe (`balance-measures`).
Les mesures, par jour mesuré, sont : par cité et pour le monde, la monnaie en circulation et le net de chaque robinet et de chaque puits ; par cité, le coût du panier, la couverture des besoins vitaux par classe et la population ; la marge nette quotidienne de chaque recette dans chaque cité, aux prix moyens des dix derniers jours ; enfin, sur les jours mesurés, la part de chaque puits dans la monnaie détruite, par cité et pour le monde, avec les sommes des puits immobiliers (achat, rénovation, entretien, hébergement chez les PNJ) et des puits publics (grands travaux, fêtes).
Le simulateur d'équilibrage (#284, spécification 15.2) rejoue ce même banc (`balance/run.ts`) avec une configuration candidate : `pnpm --filter @oikos/api simulate --candidate config.json [--days 30] [--seed graine] [--json rapport.json] [--markdown rapport.md]`, ou `--version <numéro>` pour une version enregistrée.
Il joue la configuration initiale puis la candidate, chacune sur un monde neuf de la base `DATABASE_URL` (comme le banc, sur une base locale), et écrit le rapport en tableaux Markdown, avec l'écart de chaque indicateur ; une candidate que le schéma refuse l'est avant toute simulation.
Sa durée est bornée dans le test (`MAX_MINUTES`) et par le délai du job.
Dans la `ci`, le job `balance` le lance ; s'il échoue, `ci` est rouge.

Catalogue des composants du système de design : `pnpm --filter @oikos/web dev`, puis `http://localhost:5173/catalogue.html`.

## Pile technique

TypeScript partout. React + Vite (PWA) côté client, Node.js + Hono pour l'API de jeu, moteur de simulation
séparé, Supabase auto-hébergé (PostgreSQL, Auth, Realtime, Storage). Détail dans `docs/specs/11-architecture.md`.
