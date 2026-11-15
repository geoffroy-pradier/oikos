# 4. Systèmes de gestion

La maison se gère sur sept systèmes qui partagent les mêmes stocks, la même trésorerie et le même personnel. Chaque système est jouable seul, mais la rentabilité vient de leur combinaison.

## 4.1 La maison (oikos)

- **Siège** : bâtiment évolutif (10 niveaux) qui fixe le nombre de sites gérables et de postes d'intendant.
- **Trésor et comptes** : compte de résultat et bilan tenus automatiquement, consultables par jour, saison et année, avec marge par filière et par site.
  Dans la première version, les comptes sont trois vues en lecture seule, que le joueur lit pour sa seule maison ; elles sont calculées à la lecture depuis le grand livre, qui fait foi, et rien n'y est recopié.
  Flux de trésorerie (`my_cash_flows`) : par compte (trésorerie, séquestre), jour de jeu et nature, en oboles, crédit positif.
  Natures : ventes (`sales`, au brut : prix × quantité de l'échange), taxes (`taxes` : l'écart entre ce brut et le net crédité), achats (`purchases`), entretien (`upkeep` : clôture et relance), acquisitions (`acquisitions`), dotation de départ (`grant`), séquestre (`escrow` : monnaie retenue pour un achat en attente, ou rendue) et `other` pour toute écriture d'une nature que la vue ne connaît pas encore.
  Chaque ligne du grand livre y est comptée une fois et en entier : la somme des flux d'un compte sur une période est la variation de son solde, et un flux de somme nulle n'est pas affiché.
  Un achat en attente quitte la trésorerie le jour où son prix est retenu (nature séquestre) ;
  servi plus tard, c'est un achat du compte de séquestre, pas de la trésorerie.
  Le jour de jeu d'une écriture (section 3) est celui de sa date, le début de sa transaction, lu avec l'heure de clôture et le fuseau de la configuration en vigueur à la lecture : changer l'horloge reclasse donc les écritures passées, et sans horloge en vigueur le jour est inconnu sans qu'aucun flux disparaisse.
  Limite : une vente dont la taxe prend tout le montant (une obole) ne crédite rien au vendeur et n'apparaît donc ni en vente ni en taxe.
  Compte de résultat (`my_income_statement` par jour de jeu, `my_income_statement_by_season` par saison) : dérivé des flux de trésorerie, en oboles, tenu au flux de trésorerie.
  Un produit ou une charge est compté le jour où la monnaie change de mains, avec le signe du flux (une charge est négative) ;
  il n'y a ni variation de stock ni amortissement, les stocks sont au bilan.
  La monnaie de la maison y est sa trésorerie plus son séquestre : retenir ou rendre le prix d'un achat en attente est un mouvement entre ses deux comptes, sans effet sur le résultat, et l'achat est une charge le jour où il est servi (au flux de la seule trésorerie, un achat payé par le séquestre ne serait jamais une charge).
  Exploitation : ventes au brut, achats, taxes, entretien ; leur somme est le résultat (`operating_result`).
  Hors exploitation (`non_operating`) : acquisitions de sites, dotation de départ, et `other` pour tout le reste.
  Résultat plus hors exploitation font la variation de la monnaie de la maison sur la période (`cash_change`), dont `escrow_change` est la part du séquestre : la variation de la trésorerie seule est leur différence.
  La saison d'un jour de jeu est celle du moteur (`seasonIndexAt`) : des saisons de `seasonDays` jours de jeu (au plus 366) comptés depuis le lundi 5 janvier 1970, lues comme le jour avec l'horloge en vigueur à la lecture ;
  la vue par saison donne le premier et le dernier jour de jeu de chacune.
  Sans durée de saison utilisable, la saison est inconnue et la vue par saison rend une seule ligne par maison ;
  si la base ne connaît pas le fuseau de la configuration, le jour et la saison sont inconnus.
  Dans les deux cas aucun montant ne disparaît.
  Stocks valorisés (`my_valued_stocks`) : chaque stock non vide, part réservée par les ventes en attente comprise, au prix de référence observé du marché de sa cité (5.3), le dernier calculé, avec sa date.
  Ce prix moyen est préféré au prix du dernier échange : un échange isolé à un prix aberrant ne déplace pas le bilan.
  Un bien qui n'a jamais eu de prix observé dans la cité n'a ni prix ni valeur ;
  aucun prix n'est inventé à sa place.
  Bilan (`my_balance_sheet`) : trésorerie, séquestre (nul tant que la maison n'a pas eu d'achat en attente), valeur des stocks qui ont un prix, et nombre de stocks sans prix, que cette valeur ignore. Les sites n'y figurent pas : leur prix d'acquisition est détruit.
