# Infrastructure OIKOS

Socle de déploiement décrit dans `docs/specs/14-infrastructure.md`. Ce dossier ne contient **aucun secret** :
toutes les valeurs sensibles vivent dans le fichier `.env` du serveur, créé et rempli par un humain.

| Fichier | Rôle |
| --- | --- |
| `docker-compose.oikos.yml` | Surcouche au compose officiel de Supabase : désactive les services inutiles, ajoute API, moteur et Caddy |
| `Caddyfile` | HTTPS, fichiers statiques du client et du back-office, proxy vers l'API et Supabase |
| `docker/static.sh`, `docker/Dockerfile.static` | Construction du client joueur et du back-office, image de transport `oikos-static` |
| `install-static.sh` | Sur le serveur : copie les fichiers de l'image dans `static/releases/`, bascule par lien symbolique |
| `test-static.sh` | Contrôle lancé par `ci` : construction, installation, service par Caddy, en-têtes de sécurité |
| `backup/pgbackrest.conf`, `backup/backup.sh` | Archivage continu et sauvegardes vers un stockage objet |
| `.env.example` | Variables OIKOS à ajouter au `.env` de Supabase |

En local, rien de tout cela n'est nécessaire : `pnpm db:start` lance Supabase par sa CLI (`packages/db/supabase/`).

## Installation sur un VPS, pas à pas

Les étapes marquées 👤 exigent un humain (commande de serveur, domaine, secrets : voir `CLAUDE.md`).

1. 👤 **Commander le VPS** (Debian 12 ou Ubuntu 24.04, 8 Go de mémoire au minimum, voir 14.1) et un bucket de stockage objet pour les sauvegardes.
2. 👤 **DNS** : faire pointer `<domaine>`, `supabase.<domaine>` et `olympe.<domaine>` vers le serveur.
3. **Durcir le serveur** : compte non root, connexion SSH par clé uniquement, pare-feu limité aux ports 22, 80 et 443, `fail2ban`, mises à jour de sécurité automatiques.
4. **Installer Docker Engine** et le greffon Compose (v2.24 ou plus, requis pour `!reset` et `!override`).
5. **Préparer l'arborescence** dans `/opt/oikos` :
   ```bash
   git clone --depth 1 --branch <étiquette-épinglée> https://github.com/supabase/supabase supabase
   git clone https://github.com/geoffroy-pradier/oikos oikos
   mkdir -p static/web static/admin
   cp supabase/docker/.env.example supabase/docker/.env
   cat oikos/infra/.env.example >> supabase/docker/.env
   ```
   La version de Supabase est épinglée (une étiquette dont le compose nomme la passerelle `api-gw` ; les plus anciennes utilisent `kong` et ne conviennent pas à la surcouche) : on ne suit jamais `master` en production, et toute montée de version passe d'abord par la préproduction.
6. 👤 **Remplir `supabase/docker/.env`** : générer tous les secrets Supabase en suivant la documentation officielle d'auto-hébergement (mot de passe Postgres, secret JWT, clés d'API, identifiants du tableau de bord), renseigner les adresses publiques (`SITE_URL`, `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`), le SMTP du service d'e-mails transactionnels, puis les variables `OIKOS_*` et `PGBACKREST_*`. Fixer `PGRST_DB_SCHEMAS=public` : aucun autre schéma ne doit être exposé par PostgREST (`game` n'est lisible qu'à travers les vues de `public`).
7. **Démarrer** :
   ```bash
   cd /opt/oikos/supabase/docker
   docker compose -f docker-compose.yml -f ../../oikos/infra/docker-compose.oikos.yml up -d
   ```
   Caddy obtient les certificats au premier démarrage. La passerelle Supabase n'est pas publiée sur l'hôte : Caddy ne relaie que `/auth/v1`, `/rest/v1`, `/realtime/v1` et `/storage/v1`, et répond 404 au reste (Studio, pg-meta, MCP). Postgres n'écoute que sur `127.0.0.1`.
