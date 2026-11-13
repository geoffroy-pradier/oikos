#!/usr/bin/env bash
# Contrôle de bout en bout des clients statiques, lancé par `ci` : construction, image de transport,
# installation comme sur le serveur (deux fois : première mise en place, puis mise à jour), et service
# par Caddy avec le Caddyfile du dépôt.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
caddy=""
cleanup() {
  [ -z "$caddy" ] || docker rm -f "$caddy" > /dev/null
  rm -rf "$work"
}
trap cleanup EXIT

bash "$repo/infra/docker/static.sh" "$work/context"
docker build -q -t oikos-static:ci "$work/context"

bash "$repo/infra/install-static.sh" oikos-static:ci "$work/static"
echo stale > "$work/static/web/stale.txt"
bash "$repo/infra/install-static.sh" oikos-static:ci "$work/static"
[ ! -e "$work/static/web/stale.txt" ] || { echo "un fichier de l'ancienne version a survécu" >&2; exit 1; }
[ -z "$(find "$work/static" -maxdepth 1 \( -name '*.next' -o -name '*.previous' \))" ] || { echo "dossier temporaire laissé" >&2; exit 1; }

# Caddy en HTTP simple sur un port local : mêmes règles que la production, sans certificat.
sed -e 's/^{\$OIKOS_DOMAIN} {/http:\/\/web.localhost:8080 {/' \
    -e 's/^olympe\.{\$OIKOS_DOMAIN} {/http:\/\/olympe.localhost:8080 {/' \
    -e 's/^supabase\.{\$OIKOS_DOMAIN} {/http:\/\/supabase.localhost:8080 {/' \
    "$repo/infra/Caddyfile" > "$work/Caddyfile"
caddy="$(docker run -d -p 127.0.0.1:18080:8080 -e OIKOS_ACME_EMAIL=ci@example.test \
  -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$work/static:/srv:ro" caddy:2.10-alpine)"

fetch() { curl -sS -o "$work/body" -D "$work/headers" -w '%{http_code}' -H "Host: $1" "http://127.0.0.1:18080$2"; }
expect() { # hôte, chemin, code attendu, motif d'en-tête attendu (facultatif)
  local code
  code="$(fetch "$1" "$2")"
  [ "$code" = "$3" ] || { echo "$1$2 : code $code, attendu $3" >&2; exit 1; }
  [ -z "${4:-}" ] || grep -qi "$4" "$work/headers" || { echo "$1$2 : en-tête « $4 » absent" >&2; exit 1; }
}
for _ in $(seq 1 30); do
  if [ "$(fetch web.localhost / 2> /dev/null || true)" = 200 ]; then break; fi
  sleep 1
done

for host in web.localhost olympe.localhost; do
  expect "$host" / 200 'cache-control: no-cache'
  # Toute adresse de l'application rend la coquille.
  expect "$host" /une/page/quelconque 200 'cache-control: no-cache'
  asset="$(grep -o '/assets/[^"]*\.js' "$work/body" | head -n 1)"
  [ -n "$asset" ] || { echo "$host : aucun script dans la coquille" >&2; exit 1; }
  expect "$host" "$asset" 200 'cache-control: public, max-age=31536000, immutable'
  # Un fichier d'une ancienne version répond 404, pas la coquille.
  expect "$host" /assets/absent-0000.js 404
  # L'API est relayée (ici vers un service absent : 502), jamais servie comme un fichier.
  expect "$host" /api/health 502
done
# Les deux domaines servent deux applications distinctes.
fetch web.localhost / > /dev/null && cp "$work/body" "$work/web.html"
fetch olympe.localhost / > /dev/null
! cmp -s "$work/web.html" "$work/body" || { echo "Olympe sert le client joueur" >&2; exit 1; }
expect supabase.localhost /studio 404
echo "Clients statiques : construction, installation et service vérifiés."
