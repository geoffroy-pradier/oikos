# Infrastructure OIKOS

Socle de déploiement décrit dans `docs/specs/14-infrastructure.md`. Ce dossier ne contient **aucun secret** :
toutes les valeurs sensibles vivent dans le fichier `.env` du serveur, créé et rempli par un humain.

| Fichier | Rôle |
| --- | --- |
| `docker-compose.oikos.yml` | Surcouche au compose officiel de Supabase : désactive les services inutiles, ajoute API, moteur et Caddy |
| `Caddyfile` | HTTPS, fichiers statiques du client et du back-office, proxy vers l'API et Supabase |
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

## État et limites

- La surcouche est validée par `docker compose config` contre le compose officiel de Supabase, mais n'a pas encore tourné sur un serveur réel : la première installation en préproduction fait foi et corrigera ce document.
- Les images `oikos-api` et `oikos-engine` seront publiées par le déploiement automatique (critère de sortie de la phase 0).
- L'intégration fine de pgBackRest dans le conteneur Postgres de Supabase reste à faire lors de l'installation.
- Olympe est servi comme simple site statique ; la restriction d'accès par VPN ou liste d'adresses (spécification 15.4) est à poser avant d'y brancher la moindre donnée (ticket 10).
- Supervision (Prometheus, Grafana, Loki, Uptime Kuma, GlitchTip) : ticket ultérieur.
