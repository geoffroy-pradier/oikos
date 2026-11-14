#!/usr/bin/env bash
# Copie les fichiers statiques d'une image `oikos-static` dans le dossier servi par Caddy.
# Usage : install-static.sh <image> <dossier static>
# Chaque version est copiée dans `releases/<identifiant>/` ; `web` et `admin` sont des liens symboliques
# vers la version courante, remplacés par un renommage atomique : Caddy ne sert jamais un dossier
# à moitié copié ni absent.
set -euo pipefail

image="${1:?usage: install-static.sh <image> <dossier static>}"
target="${2:?usage: install-static.sh <image> <dossier static>}"
apps=(web admin)

container="$(docker create "$image")"
trap 'docker rm -f "$container" > /dev/null' EXIT

release="$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$target/releases/$release"
for app in "${apps[@]}"; do
  docker cp "$container:/$app" "$target/releases/$release/$app"
  [ -f "$target/releases/$release/$app/index.html" ] || { echo "$app : index.html absent de l'image" >&2; exit 1; }
done
# Lisible par Caddy, quel que soit le masque du compte de déploiement.
chmod a+rx "$target" "$target/releases"
chmod -R a+rX "$target/releases/$release"

for app in "${apps[@]}"; do
  # Première installation : le dossier vide créé à la main (README) laisse la place au lien.
  if [ -d "$target/$app" ] && [ ! -L "$target/$app" ]; then
    mv "$target/$app" "$target/releases/$release/$app.replaced"
  fi
  ln -s "releases/$release/$app" "$target/$app.link"
  mv -T "$target/$app.link" "$target/$app"
done

# On garde la version précédente (requêtes en cours, retour rapide) et on retire les plus anciennes,
# ainsi que les restes d'une installation interrompue.
rm -rf "$target/releases/$release"/*.replaced
ls -1 "$target/releases" | sort | head -n -2 | while read -r old; do
  rm -rf "${target:?}/releases/$old"
done
