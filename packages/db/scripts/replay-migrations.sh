#!/usr/bin/env bash
# Test de rejeu des migrations (CLAUDE.md, règle 9). `infra/deploy.sh` n'applique que les migrations
# nouvelles (`infra/apply-migrations.sh`) ; ce rejeu reste un filet : sur une base déjà migrée, chacune doit
# passer, et le schéma doit en sortir inchangé. Le script rejoue deux fois toutes les migrations, chaque
# fichier en une transaction, et compare l'empreinte du schéma (`schema-fingerprint.sql`) avant et après.
# `ci` le lance après `db:reset`, puis après les tests d'intégration, sur une base qui contient des données.
#
#   REPLAY_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db:replay
#
# Pas de base par défaut : la base désignée doit être déjà migrée (`pnpm db:reset`), avec le compte
# propriétaire du schéma (`postgres` en local), et elle est modifiée comme par un déploiement.
set -euo pipefail

url="${REPLAY_DATABASE_URL:?REPLAY_DATABASE_URL : base déjà migrée à rejouer, voir packages/db/scripts/replay-migrations.sh}"
db_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export PGOPTIONS='-c client_min_messages=warning'

fingerprint() {
  psql "$url" -X -q -At -v ON_ERROR_STOP=1 -f "$db_dir/scripts/schema-fingerprint.sql" > "$1"
}

fingerprint "$work/before"
for pass in 1 2; do
  for file in "$db_dir"/supabase/migrations/*.sql; do
    if ! psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$file" > /dev/null 2> "$work/error"; then
      echo "rejeu $pass : échec de $(basename "$file")" >&2
      cat "$work/error" >&2
      exit 1
    fi
  done
  echo "rejeu $pass : $(ls "$db_dir"/supabase/migrations/*.sql | wc -l) migrations passées"
done
fingerprint "$work/after"
if ! diff -u "$work/before" "$work/after"; then
  echo "le rejeu des migrations a changé le schéma (différences ci-dessus)" >&2
  exit 1
fi
echo "schéma inchangé après rejeu ($(wc -l < "$work/before") lignes d'empreinte)"
