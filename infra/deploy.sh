#!/usr/bin/env bash
# Déploiement en préproduction, exécuté SUR le serveur (envoyé par SSH depuis le flux `deploy`).
# Usage : deploy.sh <version>   où <version> est l'étiquette des images (empreinte du commit).
# Prérequis : arborescence /opt/oikos décrite dans infra/README.md.
set -euo pipefail

version="${1:?usage: deploy.sh <version>}"
case "$version" in
  *[!0-9a-f]* | "") echo "version invalide : $version" >&2; exit 2 ;;
esac

root=/opt/oikos
compose=(docker compose -f "$root/supabase/docker/docker-compose.yml" -f "$root/oikos/infra/docker-compose.oikos.yml")
env_file="$root/supabase/docker/.env"
previous="$(grep -E '^OIKOS_VERSION=' "$env_file" | cut -d= -f2- || true)"

echo "== Code et migrations à la version $version"
git -C "$root/oikos" fetch --quiet origin
git -C "$root/oikos" checkout --quiet --detach "$version"

# Les migrations passent avant le basculement : elles restent compatibles avec la version précédente du code.
echo "== Migrations"
for file in "$root/oikos"/packages/db/supabase/migrations/*.sql; do
  name="$(basename "$file")"
  "${compose[@]}" exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < "$file"
  echo "   $name"
done

echo "== Basculement des conteneurs ($previous -> $version)"
sed -i "s/^OIKOS_VERSION=.*/OIKOS_VERSION=$version/" "$env_file"
"${compose[@]}" pull --quiet api engine
"${compose[@]}" up -d api engine

echo "== Contrôle de santé"
for attempt in $(seq 1 30); do
  if "${compose[@]}" exec -T caddy wget -qO- http://api:8787/api/health >/dev/null 2>&1; then
    echo "   API en bonne santé"; exit 0
  fi
  sleep 2
done

# Retour arrière automatique à l'image précédente. Les migrations, compatibles, ne sont pas annulées.
echo "!! API en échec : retour à $previous" >&2
if [ -n "$previous" ]; then
  sed -i "s/^OIKOS_VERSION=.*/OIKOS_VERSION=$previous/" "$env_file"
  "${compose[@]}" up -d api engine
fi
exit 1
