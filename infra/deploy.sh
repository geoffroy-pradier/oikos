#!/usr/bin/env bash
# Déploiement en préproduction, exécuté SUR le serveur, depuis un fichier (jamais lu sur l'entrée standard).
# Usage : deploy.sh <version>   où <version> est l'étiquette des images (empreinte du commit).
# Prérequis : arborescence /opt/oikos décrite dans infra/README.md.
#
# Principe : `.env` n'est modifié qu'une fois la nouvelle version en bonne santé. Jusque-là, la version
# est passée par l'environnement ; au moindre échec, les conteneurs sont relancés sur la version de `.env`.
set -euo pipefail

version="${1:?usage: deploy.sh <version>}"
case "$version" in
  *[!0-9a-f]* | "") echo "version invalide : $version" >&2; exit 2 ;;
esac

root="${OIKOS_ROOT:-/opt/oikos}"
compose=(docker compose -f "$root/supabase/docker/docker-compose.yml" -f "$root/oikos/infra/docker-compose.oikos.yml")
env_file="$root/supabase/docker/.env"

# Un seul déploiement à la fois.
exec 9> "$root/.deploy.lock"
flock -n 9 || { echo "un autre déploiement est en cours" >&2; exit 3; }

previous="$(grep -E '^OIKOS_VERSION=' "$env_file" | cut -d= -f2- || true)"
services=(api)

rollback() {
  echo "!! Échec du déploiement de $version : retour à la version ${previous:-(aucune)}" >&2
  if [ -n "$previous" ]; then
    "${compose[@]}" up -d "${services[@]}" < /dev/null || true
  fi
}
trap rollback ERR

echo "== Images de la version $version"
OIKOS_VERSION="$version" "${compose[@]}" pull --quiet api < /dev/null
# Le moteur n'est déployé que si son image existe pour cette version.
if OIKOS_VERSION="$version" "${compose[@]}" pull --quiet engine < /dev/null 2> /dev/null; then
  services+=(engine)
else
  echo "   pas d'image du moteur pour cette version : seule l'API est déployée"
fi

# Clients statiques : image de transport, publiée seulement si l'environnement a ses variables de construction.
static_image="ghcr.io/geoffroy-pradier/oikos-static:$version"
# « Image absente » et « registre injoignable » ne se confondent pas : seule la première est tolérée.
if manifest="$(docker manifest inspect "$static_image" 2>&1 < /dev/null)"; then
  has_static=true
  docker pull --quiet "$static_image" < /dev/null > /dev/null
elif grep -qiE 'manifest unknown|no such manifest|not found' <<< "$manifest"; then
  has_static=false
  echo "   pas d'image des clients statiques pour cette version : ils ne sont pas mis à jour"
else
  echo "!! Image des clients statiques illisible : $manifest" >&2
  false
fi

echo "== Code et migrations"
git -C "$root/oikos" fetch --quiet origin
git -C "$root/oikos" checkout --quiet --detach "$version"
# Les migrations passent avant le basculement : elles restent compatibles avec la version précédente du code.
# Chaque fichier s'applique en une transaction : un échec ne laisse pas de migration à moitié passée.
for file in "$root/oikos"/packages/db/supabase/migrations/*.sql; do
  "${compose[@]}" exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -q -f - < "$file"
  echo "   $(basename "$file")"
done

echo "== Basculement des conteneurs (${previous:-aucune} -> $version)"
OIKOS_VERSION="$version" "${compose[@]}" up -d "${services[@]}" < /dev/null

echo "== Contrôle de santé"
healthy=false
for _ in $(seq 1 30); do
  if "${compose[@]}" exec -T caddy wget -qO- http://api:8787/api/health < /dev/null > /dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done
if [ "$healthy" != true ]; then
  echo "!! L'API ne répond pas sur /api/health" >&2
  false
fi

# Les clients ne sont remplacés qu'une fois l'API de la même version en bonne santé.
if [ "$has_static" = true ]; then
  echo "== Clients statiques"
  bash "$root/oikos/infra/install-static.sh" "$static_image" "$root/static" < /dev/null
fi

# Le Caddyfile est monté comme fichier : Caddy ne voit ses changements qu'une fois recréé.
if [ -z "$previous" ] || ! git -C "$root/oikos" diff --quiet "$previous" "$version" -- infra/Caddyfile 2> /dev/null; then
  echo "== Caddy (configuration modifiée)"
  "${compose[@]}" up -d --force-recreate caddy < /dev/null
fi

# Succès : la version devient celle de référence.
if grep -qE '^OIKOS_VERSION=' "$env_file"; then
  sed -i "s/^OIKOS_VERSION=.*/OIKOS_VERSION=$version/" "$env_file"
else
  printf 'OIKOS_VERSION=%s\n' "$version" >> "$env_file"
fi
trap - ERR
echo "== Version $version déployée (${services[*]})"
