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

Phase 1 (prototype « une cité ») : en cours. Ce qui est jouable, les décisions prises et les points en suspens sont dans `docs/etat.md` ; les tickets dans `docs/tickets/phase-1.md`.

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
pnpm test:e2e           # Playwright : parcours web complet, sur la construction de production
```

Catalogue des composants du système de design : `pnpm --filter @oikos/web dev`, puis `http://localhost:5173/catalogue.html`.

## Pile technique

TypeScript partout. React + Vite (PWA) côté client, Node.js + Hono pour l'API de jeu, moteur de simulation
séparé, Supabase auto-hébergé (PostgreSQL, Auth, Realtime, Storage). Détail dans `docs/specs/11-architecture.md`.
