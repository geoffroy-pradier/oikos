# État du projet

Point d'étape au 15 novembre 2026, vers 13 h (heure de Paris). Pendant la session, dix tickets ont été fermés :
#77, #161, #97, #100, #136, #123, #130, #145, #155 et #158. #78 (équilibrage) a reçu son banc de mesure ;
ses décisions de calibrage attendent un humain. Ce fichier décrit ce qui tourne réellement sur `main` ; les
spécifications (`docs/specs/`) décrivent la cible.

## Où en est la feuille de route

- **Phase 0 (fondations)** : terminée, sauf le ticket #33 (serveur de préproduction), marqué
  `needs-human` : il demande de commander un serveur, un nom de domaine et de saisir des secrets.
  Rien n'est donc déployé : le jeu ne tourne qu'en local et en intégration continue.
- **Phase 1 (prototype « une cité »)** : en cours.
  - Fermés : #64 à #77, #97, #98, #100, #123, #130, #136, #145, #155, #158 et #161.
  - Ouvert, partiellement livré : #78 (équilibrage). Le banc de mesure est fusionné (#215, #223, puis #224 pour les mesures) ; le calibrage attend les décisions humaines décrites plus bas.
  - Suivis des relectures, ouverts et pas commencés : #176, #181, #184, #191, #200, #205, #208, #213, #218 et #222.
    Tous sont `sensible`, sauf #213.

## Ce qui est jouable aujourd'hui

En local (procédure dans le `README.md`), dans une seule cité, Kallistè :

- **Compte et maison.** Connexion par lien magique (courriel). Création d'une maison : nom, blason, cité.
  La maison reçoit 3 000 oboles et un champ de blé. La commande de renommage existe dans l'API, sans écran.
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
- **Population des PNJ : en jeu.** Chaque classe de chaque cité croît ou émigre à la clôture selon la
  couverture de ses besoins vitaux la veille ; la demande des PNJ suit la population courante. L'onglet
  Cité montre la population par classe et la couverture retenue.
- **Agora.** Carnet d'ordres à cours limité par bien : ventes et achats attendent dans le carnet, une vente
  réserve son stock, un achat met son prix sous séquestre. Exécution à l'arrivée, au prix de l'ordre qui
  attendait ; annulation d'un ordre ouvert. Le carnet public montre les deux côtés par niveau de prix,
  sans identité.
- **Taxe de marché.** Chaque échange de l'agora, entre joueurs comme avec les PNJ, prélève 5 % sur le
  vendeur, arrondis à l'obole supérieure : la moitié est détruite, l'autre va au trésor de la cité, que
  rien ne dépense encore. Le formulaire de vente annonce le net attendu.
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
  et en anglais. Onglets Maison, Agora et Cité ; Carte et Messages sont des coquilles vides. Une nouvelle
  version est proposée, jamais imposée pendant une saisie. Une acquisition restée sans réponse garde sa
  clé d'idempotence, même onglet quitté : la renvoyer rejoue l'achat au lieu de le payer deux fois.
