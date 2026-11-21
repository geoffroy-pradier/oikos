# 17. Feuille de route

Le lancement de la version 1.0 est visé en 32 semaines, en cinq phases dont chacune livre un jeu jouable et se clôt sur un critère mesurable. Les durées supposent un fondateur à temps partiel pilotant des agents ; elles sont à réviser après la phase 0.

> Schéma « feuille de route · 5 phases, 5 jalons » : voir le document source (non exporté en Markdown).

Chaque losange est une porte : la phase suivante ne démarre que si le critère est atteint.
Exception décidée par le propriétaire le 15 novembre 2026 : le serveur de préproduction de la phase 0 est reporté, et le développement des phases suivantes continue en local jusqu'à une version à mettre en ligne.

## Contenu par phase

- **Phase 0, fondations (2 semaines).** Dépôt, intégration continue, serveur de préproduction, authentification, grand livre, cadre de configuration, système de design.
- **Phase 1, prototype « une cité » (6 semaines).** Maison, domaines et ateliers, 15 biens, agora à carnet d'ordres, demande des PNJ, ticks, comptes, interface mobile, back-office v0.
- **Phase 2, alpha fermée (8 semaines).** 4 cités, transport maritime, immobilier, personnel et intendants, archonte, taxes et décrets, discussion, Charis et grâces, Pythie et chronique, modération v1, simulateur.
- **Phase 3, bêta ouverte (10 semaines).** 12 cités, 60 biens, banques et prêts, ligues et conflits, liturgies, ostracisme, Hybris, marchands PNJ négociateurs, Jeux, boutique, anglais, notifications push.
- **Phase 4, lancement 1.0 (6 semaines).** Accueil des nouveaux joueurs, finitions, tests de charge, support, versions pour les magasins d'applications, communication.
- **Après le lancement.** Sociétés et parts, tribunaux, colonies sur de nouvelles îles, Hadès et Hestia, mondes à règles spéciales.

## Critères de sortie

Le schéma des jalons n'est pas exporté en Markdown ; les critères ci-dessous en sont repris.
Le propriétaire a délégué aux agents, le 15 novembre 2026, leur emploi pour piloter les phases et les décisions d'équilibrage de la phase 1 (5.5).

- **Phase 0** : déploiement automatique en place.
  Le flux existe (`infra/deploy.sh`, `.github/workflows/deploy.yml`), mais il n'a tourné sur aucun serveur : le serveur de préproduction (#33) est reporté par décision du propriétaire, qui préfère développer et tester en local jusqu'à une version à mettre en ligne.
- **Phase 1** : dans une cité, un joueur peut, sur téléphone, acquérir des sites, produire et transformer les 15 biens, les vendre et les acheter à l'agora, et lire des comptes exacts ; une simulation de 30 jours avec maisons actives tient l'inflation mensuelle entre 0 % et 3 % ; le tableau de bord économique d'Olympe suit chaque robinet et chaque puits.

Vérification du critère de la phase 1, le 15 novembre 2026 :

