# 16. Développement par agents IA

Le projet est organisé pour que des agents de code travaillent en parallèle sur des tranches verticales, avec vous comme responsable produit et dernier valideur. Trois choses rendent cela possible : des spécifications dans le dépôt, des contrats typés entre couches et des contrôles automatiques stricts.

## 16.1 Sources de vérité dans le dépôt

| Fichier ou dossier | Contenu |
| --- | --- |
| `AGENTS.md` | Règles communes : conventions, commandes, interdits, définition de terminé |
| `docs/specs/` | Une spécification par système, dérivée de ce document, avec critères d'acceptation |
| `docs/adr/` | Décisions d'architecture datées et motivées |
| `packages/contracts/` | Schémas des commandes et événements : le contrat entre client, API et moteur |
| `packages/config/` | Schémas et valeurs d'équilibrage |
| `packages/db/supabase/migrations/` | État de la base (arborescence imposée par la CLI Supabase) |
| `docs/glossary.md` | Lexique du jeu, pour que tous les agents nomment les choses de la même façon |

## 16.2 Rôles d'agents

| Agent | Mission | Livrables |
| --- | --- | --- |
| Orchestrateur | Découpe les spécifications en tickets, ordonne, suit les dépendances | Tickets GitHub avec critères d'acceptation |
| Architecte | Garde la cohérence technique, rédige les décisions | ADR, contrats |
| Concepteur de jeu | Détaille les règles et les formules de chaque système | Spécifications, tables de configuration |
| Économiste | Simule et règle les valeurs | Rapports de simulation, jeux de paramètres |
| Base de données | Schéma, migrations, règles par ligne | SQL, tests pgTAP |
| Simulation | Cœur pur de simulation | Fonctions testées par propriétés |
| API et moteur | Commandes, tâches, temps réel | Code et tests d'intégration |
| Interface joueur | Écrans, système de design | Composants, tests Playwright |
| Interface back-office | Modules d'Olympe | Idem |
| Narration et contenu | Textes, noms, quêtes, prompts des PNJ | Fichiers de contenu en français et en anglais |
| Qualité | Plans de test, tests de bout en bout et de charge | Rapports, tickets d'anomalie |
| Revue et sécurité | Relit chaque demande de fusion, cherche les failles | Revues ; n'est jamais l'auteur du code relu |
| Exploitation | Infrastructure, intégration continue, sauvegardes | Scripts, tableaux de bord |

## 16.3 Flux de travail

1. L'orchestrateur ouvre un ticket : contexte, spécification liée, critères d'acceptation, fichiers concernés, hors périmètre.
2. Si la tranche touche plusieurs couches, le contrat (schémas de commande et d'événement) est fusionné d'abord.
3. Chaque agent travaille sur sa branche et ouvre une demande de fusion de moins de 400 lignes modifiées.
4. L'intégration continue doit passer : types, lint, tests unitaires, tests de règles par ligne, migrations rejouables, taille du paquet client, tests de bout en bout.
5. L'agent de revue relit ; un humain valide toute fusion qui touche à la monnaie, à la sécurité, aux paiements ou à l'équilibrage.
6. Déploiement automatique en préproduction ; séance de jeu hebdomadaire pour juger le ressenti.

## 16.4 Définition de terminé

- Critères d'acceptation couverts par des tests.
- Aucune constante d'équilibrage dans le code.
- Textes externalisés en français et en anglais.
- Écran utilisable à 360 px de large et au clavier.
- Commande journalisée, idempotente, avec ses erreurs métier documentées.
- Spécification mise à jour si le comportement a changé.

## 16.5 Premiers tickets à ouvrir

- [ ] Initialiser le monorepo, l'intégration continue et `AGENTS.md`
- [ ] Monter Supabase en local et en préproduction, avec proxy et sauvegardes
- [ ] Authentification et création de maison
- [ ] Cadre de configuration versionnée (schémas, chargement, version par tick)
- [ ] Grand livre en partie double et journal des stocks, avec tests de propriétés
- [ ] Squelette de l'API de jeu : commande, idempotence, journal, événements
- [ ] Squelette du moteur : horloge, file de tâches, tick rejouable
- [ ] Système de design et coquille de navigation responsive
- [ ] Première tranche verticale : un champ produit du blé, vendu à l'agora à des PNJ
- [ ] Back-office v0 : connexion, vigie, éditeur de paramètres