- **Back-office Olympe.** Connexion avec second facteur, Vigie (compteurs de refus de l'API, ticks et
  clôtures en échec sur 24 heures avec la dernière erreur ; elle montre si la double validation est levée), Paramètres (versions de configuration : consulter, comparer,
  enregistrer, programmer à la prochaine clôture, annuler une programmation à venir ; un refus du
  schéma désigne la table, la ligne et le champ ; un texte modifié n'est jamais remplacé sans
  confirmation), journal d'audit, Accès (liste des rôles, accorder par identifiant de compte, retirer
  après confirmation ; réservé au super-administrateur). Une version n'est programmable que par un
  autre compte que son auteur. Procédure écrite d'accès : `docs/exploitation/` (premier enrôlement,
  appareil perdu, retrait). Économie : masse monétaire par nature de compte, robinets et puits par jour de
  jeu, indice des prix sur un panier de six biens et inflation sur 30 jours, avec une alerte écrite
  quand elle sort de la cible de 0 à 3 % (la mesure est dite inconnue tant qu'un bien du panier n'a
  aucun échange dans l'une des deux fenêtres ; elle peut donc être annoncée dès le 31e jour, sur une
  fenêtre précédente partielle, #181). Paramètres : formulaires des biens (ajout et retrait compris), des recettes et des classes de PNJ, à côté
  du texte JSON (#77). Une version qui change l'horloge du monde (durée du tick, heure ou fuseau de clôture)
  est refusée, et une programmation ne peut viser une clôture à moins d'une minute. Le premier
  super-administrateur s'inscrit à la main en base. Le `Caddyfile` du futur serveur pose une politique de contenu et des en-têtes de
  sécurité sur les deux clients, vérifiés en `ci` ; en local, servis par Vite, ils ne les portent pas.

Ce qui manque encore pour le critère de sortie de la phase 1 : l'équilibrage (#78). Le banc de mesure existe
(voir « Points en suspens »), mais la configuration initiale n'a pas été ajustée. Il faut d'abord trancher
la taille de la cité prototype, la consommation par habitant et le taux de croissance.

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
  d'abandonner la clé (suivis : #176). Les résultats sont annoncés dans des régions vivantes
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
  Un refus au COMMIT devient une erreur métier du registre (`CONFIG_ACTIVATION_TOO_LATE`), rejouable sous
  la même clé. Limite connue : `SET CONSTRAINTS ALL IMMEDIATE` contourne ce contrôle (#208).
- **Session de base fermée** (14.3, ticket #136) : une connexion coupée en cours de commande, de tick ou de
  clôture ne fait échouer que ce passage. La trace d'audit est écrite par une autre connexion, la clé
  d'idempotence reste utilisable et le passage suivant rejoue une seule fois.
- **Règlement d'un échange** (5.3, ticket #100) : la base contrôle qu'un échange est réglé par sa propre
  écriture, du brut exact, réparti entre net et taxe, et qu'un séquestre ne paie que les échanges de sa
  maison ou rend à sa trésorerie. Suivis : #205.
- **Recette retirée** (4.2, ticket #97) : un site dont la recette a disparu de la configuration est à l'arrêt
  faute de production, sans erreur interne ; sa maison peut en changer. L'avertissement avant programmation
  est suivi dans #200.
- **Entretien et prix vu par le joueur** (4.2, 5.5, ticket #145) : le client envoie le prix qu'il affiche,
  et une clé en attente repart toujours avec son entrée d'origine. Le joueur ne paie jamais deux fois, et
  jamais un autre prix que celui qu'il a vu. La clôture fixe elle-même son isolation (READ COMMITTED) et
  inscrit chaque tentative dans `telemetry.close_runs`, en ajout seul.
- **Lectures de comptes rapides** (12, ticket #155) : `jit = off` pour les rôles `anon` et `authenticated`
  plutôt qu'une réécriture des règles par ligne ; la migration fait recharger PostgREST. La vérification
  après déploiement passe par `/rest/v1/rpc/client_jit`, et la mesure est reproductible par
  `pnpm --filter @oikos/db bench:cash-flows`.
- **Migrations rejouables** (règle 9, ticket #158) : toutes se rejouent sur une base déjà migrée sans changer
  l'état final, ce que `pnpm test:db:replay` vérifie en `ci` par une empreinte du schéma. Pendant un
  rejeu, un fichier peut remettre brièvement une définition ou un droit antérieurs : #218 doit faire
  appliquer seulement les migrations nouvelles. La saison est bornée à 366 jours. Un fuseau inconnu de la
  base n'est refusé qu'à la configuration initiale ; le fuseau en vigueur ne l'est jamais.
- **Appariements d'un monde exécutés l'un après l'autre** (verrou consultatif par monde) : au plus simple,
  à revoir si la charge le demande.
- **Demande des PNJ** : ils n'achètent qu'aux ventes en attente et ne déposent pas d'ordre.
- **Limitation de débit tenue en base**, partagée entre les répliques de l'API.
- **Demandes de fusion de plus de 400 lignes** : plusieurs ont dépassé la limite du `CLAUDE.md` jusqu'au
  ticket #69, presque toujours par leurs tests d'intégration. Depuis, deux seulement : #141 (481 lignes)
  et #160 (468), acceptées en relecture ; les autres tickets sont découpés en tranches.
- **Tranches et rebases** : les tickets de la session ont été livrés en tranches de moins de 400 lignes,
  dans l'ordre des numéros de migration (36 à 40). Chaque tranche `sensible` a été relue par
  `relecteur-sensible` avant sa fusion et porte le label `a-relire-fable`.
- **Répartition entre modèles** (#143) : le code des tickets `sensible` est écrit par le sous-agent
  `dev-sensible` et relu par `relecteur-sensible` ; les autres demandes sont relues par une session
  distincte. Les commits des sous-agents portent leur propre ligne `Co-Authored-By`.

## Points en suspens

À décider ou à faire par un humain :

- **#33, préproduction** : serveur, nom de domaine, secrets. Bloque tout déploiement.
- **Critère de sortie de la phase 1** (`docs/specs/17-feuille-de-route.md`) : à confirmer par un humain
  quand les tickets seront fermés ; il demande des joueurs réels.
- **Branches fusionnées** : les branches `claude/*` restent sur GitHub, la session n'a pas le droit de les
  supprimer. À nettoyer à la main.
- **Équilibrage (#78)** : le banc d'intégration (`apps/api/src/balance/`, `balance.integration.test.ts`)
  joue 7 jours de mise en route puis 30 jours mesurés avec des maisons scriptées. Il publie la masse
  monétaire, le coût du panier, la couverture et la part de chaque puits, et rapproche chaque compte
  système de flux comptés à part. Avec la configuration initiale telle quelle, les mesures ne tiennent
  pas la cible :
  - les 23 maisons scriptées ne couvrent qu'une petite part des besoins vitaux de 10 000 habitants, et la
    population émigre (environ −39 % sur le mois) ;
  - les prix montent tant que tout se vend : le coût du panier des dix derniers jours dépasse de 20 % celui des
    dix premiers, surtout parce que la règle de prix du banc relève de 1 % par jour un prix dont tout s'est vendu ;
  - l'entretien fait 46 % des puits, la taxe 32 % et l'acquisition de sites 22 %.

  Avant d'ajuster la configuration, un humain doit décider :
  - la taille de la cité prototype au regard du nombre de joueurs attendu ;
  - la consommation par habitant face à la production d'un site ;
  - le taux de croissance et le seuil de couverture ;
  - la composition du panier et la cible d'inflation (#181).

  Les bornes du test (inflation de 0 à 3 %, besoins couverts) ne seront écrites qu'ensuite.
- **Indice des prix** (#181) : la composition du panier et la cible de 0 à 3 % sont à confirmer ;
  l'inflation est annoncée connue dès le 31e jour, sur une fenêtre précédente encore partielle.
- **PostgreSQL 17** : la pile locale et `ci` l'utilisent ; rien ne l'impose encore sur le futur serveur (#33).

Défauts connus, déjà en tickets :

- **#176, #181, #184** : suivis des relectures du rejeu d'acquisition, de l'indice des prix et de l'écran
  Économie (dont sa garde de bout en bout à 360 px). #176 porte les derniers cas étroits de double
  paiement à l'acquisition.
- **#191, #200** : un bien, une recette ou une classe retirés de la configuration alors que le monde les
  utilise encore ; Olympe devrait avertir avant la programmation.
- **#205, #208** : suivis du règlement des échanges et du contrôle à la validation des activations,
  contournable par `SET CONSTRAINTS`.
- **#213** : pas de rétention pour `telemetry.tick_runs` et `close_runs` ; une activation à l'horloge
  différente, programmée avant #123, serait encore appliquée.
- **#222** : un monde dont le fuseau quitte tzdata peut encore publier, mais ses comptes perdent jour
  de jeu et saison, et la Vigie ne le signale pas.
- **#218** : `deploy.sh` rejoue toutes les migrations ; à remplacer par l'application des seules nouvelles,
  avant d'activer le déploiement.
- **Test instable de l'agora** (ex-#98) : une cause établie (service worker), une autre non prouvée ; les
  traces d'un test rejoué sont désormais gardées en artefact de `ci` (`e2e-traces`).

Limites assumées pour l'instant :

- Une seule cité, pas de transport : tout stock est dans la cité de la maison (l'affichage par cité de
  l'entrepôt est prêt, sans être encore atteignable).
- Pas de temps réel : un écran ne se met à jour qu'après une action ou un rechargement ; seule la carte
  des sites relit ses sites, ses règles et l'heure chaque minute et au retour sur l'onglet.
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
- Aucun usage d'IA en jeu à ce stade.
