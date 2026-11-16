# État du projet

Point d'étape au 16 novembre 2026, vers 18 h 45 (heure de Paris).
La phase 1 est terminée : ses derniers tickets, #78 (équilibrage), #229 (rachat d'un bien à retirer) et #234 (confirmation de ce que la version retire), sont fermés (demandes de fusion #242 à #249).
Les tickets de la phase 2 sont rédigés dans `docs/tickets/phase-2.md` et ouverts sur GitHub (#250 à #286, plus les suivis #291 et #333).
Vingt sont fermés : #250 (quatre cités), #251 à #254 (transport complet : navires, départ, arrivée, écran Carte), #255 et #258 (salaires, marché du travail et logement), #256, #257 et #259 (immobilier : parc, baux, revente et écrans), #260 (citoyenneté et élection de l'archonte), #261 à #264 (décrets : vote, taux, dépenses, trésor public et écran Cité), #265 (Charis), #267 (événements du monde), #268 (passerelle IA), #273 (discussion) et #291 (écran Sites filtré par terroir).
Des suivis sont ouverts :
- #403 et #404, de #259 (entretien impayé visible sur les offres, net du vendeur après taxe) ;
- #420, #441 et #444, de #264 (« depuis quand » du statut, plafond de lecture des maisons, finitions du formulaire de décret) ;
- #417 et #446, de #267 (montrer les événements au joueur, tests complémentaires).
Le suivi #354 (test instable du moteur près de la clôture) est fermé lui aussi.
Ce fichier décrit ce qui tourne réellement sur `main` ; les spécifications (`docs/specs/`) décrivent la cible.

## Où en est la feuille de route

- **Phase 0 (fondations)** : terminée, sauf le ticket #33 (serveur de préproduction), marqué
  `needs-human` : il demande de commander un serveur, un nom de domaine et de saisir des secrets.
  Rien n'est donc déployé : le jeu ne tourne qu'en local et en intégration continue.
- **Phase 1 (prototype « une cité »)** : terminée le 15 novembre 2026.
  Son critère de sortie est vérifié par le code (`docs/specs/17-feuille-de-route.md`) ; il reste à l'éprouver avec des joueurs réels, une fois un serveur en place.
- **Phase 2 (alpha fermée)** : en cours.
  Fermés : #250 à #265, #267, #268, #273, #291.
  En cours : #266 (grâces).
  Critère de sortie en tête de `docs/tickets/phase-2.md`, retenu par délégation du propriétaire.
  Le propriétaire a reporté tout serveur : la phase se développe et se teste en local, et seul #269 (fournisseur d'IA réel) est `needs-human`.

## Ce qui est jouable aujourd'hui

En local (procédure dans le `README.md`), dans quatre cités : Kallistè, Elaia, Ampelos et Halos (#250).
Une base locale existante doit être remise à zéro (`pnpm db:reset`) pour recevoir les trois nouvelles cités et la configuration qui les décrit.

- **Compte et maison.** Connexion par lien magique (courriel). Création d'une maison : nom, blason, cité.
  La maison reçoit 3 000 oboles et le premier site de sa cité (champ de blé, vigne ou pêcherie). La commande de renommage existe dans l'API, sans écran.
- **Sites.** Jusqu'à quatre sites par maison. Acquisition contre monnaie (de 600 à 1 200 oboles selon le
  type), changement de production d'un site. Quinze productions pour quinze biens : huit matières
  premières (blé, olives, raisin, bois, argile, laine, poisson, sel) et sept transformations en atelier
  (farine, huile, charbon de bois, tissu, pain, amphores, vin).
- **Production.** Elle s'accumule avec le temps, jusqu'à un plafond, et se récolte à la demande. Un atelier
  consomme ses intrants dans le stock libre de sa cité ; à court d'intrants, il attend. La fiche d'un
  site affiche son entretien, son plafond, les intrants par cycle, le stock libre et ce qui est
  récoltable, calculé à l'heure du serveur (en-tête `Date` de l'API) et recompté au retour sur l'onglet.
- **Clôture quotidienne et entretien : en jeu.** Le moteur joue une clôture par monde et par jour de jeu
  (04 h 00, heure de Paris), à l'heure de la base, une seule fois même avec plusieurs moteurs ; une
  clôture manquée est rattrapée une fois. Chaque clôture fait évoluer la population des PNJ, puis
  prélève un jour d'entretien par site (30 à 60 oboles). Un site impayé s'arrête ; sa fiche le dit, et
  « Relancer » le repart en payant un jour, au prix affiché. Ce prix est envoyé avec la commande : si le
  tarif a changé entre-temps, l'API refuse sans rien prélever (`PRICE_CHANGED`), et l'acquisition d'un site
  fonctionne de même. La carte des sites se relit chaque minute et au retour sur l'onglet, et annonce un
  arrêt prononcé pendant que la page est ouverte. Une clôture en échec est notée avec l'étape et la maison
  en cause, puis reprise au passage suivant.
