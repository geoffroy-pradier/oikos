#!/usr/bin/env bash
# Test de rejeu des migrations (CLAUDE.md, règle 9). `infra/deploy.sh` n'applique que les migrations
# nouvelles (`infra/apply-migrations.sh`) ; ce rejeu reste un filet : sur une base déjà migrée, chacune doit
# passer, et le schéma doit en sortir inchangé. Le script rejoue deux fois toutes les migrations, chaque
# fichier en une transaction, et compare l'empreinte du schéma (`schema-fingerprint.sql`) avant et après.
# `ci` le lance après `db:reset` (job `database`), puis après les tests d'intégration de chaque job `integration`,
# sur une base qui contient des données.
#
#   REPLAY_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db:replay
#
# Pas de base par défaut : la base désignée doit être déjà migrée (`pnpm db:reset`), avec le compte
# propriétaire du schéma (`postgres` en local), et elle est modifiée comme par un déploiement.
# REPLAY_MAX_ATTEMPTS (3) et REPLAY_LOCK_TIMEOUT (10s) règlent le nouvel essai face à un verrou concurrent.
set -euo pipefail

url="${REPLAY_DATABASE_URL:?REPLAY_DATABASE_URL : base déjà migrée à rejouer, voir packages/db/scripts/replay-migrations.sh}"
db_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export PGOPTIONS='-c client_min_messages=warning'

fingerprint() {
  psql "$url" -X -q -At -v ON_ERROR_STOP=1 -f "$db_dir/scripts/schema-fingerprint.sql" > "$1"
}

# Les services de Supabase (PostgREST, Realtime, Auth, pg_cron) gardent des sessions sur la base et peuvent
# prendre un verrou sur une table pendant qu'une migration la modifie (`drop policy` demande un verrou
# exclusif) : Postgres tranche alors par un interblocage ou, ici, par `lock_timeout`. Ce n'est pas un défaut
# des migrations : seul ce cas déclenche un nouvel essai du rejeu entier, borné (REPLAY_MAX_ATTEMPTS, 3 par
# défaut). Toute autre erreur échoue tout de suite, et chaque essai rejoue toutes les migrations.
max_attempts="${REPLAY_MAX_ATTEMPTS:-3}"
case "$max_attempts" in
  "" | *[!0-9]*) echo "REPLAY_MAX_ATTEMPTS doit être un entier positif : $max_attempts" >&2; exit 2 ;;
esac
export PGOPTIONS="$PGOPTIONS -c lock_timeout=${REPLAY_LOCK_TIMEOUT:-10s}"

# Code SQL 55P03 (lock_not_available) ou 40P01 (deadlock_detected), lu dans le message verbeux, quelle que
# soit la langue des messages.
lock_failure() {
  grep -Eq ':  (55P03|40P01): ' "$1"
}

# Sessions des autres clients au moment de l'échec, pour identifier la concurrente.
show_sessions() {
  psql "$url" -X -q -At -F ' | ' -c "
    select pid, coalesce(application_name, ''), coalesce(usename, ''), state, coalesce(wait_event, ''),
           'bloquée par ' || coalesce(nullif(array_to_string(pg_blocking_pids(pid), ','), ''), '-'),
           left(regexp_replace(query, '\\s+', ' ', 'g'), 100)
    from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
    order by pid" >&2 || true
}

replay_all() {
  local pass file
  for pass in 1 2; do
    for file in "$db_dir"/supabase/migrations/*.sql; do
      if ! psql "$url" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose --single-transaction -f "$file" > /dev/null 2> "$work/error"; then
        echo "rejeu $pass : échec de $(basename "$file")" >&2
        cat "$work/error" >&2
        return 1
      fi
    done
    echo "rejeu $pass : $(ls "$db_dir"/supabase/migrations/*.sql | wc -l) migrations passées"
  done
}

fingerprint "$work/before"
attempt=1
until replay_all; do
  if ! lock_failure "$work/error" || [ "$attempt" -ge "$max_attempts" ]; then
    lock_failure "$work/error" && echo "verrou toujours tenu après $attempt essais" >&2
    show_sessions
    exit 1
  fi
  echo "verrou tenu par une autre session (essai $attempt sur $max_attempts), nouvel essai du rejeu entier" >&2
  show_sessions
  attempt=$((attempt + 1))
  sleep 3
done
fingerprint "$work/after"
if ! diff -u "$work/before" "$work/after"; then
  echo "le rejeu des migrations a changé le schéma (différences ci-dessus)" >&2
  exit 1
fi
echo "schéma inchangé après rejeu ($(wc -l < "$work/before") lignes d'empreinte)"
