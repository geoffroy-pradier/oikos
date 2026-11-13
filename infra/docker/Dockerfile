# Image d'exécution d'une application Node d'OIKOS (API de jeu, moteur).
# Le contexte de construction ne contient que le fichier empaqueté par `infra/docker/bundle.mjs` :
# aucune dépendance n'est installée dans l'image, aucun outil de construction n'y figure.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node main.mjs main.mjs.map ./
# Jamais en root.
USER node
CMD ["node", "--enable-source-maps", "main.mjs"]