8. **Appliquer les migrations** depuis un poste autorisé, par tunnel SSH vers le port Postgres :
   ```bash
   pnpm exec supabase db push --workdir packages/db --db-url "$DATABASE_URL"
   ```
   Les migrations sont appliquées avant le basculement des conteneurs et restent compatibles avec la version précédente du code.
   `supabase db push` les enregistre dans `supabase_migrations.schema_migrations`, la table que lit ensuite `deploy.sh` (voir « Migrations au déploiement »).
   Les migrations créent le rôle `oikos_service` (sans connexion), qui porte les seuls droits de l'API et du moteur.
   👤 Créer ensuite le compte de connexion des services, membre de ce rôle, avec un mot de passe généré (jamais dans le dépôt), et le placer dans `OIKOS_DATABASE_URL` :
   ```sql
   create role oikos_app login password '<mot de passe généré>' in role oikos_service;
   ```
   Les services ne se connectent jamais avec le propriétaire des tables : ils ne peuvent ni supprimer une écriture, ni modifier un solde ou un stock hors des journaux.
9. **Sauvegardes** : installer pgBackRest à côté de Postgres avec `backup/pgbackrest.conf`, activer l'archivage (`archive_mode=on`, `archive_command='pgbackrest --stanza=oikos archive-push %p'`), créer la stanza (`pgbackrest --stanza=oikos stanza-create`), puis planifier `backup/backup.sh full` le dimanche et `backup/backup.sh diff` les autres jours. Tester une restauration chaque mois sur la préproduction.
10. **Accès d'administration** : Studio et les outils de supervision ne sont joignables que par VPN (WireGuard ou Tailscale) ; aucun n'est relayé par le `Caddyfile`. Le premier super-administrateur d'Olympe est inscrit en base par un humain : voir `docs/exploitation/acces-olympe.md`.
11. 👤 **Cloudflare** en façade (cache, pare-feu applicatif), une fois le domaine vérifié.

## Déploiement automatique

Le flux `.github/workflows/deploy.yml` s'exécute à chaque fusion sur `main`.

1. **Images** : l'API et le moteur sont empaquetés en un fichier chacun (`infra/docker/bundle.mjs`), mis dans une image `node:22-alpine` sans dépendance ni outil de construction (`infra/docker/Dockerfile`, utilisateur non root), puis publiés sur `ghcr.io/<propriétaire>/oikos-api` et `oikos-engine` avec l'empreinte du commit et l'étiquette `main`. Le jeton fourni par GitHub Actions suffit.
2. **Clients statiques** (tâche `static`) : le client joueur et le back-office sont construits (`infra/docker/static.sh`) et publiés dans l'image de transport `ghcr.io/<propriétaire>/oikos-static`. L'adresse publique de Supabase et sa clé publique sont figées dans les fichiers à la construction : la tâche ne publie rien tant que les variables de dépôt `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` n'existent pas.
3. **Déploiement** (tâche `deploy`, inactive par défaut) : `infra/deploy.sh` est copié sur le serveur puis exécuté. Il tire les images de la version, applique les seules migrations nouvelles (voir ci-dessous), démarre l'API — et le moteur si son image existe — sur la nouvelle version, puis interroge `/api/health`. Une fois l'API en bonne santé, `infra/install-static.sh` remplace `static/web` et `static/admin` par les fichiers de la même version (chaque version est copiée dans `static/releases/`, `web` et `admin` sont des liens symboliques remplacés par un renommage atomique ; la version précédente est conservée ; sans image `oikos-static` pour cette version, les clients restent tels quels, mais un registre injoignable fait échouer le déploiement). Caddy est recréé quand le `Caddyfile` a changé. Le fichier `.env` n'est modifié qu'en cas de succès : au moindre échec, les conteneurs sont relancés sur la version qu'il contient et la tâche est rouge. Les migrations, compatibles avec la version précédente du code, ne sont pas annulées.

### Migrations au déploiement

