#!/usr/bin/env bash
# Applique les migrations absentes de `supabase_migrations.schema_migrations`, la table de la CLI Supabase
# (`supabase db reset`, `supabase db push`) : une transaction par migration, qui contient son enregistrement.
# Une migration en échec n'est pas enregistrée, et les suivantes ne sont pas appliquées.
#
#   apply-migrations.sh [--adopt <liste>] <dossier des migrations> -- <commande psql…>
#
# La commande psql vise la base avec le propriétaire du schéma ; le script lui passe ses requêtes sur
# l'entrée standard (sur le serveur : `docker compose … exec -T db psql -U postgres -d postgres`).
#
# Une migration publiée est immuable : si le texte enregistré par ce script (un seul élément dans
# `statements`) diffère du fichier, le script s'arrête avant d'appliquer quoi que ce soit.
#
# Base déjà déployée sans cette table (migrations rejouées par l'ancien `deploy.sh`) : elle est reconnue à
# ce qu'aucune migration n'y est enregistrée alors que le schéma `game` existe. Les migrations nommées une
# par ligne dans <liste> (celles de la version précédente, inchangées depuis) sont alors enregistrées sans
# être rejouées ; sans <liste>, le script s'arrête sans rien modifier. Hors de ce cas, <liste> est ignorée.
#
# Deux exécutions simultanées sur la même base appliquent chaque migration une fois : chaque transaction
# prend un verrou consultatif, puis vérifie de nouveau l'enregistrement avant d'appliquer.
#
# Chaque transaction est écrite dans un fichier avant d'être envoyée, hors de toute condition : une lecture
# en échec arrête le script (`set -e`) au lieu d'enregistrer un texte vide.
set -euo pipefail
shopt -s nullglob
export LC_ALL=C

usage() {
  echo "usage : apply-migrations.sh [--adopt <liste>] <dossier des migrations> -- <commande psql…>" >&2
  exit 2
}

adopt=""
if [ "${1:-}" = --adopt ]; then
  adopt="${2:-}"
  [ -f "$adopt" ] || usage
  shift 2
