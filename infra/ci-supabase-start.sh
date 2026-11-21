#!/usr/bin/env bash
# Démarrage de Supabase local dans un job de `ci` ou de `balance-nightly` (#900, #932) : `bash infra/ci-supabase-start.sh`.
# Les ports de Supabase en local (54320 à 54329) sont dans la plage éphémère de Linux (32768 à 60999) : l'agent du
# runner y ouvre des connexions sortantes qui peuvent en prendre un, et Docker refuse alors d'y lier Postgres
# (« address already in use », vu sur #901 et #930). En CI, le script décale donc tous ces ports de 40000
# (14320 à 14329, hors de la plage éphémère : aucune connexion sortante n'y tombe). Il réécrit pour cela, dans la copie
# de travail du job seulement, `packages/db/supabase/config.toml`, qui reste la seule source des ports : rien n'est
# versionné en double et la configuration des développeurs ne change pas. Il écrit ensuite dans `$GITHUB_ENV`
# `SUPABASE_DB_PORT` et `DATABASE_URL`, lues par les tests et par les étapes suivantes du job (le serveur d'API et les
# adresses de Mailpit viennent de `supabase status`).
# Si un de ces ports est tout de même pris (un service du runner), le script le dit avec le processus et échoue
# aussitôt : attendre ne le libérerait pas.
set -uo pipefail

[ "${CI:-}" = "true" ] || { echo "Ce script est réservé à la CI : il réécrit packages/db/supabase/config.toml." >&2; exit 1; }

config=packages/db/supabase/config.toml
ports='( sport >= :14320 and sport <= :14329 )'
db_port=14322

sed -E -i 's/\b5432([0-9])\b/1432\1/g' "$config"
if grep -qE '\b5432[0-9]\b' "$config"; then
  echo "::error::Des ports 5432x restent dans $config."
  exit 1
fi
grep -qE "^port = $db_port\$" "$config" || { echo "::error::Port de Postgres attendu : $db_port dans $config."; exit 1; }

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "SUPABASE_DB_PORT=$db_port"
    echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:$db_port/postgres"
  } >> "$GITHUB_ENV"
fi

# Une socket qui écoute ou qui est établie ; les sockets en TIME-WAIT ne bloquent pas la liaison de Docker.
held() { sudo ss -Htanp state listening "$ports"; sudo ss -Htanp state connected "$ports"; }

# Seul le premier essai vérifie les ports : après un échec, `db:stop` peut laisser un instant un `docker-proxy`.
for attempt in 1 2 3; do
  if [ "$attempt" -eq 1 ] && [ -n "$(held)" ]; then
    echo "::error::Ports de Supabase (14320 à 14329) déjà occupés, sans attente possible :"
    held
    exit 1
  fi
  pnpm db:start:ci && exit 0
  echo "::warning::Supabase n'a pas démarré (essai $attempt sur 3). Sockets sur ses ports :"
  held || true
  pnpm db:stop || true
  sleep 5
done
echo "::error::Supabase n'a pas démarré en trois essais."
exit 1
