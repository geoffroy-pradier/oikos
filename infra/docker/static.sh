#!/usr/bin/env bash
# Construit le client joueur et le back-office, et prépare le contexte de leur image de transport.
# Usage : static.sh <dossier de sortie>
# L'adresse de Supabase et sa clé publique sont figées dans les fichiers à la construction : elles
# doivent être celles de l'environnement visé. Ce ne sont pas des secrets (voir `.env.example`).
set -euo pipefail

out="${1:?usage: static.sh <dossier de sortie>}"
: "${VITE_SUPABASE_URL:?VITE_SUPABASE_URL manquante : adresse publique de Supabase pour cet environnement}"
: "${VITE_SUPABASE_PUBLISHABLE_KEY:?VITE_SUPABASE_PUBLISHABLE_KEY manquante : clé publique de Supabase}"

repo="$(cd "$(dirname "$0")/../.." && pwd)"
(cd "$repo" && pnpm --filter @oikos/web --filter @oikos/admin build)

rm -rf "$out"
mkdir -p "$out"
cp -r "$repo/apps/web/dist" "$out/web"
cp -r "$repo/apps/admin/dist" "$out/admin"
cp "$repo/infra/docker/Dockerfile.static" "$out/Dockerfile"

# Garde : une application construite sans l'adresse de Supabase ne démarrerait pas.
for app in web admin; do
  [ -f "$out/$app/index.html" ] || { echo "$app : index.html absent" >&2; exit 1; }
  grep -rqF "$VITE_SUPABASE_URL" "$out/$app" || { echo "$app : adresse de Supabase absente des fichiers" >&2; exit 1; }
done
