#!/usr/bin/env bash
# Test de `infra/apply-migrations.sh` (ticket 218), lancé par `ci` : `pnpm test:db:deploy`.
# Chaque scénario crée sa propre base jetable `oikos_deploy_test_<aléatoire>` sur le serveur désigné, et la
# supprime à la fin ; la base `postgres` n'est jamais modifiée.
#
#   MIGRATIONS_TEST_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db:deploy
set -euo pipefail

admin="${MIGRATIONS_TEST_ADMIN_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
apply_script="$here/apply-migrations.sh"
real_migrations="$here/../packages/db/supabase/migrations"
work="$(mktemp -d)"
dbs=()
cleanup() {
  for db in "${dbs[@]}"; do
    psql "$admin" -X -q -c "drop database if exists $db with (force)" > /dev/null || true
  done
  rm -rf "$work"
}
trap cleanup EXIT
export PGOPTIONS='-c client_min_messages=warning'

fresh_db() {
  local db
  db="oikos_deploy_test_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
  psql "$admin" -X -q -v ON_ERROR_STOP=1 -c "create database $db" > /dev/null
  dbs+=("$db")
  url="${admin%/*}/$db"
}
q() { psql "$url" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
run() { bash "$apply_script" "$@" -- psql "$url" > "$work/out" 2>&1; }
apply() { run "$@" || fail "déploiement en échec"; }
fail() {
  echo "ÉCHEC : $1" >&2
  cat "$work/out" >&2
  exit 1
}
expect() {
  [ "$2" = "$3" ] || fail "$1 (attendu « $3 », obtenu « $2 »)"
  echo "ok - $1"
}
times_applied() { q "select count(*) from public.migration_log where name = '$1'"; }
recorded() { q "select count(*) from supabase_migrations.schema_migrations"; }

# Migrations factices : chacune note son passage dans `migration_log`.
mig="$work/migrations"
mkdir -p "$mig"
touch "$work/out"
cat > "$mig/20260101000001_log.sql" << 'SQL'
create table public.migration_log (name text not null);
create function public.migration_label(t text) returns text language plpgsql as $$
begin return 'migration : ' || t || E'\n'; end $$;
insert into public.migration_log values ('m1')
SQL
add() { printf "insert into public.migration_log values ('%s');\n%s\n" "$2" "${3:-}" > "$mig/$1"; }
add 20260101000002_two.sql m2

echo "# Base neuve, déploiements successifs"
fresh_db
apply "$mig"
expect "base neuve : m1 appliquée une fois" "$(times_applied m1)" 1
expect "base neuve : m2 appliquée une fois" "$(times_applied m2)" 1
expect "base neuve : deux migrations enregistrées" "$(recorded)" 2
expect "enregistrement : nom de la migration" "$(q "select name from supabase_migrations.schema_migrations where version = '20260101000001'")" log
expect "enregistrement : texte exact du fichier" \
  "$(q "select md5(statements[1]) from supabase_migrations.schema_migrations where version = '20260101000001'")" \
  "$(md5sum < "$mig/20260101000001_log.sql" | cut -d' ' -f1)"
apply "$mig"
apply "$mig"
expect "deux déploiements de plus : rien n'est rejoué" "$(q "select count(*) from public.migration_log")" 2
grep -q '0 migrations nouvelles' "$work/out" || fail "le dernier déploiement annonce des migrations appliquées"
expect "deux déploiements de plus : aucun enregistrement nouveau" "$(recorded)" 2

add 20260101000003_three.sql m3
apply "$mig"
expect "migration nouvelle : appliquée une fois" "$(times_applied m3)" 1
expect "migration nouvelle : les anciennes ne sont pas rejouées" "$(times_applied m1)$(times_applied m2)" 11

echo "# Migration en échec"
add 20260101000004_broken.sql m4 'select 1 / 0;'
add 20260101000005_after.sql m5
code=0
run "$mig" || code=$?
expect "migration en échec : le script échoue" "$code" 1
expect "migration en échec : son effet est annulé" "$(times_applied m4)" 0
expect "migration en échec : non enregistrée" "$(q "select count(*) from supabase_migrations.schema_migrations where version = '20260101000004'")" 0
expect "migration en échec : la suivante n'est pas appliquée" "$(times_applied m5)" 0
expect "migration en échec : la suivante n'est pas enregistrée" "$(recorded)" 3
add 20260101000004_broken.sql m4
apply "$mig"
expect "migration corrigée : appliquée une fois, puis la suivante" "$(times_applied m4)$(times_applied m5)" 11

echo "# Exécutions simultanées"
# Une migration enregistrée par une autre exécution après le calcul des migrations à appliquer est sautée.
add 20260101000006_six.sql m6 "insert into supabase_migrations.schema_migrations (version) values ('20260101000007');"
add 20260101000007_seven.sql m7
apply "$mig"
expect "enregistrée entre-temps : non rejouée" "$(times_applied m6)$(times_applied m7)" 10
grep -q '20260101000007_seven.sql (déjà appliquée' "$work/out" || fail "m7 n'est pas annoncée comme déjà appliquée"
for n in 8 9; do add "2026010100000${n}_slow.sql" "m$n" 'select pg_sleep(0.3);'; done
pids=()
for i in 1 2 3; do
  bash "$apply_script" "$mig" -- psql "$url" > "$work/out$i" 2>&1 &
  pids+=($!)
done
for i in 1 2 3; do wait "${pids[$((i - 1))]}" || { cp "$work/out$i" "$work/out"; fail "exécution simultanée $i en échec"; }; done
expect "trois exécutions simultanées : chaque migration appliquée une fois" "$(times_applied m8)$(times_applied m9)" 11
expect "trois exécutions simultanées : enregistrements uniques" "$(recorded)" 9

echo "# Base déjà déployée sans table des migrations"
fresh_db
q "create schema game"
for f in "$mig"/2026010100000[1-3]_*.sql; do psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$f"; done
code=0
run "$mig" || code=$?
expect "sans liste --adopt : le script échoue" "$code" 1
expect "sans liste --adopt : rien n'est créé" "$(q "select count(*) from pg_namespace where nspname = 'supabase_migrations'")" 0
expect "sans liste --adopt : rien n'est appliqué" "$(times_applied m4)" 0
printf '%s\n' 20260101000001_log.sql 20260101000002_two.sql 20260101000099_absent.sql > "$work/adopt"
code=0
run --adopt "$work/adopt" "$mig" || code=$?
expect "liste --adopt nommant un fichier absent : refusée" "$code" 2
ls "$mig" | head -3 > "$work/adopt"
apply --adopt "$work/adopt" "$mig"
expect "adoption : migrations de la version précédente non rejouées" "$(times_applied m1)$(times_applied m2)$(times_applied m3)" 111
expect "adoption : les suivantes appliquées une fois" "$(times_applied m4)$(times_applied m7)$(times_applied m9)" 101
expect "adoption : toutes enregistrées" "$(recorded)" 9
apply --adopt "$work/adopt" "$mig"
expect "adoption : un second déploiement ne rejoue rien" "$(q "select count(*) from public.migration_log")" 8

echo "# Migrations du dépôt, sur une base déjà déployée"
fresh_db
q "create schema game"
ls "$real_migrations" > "$work/adopt"
apply --adopt "$work/adopt" "$real_migrations"
expect "migrations du dépôt : toutes enregistrées" "$(recorded)" "$(wc -l < "$work/adopt")"
expect "migrations du dépôt : aucune rejouée" "$(q "select count(*) from pg_namespace where nspname = 'config'")" 0
expect "migrations du dépôt : texte exact enregistré" \
  "$(q "select string_agg(md5(statements[1]), ' ' order by version) from supabase_migrations.schema_migrations")" \
  "$(for f in "$real_migrations"/*.sql; do md5sum < "$f" | cut -d' ' -f1; done | paste -sd' ')"