fi
dir="${1:-}"
[ -d "$dir" ] && [ "${2:-}" = -- ] && [ $# -gt 2 ] || usage
shift 2
psql_cmd=("$@" -X -q -v ON_ERROR_STOP=1)
table=supabase_migrations.schema_migrations
lock="select pg_advisory_xact_lock(hashtext('oikos.apply-migrations')) as oikos_lock \\gset"
game_exists="exists (select 1 from pg_namespace where nspname = 'game')"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tx="$work/tx"
send() { "${psql_cmd[@]}" --single-transaction -f - < "$tx"; }

files=()
declare -A md5
for file in "$dir"/*.sql; do
  base="$(basename "$file")"
  # Même convention que la CLI Supabase : <version>_<nom>.sql.
  [[ "$base" =~ ^([0-9]+)_([A-Za-z0-9_-]+)\.sql$ ]] || { echo "nom de migration invalide : $base" >&2; exit 2; }
  version="${BASH_REMATCH[1]}"
  [ -f "$file" ] && [ -r "$file" ] || { echo "migration illisible : $base" >&2; exit 2; }
  # Deux fichiers de même version : le second serait pris pour déjà appliqué.
  [ -z "${md5[$version]:-}" ] || { echo "version de migration en double : $version" >&2; exit 2; }
  sum="$(md5sum < "$file")"
  md5[$version]="${sum%% *}"
  files+=("$file")
done
[ ${#files[@]} -gt 0 ] || { echo "aucune migration dans $dir" >&2; exit 2; }

version_of() { basename "$1" | cut -d_ -f1; }
name_of() { basename "$1" .sql | cut -d_ -f2-; }

# Écrit l'insertion de l'enregistrement d'une migration, son texte entre guillemets dollar.
record() {
  local tag found
  while :; do
    tag="oikos_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
    found=0
    grep -qF -- "\$$tag\$" "$1" || found=$?
    [ "$found" -eq 0 ] && continue
    [ "$found" -eq 1 ] || { echo "migration illisible : $1" >&2; exit 1; }
    break
  done
  printf "insert into %s (version, name, statements) values ('%s', '%s', array[\$%s\$" \
    "$table" "$(version_of "$1")" "$(name_of "$1")" "$tag"
  cat "$1"
  printf '$%s$]);\n' "$tag"
}

# 1. Base déjà déployée sans migration enregistrée ?
adopting="$(
  "${psql_cmd[@]}" -At -f - << SQL
select to_regclass('$table') is not null as oikos_has_table \\gset
\\if :oikos_has_table
select not exists (select 1 from $table) and $game_exists;
\\else
select $game_exists;
\\endif
SQL
)"
if [ "$adopting" = t ] && [ -z "$adopt" ]; then
  echo "!! base déjà déployée sans migration enregistrée : liste --adopt requise, rien n'est modifié" >&2
  exit 1
fi

# 2. Table des migrations, et adoption des migrations déjà passées.
{
  echo "set local client_min_messages = warning;"
  echo "$lock"
  echo "create schema if not exists supabase_migrations;"
  echo "create table if not exists $table (version text not null primary key);"
  echo "alter table $table add column if not exists statements text[];"
  echo "alter table $table add column if not exists name text;"
  if [ "$adopting" = t ]; then
    echo "select not exists (select 1 from $table) and $game_exists as oikos_adopt \\gset"
    echo "\\if :oikos_adopt"
    count=0
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] || continue
      [[ "$line" =~ ^[0-9]+_[A-Za-z0-9_-]+\.sql$ ]] && [ -f "$dir/$line" ] \
        || { echo "migration adoptée absente du dossier : $line" >&2; exit 2; }
      record "$dir/$line"
      count=$((count + 1))
    done < "$adopt"
    echo "\\echo '   base déjà déployée : $count migrations enregistrées sans être rejouées'"
    echo "\\endif"
  fi
} > "$tx"
if ! send; then
  echo "!! table des migrations : échec, rien n'est modifié" >&2
  exit 1
fi

# 3. Migrations enregistrées : le texte écrit par ce script doit être celui du fichier.
"${psql_cmd[@]}" -At -F ' ' -f - > "$work/recorded" << SQL
select version, coalesce(case when cardinality(statements) = 1 then md5(statements[1]) end, '-') from $table;
SQL
declare -A recorded
while read -r version sum; do recorded[$version]="$sum"; done < "$work/recorded"
changed=0
for file in "${files[@]}"; do
  version="$(version_of "$file")"
  sum="${recorded[$version]:--}"
  if [ "$sum" != - ] && [ "$sum" != "${md5[$version]}" ]; then
    echo "!! $(basename "$file") a changé depuis son application : corriger par une migration nouvelle" >&2
    changed=1
  fi
done
[ "$changed" -eq 0 ] || exit 1

# 4. Migrations à appliquer, chacune avec son enregistrement.
pending=0
for file in "${files[@]}"; do
  version="$(version_of "$file")"
  [ -z "${recorded[$version]:-}" ] || continue
  pending=$((pending + 1))
  {
    echo "set local client_min_messages = warning;"
    echo "$lock"
    echo "select exists (select 1 from $table where version = '$version') as oikos_applied \\gset"
    echo "\\if :oikos_applied"
    echo "\\echo '   $(basename "$file") (déjà appliquée par une exécution simultanée)'"
    echo "\\else"
    cat "$file"
    # Termine une dernière instruction sans point-virgule avant l'enregistrement.
    printf '\n;\n'
    record "$file"
    echo "\\echo '   $(basename "$file")'"
    echo "\\endif"
  } > "$tx"
  if ! send; then
    echo "!! échec de $(basename "$file") : non enregistrée, les migrations suivantes ne sont pas appliquées" >&2
    exit 1
  fi
done
echo "   $pending migrations nouvelles, $((${#files[@]} - pending)) déjà enregistrées"