- **Famille** : conjoint, héritiers, parents, chacun avec 2 ou 3 traits. Un membre peut être placé à la tête d'un site ou envoyé en ambassade. Les mariages entre maisons de joueurs créent une alliance formelle (accès croisé aux entrepôts, clause d'entraide).
- **Timè** : monte avec les contrats honorés, les liturgies et les mandats bien tenus ; baisse avec les défauts de paiement et les sanctions. Elle conditionne le crédit, l'éligibilité et les prix obtenus des PNJ.

## 4.2 Les domaines

La carte de chaque cité est découpée en parcelles finies (200 à 600 par cité), chacune avec un terrain, une fertilité et un accès à l'eau. La rareté du foncier est voulue : elle crée un marché immobilier rural et une rente.

| Type de site | Production | Particularité |
| --- | --- | --- |
| Champ | Blé, orge, lin | Cycle saisonnier, rotation des cultures, risque météo |
| Verger et vigne | Olives, raisin, figues | 2 saisons avant la première récolte, rendement croissant |
| Pâture | Laine, lait, cuir | Demande du fourrage |
| Forêt | Bois, miel, gibier | S'épuise si surexploitée, se régénère |
| Carrière et mine | Marbre, argile, cuivre, fer, argent | Concession accordée aux enchères par la cité, durée limitée |
| Pêcherie et saline | Poisson, sel | Exige un accès côtier |

