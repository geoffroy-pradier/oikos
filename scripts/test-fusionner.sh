#!/usr/bin/env bash
# Teste scripts/fusionner.sh avec un faux `gh`, qui rend des réponses écrites d'avance et note la fusion demandée.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir "$work/bin"
cat > "$work/bin/gh" <<'GH'
#!/usr/bin/env bash
# Faux gh : `gh api [-X METHOD] <chemin> [...] --jq <filtre>` applique le filtre à la réponse écrite d'avance.
method=GET
[ "$2" = -X ] && { method=$3; shift 2; }
path=$2
filter=.
while [ "$#" -gt 0 ]; do [ "$1" = --jq ] && filter=$2; shift; done
case "$method $path" in
  "GET repos/o/r/pulls/7") body="{\"head\":{\"sha\":\"$FAKE_HEAD\"}}" ;;
  "GET repos/o/r/commits/main") body='{"sha":"m1"}' ;;
  "GET repos/o/r/compare/m1..."*) body="{\"behind_by\":$FAKE_BEHIND}" ;;
  "GET repos/o/r/commits/"*"/check-runs?per_page=100") body="{\"check_runs\":$FAKE_CHECKS}" ;;
  "PUT repos/o/r/pulls/7/merge") echo merged >> "$FAKE_LOG"; body='{"merged":true}' ;;
  *) echo "appel inattendu : $method $path" >&2; exit 9 ;;
esac
printf '%s' "$body" | jq -r "$filter"
GH
chmod +x "$work/bin/gh"

green='[{"name":"static","conclusion":"success"},{"name":"e2e","conclusion":"skipped"},{"name":"ci","conclusion":"success"}]'
failures=0

# cas <nom> <code attendu> <fusion attendue : oui|non> <tête> <retard> <contrôles>
cas() {
  local name=$1 want_code=$2 want_merge=$3
  : > "$work/log"
  local code=0
  PATH="$work/bin:$PATH" OIKOS_REPO=o/r FAKE_LOG="$work/log" FAKE_HEAD=$4 FAKE_BEHIND=$5 FAKE_CHECKS=$6 \
    bash "$here/fusionner.sh" 7 abc > /dev/null 2>&1 || code=$?
  local merged=non
  grep -q merged "$work/log" && merged=oui
  if [ "$code" = "$want_code" ] && [ "$merged" = "$want_merge" ]; then
    echo "ok   $name"
  else
    echo "ÉCHEC $name : code $code (attendu $want_code), fusion $merged (attendue $want_merge)"
    failures=$((failures + 1))
  fi
}

cas "à jour, tout vert : fusionnée" 0 oui abc 0 "$green"
cas "tête différente : refusée" 1 non def 0 "$green"
cas "en retard sur main : refusée" 1 non abc 1 "$green"
cas "ci absent : refusée" 1 non abc 0 '[{"name":"static","conclusion":"success"}]'
cas "ci en échec : refusée" 1 non abc 0 '[{"name":"ci","conclusion":"failure"}]'
cas "ci en cours : refusée" 1 non abc 0 '[{"name":"ci","conclusion":null}]'
cas "autre contrôle annulé : refusée" 1 non abc 0 '[{"name":"ci","conclusion":"success"},{"name":"e2e","conclusion":"cancelled"}]'
cas "aucun contrôle : refusée" 1 non abc 0 '[]'

if [ "$(PATH="$work/bin:$PATH" bash "$here/fusionner.sh" 7 > /dev/null 2>&1; echo $?)" != 2 ]; then
  echo "ÉCHEC usage sans commit attendu"
  failures=$((failures + 1))
else
  echo "ok   usage sans commit attendu : refusé"
fi

[ "$failures" = 0 ]
