# Infrastructure OIKOS

Socle de déploiement décrit dans `docs/specs/14-infrastructure.md`. Ce dossier ne contient **aucun secret** :
toutes les valeurs sensibles vivent dans le fichier `.env` du serveur, créé et rempli par un humain.

| Fichier | Rôle |
| --- | --- |
| `docker-compose.oikos.yml` | Surcouche au compose officiel de Supabase : désactive les services inutiles, ajoute API, moteur et Caddy |
| `Caddyfile` | HTTPS, fichiers statiques du client et du back-office, proxy vers l'API et Supabase |
| `docker/static.sh`, `docker/Dockerfile.static` | Construction du client joueur et du back-office, image de transport `oikos-static` |
| `install-static.sh` | Sur le serveur : copie les fichiers de l'image dans `static/`, par renommage |
| `test-static.sh` | Contrôle lancé par `ci` : construction, installation, service par Caddy |
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
9. **Sauvegardes** : installer pgBackRest à côté de Postgres avec `backup/pgbackrest.conf`, activer l'archivage (`archive_mode=on`, `archive_command='pgbackrest --stanza=oikos archive-push %p'`), créer la stanza (`pgbackrest --stanza=oikos stanza-create`), puis planifier `backup/backup.sh full` le dimanche et `backup/backup.sh diff` les autres jours. Tester une restauration chaque mois sur la préproduction.
10. **Accès d'administration** : Studio et les outils de supervision ne sont joignables que par VPN (WireGuard ou Tailscale) ; aucun n'est relayé par le `Caddyfile`.
11. 👤 **Cloudflare** en façade (cache, pare-feu applicatif), une fois le domaine vérifié.

## Déploiement automatique

Le flux `.github/workflows/deploy.yml` s'exécute à chaque fusion sur `main`.

1. **Images** : l'API et le moteur sont empaquetés en un fichier chacun (`infra/docker/bundle.mjs`), mis dans une image `node:22-alpine` sans dépendance ni outil de construction (`infra/docker/Dockerfile`, utilisateur non root), puis publiés sur `ghcr.io/<propriétaire>/oikos-api` et `oikos-engine` avec l'empreinte du commit et l'étiquette `main`. Le jeton fourni par GitHub Actions suffit.
2. **Clients statiques** (tâche `static`) : le client joueur et le back-office sont construits (`infra/docker/static.sh`) et publiés dans l'image de transport `ghcr.io/<propriétaire>/oikos-static`. L'adresse publique de Supabase et sa clé publique sont figées dans les fichiers à la construction : la tâche ne publie rien tant que les variables de dépôt `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` n'existent pas.
3. **Déploiement** (tâche `deploy`, inactive par défaut) : `infra/deploy.sh` est copié sur le serveur puis exécuté. Il tire les images de la version, applique les migrations (une transaction par fichier), démarre l'API — et le moteur si son image existe — sur la nouvelle version, puis interroge `/api/health`. Une fois l'API en bonne santé, `infra/install-static.sh` remplace `static/web` et `static/admin` par les fichiers de la même version (un renommage par application ; sans image `oikos-static` pour cette version, les clients restent tels quels). Le fichier `.env` n'est modifié qu'en cas de succès : au moindre échec, les conteneurs sont relancés sur la version qu'il contient et la tâche est rouge. Les migrations, compatibles avec la version précédente du code, ne sont pas annulées.

Pour l'activer, un humain doit, une fois le serveur prêt :

- créer les secrets de dépôt `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` ;
- créer les variables de dépôt `VITE_SUPABASE_URL` (`https://supabase.<domaine>`) et `VITE_SUPABASE_PUBLISHABLE_KEY` (clé publique « anon » de l'instance : publique par nature, ce n'est pas un secret) ;
- dans le `.env` de Supabase : ajouter `https://olympe.<domaine>` à `ADDITIONAL_REDIRECT_URLS` (sinon le lien de connexion du back-office ramène sur le client joueur) et activer le second facteur TOTP de Supabase Auth, exigé par le back-office (variables `GOTRUE_MFA_TOTP_ENROLL_ENABLED` et `GOTRUE_MFA_TOTP_VERIFY_ENABLED` du service `auth` ; à confirmer sur la version épinglée lors de l'installation) ;
- créer la variable de dépôt `DEPLOY_ENABLED` avec la valeur `true`, et protéger l'environnement GitHub `preproduction` s'il doit exiger une approbation ;
- sur le serveur : l'utilisateur de déploiement doit pouvoir lancer `docker compose`, écrire dans `/opt/oikos/oikos` (clone Git) et dans `/opt/oikos/supabase/docker/.env`, et lire les images du registre (`docker login ghcr.io` avec un jeton en lecture seule si le dépôt est privé). Attention : l'accès à Docker équivaut à un accès root, et ce `.env` contient tous les secrets du serveur ; ce compte doit être réservé au déploiement ;
- Caddy et la base doivent déjà tourner (`docker compose up -d` une première fois, étape 7) : le contrôle de santé passe par Caddy.

Cache : Caddy sert les fichiers nommés par leur empreinte (`/assets/*`) avec un cache définitif, et fait toujours revalider la coquille (`index.html`) et le service worker ; un fichier d'une version disparue répond 404.

Retour arrière manuel : relancer, depuis l'interface de GitHub, l'exécution du flux `deploy` d'un commit antérieur ; ou, sur le serveur, `bash /opt/oikos/oikos/infra/deploy.sh <empreinte du commit précédent>`.

Limites : le script n'a encore tourné sur aucun serveur réel ; le contrôle de santé ne porte que sur l'API (une réplique suffit à le valider, le moteur n'est pas contrôlé) ; un retour arrière automatique ne concerne que les conteneurs (les clients statiques, remplacés en dernier, ne le sont qu'après un contrôle de santé réussi) ; la production (étiquette de version, validation humaine) aura son propre flux.

## État et limites

- La surcouche est validée par `docker compose config` contre le compose officiel de Supabase, mais n'a pas encore tourné sur un serveur réel : la première installation en préproduction fait foi et corrigera ce document.
- L'intégration fine de pgBackRest dans le conteneur Postgres de Supabase reste à faire lors de l'installation.
- Olympe est servi comme site statique, son API relayée sous son domaine ; la restriction d'accès par VPN ou liste d'adresses (spécification 15.4) est à poser avant d'y brancher la moindre donnée (ticket 10).
- Supervision (Prometheus, Grafana, Loki, Uptime Kuma, GlitchTip) : ticket ultérieur.