Dans la première version : une maison acquiert un site dans sa cité en choisissant sa recette ;
le type du site est celui de la recette, et son prix, fixé par type dans la configuration, est détruit (puits « acquisition de sites »).
La commande porte le prix que le joueur a vu : un autre tarif en vigueur est refusé (« le prix a changé »), rien n'est payé ;
comme pour la relance (5.5), ce prix est facultatif pour un client antérieur, servi au tarif en vigueur, et il est retenu avec la clé d'une acquisition restée sans réponse : un nouvel essai renvoie ce prix sous la même clé, même si le tarif affiché a changé entre-temps.
Le nombre de sites d'une maison est borné par le niveau de son siège (toute maison est au premier niveau).
Un site peut changer de recette parmi celles de son type : ce qu'il a déjà produit doit d'abord être récolté, le cycle entamé est perdu et le nouveau commence à l'instant du changement.
Il n'y a encore ni carte des parcelles, ni fertilité, ni marché foncier.
Le terroir de la cité (6.1) restreint les productions primaires : un site reste dans la cité de sa maison, et n'y lance qu'une production de son terroir ; un atelier est admis partout.
Une acquisition ou un changement de recette hors terroir est refusé (« hors du terroir de la cité »), sans rien payer ni changer : le refus passe avant le prix et avant la relance gratuite d'un site sans recette.
Un site qui exploite une production sortie du terroir (version de configuration qui le resserre) continue de produire, se récolte et se relance comme avant ; une fois qu'il l'a quittée, il n'y revient plus.
Un site à l'arrêt faute d'entretien payé (5.5) se récolte pour ce qu'il avait accumulé avant son arrêt, et pas davantage (un atelier, lui, ne se récolte pas à l'arrêt : voir 4.3) : pour lui, le temps s'est arrêté à cet instant, le cycle entamé reste gelé et reprend à la relance.
Il ne change pas de recette tant qu'il est à l'arrêt (refus « site à l'arrêt ») : il faut le relancer d'abord.

Recette retirée : une version de configuration peut retirer une recette qu'un site exploite encore.
Ni la publication ni l'activation ne le refusent (Olympe le dit avant la programmation, nombre de sites et de maisons, et la fait confirmer si la version en vigueur la contient encore : 15.2) : un refus lierait l'équilibrage aux choix passés des joueurs (pilier « Tout est réglable », section 1), et la configuration resterait bloquée tant qu'un seul site exploiterait la recette.
Le repli est dans les commandes. Un tel site n'a plus de type, donc ni tarif ni entretien (5.5), ni production : il est à l'arrêt faute de recette.
Il ne se récolte plus (refus « production retirée »), à l'arrêt ou non, et un atelier n'y consomme aucun intrant.
Il peut changer de recette sans récolte préalable : ce qu'il avait accumulé est perdu avec le cycle entamé, et le nouveau cycle commence à l'instant du changement.
Faute de type, il peut adopter n'importe quelle recette de la configuration que le terroir de sa cité admet, et prend le type de celle-ci ;
chercher son ancien type dans l'historique des versions demanderait à l'écran comme à l'API de relire des versions qui ne sont plus en vigueur, pour un cas que le back-office provoque.
Limite : ce changement de type est gratuit, alors que le prix d'acquisition dépend du type ;
retirer une recette offre donc à chaque site qui l'exploitait le type de son choix, et c'est au concepteur de jeu d'en tenir compte.
Un site sans recette à l'arrêt (arrêté avant le retrait) change de recette quand même : sans tarif, l'arrêt est levé sans rien payer (événement de relance à zéro obole), comme le ferait une relance ou la clôture, puis la nouvelle recette commence.
Une version qui rend la recette la rend aussi aux sites qui ne l'ont pas quittée : ils reprennent leur cycle là où il en est, le temps passé sans recette compté comme du temps de production, dans la limite du plafond d'accumulation.
Rien n'est migré ni dédommagé automatiquement. L'écran dit qu'un tel site est à l'arrêt faute de production (aussi parmi les sites à surveiller), ne propose ni récolte ni relance ni entretien, et propose toutes les productions avec leur type.

Partage des contrôles : la base garantit qu'un changement de recette repart d'un cycle neuf, si bien qu'aucune production de l'ancienne recette n'est récoltée sous la nouvelle.
Un site n'a pas de type enregistré : son type se déduit de sa recette, que seule la configuration connaît.
L'existence de la recette, celle de la recette en cours comprise, et sa compatibilité avec le type du site sont donc vérifiées par la commande, pas par la base.
Si une récolte du même site aboutit pendant le changement de recette, celui-ci est refusé (« le site vient de changer ») : le joueur réessaie, et le client envoie alors une nouvelle clé d'idempotence, puisqu'un refus reste attaché à la sienne.
Une acquisition restée sans réponse garde sa clé, même onglet quitté ou page rechargée (stockage de session, par maison) : la renvoyer rejoue l'achat au lieu de le payer deux fois.
Même aboutie, elle ne rend sa clé qu'à la relecture qui montre le site acquis : un écran rouvert pendant l'envoi, qui lit encore l'ancien nombre de sites, renvoie la même clé (l'API rejoue l'achat) au lieu d'en payer un second.
Un succès reçu par un écran quitté n'est pas annoncé : le nouvel écran rend la clé en silence quand la liste montre le site.
Un clic pendant une autre commande n'envoie rien et ne crée aucune clé.
L'intention comprend le nombre de sites de la maison : si la relecture montre le site acquis, vouloir de nouveau la même production est un nouvel achat.
Tant que les sites de la maison ne sont pas lus (écran qui se rouvre, lecture en échec), leur nombre est inconnu : l'acquisition n'est pas proposée et rien n'est envoyé, car les compter pour zéro donnerait une clé neuve à un achat peut-être déjà abouti.
Sans réponse, si la relecture montre un site de plus qu'à l'envoi, l'écran renvoie de lui-même la même clé, une fois : l'API dit alors l'issue.
Si elle reste inconnue, une lecture qui montre N sites abandonne la clé d'une acquisition demandée avec moins de N sites (le nombre de sites ne diminuant pas dans cette version, elle ne serait plus renvoyée), et l'écran prévient à ce moment-là, à la fin d'une commande comme au retour sur l'écran ou sur l'onglet : un site de plus apparaît, la liste est à vérifier, un nouvel essai serait un nouvel achat.
Cet avertissement est rappelé à chaque ouverture de l'écran tant que le joueur n'a pas dit avoir vérifié la liste ni lancé une nouvelle acquisition.
Pour une acquisition comme pour la relance d'un site, une clé reste aussi en attente après un refus rendu avant le registre de l'API (session expirée, trop de demandes), qui ne dit rien de l'issue, tandis qu'une clé absente ou mal formée, que l'API n'a jamais pu consommer, est rendue.
Sans stockage de session (navigation privée), les clés sont gardées en mémoire : elles survivent au changement d'écran, pas au rechargement de la page.
Le jour où une maison pourra céder un site, ce nombre ne suffira plus à distinguer les intentions.
Ce que l'écran annonce comme récoltable est calculé à l'heure du serveur, lue dans l'en-tête `Date` des réponses de l'API (route de santé à l'ouverture, puis chaque commande), et non à l'horloge du navigateur : l'en-tête, à la seconde près, garde l'horloge du navigateur quand elle lui est compatible et sinon la corrige au milieu de l'intervalle qu'il permet (à une seconde environ près) ;
c'est la commande de récolte qui fait foi. Au retour sur un onglet resté en arrière-plan, l'heure, les sites et leurs règles (prix, entretien) sont relus ;
les sites et les règles le sont aussi chaque minute tant que l'onglet est visible, hors commande en cours.
Un arrêt prononcé par la clôture pendant que la fiche est ouverte est ainsi affiché, et annoncé (région d'alerte) à la relecture qui le découvre ;
la première lecture ne l'annonce pas, la fiche le dit déjà.

## 4.3 Les ateliers

Un atelier applique des recettes : intrants, durée, personnel requis, extrant. Trois leviers le différencient.

- **Qualité** (0 à 100) : dépend de la qualité des intrants, du niveau de l'artisan et de l'outillage. Elle segmente la demande : le peuple achète le prix, les riches achètent la qualité.
- **Marque** : à partir d'un seuil de volume et de qualité, une maison peut déposer un sceau. Un sceau reconnu se vend plus cher et se contrefait (voie d'Hermès).
- **Cadence** : production normale, forcée (plus rapide, usure et fatigue) ou soignée (plus lente, qualité accrue).

Dans la première version : un atelier se récolte comme un site de matière première.
À la récolte, chaque cycle écoulé consomme ses intrants dans le stock libre de la maison dans la cité du site (le stock réservé par des ordres de vente n'est pas touché) et livre ses extrants.
À court d'intrants, le cycle attend : les cycles que le stock permet tournent, le temps des autres reste dû et se rattrape à une récolte suivante, une fois l'atelier réapprovisionné.
Ce rattrapage ne dépasse jamais le plafond d'accumulation du site : à tout moment, les cycles récoltés d'un coup et les cycles encore dus ne font pas ensemble plus que ce plafond ;
au-delà, le temps perdu est perdu. Les intrants ne sont demandés qu'au moment de la récolte.
Un atelier change de recette comme tout site (4.2) : il doit d'abord être récolté s'il a de quoi tourner ;
à court d'intrants, il n'a rien produit, change de recette aussitôt, et ses cycles en attente sont perdus avec le cycle entamé.
Qualité, marque, cadence et personnel ne sont pas encore simulés.
Un atelier dont la recette a quitté la configuration ne se récolte pas non plus (4.2).
Un atelier à l'arrêt faute d'entretien payé (5.5) ne consomme aucun intrant : il ne se récolte pas tant qu'il est à l'arrêt (refus « site à l'arrêt »), même réapprovisionné entre-temps.
Pour un atelier, rien n'est « accumulé » tant que les intrants ne sont pas consommés : les cycles écoulés avant l'arrêt restent dus, dans la limite du plafond, et tournent à la première récolte après la relance.

## 4.4 Le personnel

- **Travailleurs** : salariés recrutés sur le marché du travail de la cité, dont le salaire d'équilibre dépend de l'offre et de la demande locales. Moral influencé par salaire, logement, fêtes et cadence.
- **Artisans** : personnages nommés, avec métier, niveau, traits et prétentions. Ils se forment, se débauchent et peuvent partir.
- **Intendants** : PNJ animés par IA qui gèrent un site selon des consignes en langage naturel (« vends l'huile au-dessus de 12 drachmes, sinon stocke »), traduites en règles vérifiables. Un intendant = une file d'opérations parallèle.

## 4.5 L'immobilier urbain

Héritage direct des jeux de référence, relié au reste de l'économie.

- **Biens** : immeubles de rapport, maisons, boutiques, entrepôts, auberges, bains.
- **Loyer d'équilibre** : fonction de l'attractivité du quartier (temples, marché, sécurité, nuisances des ateliers) et de la population de la cité. Les travailleurs des joueurs doivent être logés : la pénurie de logements fait monter les salaires.
- **Cycle** : achat, rénovation, location, revente ; vétusté et entretien ; ventes aux enchères après saisie.
- **Urbanisme** : le zonage et les permis sont décidés par le magistrat élu (astynome).

## 4.6 La flotte et les caravanes

Les prix diffèrent d'une cité à l'autre ; le transport est le métier qui les rapproche. Un trajet a une durée (2 à 20 heures réelles), un coût, une capacité et un risque (tempête, piraterie), réduit par la saison, l'escorte et la faveur de Poséidon. Trois classes de navires au lancement : caboteur, navire rond de commerce, galère d'escorte. Le fret peut être vendu à d'autres joueurs.

## 4.7 Le savoir

La recherche est collective : chaque cité finance une école et choisit par vote les savoirs étudiés (irrigation, voile, comptabilité, alliages). Un savoir acquis profite à tous les citoyens, ce qui différencie les cités et nourrit les migrations.
