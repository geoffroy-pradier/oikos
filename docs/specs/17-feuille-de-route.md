# 17. Feuille de route

Le lancement de la version 1.0 est visé en 32 semaines, en cinq phases dont chacune livre un jeu jouable et se clôt sur un critère mesurable. Les durées supposent un fondateur à temps partiel pilotant des agents ; elles sont à réviser après la phase 0.

> Schéma « feuille de route · 5 phases, 5 jalons » : voir le document source (non exporté en Markdown).

Chaque losange est une porte : la phase suivante ne démarre que si le critère est atteint.

## Contenu par phase

- **Phase 0, fondations (2 semaines).** Dépôt, intégration continue, serveur de préproduction, authentification, grand livre, cadre de configuration, système de design.
- **Phase 1, prototype « une cité » (6 semaines).** Maison, domaines et ateliers, 15 biens, agora à carnet d'ordres, demande des PNJ, ticks, comptes, interface mobile, back-office v0.
- **Phase 2, alpha fermée (8 semaines).** 4 cités, transport maritime, immobilier, personnel et intendants, archonte, taxes et décrets, discussion, Charis et grâces, Pythie et chronique, modération v1, simulateur.
- **Phase 3, bêta ouverte (10 semaines).** 12 cités, 60 biens, banques et prêts, ligues et conflits, liturgies, ostracisme, Hybris, marchands PNJ négociateurs, Jeux, boutique, anglais, notifications push.
- **Phase 4, lancement 1.0 (6 semaines).** Accueil des nouveaux joueurs, finitions, tests de charge, support, versions pour les magasins d'applications, communication.
- **Après le lancement.** Sociétés et parts, tribunaux, colonies sur de nouvelles îles, Hadès et Hestia, mondes à règles spéciales.

## Critères de sortie

Le schéma des jalons n'est pas exporté en Markdown ; les critères ci-dessous sont ceux retenus pour piloter les phases.

- **Phase 0** : déploiement automatique en place.
  Le flux existe (`infra/deploy.sh`, `.github/workflows/deploy.yml`), mais il n'a tourné sur aucun serveur : le serveur de préproduction (#33) est reporté par décision du propriétaire, qui préfère développer et tester en local jusqu'à une version à mettre en ligne.
- **Phase 1** : dans une cité, un joueur peut, sur téléphone, acquérir des sites, produire et transformer les 15 biens, les vendre et les acheter à l'agora, et lire des comptes exacts ; une simulation de 30 jours avec maisons actives tient l'inflation mensuelle entre 0 % et 3 % ; le tableau de bord économique d'Olympe suit chaque robinet et chaque puits.

Vérification du critère de la phase 1, le 15 novembre 2026 :

- Parcours du joueur sur téléphone : tests de bout en bout de `apps/web` à 360 px (acquisition et changement de production d'un site, récolte d'une matière première et d'un atelier, ventes et achats à l'agora, comptes et compte de résultat).
- Comptes exacts : bilan et compte de résultat rapprochés du grand livre (tickets #73 et #155).
- Simulation de 30 jours : banc d'équilibrage du ticket #78, borné (coût du panier de 0 à 2 % sur vingt jours, besoins vitaux couverts à 98 % au moins) ; calibrage décrit en 5.5.
- Tableau de bord d'Olympe : masse monétaire, robinets et puits par jour de jeu, indice des prix et inflation (tickets #76, #181, #184).

Le critère est atteint par le code. La phase 1 se ferme quand ses derniers tickets de suivi le sont ; le passage en phase 2 ne demande pas de serveur.

## Ce qui est volontairement hors de la 1.0

Bourse des sociétés, tribunaux de joueurs, application native distincte, 3D, combat. Chacun de ces sujets doublerait un chantier ; ils attendent que l'économie de base soit stable.
