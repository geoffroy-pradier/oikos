# Tickets — phase 1, prototype « une cité »

À traiter dans l'ordre. Contenu de la phase (`docs/specs/17-feuille-de-route.md`) : maison, domaines et ateliers,
15 biens, agora à carnet d'ordres, demande des PNJ, ticks, comptes, interface mobile, back-office v0.

La phase 0 a déjà livré une première tranche : maison, un site de matière première, agora (ventes en attente,
achats à l'arrivée), demande des PNJ, tick, back-office (Vigie, paramètres, journal d'audit). La phase 1 la
complète jusqu'à une cité jouable de bout en bout.

**Critère de sortie proposé** (le schéma de la feuille de route n'est pas exporté ; à confirmer par un humain) :
dans une cité, un joueur peut, sur téléphone, acquérir des sites, produire et transformer les 15 biens, les
vendre et les acheter à l'agora, et lire des comptes exacts ; une simulation de 30 jours avec maisons actives
tient l'inflation mensuelle entre 0 % et 3 % ; le tableau de bord économique d'Olympe suit chaque robinet et
chaque puits.

**État de la phase 0.** Le flux de déploiement est en place mais n'a encore tourné sur aucun serveur : le
ticket « Serveur de préproduction » (#33, `needs-human`) reste ouvert. Les tickets ci-dessous n'en dépendent pas.

Les numéros sont ceux des tickets GitHub (#64 à #78).

---

# 64. Rôle de service non propriétaire et gardes de la base

## Contexte

L'API et le moteur se connectent aujourd'hui avec le rôle propriétaire des tables. Les gardes des journaux, des
stocks et des ordres distinguent une écriture directe d'une écriture faite par un déclencheur
(`pg_trigger_depth`), pas l'auteur du déclencheur : un rôle capable de créer une table temporaire et son propre
déclencheur les franchirait. Avant d'ajouter des commandes, les services doivent tourner avec un rôle qui ne
possède rien.

## Spécification liée

`docs/specs/12-modele-donnees.md`, `docs/specs/13-moteur-anti-triche.md`, `docs/specs/14-infrastructure.md`

## Critères d'acceptation

- [ ] Migration : rôle `oikos_service` sans propriété, sans `TEMPORARY`, sans `CREATE`, avec les seuls droits utilisés par l'API et le moteur
- [ ] Tests pgTAP : ce rôle ne peut ni modifier un solde, une quantité ou une réservation hors journaux, ni supprimer une écriture, ni créer de déclencheur
- [ ] Tests d'intégration de l'API et du moteur exécutés avec ce rôle
- [ ] Les comptes système d'un monde (robinets, puits) sont créés avec le monde, par contrainte ou déclencheur, et testés
- [ ] `infra/README.md` et `.env.example` : la connexion des services utilise ce rôle

## Hors périmètre

Création du rôle et de son mot de passe sur un serveur réel (humain).

## Dépendances

aucune

---

# 65. Journal des commandes : contexte complet et refus d'entrée

## Contexte

Le journal des commandes ne garde ni le niveau d'authentification, ni le rôle d'administration, ni la version de
configuration appliquée ; les refus avant exécution (jeton invalide, débit dépassé, corps trop gros) et les
lectures du back-office n'y figurent pas. La Vigie et le journal d'audit lisent ce journal sans index adapté.

## Spécification liée

`docs/specs/13-moteur-anti-triche.md`, `docs/specs/15-back-office-olympe.md` (15.4)

## Critères d'acceptation

- [ ] `game.command_log` porte le niveau `aal`, le rôle d'administration relu et la version de configuration de la commande (migration compatible)
- [ ] Les refus 401, 413 et 429 sont comptés (table ou compteur dédié, sans contenu de requête) et visibles dans la Vigie
- [ ] Les lectures `GET /api/admin/*` laissent une trace (compte, route, issue)
- [ ] Index couvrant les requêtes de la Vigie et du journal d'audit ; plan vérifié par un test
- [ ] Limite de débit tenue en base ou partagée entre répliques de l'API (deux répliques ne doublent pas le quota), testée
- [ ] ADR : durée de conservation des clés d'idempotence et du journal, purge

## Hors périmètre

Partitionnement des tables de journal ; supervision externe.

## Dépendances

#64

---

# 66. Acquérir un site et choisir sa recette

## Contexte

Une maison n'a qu'un site, créé avec elle, dont la recette est fixe. Le joueur doit pouvoir acquérir d'autres
sites dans sa cité et choisir ce qu'ils produisent, dans la limite fixée par le niveau de son siège (4.1, 4.2).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1, 4.2), `docs/specs/05-economie.md` (5.5)

## Critères d'acceptation

- [ ] Configuration : coût d'acquisition par type de site, nombre de sites par niveau de siège, types de site et recettes compatibles
- [ ] Commande `site.acquire` : paie le coût par le grand livre (puits), crée le site ; refus si limite atteinte ou solde insuffisant
- [ ] Commande `site.setRecipe` : change la recette d'un site parmi les recettes compatibles (la garde de base qui rend la recette immuable est adaptée par migration) ; la production en cours non récoltée suit une règle écrite dans la spécification
- [ ] Tests : idempotence, concurrence (deux acquisitions simultanées à la limite), solde jamais négatif
- [ ] Écran : liste des sites de la maison, acquisition et choix de recette, utilisable à 360 px et au clavier, fr et en

## Hors périmètre

Carte des parcelles, fertilité, marché foncier, niveaux de siège au-delà du premier palier, personnel.

## Dépendances

#64

---

# 67. Ateliers : recettes à intrants

## Contexte

`site.collect` refuse toute recette qui consomme des intrants. Sept des quinze biens (farine, huile, charbon,
tissu, pain, vin, amphores) ne peuvent donc pas être produits. Un atelier consomme ses intrants dans le stock de
la maison et produit à la demande, comme un site de matière première (4.3).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.3), `docs/specs/03-boucles-progression.md` (temps et horloges)

## Critères d'acceptation

- [ ] `packages/sim` : calcul pur des cycles réalisables selon le temps écoulé et les intrants disponibles (tests de propriétés : jamais plus de cycles que d'intrants, rien ne se crée ni ne se perd)
- [ ] `site.collect` : intrants sortis et extrants entrés par le journal des stocks dans la même transaction ; le stock réservé par des ordres de vente n'est pas consommé
- [ ] Règle écrite dans la spécification pour un atelier à court d'intrants (le cycle attend, le temps perdu n'est pas rattrapé au-delà du plafond d'accumulation)
- [ ] Tests d'intégration : chaîne blé → farine → pain ; concurrence avec une vente qui réserve le même stock
- [ ] Écran : la fiche d'un atelier montre intrants requis, stock disponible et production récoltable

## Hors périmètre

Qualité, marque, cadence, personnel et artisans.

## Dépendances

#66

---

# 68. Agora : choix du bien, mes ordres, annulation

## Contexte

L'écran de l'agora ne traite qu'un bien et la cité du joueur ; un ordre de vente ne peut pas être annulé, alors
que le stock qu'il réserve est immobilisé.

## Spécification liée

`docs/specs/05-economie.md` (5.3), `docs/specs/10-ux-ui.md`

## Critères d'acceptation

- [ ] Commande `market.cancelOrder` : annule un ordre ouvert de sa propre maison, libère la réservation ; l'ordre d'un autre est indiscernable d'un ordre inexistant
- [ ] Tests : annulation concurrente d'un achat ou d'un tick qui sert le même ordre (la quantité servie et la quantité libérée font toujours la quantité de l'ordre)
- [ ] Écran : choix du bien parmi les 15, carnet par niveau de prix, liste de mes ordres avec annulation, à 360 px et au clavier
- [ ] À la création de maison comme à l'agora, les cités proposées sont celles d'un seul monde
- [ ] Un achat dont une partie dépasse le prix limite ou le solde est exécuté pour la partie possible et le dit clairement

## Hors périmètre

Achats en attente, taxe, historique des prix, contrats, enchères.

## Dépendances

aucune

---

# 69. Achats en attente et séquestre

## Contexte

Un ordre d'achat s'exécute à l'arrivée et son reste est annulé : un acheteur ne peut pas afficher un prix et
attendre. Un achat en attente doit mettre sa monnaie sous séquestre, comme une vente réserve son stock.

## Spécification liée

`docs/specs/05-economie.md` (5.3)

## Critères d'acceptation

- [ ] Compte de séquestre par maison dans le grand livre ; un achat en attente y vire prix × quantité, l'exécution paie le vendeur depuis le séquestre, l'annulation rend le reste
- [ ] Une vente qui arrive s'exécute contre les achats en attente, du plus cher au moins cher, puis par ancienneté, au prix de l'ordre en attente
- [ ] La garde de base « un achat ne reste pas dans le carnet » est remplacée par « séquestre = somme des restes à payer », testée en pgTAP
- [ ] Tests de propriétés sur l'appariement (`packages/sim`) : conservation de la monnaie et des biens, aucune auto-transaction, priorité prix puis temps
- [ ] Une vente qui rencontrerait un achat en attente de la même maison ne s'exécute pas contre lui ; la règle est écrite dans la spécification
- [ ] Le carnet public montre les deux côtés par niveau de prix, sans identité
- [ ] Spécification 5.3 mise à jour

## Hors périmètre

Ordres au marché, ordres conditionnels, taxe.

## Dépendances

#68

---

# 70. Taxe de marché

## Contexte

La taxe de marché est un puits de monnaie et, plus tard, une recette de la cité (5.5, 5.6). Elle n'existe pas
encore : toute la dépense des PNJ reste dans l'économie.

## Spécification liée

`docs/specs/05-economie.md` (5.3, 5.5, 5.6)

## Critères d'acceptation

- [ ] Configuration : taux de la taxe de marché (borné), part détruite et part versée au trésor de la cité
- [ ] Chaque échange (entre joueurs et avec les PNJ) prélève la taxe sur le vendeur dans la même écriture que le paiement ; arrondi à l'obole écrit dans la spécification
- [ ] Compte « trésor de la cité » dans le grand livre, alimenté par la part non détruite
- [ ] Tests : somme des soldes inchangée hors part détruite ; taxe nulle sur un taux nul ; arrondi jamais en faveur de la création de monnaie
- [ ] L'écran de l'agora affiche le net attendu avant de placer une vente

## Hors périmètre

Vote du taux par la cité, droit de port, autres impôts.

## Dépendances

#69

---

# 71. Historique des prix et prix de référence

## Contexte

Le joueur ne voit que le carnet du moment. La spécification prévoit un historique en chandeliers, et le tick doit
recalculer un prix de référence observé pour l'affichage et pour le tableau de bord économique.

## Spécification liée

`docs/specs/05-economie.md` (5.3), `docs/specs/03-boucles-progression.md`

## Critères d'acceptation

- [ ] Table d'agrégats par cité, bien et période (ouverture, plus haut, plus bas, clôture, volume), remplie par une étape du tick à partir des échanges ; rejouer un tick ne double rien
- [ ] Vue publique en lecture, règles par ligne testées en pgTAP
- [ ] Écran : historique d'un bien (graphique accessible, avec tableau de repli), dernier prix et variation sur 24 h
- [ ] Événement de domaine par achat de PNJ (aujourd'hui absent)

## Hors périmètre

Indice des prix et inflation (#76), alertes de prix.

## Dépendances

#68

---

# 72. Clôture quotidienne : entretien des sites

## Contexte

La clôture quotidienne ne fait qu'activer une configuration programmée. L'entretien des bâtiments est le premier
puits de monnaie récurrent (5.5) et l'un des trois leviers d'inflation.

## Spécification liée

`docs/specs/03-boucles-progression.md` (temps et horloges), `docs/specs/05-economie.md` (5.5)

## Critères d'acceptation

- [ ] Configuration : entretien quotidien par type de site, coefficient d'entretien global
- [ ] Étape de clôture, une fois par jour de jeu et par monde, rejouable sans double prélèvement : chaque maison paie l'entretien de ses sites par le grand livre (puits)
- [ ] Règle écrite pour une maison qui ne peut pas payer (site à l'arrêt jusqu'au paiement ; jamais de solde négatif)
- [ ] Le planificateur s'appuie sur l'heure de la base, pas sur celle du processus ; un changement de durée de tick en configuration ne décale pas les clôtures
- [ ] Tests d'intégration : clôture manquée rattrapée une seule fois, deux moteurs concurrents

## Hors périmètre

Salaires, loyers, intérêts, impôts, chronique du jour.

## Dépendances

#66

---

# 73. Comptes de la maison

## Contexte

« Trésor et comptes : compte de résultat et bilan tenus automatiquement » (4.1). Le grand livre contient tout,
mais le joueur ne voit que son solde.

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1), `docs/specs/10-ux-ui.md` (écran Comptes)

## Critères d'acceptation

- [ ] Vues en lecture, limitées à sa propre maison (règles par ligne testées en pgTAP) : flux de trésorerie par jour et par nature (ventes, achats, taxes, entretien, acquisitions), stocks valorisés au dernier prix
- [ ] Compte de résultat par jour et par saison ; bilan (trésorerie, séquestre, stocks valorisés)
- [ ] Test : la somme des flux affichés d'une période égale la variation du solde sur cette période
- [ ] Écran Comptes à 360 px (fiches) et sur ordinateur (tableau triable), montants en drachmes et oboles, fr et en

## Hors périmètre

Marge par filière et par site, export, comparaison entre maisons.

## Dépendances

#70, #72

---

# 74. Tableau de bord de la maison et fiche de site

## Contexte

Premiers écrans clés de la spécification 10 : le tableau de bord (trésorerie, alertes, production en cours) et la
fiche de site. L'accueil actuel est une liste minimale.

## Spécification liée

`docs/specs/10-ux-ui.md`, `docs/specs/03-boucles-progression.md` (session de 3 à 10 minutes)

## Critères d'acceptation

- [ ] Tableau de bord : trésorerie, production récoltable par site, ordres ouverts, alertes (atelier à court d'intrants, site à l'arrêt, site au plafond d'accumulation)
- [ ] « Tout récolter » en une action, une commande par site, résultat lisible si certaines échouent
- [ ] Fiche de site : recette, intrants, production accumulée, plafond, entretien
- [ ] Une action courante en trois touches au plus ; états de chargement, d'erreur et « Réessayer » sur chaque lecture ; pluriels corrects
- [ ] Mise à jour de l'application : une nouvelle version du client est proposée sans perdre une saisie en cours (service worker)
- [ ] Tests de bout en bout à 360 px et 1 440 px

## Hors périmètre

Carte, personnel, famille, notifications push.

## Dépendances

#67, #72

---

# 75. Population des PNJ : croissance et émigration

## Contexte

« La population croît quand ses besoins sont couverts et émigre sinon » (5.2). La population de chaque classe
est aujourd'hui une constante de configuration.

## Spécification liée

`docs/specs/05-economie.md` (5.2)

## Critères d'acceptation

- [ ] La population par cité et par classe devient un état du monde, initialisé depuis la configuration
- [ ] Configuration : seuils de couverture des besoins vitaux, taux de croissance et d'émigration, bornes
- [ ] Étape de clôture : la couverture du jour (quantités servies sur quantités demandées, par classe) fait croître ou décroître la population ; calcul pur dans `packages/sim`, testé par propriétés (bornes, monotonie)
- [ ] La demande et le budget des PNJ suivent la population courante
- [ ] Vue publique : population de la cité et couverture des besoins, affichée au joueur

## Hors périmètre

Migration entre cités, sensibilité à la qualité, classes au-delà des quatre existantes.

## Dépendances

#72

---

# 76. Tableau de bord économique d'Olympe

## Contexte

« La masse monétaire est pilotée. Le tableau de bord économique suit chaque ligne en continu » (5.5). Olympe n'a
que la Vigie technique.

## Spécification liée

`docs/specs/05-economie.md` (5.5), `docs/specs/15-back-office-olympe.md` (15.1)

## Critères d'acceptation

- [ ] Route `GET /api/admin/economy` (rôles : super-administrateur, concepteur de jeu, observateur) : masse monétaire, création et destruction par robinet et par puits et par jour, indice des prix sur le panier de référence, inflation sur 30 jours glissants
- [ ] Les chiffres viennent du grand livre et des agrégats de prix ; un test compare la masse affichée à la somme des soldes
- [ ] Module « Économie » dans Olympe, tableaux lisibles à 360 px, fr et en
- [ ] Spécification 5.5 : définition de la masse monétaire (comptes comptés, trésor de la cité compris ou non) et de la mesure de l'inflation (panier de référence, période)
- [ ] Alerte visible quand l'inflation sort de la cible de 0 % à 3 %

## Hors périmètre

Simulateur d'équilibrage, modification des leviers depuis ce module (elle passe par Paramètres).

## Dépendances

#70, #71, #72

---

# 77. Olympe : rôles, double validation, exploitation

## Contexte

Limites notées pendant la phase 0 : les rôles d'administration sont inscrits à la main en base, une
configuration peut être programmée par la personne qui l'a écrite, une programmation ne s'annule pas, et la
procédure d'enrôlement du second facteur n'est pas écrite.

## Spécification liée

`docs/specs/15-back-office-olympe.md` (15.2, 15.3, 15.4)

## Critères d'acceptation

- [ ] Commandes `admin.grantRole` et `admin.revokeRole` (super-administrateur), journalisées ; le dernier super-administrateur ne peut pas être retiré
- [ ] Une version de configuration n'est programmable que par un compte différent de son auteur (15.2, étape 3), sauf variable d'environnement de l'API, désactivée par défaut, pour un monde de test
- [ ] Commande `admin.cancelActivation` pour une programmation à venir
- [ ] Édition des paramètres par formulaire pour les tables courantes (biens, recettes, classes), le JSON restant disponible ; les erreurs de schéma désignent le champ
- [ ] Paramètres : avertissement avant de remplacer un texte modifié, foyer déplacé vers la version ouverte, annonces d'erreur sans
      répétition à chaque frappe
- [ ] Le journal d'audit garde sa page au renouvellement de jeton ; messages d'erreur distincts (réseau, débit, code refusé) et bouton « Réessayer »
- [ ] Procédure écrite : premier enrôlement, perte d'appareil, retrait d'accès ; liste des rôles par module partagée entre l'API et le client
- [ ] En-têtes de sécurité (politique de contenu) pour Olympe et le client joueur, vérifiés par le contrôle des clients statiques

## Hors périmètre

Modération, fiche joueur, simulateur, restriction par adresse (dépend du serveur, #33).

## Dépendances

aucune

---

# 78. Équilibrage de la cité prototype

## Contexte

Les valeurs initiales n'ont été éprouvées que sur le blé. Avec quinze biens, des ateliers, la taxe, l'entretien
et une population qui varie, la cible d'inflation doit être tenue par la configuration, pas par chance.

## Spécification liée

`docs/specs/05-economie.md` (5.2, 5.5), `docs/specs/18-indicateurs-risques-conformite.md`

## Critères d'acceptation

- [ ] Simulation d'intégration de 30 jours de jeu : plusieurs maisons scriptées (producteur, transformateur, négociant) sur les 15 biens
- [ ] Mesures publiées par le test : masse monétaire, inflation, couverture des besoins par classe, part de chaque puits
- [ ] Configuration ajustée, par une nouvelle version, pour une inflation mensuelle entre 0 % et 3 % et des besoins vitaux couverts ; chaque changement est justifié dans la demande de fusion
- [ ] Aucune constante d'équilibrage ajoutée dans le code ; bornes du test écrites à la main, pas recalculées par le code testé
- [ ] Vérification du critère de sortie de la phase, écrite dans `docs/specs/17-feuille-de-route.md`

## Hors périmètre

Équilibrage à plusieurs cités, qualité, transport.

## Dépendances

#67, #70, #72, #75, #76

---

# 97. Recette retirée de la configuration alors qu'un site l'utilise

## Contexte

Report des relectures des PR #90, #95 et #96 (tickets #66 et #67). Si une version de configuration retire une recette qu'un site utilise encore, `site.collect` et `site.setRecipe` lèvent une erreur interne : le site ne peut plus ni être récolté ni changer de recette. Rien n'empêche aujourd'hui de publier une telle configuration. Côté écran, la fiche d'un tel site n'affiche ni intrants ni annonce, et « Récolter » échoue en erreur interne.

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.2, 4.3), `docs/specs/11-architecture.md` (configuration versionnée)

## Critères d'acceptation

- [ ] Décision écrite dans la spécification : refus à la publication ou à l'activation d'une configuration qui retire une recette utilisée, ou repli côté commandes (un site dont la recette a disparu peut changer de recette, sans récolte), ou les deux
- [ ] Aucune commande de site ne répond par une erreur interne pour un site dont la recette n'existe plus
- [ ] Tests d'intégration : publication ou activation d'une configuration sans la recette d'un site existant ; récolte et changement de recette de ce site
- [ ] L'écran dit clairement qu'un site est à l'arrêt faute de recette, en fr et en en

## Hors périmètre

Migration automatique des sites vers une autre recette, dédommagement des joueurs.

## Dépendances

#67

---

# 98. Carte des sites : accessibilité, rejeu d'acquisition, stock par cité ; test instable de l'agora

## Contexte

Reports des relectures des PR #92, #94 et #96 (écran des sites, tickets #66 et #67), regroupés parce qu'ils touchent le même écran du client joueur et ses tests de bout en bout.

## Spécification liée

`docs/specs/10-ux-ui.md` (accessibilité), `docs/specs/04-systemes-gestion.md` (4.2, 4.3)

## Critères d'acceptation

- [ ] Focus : après un changement de production réussi (le bouton « Changer » redevient inactif) et quand le formulaire d'acquisition disparaît à la limite de sites, le focus va à un élément utile au lieu de retomber sur la page ; testé au clavier
- [ ] Annonce des résultats : région vivante fiable pour les lecteurs d'écran (région permanente par cible, ou focus posé sur le message), sans régression de l'affichage « près de l'action »
- [ ] Rejeu d'acquisition : une clé restée en attente après une réponse perdue ne transforme plus la prochaine acquisition voulue de la même production en rejeu (« déjà acquis », un clic de plus) ; la clé ne se perd pas non plus en quittant l'onglet Maison
- [ ] Stock par cité : l'entrepôt de l'onglet Maison distingue les cités (deux lignes du même bien dans deux cités sont aujourd'hui indistinctes) ; les sites lisent leur propre cité au lieu de supposer celle de la maison
- [ ] Heure : l'annonce « À récolter » se cale sur l'heure du serveur (en-tête `Date` d'une réponse, par exemple) plutôt que sur l'horloge du navigateur ; recomptage au retour sur un onglet resté en arrière-plan
- [ ] Test instable « agora : choisir un bien, déposer une vente puis l'annuler » : cause établie. Symptôme : la réponse perdue simulée par `page.route` n'était pas interceptée et la vente était déposée (une fois en `ci` sur la PR #93, une fois en local service worker bloqué). Le test a été durci dans la PR #94 (interception posée dès le début, vérifiée) sans que la cause soit prouvée ; conserver les traces Playwright en artefact de `ci` aiderait

## Hors périmètre

Nom de site choisi par le joueur, temps réel (Supabase Realtime) sur le stock.

## Dépendances

#67