- **Télémétrie du moteur.** Le moteur garde 90 jours de passages de tick et de clôture
  (`telemetry.retentionDays`) et purge le reste à chaque passage (#213).
- **Population des PNJ : en jeu.** Chaque classe de chaque cité croît ou émigre à la clôture selon la
  couverture de ses besoins vitaux la veille ; la demande des PNJ suit la population courante. L'onglet
  Cité montre la population par classe et la couverture retenue.
- **Agora.** Carnet d'ordres à cours limité par bien : ventes et achats attendent dans le carnet, une vente
  réserve son stock, un achat met son prix sous séquestre. Exécution à l'arrivée, au prix de l'ordre qui
  attendait ; annulation d'un ordre ouvert. Le carnet public montre les deux côtés par niveau de prix,
  sans identité.
- **Taxe de marché.** Chaque échange de l'agora, entre joueurs comme avec les PNJ, prélève sur le vendeur 5 % dans la configuration initiale, ou le taux qu'un décret de la cité a fixé (#262), arrondis à l'obole supérieure.
  La moitié est détruite, l'autre va au trésor de la cité, que les décrets de dépense peuvent dépenser (#263).
  Le formulaire de vente annonce le net attendu.
- **Demande des PNJ.** Toutes les dix minutes, le moteur fait acheter les habitants de la cité aux ventes
  en attente, des moins chères aux plus chères, jusqu'à trois fois le prix de référence du bien. C'est la
  seule création de monnaie en jeu, avec la dotation de départ ; le vendeur en reçoit le net de taxe.
- **Historique des prix.** À chaque tick, le moteur résume les échanges de chaque bien en chandeliers
  d'une heure (ouverture, plus haut, plus bas, clôture, volume) et recalcule un prix moyen observé sur
  24 heures. L'agora affiche pour le bien choisi le dernier prix, la variation sur 24 heures, ce prix
  moyen, un graphique en chandeliers décrit et le tableau des mêmes valeurs. Chaque achat des PNJ
  laisse un événement de domaine.
- **Tableau de bord et comptes.** L'onglet Maison montre la trésorerie, l'entrepôt (par cité dès qu'un
  stock est ailleurs), les ordres ouverts, les sites à surveiller (arrêt, à court d'intrants, plafond) et
  « Tout récolter » (une commande par site, échecs nommés). L'écran Comptes (`/comptes`) donne le bilan
  en drachmes et oboles, les stocks valorisés au prix moyen observé et le compte de résultat par jour ou
  par saison.
- **Client.** Application web installable (PWA), utilisable à 360 px de large et au clavier, en français
  et en anglais. Onglets Maison, Carte, Agora et Cité ; Messages est une coquille vide (l'écran de la discussion attend #274). Une nouvelle
  version est proposée, jamais imposée pendant une saisie. Une acquisition restée sans réponse garde sa
  clé d'idempotence, même onglet quitté : la renvoyer rejoue l'achat au lieu de le payer deux fois. Même
  aboutie, la clé n'est rendue qu'à la relecture qui montre le site acheté (#176). L'avertissement d'une
  acquisition restée sans réponse revient à chaque ouverture de l'écran tant que le joueur n'a pas cliqué
  « J'ai vérifié la liste » ou lancé une nouvelle acquisition.
- **Back-office Olympe.** Connexion avec second facteur, Vigie (compteurs de refus de l'API, ticks et
  clôtures en échec sur 24 heures avec la dernière erreur ; elle montre si la double validation est levée,
  et le fuseau en vigueur pour tous les mondes, avec une alerte s'il est inconnu de la base ou si la
  version en vigueur ne respecte plus le schéma, #222), Paramètres (versions de configuration : consulter, comparer,
  enregistrer, programmer à la prochaine clôture, annuler une programmation à venir ; un refus du
  schéma désigne la table, la ligne et le champ ; un texte modifié n'est jamais remplacé sans
  confirmation), journal d'audit, Accès (liste des rôles, accorder par identifiant de compte, retirer
  après confirmation ; réservé au super-administrateur). Une version n'est programmable que par un
  autre compte que son auteur. Procédure écrite d'accès : `docs/exploitation/` (premier enrôlement,
  appareil perdu, retrait). Économie : masse monétaire par nature de compte, robinets et puits par jour de
  jeu, indice des prix sur un panier de six biens et inflation sur 30 jours, avec une alerte écrite
  quand elle sort de la cible de 0 à 3 % (la mesure est dite inconnue tant qu'un bien du panier n'a
  aucun échange dans l'une des deux fenêtres ; elle peut donc être annoncée dès le 31e jour, sur une
  fenêtre précédente partielle, que l'écran signale, #181 et #184). Les alertes de plusieurs mondes sont
  rappelées en tête de page, et un « Actualiser » en échec dit que les chiffres sont anciens. Paramètres :
  sous chaque version, ce qu'elle retire et que le monde porte encore. Un bien détenu en stock, en carnet ou
  sous séquestre interdit sa programmation (`CONFIG_GOOD_IN_USE`, #191). Une recette encore exploitée ou une
  classe qui a encore une population demande une confirmation explicite (case à cocher,
  `CONFIG_RETIRED_UNCONFIRMED`, #200), si la version en vigueur la contient encore (#234). Formulaires des biens (ajout et retrait compris), des recettes et des classes de PNJ, à côté
  du texte JSON (#77). Une version qui change l'horloge du monde (durée du tick, heure ou fuseau de clôture)
  est refusée, et une programmation ne peut viser une clôture à moins d'une minute. Le premier
  super-administrateur s'inscrit à la main en base. Le `Caddyfile` du futur serveur pose une politique de contenu et des en-têtes de
  sécurité sur les deux clients, vérifiés en `ci` ; en local, servis par Vite, ils ne les portent pas.

Ajouts de la phase 2 :

- **Transport** (#251 à #254, 4.6) : une maison achète des navires et les fait partir d'une cité vers une autre reliée par une route, chargés d'une cargaison prise dans son stock libre.
  Le départ paie les provisions de la route et le droit de port de la cité d'arrivée ; une part du droit est détruite, le reste va au trésor de la cité.
  La cargaison est en transit au journal des stocks pendant le trajet ; à chaque tick, le moteur décharge les voyages échus dans la cité d'arrivée, et le navire y est à quai.
  L'entretien des navires est prélevé à la clôture, après celui des sites ; un navire impayé est désarmé jusqu'à la clôture qui le paie.
  L'onglet Carte montre l'archipel, ses routes et la flotte, doublés d'une liste au clavier, avec le chantier naval, la fiche de chaque navire et le départ en deux touches.
  La Vigie compte les voyages en retard de déchargement.
  Provisions, droit de port et entretien des navires sont à zéro dans la configuration initiale (paramètres neutres) jusqu'au calibrage (#283).
- **Immobilier** (#256, 4.5) : chaque cité a un parc fini de logements en deux tailles, maison de ville et immeuble de rapport, créé par le moteur au premier tick qui la connaît.
  Une maison achète à la cité un bien qu'elle détient encore, dans n'importe quelle cité de son monde ; le prix est détruit par un puits.
  Elle le rénove en payant en oboles et en consommant des biens de son stock dans la cité du bien ; le bien redevient neuf.
  À la clôture, chaque bien perd sa vétusté du jour, puis son entretien est payé après les sites et les navires, chacun en entier ou pas du tout.
  Un bien impayé est marqué ; il ne loge plus personne à partir du lendemain (#258).
  La base garantit qu'un bien ne change de propriétaire que par une écriture d'achat, et que son état ne remonte que par une rénovation.
  Vues : règles et parc publics, sans nom de propriétaire, et biens de sa maison.
  Entretien et vétusté sont à zéro dans la configuration initiale.
- **Baux et revente entre maisons** (#257, 4.5) : une maison offre un bien qu'elle possède à la vente ou à la location, à un prix qu'elle fixe.
  Une autre maison l'achète au prix affiché, taxé comme à l'agora, ou le prend à bail, sans durée ni paiement à la signature.
  À la clôture, avant la vétusté et l'entretien, chaque bail paie le loyer d'un jour en entier ; sinon il prend fin, impayé.
  Une fin de bail demandée par l'une des parties prend effet à la clôture suivante, sans loyer.
  Loyers et reventes entrent dans les comptes de la maison ; les offres ouvertes sont publiques, sans le nom de la maison qui offre.
- **Salaires** (#255, 4.4) : chaque site paie chaque jour ses travailleurs à la clôture, avec son entretien, à un puits ; à zéro dans la configuration initiale.
- **Marché du travail et logement** (#258, 4.4, 4.5) : chaque clôture fixe, par cité, l'offre de travail, le salaire du jour selon le taux d'emploi et le prix d'une nuit chez les habitants selon la pénurie de logements.
  Les biens d'une maison, possédés ou pris à bail, logent d'abord les travailleurs de ses sites les plus anciens ; chaque travailleur sans logement coûte une nuit, payée avec l'entretien par une écriture à part, en entier ou site à l'arrêt.
  Une cité qui n'a plus de travailleurs refuse un nouveau site (`NO_WORKERS_AVAILABLE`), sans rien arrêter.
  Configuration initiale neutre : offre sans limite, hébergement gratuit.
- **Écrans Personnel et Immobilier** (#259, 10) : fiche de site (travailleurs logés ou non, coût d'un jour), écran Personnel, écran Immobilier (offres, achat, location, rénovation, mise en vente ou en location, fin de bail, au prix vu), marché du travail et parc dans l'onglet Cité, et alertes du tableau de bord.
- **Citoyenneté et élection de l'archonte** (#260, ADR 0007) : une maison devient citoyenne de sa cité selon les règles de la configuration ; l'archonte est élu à date fixe, au vote secret entre joueurs.
- **Décrets, proposition et vote** (#261, 6.3) : l'archonte propose un décret pris dans un catalogue fermé de quatre modèles aux paramètres bornés ; les citoyens votent, une voix par maison.
  La clôture dépouille les votes clos : le décret est adopté si le quorum est atteint et si les votes pour l'emportent strictement.
- **Décrets de taux** (#262, 5.3, 5.6) : la clôture applique les décrets adoptés de taxe de marché et de droit de port, ramenés dans les bornes en vigueur ; chaque cité a son taux, calculé en base par une seule fonction et lu par les commandes, les PNJ et les écrans (vue `city_rates`).
- **Décrets de dépense et trésor public** (#263, 5.5, 5.6, 7.5) : la clôture paie du trésor de la cité les grands travaux et les fêtes, détruits dans un puits, ou rend le décret caduc s'il dépasse la part permise du trésor.
  Une fête relève, pendant ses jours, la demande des PNJ de la cité pour ses biens.
  Le trésor de chaque cité est public : solde et flux par jour et par nature (vues `city_treasury` et `city_treasury_flows`).
- **Écran Cité** (#264, 10) : l'onglet Cité montre le statut de la maison, la vie politique (archonte, élection en cours avec candidature et vote, derniers résultats), l'assemblée (décrets au vote, vote en deux touches, décrets adoptés et en vigueur, formulaire de proposition de l'archonte aux bornes annoncées) et le trésor public (solde, flux par jour, taxes en vigueur).
  Un métèque voit tout, sans bouton, et l'écran dit pourquoi.
  La date du statut attend #420.
- **Charis** (#265, 7.1) : une maison fait des offrandes de monnaie ou de biens à un dieu du catalogue de la configuration et gagne sa Charis envers lui ; les oboles sont détruites par un puits, les biens quittent le stock par le journal des stocks.
  La Charis décline chaque jour à la clôture, une fois par jour même si la clôture est rejouée ; la Charis de cité somme celle des citoyennes envers le dieu protecteur.
  Lectures : règles du temple et Charis de cité publiques, Charis de sa maison privée ; pas encore d'écran (#272).
- **Événements du monde** (#267, 7.3, 7.4) : chaque monde a une graine secrète ; la clôture planifie, quelques jours à l'avance et de façon reproductible, sécheresses, bonnes années, tempêtes et caravanes étrangères.
  Une sécheresse réduit et une bonne année accroît la récolte des cycles qui se terminent pendant elle (dans le temps du site, gelé pendant un arrêt) ; une tempête allonge le trajet d'un navire qui part pendant elle ; une caravane relève la demande des PNJ pour son bien.
  Chaque écart est expliqué dans `event_effects` ; les joueurs ne lisent un événement qu'une fois commencé, et Olympe montre aussi ceux à venir (module Animation).
  Toutes les probabilités sont nulles dans la configuration initiale : rien ne change tant qu'une version ne les active pas, et rien ne les montre encore au joueur (#417).
- **Discussion, côté serveur** (#273, 6.6) : un canal par cité, ouvert aux maisons de la cité (citoyennes ou métèques), et des conversations privées entre deux maisons d'un même monde.
  Commandes `chat.openDirect` et `chat.post`, limite de débit propre à la discussion, messages purgés après 30 jours (configuration).
  Le texte d'un message n'entre ni dans le journal des commandes ni dans les événements ; un message masqué ne rend plus son texte aux joueurs.
- **Quatre cités** (#250, 6.1) : chacune a son terroir (productions primaires admises ; les ateliers le sont partout), son port, son dieu protecteur et son site de départ.
  La fondation présente les quatre cités avec leur identité, et l'onglet Cité montre celle de la cité du joueur.
  L'API refuse une production hors terroir (`RECIPE_NOT_IN_TERROIR`), et l'écran Sites ne la propose pas (#291).
  Kallistè garde toutes ses matières premières jusqu'au calibrage à quatre cités (#283).
- **Passerelle IA** (#268, ADR 0005) : `packages/ai` rend toujours un résultat, la sortie du modèle si elle est conforme à son schéma, sinon le repli.
  Plafond mensuel par usage, journal `telemetry.ai_calls` sans texte, tableau dans la Vigie.
  Aucun usage n'est encore branché, et tous sont coupés dans la configuration initiale ; le fournisseur réel attend #269 (`needs-human`).
- **Contrôle `ci` en parallèle** (#298) : statique, base, intégration (deux jobs), bout en bout et images tournent en même temps, en 4 minutes environ au lieu de 10.
  Un changement de documents seuls ne lance que les contrôles statiques, en moins d'une minute.
  Le job final `ci` reste le seul contrôle à attendre ; il n'apparaît qu'à la fin de l'exécution.

Ajouts de la fin de la phase 1 :

- **Calibrage de la cité prototype** (#78, 5.5) : 28 maisons de quatre sites approvisionnent Kallistè ; le banc d'équilibrage tient ses bornes écrites à la main.
- **Rachat d'un bien à retirer** (#229) : le super-administrateur rachète, au prix de référence, tout le stock d'un bien qu'une version retire, par le robinet `faucet_good_buyback`, depuis le module Paramètres.
- **Confirmation d'un retrait** (#234) : seules les recettes et les classes que la version retire par rapport à celle en vigueur demandent la case ; ce qui était déjà retiré est montré une fois, pour information.

## Décisions prises en cours de route

Les décisions structurantes sont dans `docs/adr/` ; celles-ci ont été prises ticket par ticket et sont
écrites dans les spécifications citées.

- **Le client lit par Supabase, écrit par l'API** (ADR 0001). Les règles du jeu qu'il affiche (recettes,
  coûts) viennent de la vue `site_rules`, pas d'une copie de la configuration.
- **Rôle de service non propriétaire** (`oikos_service`) pour l'API et le moteur : il ne peut ni modifier
  un solde ou un stock à la main, ni supprimer, ni créer de compte système. Les soldes ne bougent que par
  les journaux, par des déclencheurs du propriétaire.
- **Comptes système créés avec le monde**, à partir d'un catalogue de robinets et de puits (5.5).
- **Production paresseuse** : rien ne tourne en tâche de fond pour les sites, la récolte calcule ce qui
  est dû. Un atelier à court d'intrants ne rattrape pas le temps perdu au-delà du plafond (4.3).
- **Changer la production d'un site remet son cycle à zéro** ; s'il y a quelque chose à récolter, il faut
  récolter d'abord (4.2).
- **Sites** : limite par niveau du siège (quatre aujourd'hui, un seul niveau), coût d'acquisition détruit
  (puits « acquisition de sites »), tout en configuration.
- **Agora, achats** (5.3, ticket #69) :
  - le séquestre est un compte du grand livre par maison, pas une colonne ; la base contrôle à chaque
    validation qu'il retient exactement la somme des restes à payer ;
  - un achat ne dépense jamais plus que la trésorerie ; son reste n'attend que si elle peut en retenir le
    prix en entier, sinon il est annulé et signalé (pas d'attente partielle) ;
  - un échange se fait au prix de l'ordre qui attendait ;
  - une maison n'échange pas avec elle-même : ses ordres peuvent se croiser sans s'exécuter.
- **Taxe de marché** (5.3, ticket #70) :
  - taux et part détruite en points de base, dans la configuration ; une version publiée avant la taxe
    se lit à taux nul, donc une base déjà initialisée ne taxe rien tant qu'une version n'est pas publiée,
    programmée et activée ;
  - arrondi à l'obole supérieure, par échange : découper ses ventes ne fait jamais payer moins, mais une
    vente servie en plusieurs échanges peut rapporter quelques oboles de moins que le net annoncé ;
  - le trésor de la cité est un compte du grand livre par cité, ouvert par la base, jamais débiteur ;
  - le client lit la taxe par la vue `market_rules` et calcule le net comme l'API ; le grand livre fait foi.
- **Historique des prix** (5.3, ticket #71) :
  - les chandeliers sont une table que le tick remplit et recalcule (période en cours et précédente),
    pas une vue matérialisée ; rejouer un tick ne double rien. Un échange validé plus d'une période après
    le calcul de la sienne n'est pas rattrapé ;
  - chaque échange porte un rang d'exécution donné par la base (`trades.seq`) : il départage l'ouverture
    et la clôture entre échanges d'une même transaction ; le service ne choisit ni ce rang ni la date ;
  - durée des chandeliers et fenêtre du prix observé sont en configuration (`priceHistory`), et lues par
    le client dans la vue `market_rules` : après un changement de durée, deux séries coexistent et seule
    celle de la durée en vigueur est affichée ;
  - le prix moyen observé ne sert qu'à l'affichage et aux indicateurs : les PNJ achètent toujours selon
    le prix de référence de la configuration ;
  - chandeliers et prix observés sont publics pour tout joueur connecté, toutes cités confondues, sans
    identité ; un achat de PNJ émet le même événement `TradeExecuted` qu'un échange entre joueurs ;
  - hausse et baisse se lisent à la forme des chandeliers (corps vide ou plein), pas à la couleur ; le
    graphique est en échelle logarithmique, pour qu'un prix aberrant n'écrase pas les autres ;
  - un prix moyen observé plus ancien que sa fenêtre est affiché avec sa date, pas comme « sur 24 h ».
- **Clôture quotidienne et entretien** (3, 5.5, ticket #72 ; décisions de conception prises en cours de
  ticket, à confirmer par un humain) :
  - une clôture par monde et par jour de jeu, décidée par l'heure de la base et la table des clôtures
    jouées, indépendante de la durée de tick ; après plusieurs jours de panne, seule la clôture du jour
    en cours est jouée : les jours manqués ne coûtent rien ;
  - chaque clôture demande à chaque site un jour d'entretien, payé par le grand livre vers un puits ;
    chaque site est payé en entier ou pas du tout, du plus ancien au plus récent ; ni dette, ni arriéré,
    ni solde négatif ; la monnaie sous séquestre n'est pas comptée ;
  - un site impayé est à l'arrêt : il ne produit ni n'accumule, ce temps n'est jamais rattrapé, le cycle
    entamé est gelé ; ce qu'une matière première avait accumulé reste récoltable, un atelier à l'arrêt
    ne consomme rien et ne se récolte pas avant sa relance ;
  - la relance paie un jour d'entretien et la clôture suivante le redemande : esquiver la clôture puis
    relancer coûte le même prix, l'impayé volontaire ne coûte que l'arrêt ;
  - la base refuse deux prélèvements d'entretien pour la même maison le même jour, date elle-même les
    clôtures et les arrêts, et impose qu'une reprise décale le cycle exactement de la durée de l'arrêt ;
  - pendant la clôture d'un monde, ses ordres, récoltes, acquisitions et relances attendent ; ce coût
    n'a pas été mesuré à l'échelle.
- **Olympe** (15.2 à 15.4, ticket #77) :
  - un rôle ne change que par une fonction de la base, sous verrou : elle relit que l'auteur est
    super-administrateur et refuse de retirer le dernier super-administrateur ; nul ne s'accorde un rôle
    à lui-même, mais un super-administrateur peut se retirer s'il en reste un autre ; l'API reste de
    confiance pour l'identité de l'auteur (jeton, second facteur) ;
  - la double validation d'une programmation est tenue par l'API, pas par la base ; un réglage d'API
    (`OLYMPE_ALLOW_SELF_REVIEW`, désactivé par défaut) la lève pour un monde de test ;
  - annuler une programmation annule toutes celles de la même clôture ; la base refuse d'annuler une
    activation passée ou à moins d'une minute de son échéance (protection en profondeur, pas garantie :
    voir #130) ;
  - la liste des rôles par module est partagée entre l'API et le client ; la lecture des rôles ne rend
    que des identifiants de compte, jamais d'adresse.
- **Population des PNJ** (5.1, ticket #75 ; à confirmer par un humain) :
  - un état par cité et par classe, créé par le moteur au premier tick qui les connaît ; la base refuse
    toute évolution hors de la transaction de la clôture de son jour ;
  - la couverture d'une classe est un seul rapport, unités servies sur unités demandées, tous biens
    vitaux confondus : un bien vital trop cher est moins acheté, donc moins servi, et **la cherté fait
    émigrer comme la pénurie**. Avec les valeurs initiales, des biens vitaux vendus durablement de 25 à
    40 % au-dessus de leur prix de référence suffisent ; Kallistè peut perdre jusqu'à 2 % par jour, avec
    un plancher à 50 % de sa population initiale ;
  - un tick rattrapé après une panne achète mais ne compte pas dans la mesure : une panne ne fait ni
    croître ni émigrer, mais le premier tick à l'heure est mesuré contre un carnet vidé par le rattrapage.
- **Comptes de la maison** (4.1, ticket #73) : montants affichés en drachmes et oboles (6 oboles pour 1
  drachme), stocks valorisés au prix moyen observé, ceux sans prix comptés à part ; un compte dont les
  totaux ne tombent pas juste n'est pas affiché.
- **Carte des sites de l'onglet Maison** (ticket #98) : l'intention d'une acquisition est la production voulue et le nombre
  de sites lus ; sans réponse, l'écran rejoue une fois la même clé, puis prévient le joueur avant
  d'abandonner la clé (réglé par #176). Les résultats sont annoncés dans des régions vivantes
  permanentes ; ce qui est récoltable est calculé à l'heure du serveur.
- **Économie d'Olympe** (5.5, ticket #76 ; panier et cible à confirmer par un humain) : la masse
  monétaire compte tous les comptes non système, trésor de la cité compris ; robinets et puits sont des
  nets par jour de jeu ; la lecture est un instantané unique, à l'heure de la base. L'indice pondère les
  prix par les volumes, en fractions exactes ; un bien du panier sans échange rend la mesure inconnue,
  jamais estimée. Panier initial : blé, pain, poisson, sel, huile, vin (97 % de la dépense de référence).
- **Heure du serveur dans le client** (#173, #182) : lue dans l'en-tête `Date`, à la seconde près ;
  l'horloge du navigateur est gardée quand l'en-tête lui donne raison. Une première version la
  corrigeait toujours d'une demi-seconde et a rendu `main` rouge un moment (cycles à la
  seconde près dans les tests de bout en bout) : réparé par #182.
- **Horloge du monde figée** (3, 15, ticket #123) : une version qui change la durée du tick, l'heure ou le
  fuseau de clôture est refusée à la publication comme à la programmation (`CONFIG_CLOCK_CHANGED`) ; la
  durée des saisons reste réglable. Le tick qui porte la clôture est le premier qui commence à la clôture
  ou après, calculé comme la clôture elle-même (`dailyCloseAt`), y compris aux changements d'heure et dans
  les fuseaux décalés d'une demi-heure. Un monde dont l'horloge recule ne joue rien, et chaque passage
  inscrit un échec que la Vigie compte.
- **Activations de configuration** (13, 15, ticket #130) : la base pose elle-même leur date de création et
  refuse une échéance passée, quel que soit le rôle. Elle refuse aussi une programmation à moins d'une
  minute de son échéance, et contrôle de nouveau l'échéance à la validation par des déclencheurs différés.
  Un refus au COMMIT devient une erreur métier du registre (`CONFIG_ACTIVATION_TOO_LATE` pour une
  programmation, `CONFIG_ACTIVATION_PAST` pour une annulation), rejouable sous la même clé.
- **Contrôle différé des activations contournable** (13, ADR 0003, ticket #208) : `SET CONSTRAINTS ALL
  IMMEDIATE` contourne le contrôle à la validation. C'est une limite assumée plutôt qu'un verrou `SHARE`, qui
  bloquerait programmations et ticks de tous les mondes. L'effet est borné à l'audit :
  - ticks, clôtures et commandes enregistrent la version lue, qui fait foi au rejeu ;
  - un rapprochement décrit en 13 détecte l'écart ;
  - le lint refuse `set constraints` dans le code TypeScript ;
  - `max_prepared_transactions = 0` est exigé sur le serveur.
- **Session de base fermée** (14.3, ticket #136) : une connexion coupée en cours de commande, de tick ou de
  clôture ne fait échouer que ce passage. La trace d'audit est écrite par une autre connexion, la clé
  d'idempotence reste utilisable et le passage suivant rejoue une seule fois.
- **Règlement d'un échange** (5.3, ticket #100) : la base contrôle qu'un échange est réglé par sa propre
  écriture, du brut exact, réparti entre net et taxe, et qu'un séquestre ne paie que les échanges de sa
  maison ou rend à sa trésorerie. Depuis #205 :
  - une écriture ne règle qu'un échange, par un index unique ;
  - le contrôle complet est refait à chaque ligne, au plus cinq fois par échange : un saut fondé sur l'ordre
    des commandes s'est révélé contournable en relecture ;
  - les parts de la taxe ne sont pas bornées davantage en base, et les débits hors échange (d'une maison
    vers une autre, robinet des PNJ) restent acceptés. Ces deux décisions sont écrites en 5.3 et 12.
- **Recette retirée** (4.2, ticket #97) : un site dont la recette a disparu de la configuration est à l'arrêt
  faute de production, sans erreur interne ; sa maison peut en changer. Depuis #200, la programmation
  d'une telle version demande une confirmation explicite. Une classe retirée puis réintroduite reprend sa
  population gardée (5.2).
- **Bien retiré encore détenu** (5.1, ticket #191) : refus à la programmation, pas à l'activation.
  - Un bien acquis entre la programmation et la clôture reste dans les journaux. Aucun nouvel ordre ne
    l'accepte (`GOOD_NOT_FOUND`) et les PNJ ne l'achètent plus, mais ses ordres ouverts restent
    annulables, jusqu'à ce qu'une version le remette.
  - Une seule unité détenue bloquait le retrait ; depuis #229, le super-administrateur peut racheter le stock.
- **Entretien et prix vu par le joueur** (4.2, 5.5, ticket #145) : le client envoie le prix qu'il affiche,
  et une clé en attente repart toujours avec son entrée d'origine. À la relance, le joueur ne paie ni deux
  fois ni un autre prix que celui qu'il a vu ; à l'acquisition non plus depuis #176. La clôture fixe elle-même son isolation (READ COMMITTED) et
  inscrit chaque tentative dans `telemetry.close_runs`, en ajout seul.
- **Lectures de comptes rapides** (12, ticket #155) : `jit = off` pour les rôles `anon` et `authenticated`
  plutôt qu'une réécriture des règles par ligne ; la migration fait recharger PostgREST. La vérification
  après déploiement passe par `/rest/v1/rpc/client_jit`, et la mesure est reproductible par
  `pnpm --filter @oikos/db bench:cash-flows`.
- **Migrations rejouables** (règle 9, ticket #158) : toutes se rejouent sur une base déjà migrée sans changer
  le schéma, ce que `pnpm test:db:replay` vérifie en `ci` par une empreinte du schéma, sur une base neuve
  puis après les tests d'intégration. La saison est bornée à 366 jours. Un fuseau inconnu de la base n'est
  refusé qu'à la configuration initiale ; le fuseau en vigueur ne l'est jamais.
- **Migrations au déploiement** (14.4, ticket #218) : `infra/apply-migrations.sh` n'applique que les
  migrations absentes de `supabase_migrations.schema_migrations`, chacune dans sa transaction avec son
  enregistrement, et refuse une migration enregistrée dont le fichier a changé (`oikos_md5`). Une base déjà
  déployée sans cette table adopte, sans les rejouer, les migrations de la version précédente restées
  identiques (ADR 0004). Une migration publiée est immuable, et la `ci` refuse qu'on la modifie : on
  corrige par une migration nouvelle. Les migrations enregistrées par la CLI (`supabase db push`) n'ont pas
  d'empreinte : seule la `ci` les protège.
- **Appariements d'un monde exécutés l'un après l'autre** (verrou consultatif par monde) : au plus simple,
  à revoir si la charge le demande.
- **Demande des PNJ** : ils n'achètent qu'aux ventes en attente et ne déposent pas d'ordre.
- **Limitation de débit tenue en base**, partagée entre les répliques de l'API.
- **Demandes de fusion de plus de 400 lignes** : plusieurs ont dépassé la limite du `CLAUDE.md` jusqu'au
  ticket #69, presque toujours par leurs tests d'intégration. Depuis, #141 (481 lignes) et #160 (468), puis
  l'après-midi #226 (401), #228 (415), #231 (484), #236 (422), #237 (471) et #239 (507). Le plus souvent, ce sont
  les tests ou les reprises demandés en relecture qui ont fait passer la limite ; #231 dépassait dès sa
  première version. Les autres tickets sont découpés en tranches.
  En fin de phase 1, #243 (403 lignes) et #246 (637 lignes, dont 415 de tests d'intégration gardés avec la commande de rachat) ont aussi dépassé la limite, avec une justification dans la demande de fusion.
- **Règle 9 et mise en page des documents** : `CLAUDE.md` dit maintenant qu'une migration publiée ne se modifie plus, et que les documents de `docs/` s'écrivent une phrase par ligne.
  Les lignes de plus de 400 caractères des spécifications ont été coupées ainsi, sans changer leur rendu : elles provoquaient des conflits à chaque demande de fusion qui touchait le même paragraphe.
- **Après-midi du 15 novembre** : plusieurs tickets ont avancé en parallèle, chacun dans son arbre de travail
  (`git worktree`), sur une seule base Supabase locale partagée. La base est donc salie par les tests
  d'intégration : en local, beaucoup de fichiers pgTAP y échouent pour cette seule raison, et la `ci`, qui
  part d'une base neuve, fait foi. Les migrations nouvelles s'appliquent par `supabase migration up`, sans
  remise à zéro. #205 a dû renuméroter la sienne (43 puis 42) quand #200 s'est révélé sans migration.
- **Rétention et horloge** (3, 15, ticket #213) :
  - la purge de la télémétrie passe par une fonction du propriétaire, qui garde toujours le dernier jour ;
  - une activation programmée avant #123 qui changerait l'horloge est annulée au déploiement et au
    démarrage du moteur ; à moins d'une minute de son échéance, elle ne peut plus l'être, et le journal du
    moteur dit qu'elle s'appliquera ;
  - le tick de clôture se reconnaît sans hypothèse sur l'ampleur d'un saut d'heure.
- **Vigie et fuseau** (3, 15, ticket #222) : la configuration est globale, donc le fuseau en vigueur est dit une
  fois pour tous les mondes. S'il quitte la base des fuseaux de PostgreSQL, un humain doit le remettre sur
  le serveur (`needs-human`) : changer de fuseau serait un changement d'horloge, refusé.
- **Tranches et rebases** : les tickets du matin ont été livrés en tranches de moins de 400 lignes,
  dans l'ordre des numéros de migration (35 à 40) ; chaque tranche `sensible` a été relue par
  `relecteur-sensible` avant sa fusion et porte le label `a-relire-fable`. L'après-midi aussi, chaque demande `sensible` a été relue
  par `relecteur-sensible` et porte `a-relire-fable` ; #231 (#213), non `sensible`, a été relue par une
  session distincte.
- **Répartition entre modèles** (#143) : le code des tickets `sensible` est écrit par le sous-agent
  `dev-sensible` et relu par `relecteur-sensible` ; les autres demandes sont relues par une session
  distincte. Les commits des sous-agents portent leur propre ligne `Co-Authored-By`.

- **Phase 2, décisions de conception** (prises ticket par ticket, écrites dans les spécifications citées) :
  - les vues et fonctions recréées sans condition par d'anciennes migrations ne gagnent pas de colonnes (ADR 0006) : salaires et transport comptent dans la colonne d'entretien du compte de résultat (« Entretien, salaires et transport »), routes et tarifs passent par le jsonb `ships` de `ship_rules` ;
  - le droit de port est un forfait par classe de navire, modulé par la cité d'arrivée et payé au départ ;
  - l'arrivée est une étape du tick qui ne traite que les voyages échus, écart assumé avec l'évaluation paresseuse des trajets (13) ;
  - l'écran Carte place les cités sur un schéma sans distance : la configuration ne donne pas de coordonnées.
- **Lancement en local** (#320) : `pnpm local:api`, `local:engine`, `local:web` et `local:admin` lancent chaque application depuis la racine, sous Windows comme ailleurs ; Supabase Studio est ouvert en local sur le port 54323.
- **Relectures de la phase 2** : chaque demande `sensible` a été relue par `relecteur-sensible`, et relue à nouveau après la correction d'un point bloquant ; elles portent toutes `a-relire-fable`.
  Les tickets ordinaires (#254, #291) ont été relus par une session distincte.

## Points en suspens

À décider ou à faire par un humain :

- **#33, préproduction** : serveur, nom de domaine, secrets ; reporté par le propriétaire, qui préfère développer et tester en local jusqu'à une version à mettre en ligne.
- **Critère de sortie de la phase 1** : retenu et vérifié par le code (`docs/specs/17-feuille-de-route.md`), par délégation du propriétaire ;
  il reste à l'éprouver avec des joueurs réels, une fois le serveur en place.
- **Branches fusionnées** : les branches `claude/*` restent sur GitHub, la session n'a pas le droit de les supprimer.
  Le propriétaire peut supprimer toutes les branches sauf `main` : aucune ne porte de travail non fusionné.
- **Équilibrage (#78)** : décidé par délégation du propriétaire et décrit en 5.5 (demande de fusion #242).
  Le banc joue 10 jours de mise en route puis 30 jours mesurés avec 28 maisons scriptées, et ses bornes sont écrites : coût du panier de 0 à 2 % sur vingt jours, besoins vitaux couverts à 98 % au moins, population qui ne baisse pas.
  Limite connue : la masse monétaire croît d'environ 60 000 oboles par jour, faute de puits suffisants ; la phase 2 la borne (#283).
- **Indice des prix** (relevé par #181) : panier d'un jour de consommation de référence et cible de 0 à 3 %, retenus par délégation avec le calibrage de #78 ;
  l'inflation est annoncée connue dès le 31e jour, sur une fenêtre précédente encore partielle.
- **PostgreSQL 17** : la pile locale et `ci` l'utilisent ; rien ne l'impose encore sur le futur serveur (#33).
  Le serveur devra aussi garder `max_prepared_transactions = 0` (ADR 0003), ce que rien ne vérifie.

Défauts connus :

- **Interblocage récolte et tick** (#333) : depuis l'arrivée des voyages, une récolte et le tick peuvent s'interbloquer quand une maison reçoit dans une cité un bien qu'elle y vend aux PNJ.
  Postgres annule l'une des deux transactions en entier, sans double effet : le tick est repris au passage suivant, mais le joueur dont la récolte est annulée reçoit une erreur interne ; #333 fera rejouer automatiquement la commande.
- **Étape d'arrivée d'un seul tenant** : tous les voyages échus d'un monde sont déchargés dans la transaction de son tick ; une erreur sur l'un d'eux ferait échouer tout le tick du monde.

- **Non suivis en ticket, relevés en relecture** :
  - le rapprochement d'audit de #208 n'est exécuté par aucune vue ni tâche ;
  - la Vigie n'envoie aucune alerte : il faut l'ouvrir ;
  - la lecture des usages (#191, #200) parcourt sites, stocks et ordres de tous les mondes à chaque
    affichage des Paramètres ;
  - `deploy.sh` lui-même n'a jamais tourné, faute de serveur.
- **Tests d'intégration partageant une base** : certains programment des versions de configuration et les annulent à la fin (#354), sauf à moins d'une minute de l'échéance, ce que la base refuse.
  Deux suites lancées en même temps sur la même base peuvent encore se gêner.
  Les scripts lancent une suite à la fois en local, et en `ci` l'api et le reste ont chacun leur base.
- **Test instable de l'agora** (ex-#98) : une cause établie (service worker), une autre non prouvée ; les
  traces d'un test rejoué sont désormais gardées en artefact de `ci` (`e2e-traces`).

Limites assumées pour l'instant :

- Le transport est en jeu, mais à paramètres neutres : il ne coûte rien tant que le calibrage (#283) n'a pas fixé provisions, droit de port et entretien des navires.
- Pas de temps réel : un écran ne se met à jour qu'après une action ou un rechargement ; seule la carte
  des sites relit ses sites et ses règles chaque minute (onglet visible), et l'heure du serveur au retour sur
  l'onglet.
- La variation sur 24 heures se juge à l'heure du navigateur et sur les 200 derniers chandeliers lus :
  avec des chandeliers très courts sur un marché très actif, elle est annoncée inconnue.
- Le prix moyen observé est dit « sur N h » ou passé selon l'heure du navigateur, elle aussi : une horloge
  décalée fausse ce choix, et la fenêtre annoncée se terminait au calcul, pas à l'instant de lecture.
- La fiche d'un site estime « à récolter » à l'heure du serveur (en-tête `Date`, à la seconde près) ;
  l'API reste seule à décider.
- Une base déjà initialisée ne taxe pas, ne prélève aucun entretien, garde sa population constante et a
  un indice des prix inconnu tant qu'une version de configuration qui porte `marketTax`,
  `sites.upkeep`, `populationDynamics` et `priceIndex` n'a pas été publiée dans Olympe, programmée par un
  second compte et activée à une clôture. « En jeu » vaut pour une base neuve.
- Aucun usage d'IA en jeu à ce stade : la passerelle existe, aucun usage ne l'appelle encore.