- Parcours du joueur sur téléphone : tests de bout en bout de `apps/web` à 360 px (acquisition et changement de production d'un site, récolte d'une matière première et d'un atelier, ventes et achats à l'agora, comptes et compte de résultat).
- Comptes exacts : bilan et compte de résultat rapprochés du grand livre (tickets #73 et #155).
- Simulation de 30 jours : banc d'équilibrage du ticket #78, borné (coût du panier de 0 à 2 % sur vingt jours, besoins vitaux couverts à 98 % au moins) ; calibrage décrit en 5.5.
- Tableau de bord d'Olympe : masse monétaire, robinets et puits par jour de jeu, indice des prix et inflation (tickets #76, #181, #184).

Le critère est atteint par le code.
Il reste à l'éprouver avec des joueurs réels, ce qui attend le serveur.
La phase 1 se ferme quand ses derniers tickets de suivi le sont ; le passage en phase 2 ne demande pas de serveur (exception ci-dessus).

- **Phase 2** : critère retenu par délégation du propriétaire et écrit en tête de `docs/tickets/phase-2.md` (parcours de l'alpha IA coupée, économie à quatre cités, pilotage, communauté, IA).

Vérification du critère de la phase 2, le 19 novembre 2026 :

- Parcours de l'alpha : `apps/web/e2e/alpha-journey.spec.ts`, à 360 px, deux joueurs dans deux cités (Kallistè et Elaia), les trois usages d'IA coupés et aucun appel journalisé (#671).
  Il enchaîne chaque étape du point 1 : relance d'un site et salaires payés (#685), achat d'un navire, voyage et vente à l'agora de l'autre cité (#673), achat, location et rénovation d'un logement, intendant par formulaire, candidature et vote à l'élection, vote d'un décret, canal de cité et message privé, signalement, offrande, grâce, Pythie et chronique.
  Le parcours pose en base ce qui demanderait des jours de jeu (fonds, temps écoulé, usure, arrêt, citoyenneté, calendrier de l'élection, chronique et oracle du jour).
  La production des chroniques et des oracles de repli, IA coupée, est vérifiée par les tests d'intégration du moteur (#270, #271).
  Le clavier est vérifié écran par écran par les autres tests de bout en bout (`city-assembly`, `temple`, `city-chronicle`, `first-slice`, `messages`), à 360 px et 1 440 px ; la proposition d'un décret par l'archonte l'est par `city-assembly`.
- Économie à quatre cités : banc `apps/api/src/balance-world.bench.ts` (#281 à #283), job `balance` de `ci`, 10 jours de mise en route et 30 mesurés.
  Il tient dans chaque cité le coût du panier de 0 à 2 %, les besoins vitaux couverts à 98 % au moins et une population qui ne baisse pas ; la masse monétaire croît de moins de 200 % et la création nette des dix derniers jours ne dépasse pas 110 % de celle des dix premiers (5.5).
  La marge des ateliers reste entre la moitié et le double de la médiane des matières premières (#285).
  Il joue la configuration initiale calibrée par #283 et #668, à quatre paramètres de scénario près, écrits dans `apps/api/src/balance/world.ts` : population divisée par huit, dotation de départ multipliée par cinq (15 000 oboles), prix des logements divisés par cinq et 2 000 oboles de fonds de roulement par armateur (5.5).
  La borne de −5 % à +25 % de la masse monétaire passait en phase 3, avec les liturgies : le banc à douze cités la tient depuis #721 (5.5).
- Pilotage : le tableau de bord d'Olympe porte chaque robinet et chaque puits du catalogue des comptes système, un test le compare au catalogue de la base et nomme ceux de la phase 2 (#670).
  Le simulateur (`pnpm --filter @oikos/api simulate`, #284) compare sur 30 jours une configuration candidate à la configuration de référence : inflation, masse monétaire, robinets et puits, couverture des besoins, population et marges par filière ; son module dans Olympe attend le serveur.
- Communauté : chaque étape d'un signalement est vérifiée contre la base, signalement, file d'Olympe, masquage, classement, sanction graduée, double validation d'une exclusion, appel et décision (#275 à #277), et l'écran de modération l'est au clavier.
  L'API refuse la discussion à un joueur réduit au silence et toute commande de jeu, sauf l'appel, à un joueur suspendu.
- IA : chaque usage (oracle, chronique, consigne d'intendant) a son repli, testé IA coupée ; celui de la consigne est le formulaire de règles (#268, #270, #271, #280).
  Le plafond mensuel se déduit du budget par joueur actif et par mois, au plus 0,10 €, et du nombre de joueurs actifs attendu ; un usage qui l'atteint est coupé jusqu'au mois suivant, ce que vérifie un test sur le fournisseur factice (#268).

Le critère est atteint par le code.
Il reste à l'éprouver avec des joueurs réels, ce qui attend le serveur (#33), comme le fournisseur d'IA réel (#269).

## Ce qui est volontairement hors de la 1.0

Bourse des sociétés, tribunaux de joueurs, application native distincte, 3D, combat. Chacun de ces sujets doublerait un chantier ; ils attendent que l'économie de base soit stable.
