# OIKOS — règles pour les agents

OIKOS est un jeu de gestion multijoueur persistant (web + mobile) dans une Grèce mythologique.
Ce fichier est lu au début de chaque session. Il prime sur toute habitude par défaut.

## Sources de vérité

- `docs/specs/` : une spécification par système. Elle fait foi sur le comportement attendu.
- `docs/glossary.md` : vocabulaire du jeu. Code en anglais, interface en français et en anglais.
- `docs/adr/` : décisions d'architecture. Toute décision structurante nouvelle y ajoute un fichier.
- `docs/tickets/` et les tickets GitHub : le travail à faire, dans l'ordre.

Si une spécification est ambiguë ou contradictoire, choisis l'option la plus simple compatible avec
`docs/specs/01-vision.md`, note la décision dans la demande de fusion et mets la spécification à jour.

## Architecture (résumé de docs/specs/11-architecture.md)

- Monorepo pnpm + Turborepo, tout en TypeScript strict.
- `apps/web` (client joueur PWA), `apps/admin` (back-office), `apps/api` (commandes), `apps/engine` (ticks, tâches, IA), `apps/site`.
- `packages/sim` (simulation pure, sans entrée-sortie), `contracts` (schémas Zod), `config`, `ui`, `db`, `ai`.
- Le client **lit** par Supabase (vues + règles par ligne) et **écrit uniquement** par l'API de jeu.
- Supabase auto-hébergé : Postgres, Auth, Realtime, Storage. Pas de logique métier dans des fonctions Edge.

## Règles non négociables

1. Aucune constante d'équilibrage dans le code : tout passe par `packages/config`.
2. Toute monnaie et tout stock passent par les journaux en partie double. Montants en entiers (oboles).
3. Aucune table du schéma `game` n'est accessible en écriture depuis le client.
4. Toute table exposée a des règles de sécurité par ligne, testées en pgTAP.
5. Une commande = un schéma d'entrée, un schéma de sortie, une clé d'idempotence, une transaction, des événements de domaine.
6. Un modèle de langage ne décide jamais d'un chiffre et n'écrit jamais en base. Chaque usage d'IA a un texte ou un formulaire de repli, développé en même temps que lui : le jeu doit rester entièrement jouable IA coupée.
7. Aucun texte d'interface en dur : fichiers de traduction `fr` et `en`.
8. Aucun secret dans le dépôt. Variables d'environnement documentées dans `.env.example`.
9. Migrations SQL versionnées, rejouables, compatibles avec la version précédente du code.

## Boucle de travail autonome

Tu travailles sans attendre de validation humaine, dans cet ordre :

1. Prends le ticket GitHub ouvert de plus petit numéro qui n'a ni le label `blocked` ni le label `needs-human`, et dont les dépendances sont fermées.
2. Crée une branche `claude/<numéro>-<slug>`.
3. Lis la ou les spécifications liées avant d'écrire du code.
4. Écris les tests en même temps que le code. Les critères d'acceptation du ticket doivent être couverts.
5. Lance en local `pnpm lint`, `pnpm typecheck`, `pnpm test` jusqu'au vert.
6. Ouvre une demande de fusion de moins de 400 lignes modifiées (hors fichiers générés), qui référence le ticket (`Closes #N`). Découpe si c'est plus gros.
7. Attends la fin du contrôle `ci` sur la demande de fusion. Le dépôt n'a pas de protection de branche : c'est toi qui garantis qu'aucune fusion ne part avec un contrôle rouge, en cours ou absent.
8. Si `ci` est vert et que la relecture (section Revue) n'a laissé aucun point ouvert, fusionne toi-même en squash (outil de fusion de la session, ou `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/merge -f merge_method=squash`), puis supprime la branche. Ne pousse jamais directement sur `main`.
   Si `ci` échoue, corrige sur la même branche. Trois échecs de suite sur la même cause : pose le label `blocked`, explique dans le ticket, passe au suivant.
9. Une fois fusionné, passe au ticket suivant.

Quand tous les tickets d'une phase sont fermés, lis `docs/specs/17-feuille-de-route.md`, vérifie le
critère de sortie de la phase, puis rédige les tickets de la phase suivante dans `docs/tickets/` et sur GitHub
(même format : contexte, spécification liée, critères d'acceptation, hors périmètre, dépendances).

## Revue

Toute demande de fusion est relue par une session distincte de celle qui a écrit le code. La relecture
vérifie : respect des règles non négociables, tests réellement pertinents (pas de test vide ou tautologique),
absence de secret, cohérence avec la spécification. Elle commente la demande de fusion ; l'auteur corrige.

Pour toute fusion qui touche à la monnaie, aux stocks, à l'authentification ou aux règles par ligne :
ajoute le label `sensible` et un paragraphe « Risques » dans la description, avec les cas limites testés.

## Répartition entre modèles

La session principale écrit elle-même le code des tickets ordinaires. Deux sous-agents, définis dans
`.claude/agents/` et réglés sur le modèle le plus fort, sont réservés au travail sensible :

- `dev-sensible` écrit le code et les tests de tout ticket (ou partie de ticket) portant le label `sensible` ;
- `relecteur-sensible` relit toute demande de fusion `sensible` avant sa fusion. Tu ne fusionnes que
  s'il ne signale rien de bloquant ; sinon tu fais corriger par `dev-sensible` et tu fais relire à nouveau.

**Période sans le modèle le plus fort.** Tant que les deux sous-agents sont réglés sur `model: opus`
(voir leur en-tête dans `.claude/agents/`), pose le label `a-relire-fable` sur toute demande de fusion
`sensible` que tu fusionnes. Ces fusions seront relues plus tard par une session sur le modèle le plus
fort ; ne retire jamais ce label toi-même.

Ne délègue jamais à ces deux agents un ticket qui n'est pas `sensible`. Si l'un d'eux n'est pas
disponible dans la session, écris-le dans la demande de fusion et pose le label `needs-human` au lieu de
fusionner une fusion `sensible` sans cette relecture.

## Ce que tu ne fais jamais sans un humain

Pose le label `needs-human`, explique ce qu'il faut, et continue sur un autre ticket :

- créer, saisir ou faire tourner un secret, une clé d'API, un moyen de paiement ;
- commander ou configurer un serveur, un nom de domaine, un compte tiers ;
- déployer en production ;
- supprimer des données ou réécrire l'historique Git de `main`.

## Définition de terminé

- Critères d'acceptation couverts par des tests qui passent.
- Lint et types sans erreur.
- Textes externalisés (fr, en).
- Écran utilisable à 360 px de large et au clavier.
- Spécification mise à jour si le comportement a changé.
- Demande de fusion fusionnée, ticket fermé.

## Commandes

Elles existent à partir du ticket 1 :

```
pnpm install
pnpm dev          # lance les applications en local
pnpm lint
pnpm typecheck
pnpm test         # tests unitaires et de propriétés
pnpm test:db      # pgTAP sur Supabase local
pnpm test:e2e     # Playwright
```
