#!/usr/bin/env bash
# Sauvegarde pgBackRest, lancée par cron sur le serveur : `backup.sh full` (dimanche), `backup.sh diff` (autres jours).
# L'archivage des journaux (restauration à la minute) est continu, indépendamment de ce script.
set -euo pipefail

type="${1:-diff}"
case "$type" in
  full | diff | incr) ;;
  *)
    echo "usage: $0 [full|diff|incr]" >&2
    exit 2
    ;;
esac

: "${PGBACKREST_REPO1_S3_BUCKET:?variable manquante}"
: "${PGBACKREST_REPO1_S3_ENDPOINT:?variable manquante}"
: "${PGBACKREST_REPO1_S3_REGION:?variable manquante}"

pgbackrest --stanza=oikos --type="$type" backup
pgbackrest --stanza=oikos check
pgbackrest --stanza=oikos info
