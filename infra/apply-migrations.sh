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
# Base déjà déployée sans cette table (migrations rejouées par l'ancien `deploy.sh`) : elle est reconnue à
# ce qu'aucune migration n'y est enregistrée alors que le schéma `game` existe. Les migrations de la
# version précédente, nommées une par ligne dans <liste>, sont alors enregistrées sans être rejouées ;
# sans <liste>, le script s'arrête sans rien modifier.
#
# Deux exécutions simultanées sur la même base appliquent chaque migration une fois : chaque transaction
# prend un verrou consultatif, puis vérifie de nouveau l'enregistrement avant d'appliquer.
set -euo pipefail
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

files=()
for file in "$dir"/*.sql; do
  [ -e "$file" ] || continue
  # Même convention que la CLI Supabase : <version>_<nom>.sql.
  [[ "$(basename "$file")" =~ ^([0-9]+)_([A-Za-z0-9_-]+)\.sql$ ]] || {
    echo "nom de migration invalide : $(basename "$file")" >&2
    exit 2
  }
  # Deux fichiers de même version : le second serait pris pour déjà appliqué.
  [[ " ${versions:-} " != *" ${BASH_REMATCH[1]} "* ]] || {
    echo "version de migration en double : ${BASH_REMATCH[1]}" >&2
    exit 2
  }
  versions="${versions:-} ${BASH_REMATCH[1]}"
  files+=("$file")
done
[ ${#files[@]} -gt 0 ] || { echo "aucune migration dans $dir" >&2; exit 2; }

version_of() { basename "$1" | cut -d_ -f1; }
name_of() { basename "$1" .sql | cut -d_ -f2-; }

# Écrit l'insertion de l'enregistrement d'une migration, son texte entre guillemets dollar.
record() {
  local tag
  tag="oikos_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  if grep -qF "\$$tag\$" "$1"; then record "$1"; return; fi
  printf "insert into %s (version, name, statements) values ('%s', '%s', array[\$%s\$" \
    "$table" "$(version_of "$1")" "$(name_of "$1")" "$tag"
  cat "$1"
  printf '$%s$]);\n' "$tag"
}

# 1. Table des migrations, et reconnaissance d'une base déjà déployée sans elle.
work="$(mktemp)"
trap 'rm -f "$work"' EXIT
{
  echo "set local client_min_messages = warning;"
  echo "$lock"
  echo "create schema if not exists supabase_migrations;"
  echo "create table if not exists $table (version text not null primary key);"
  echo "alter table $table add column if not exists statements text[];"
  echo "alter table $table add column if not exists name text;"
  echo "select not exists (select 1 from $table)"
  echo "  and exists (select 1 from pg_namespace where nspname = 'game') as oikos_adopt \\gset"
  echo "\\if :oikos_adopt"
  if [ -z "$adopt" ]; then
    echo "do \$\$ begin raise exception 'base déjà déployée sans table des migrations : liste --adopt requise'; end \$\$;"
  else
    count=0
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] || continue
      [[ "$line" =~ ^[0-9]+_[A-Za-z0-9_-]+\.sql$ ]] && [ -f "$dir/$line" ] || { echo "migration adoptée absente du dossier : $line" >&2; exit 2; }
      record "$dir/$line"
      count=$((count + 1))
    done < "$adopt"
    echo "\\echo '   base déjà déployée : $count migrations enregistrées sans être rejouées'"
  fi
  echo "\\endif"
} > "$work"
if ! "${psql_cmd[@]}" --single-transaction -f - < "$work"; then
  echo "!! table des migrations : échec, rien n'est modifié" >&2
  exit 1
fi

# 2. Migrations à appliquer.
applied="$(echo "select version from $table;" | "${psql_cmd[@]}" -At -f -)"
pending=0
for file in "${files[@]}"; do
  version="$(version_of "$file")"
  grep -qxF "$version" <<< "$applied" && continue
  pending=$((pending + 1))
  if ! {
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
  } | "${psql_cmd[@]}" --single-transaction -f -; then
    echo "!! échec de $(basename "$file") : non enregistrée, les migrations suivantes ne sont pas appliquées" >&2
    exit 1
  fi
done
echo "   $pending migrations nouvelles, $((${#files[@]} - pending)) déjà enregistrées"
