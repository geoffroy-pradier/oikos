#!/usr/bin/env bash
# Démarrage de Supabase local dans un job de `ci` (#900) : `bash infra/ci-supabase-start.sh`.
# Ses ports (54320 à 54329) sont dans la plage éphémère de Linux : le job les réserve dès sa première étape
# (`ip_local_reserved_ports`), mais une connexion ouverte avant, par l'agent du runner, peut encore tenir l'un
# d'eux. Vu sur la PR #901 : 54322 en TIME-WAIT vers 168.63.129.16:80, et Docker refuse alors d'y lier
# Postgres (« address already in use »), deux fois de suite. Une telle connexion s'éteint en 60 s. Avant chaque
# essai, le script attend donc que plus aucune socket n'occupe ces ports (au plus `SUPABASE_PORT_WAIT`, 90 s par
# défaut), puis démarre, en trois essais au plus, en listant ce qui tenait les ports après un échec.
set -uo pipefail

ports='( sport >= :54320 and sport <= :54329 )'
wait_seconds="${SUPABASE_PORT_WAIT:-90}"

held() { sudo ss -Htanp state all "$ports"; }

wait_for_ports() {
  local waited=0
  while [ -n "$(held)" ]; do
    if [ "$waited" -ge "$wait_seconds" ]; then
      echo "::warning::Ports de Supabase encore occupés après ${wait_seconds} s :"
      held
      return 0
    fi
    [ "$waited" -eq 0 ] && { echo "Ports de Supabase occupés, attente :"; held; }
    sleep 1
    waited=$((waited + 1))
  done
  [ "$waited" -eq 0 ] || echo "Ports de Supabase libres après ${waited} s."
}

for attempt in 1 2 3; do
  wait_for_ports
  pnpm db:start:ci && exit 0
  echo "::warning::Supabase n'a pas démarré (essai $attempt sur 3). Sockets sur ses ports :"
  held || true
  pnpm db:stop || true
done
echo "::error::Supabase n'a pas démarré en trois essais."
exit 1
