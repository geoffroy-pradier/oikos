#!/usr/bin/env bash
# Copie les fichiers statiques d'une image `oikos-static` dans le dossier servi par Caddy.
# Usage : install-static.sh <image> <dossier static>
# Chaque application est remplacée d'un seul renommage : Caddy ne sert jamais un dossier à moitié copié.
set -euo pipefail

image="${1:?usage: install-static.sh <image> <dossier static>}"
target="${2:?usage: install-static.sh <image> <dossier static>}"

container="$(docker create "$image")"
trap 'docker rm -f "$container" > /dev/null' EXIT

mkdir -p "$target"
for app in web admin; do
  rm -rf "$target/$app.next" "$target/$app.previous"
  docker cp "$container:/$app" "$target/$app.next"
  [ -f "$target/$app.next/index.html" ] || { echo "$app : index.html absent de l'image" >&2; exit 1; }
done
# Lisible par Caddy, quel que soit le masque du compte de déploiement.
chmod -R a+rX "$target/web.next" "$target/admin.next"
for app in web admin; do
  if [ -e "$target/$app" ]; then mv "$target/$app" "$target/$app.previous"; fi
  mv "$target/$app.next" "$target/$app"
  rm -rf "$target/$app.previous"
done
