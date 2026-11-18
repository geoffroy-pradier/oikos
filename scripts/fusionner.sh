#!/usr/bin/env bash
# Fusionne en squash une demande de fusion, seulement si elle peut l'être (CLAUDE.md, boucle de travail, étape 8).
# Usage : scripts/fusionner.sh <numéro> <commit de tête attendu>
# Refuse, sans rien fusionner, si :
# - la tête de la demande n'est plus le commit attendu (un commit poussé entre-temps n'a pas été relu) ;
# - la demande n'est pas à jour de main : la suite complète ne retourne pas sur main après une fusion (ADR 0009),
#   le commit fusionné doit donc être celui que le contrôle `ci` de la demande a testé ;
# - le contrôle `ci` n'est pas vert sur ce commit, ou un autre contrôle n'est ni vert ni sauté.
# Le dépôt vaut OIKOS_REPO, sinon geoffroy-pradier/oikos. `gh` doit être authentifié.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage : $0 <numéro> <commit de tête attendu>" >&2
  exit 2
fi
pr=$1
sha=$2
repo=${OIKOS_REPO:-geoffroy-pradier/oikos}

head=$(gh api "repos/$repo/pulls/$pr" --jq .head.sha)
if [ "$head" != "$sha" ]; then
  echo "Refus : la tête de #$pr est $head, pas $sha." >&2
  exit 1
fi

main=$(gh api "repos/$repo/commits/main" --jq .sha)
behind=$(gh api "repos/$repo/compare/$main...$sha" --jq .behind_by)
if [ "$behind" != 0 ]; then
  echo "Refus : #$pr est en retard de $behind commit(s) sur main ; la remettre à jour et attendre son contrôle ci." >&2
  exit 1
fi

checks=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" --jq '[.check_runs[] | {name, conclusion}]')
if ! printf '%s' "$checks" | jq -e '
  any(.[]; .name == "ci" and .conclusion == "success")
  and all(.[]; .conclusion == "success" or .conclusion == "skipped")' > /dev/null; then
  echo "Refus : contrôles de $sha non verts : $(printf '%s' "$checks" | jq -c 'map("\(.name)=\(.conclusion)")')" >&2
  exit 1
fi

gh api -X PUT "repos/$repo/pulls/$pr/merge" -f merge_method=squash -f sha="$sha" --jq '"#'"$pr"' fusionnée : \(.merged)"'
