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

# Première installation sur les dossiers vides du README, sous un masque strict, puis deux mises à jour.
(umask 077 && mkdir -p "$work/static/web" "$work/static/admin")
install() { (umask 077 && bash "$repo/infra/install-static.sh" oikos-static:ci "$work/static"); }
install
first="$(readlink "$work/static/web")"
echo stale > "$work/static/web/stale.txt"
sleep 1
install
sleep 1
install
[ -L "$work/static/web" ] && [ -L "$work/static/admin" ] || { echo "web et admin doivent être des liens" >&2; exit 1; }
[ ! -e "$work/static/web/stale.txt" ] || { echo "un fichier de l'ancienne version a survécu" >&2; exit 1; }
[ "$(ls -1 "$work/static/releases" | wc -l)" = 2 ] || { echo "versions conservées : $(ls "$work/static/releases")" >&2; exit 1; }
[ ! -e "$work/static/$first" ] || { echo "la plus ancienne version n'a pas été retirée" >&2; exit 1; }
[ -z "$(find "$work/static" -name '*.link' -o -name '*.replaced')" ] || { echo "reste d'installation" >&2; exit 1; }
# Lisible par un Caddy qui ne serait pas root.
[ "$(stat -c %A "$work/static" | cut -c8,10)" = "rx" ] || { echo "dossier static illisible" >&2; exit 1; }
[ -z "$(find "$work/static/releases" ! -perm -o=r)" ] || { echo "fichiers illisibles" >&2; exit 1; }

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
  # Un fichier d'une ancienne version répond 404, pas la coquille, et cette absence n'est jamais mise en cache.
  expect "$host" /assets/absent-0000.js 404 'cache-control: no-store'
  ! grep -qi 'immutable' "$work/headers" || { echo "$host : 404 mis en cache définitif" >&2; exit 1; }
  # L'API est relayée (ici vers un service absent : 502), jamais servie comme un fichier.
  expect "$host" /api/health 502
done
# Les deux domaines servent deux applications distinctes.
fetch web.localhost / > /dev/null && cp "$work/body" "$work/web.html"
fetch olympe.localhost / > /dev/null
! cmp -s "$work/web.html" "$work/body" || { echo "Olympe sert le client joueur" >&2; exit 1; }
# Service worker du client joueur : toujours revalidé.
expect web.localhost /sw.js 200 'cache-control: no-cache'
# Passerelle Supabase : rien d'autre que les API du client.
for path in / /studio /pg/ /mcp /api/health; do
  expect supabase.localhost "$path" 404
done
expect supabase.localhost /auth/v1/health 502
echo "Clients statiques : construction, installation et service vérifiés."
