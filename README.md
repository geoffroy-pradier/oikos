# OIKOS

Jeu de gestion multijoueur persistant, jouable sur web et mobile, dans une Grèce mythologique.
Chaque joueur dirige une maison (un *oikos*) : domaines, ateliers, flotte, finance, politique de sa cité
et faveur des dieux.

## Où lire quoi

| Fichier | Contenu |
| --- | --- |
| `CLAUDE.md` | Règles de travail des agents, boucle autonome, définition de terminé |
| `docs/specs/` | Cahier des charges, une spécification par système |
| `docs/glossary.md` | Lexique du jeu |
| `docs/adr/` | Décisions d'architecture |
| `docs/tickets/` | Tickets par phase |

## État

Phase 0 (fondations) : en cours. Voir `docs/tickets/phase-0.md`.

## Démarrer

Node 22 (`.nvmrc`) et pnpm (version épinglée dans `packageManager`, activable par `corepack enable`).

```
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm db:start   # Supabase local (Docker requis)
pnpm db:reset   # rejoue les migrations
pnpm test:db    # pgTAP
pnpm test:integration   # API contre Supabase local
pnpm test:e2e   # Playwright : parcours web complet
```

## Pile technique

TypeScript partout. React + Vite (PWA) côté client, Node.js + Hono pour l'API de jeu, moteur de simulation
séparé, Supabase auto-hébergé (PostgreSQL, Auth, Realtime, Storage). Détail dans `docs/specs/11-architecture.md`.