`deploy.sh` confie les migrations à `infra/apply-migrations.sh`, copié avec lui sur le serveur. Celui-ci n'applique que les fichiers dont la version (préfixe du nom) est absente de `supabase_migrations.schema_migrations` (colonnes `version`, `name`, `statements`, celles de la CLI Supabase), dans l'ordre des noms, chacun en une transaction qui contient son enregistrement : une migration en échec n'est pas enregistrée, les suivantes ne sont pas appliquées, et le déploiement revient à la version précédente. Les migrations déjà enregistrées ne sont jamais rejouées : un état intermédiaire d'une suite rejouée n'est plus exposé aux joueurs. Deux exécutions simultanées sont sérialisées par un verrou consultatif et n'appliquent chaque migration qu'une fois. Test : `pnpm test:db:deploy`, en `ci`, dans des bases jetables.

**Base déjà déployée sans cette table** (migrations rejouées par l'ancien `deploy.sh`) : elle est reconnue à ce qu'aucune migration n'est enregistrée alors que le schéma `game` existe. Les migrations présentes dans la version précédente (`OIKOS_VERSION` du `.env`, lues par `git ls-tree`) sont alors enregistrées sans être rejouées, puis les nouvelles appliquées. Sans version précédente connue, le déploiement s'arrête sans rien modifier : un humain enregistre les migrations déjà passées (`supabase migration repair --status applied <version>` ou insertion dans la table) avant de relancer. Une table qui n'enregistre qu'une partie des migrations passées (`supabase db push` à l'installation, puis l'ancien `deploy.sh`) n'est pas reconnue ainsi : les absentes sont rejouées une fois, ce que la rejouabilité permet.

La rejouabilité reste exigée (CLAUDE.md, règle 9) : `pnpm test:db:replay` rejoue la suite entière en `ci`, après `db:reset` puis sur la base remplie par les tests d'intégration.

Pour l'activer, un humain doit, une fois le serveur prêt :

- créer les secrets de dépôt `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` ;
- créer les variables de dépôt `VITE_SUPABASE_URL` (`https://supabase.<domaine>`) et `VITE_SUPABASE_PUBLISHABLE_KEY` (clé publique « anon » de l'instance : publique par nature, ce n'est pas un secret) ;
- dans le `.env` de Supabase : ajouter `https://olympe.<domaine>` à `ADDITIONAL_REDIRECT_URLS` (sinon le lien de connexion du back-office ramène sur le client joueur) et activer le second facteur TOTP de Supabase Auth, exigé par le back-office (variables `GOTRUE_MFA_TOTP_ENROLL_ENABLED` et `GOTRUE_MFA_TOTP_VERIFY_ENABLED` du service `auth` ; à confirmer sur la version épinglée lors de l'installation) ;
- créer la variable de dépôt `DEPLOY_ENABLED` avec la valeur `true`, et protéger l'environnement GitHub `preproduction` s'il doit exiger une approbation ;
- sur le serveur : l'utilisateur de déploiement doit pouvoir lancer `docker compose`, écrire dans `/opt/oikos/oikos` (clone Git) et dans `/opt/oikos/supabase/docker/.env`, et lire les images du registre (`docker login ghcr.io` avec un jeton en lecture seule si le dépôt est privé). Attention : l'accès à Docker équivaut à un accès root, et ce `.env` contient tous les secrets du serveur ; ce compte doit être réservé au déploiement ;
- Caddy et la base doivent déjà tourner (`docker compose up -d` une première fois, étape 7) : le contrôle de santé passe par Caddy.

Cache : Caddy sert les fichiers nommés par leur empreinte (`/assets/*`) avec un cache définitif, et fait toujours revalider la coquille (`index.html`) et le service worker ; un fichier d'une version disparue répond 404, sans mise en cache.

En-têtes de sécurité : Caddy ajoute aux deux clients une politique de contenu (`Content-Security-Policy`) qui n'admet que les fichiers du domaine, l'API de jeu et `supabase.<domaine>` — la variable `VITE_SUPABASE_URL` doit donc valoir exactement `https://supabase.<domaine>`, sinon le navigateur bloque les appels à Supabase. Le script de thème en ligne du client joueur est admis par son empreinte, écrite dans le `Caddyfile` : si `apps/web/index.html` change ce script, `infra/test-static.sh` échoue et affiche l'empreinte à y reporter. Cloudflare (étape 11) ne doit ni réécrire les pages ni y injecter de script, qui serait bloqué.

Retour arrière manuel : relancer, depuis l'interface de GitHub, l'exécution du flux `deploy` d'un commit antérieur ; ou, sur le serveur, `bash /opt/oikos/oikos/infra/deploy.sh <empreinte du commit précédent>`. Les migrations de ce commit sont déjà enregistrées : aucune n'est rejouée ni annulée. Un commit antérieur au ticket 218 porte l'ancien `deploy.sh`, qui rejoue toute sa suite : sur le serveur, préférer la seconde forme.

Limites : le script n'a encore tourné sur aucun serveur réel ; le contrôle de santé ne porte que sur l'API (une réplique suffit à le valider, le moteur n'est pas contrôlé) ; un retour arrière automatique ne concerne que les conteneurs (les clients statiques, remplacés en dernier, ne le sont qu'après un contrôle de santé réussi) ; la production (étiquette de version, validation humaine) aura son propre flux.

## Réglages de la base

- **Pas de compilation à la volée pour les clients** (ticket 155, migration 40) : `alter role authenticated set jit = off` et de même pour `anon`. Les règles par ligne du grand livre donnent à la lecture des flux de trésorerie un coût estimé qui déclencherait la compilation, pour un surcoût de plusieurs fois la lecture (mesure : `BENCH_DATABASE_URL=… pnpm --filter @oikos/db bench:cash-flows`, dans une base neuve dédiée, migrations et seed appliqués ; jamais la base de développement partagée). Le rôle de service (API, moteur) garde le réglage de la base. L'image Postgres de Supabase n'embarque pas toujours la compilation à la volée (`select pg_jit_available()`) : le réglage est alors sans effet, et reste le bon si l'on change d'image ou d'hébergeur.
- **PostgREST ne lit pas ces réglages à chaque requête** : il lit les réglages des rôles à son démarrage, puis à chaque rechargement de son cache de schéma ou de sa configuration selon sa version, et les applique aux requêtes. Le déclencheur d'événements de Supabase qui provoque ce rechargement ne réagit pas à `alter role`, et `deploy.sh` ne redémarre pas le conteneur `rest` : la migration 40 se termine donc par `notify pgrst, 'reload schema'` et `notify pgrst, 'reload config'`. Toute migration future qui change un réglage de rôle doit faire de même.
- **Vérification, par PostgREST lui-même** (le catalogue, `select rolname, rolconfig from pg_roles where rolname in ('anon', 'authenticated')`, ne dit que ce que PostgREST appliquera après rechargement) : la fonction `public.client_jit()`, exécutable par `anon` et `authenticated` seulement (ni `service_role` ni `oikos_service`), rend le réglage de la requête en cours. Après chaque déploiement qui touche aux réglages des rôles :

  ```sh
  curl -s "$SUPABASE_URL/rest/v1/rpc/client_jit" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}'
  # attendu : "off" (même vérification avec le jeton d'un joueur dans Authorization: Bearer)
  ```

  Si la réponse est `"on"`, sur le serveur, avec les fichiers compose de `deploy.sh` (ou redémarrer le conteneur `rest`), puis vérifier à nouveau :

  ```sh
  docker compose -f /opt/oikos/supabase/docker/docker-compose.yml -f /opt/oikos/oikos/infra/docker-compose.oikos.yml \
    exec db psql -U postgres -c "notify pgrst, 'reload schema'" -c "notify pgrst, 'reload config'"
  ```

## État et limites

- La surcouche est validée par `docker compose config` contre le compose officiel de Supabase, mais n'a pas encore tourné sur un serveur réel : la première installation en préproduction fait foi et corrigera ce document.
- L'intégration fine de pgBackRest dans le conteneur Postgres de Supabase reste à faire lors de l'installation.
- Olympe est servi comme site statique, son API relayée sous son domaine ; la restriction d'accès par VPN ou liste d'adresses (spécification 15.4) est à poser avant d'y brancher la moindre donnée (ticket 10).
- Supervision (Prometheus, Grafana, Loki, Uptime Kuma, GlitchTip) : ticket ultérieur.
