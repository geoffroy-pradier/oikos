# 4. Systèmes de gestion

La maison se gère sur sept systèmes qui partagent les mêmes stocks, la même trésorerie et le même personnel. Chaque système est jouable seul, mais la rentabilité vient de leur combinaison.

## 4.1 La maison (oikos)

- **Siège** : bâtiment évolutif (10 niveaux) qui fixe le nombre de sites gérables et de postes d'intendant.
- **Trésor et comptes** : compte de résultat et bilan tenus automatiquement, consultables par jour, saison et année, avec marge par filière et par site.
  Dans la première version, les comptes sont trois vues en lecture seule, que le joueur lit pour sa seule maison ; elles sont calculées à la lecture depuis le grand livre, qui fait foi, et rien n'y est recopié.
  Flux de trésorerie (`my_cash_flows`) : par compte (trésorerie, séquestre), jour de jeu et nature, en oboles, crédit positif.
  Natures : ventes (`sales`, au brut : prix × quantité de l'échange), taxes (`taxes` : l'écart entre ce brut et le net crédité), achats (`purchases`), entretien (`upkeep` : clôture et relance, rénovation d'un bien immobilier, écriture `property.renovate`, 4.5), salaires (`wages` : clôture et relance, 4.4), acquisitions (`acquisitions` : un site, un navire, un bien immobilier acheté à la cité, écriture `property.buy`, ou acheté à une autre maison et cédé par elle, écriture `property.sale`, 4.5), loyers (`rents` : écriture `lease.rent`, négatifs pour le locataire, positifs pour le propriétaire, 4.5), transport (`transport` : provisions et droit de port payés au départ d'un voyage, écriture `voyage.departure`, 4.6), dotation de départ (`grant`), séquestre (`escrow` : monnaie retenue pour un achat en attente, ou rendue) et `other` pour toute écriture d'une nature que la vue ne connaît pas encore.
  Une écriture peut porter plusieurs natures : une ligne du grand livre marquée d'une nature (`ledger_lines.nature`, 12) est rangée sous ce marqueur, une ligne sans marqueur sous la nature de son écriture.
  Ainsi l'écriture d'entretien d'une clôture ou d'une relance porte une ligne `upkeep` et une ligne `wages`.
  La revente d'un bien entre maisons se lit comme une vente de l'agora : le vendeur, qui lit le prix de son offre vendue, voit la cession au brut en `acquisitions` (positive) et l'écart avec le net crédité en `taxes` ; l'acheteur voit le prix en `acquisitions` (négatif).
  L'entretien des navires, prélevé dans la même écriture de clôture, a sa propre ligne marquée `upkeep`, vers son puits (4.6) ; celui des biens immobiliers aussi (4.5).
  La rénovation d'un bien marque elle aussi son débit `upkeep`.
  Un ticket qui ajoute une écriture de maison lui donne sa nature ici.
  Chaque ligne du grand livre y est comptée une fois et en entier : la somme des flux d'un compte sur une période est la variation de son solde, et un flux de somme nulle n'est pas affiché.
  Un achat en attente quitte la trésorerie le jour où son prix est retenu (nature séquestre) ;
  servi plus tard, c'est un achat du compte de séquestre, pas de la trésorerie.
  Le jour de jeu d'une écriture (section 3) est celui de sa date, le début de sa transaction, lu avec l'heure de clôture et le fuseau de la configuration en vigueur à la lecture : changer l'horloge reclasse donc les écritures passées, et sans horloge en vigueur le jour est inconnu sans qu'aucun flux disparaisse.
  Limite : une vente dont la taxe prend tout le montant (une obole) ne crédite rien au vendeur et n'apparaît donc ni en vente ni en taxe.
  Compte de résultat (`my_income_statement` par jour de jeu, `my_income_statement_by_season` par saison) : dérivé des flux de trésorerie, en oboles, tenu au flux de trésorerie.
  Un produit ou une charge est compté le jour où la monnaie change de mains, avec le signe du flux (une charge est négative) ;
  il n'y a ni variation de stock ni amortissement, les stocks sont au bilan.
  La monnaie de la maison y est sa trésorerie plus son séquestre : retenir ou rendre le prix d'un achat en attente est un mouvement entre ses deux comptes, sans effet sur le résultat, et l'achat est une charge le jour où il est servi (au flux de la seule trésorerie, un achat payé par le séquestre ne serait jamais une charge).
  Exploitation : ventes au brut, achats, taxes, charges courantes ; leur somme est le résultat (`operating_result`).
  La colonne de l'entretien (`upkeep`) y porte les charges courantes : entretien des sites, des navires et des biens immobiliers, rénovation des biens, salaires et transport, dont `my_cash_flows` donne le détail par nature.
  Décision (#252, ADR 0006) : le transport y entre plutôt que dans une vue nouvelle, comme les salaires avant lui ; l'écran Comptes la libelle « Entretien, salaires et transport ».
  Les colonnes du compte de résultat sont figées : la migration qui l'a créé le recrée tel quel quand la suite des migrations est rejouée, ce qu'une colonne de plus rendrait impossible.
  Une nature nouvelle y entre dans une colonne existante, ou dans une vue nouvelle.
  Décision (#257, ADR 0006) : les loyers d'un jour y entrent par leur net, dans les ventes (`sales`, produits d'exploitation) quand il est positif, dans les charges courantes (`upkeep`) quand il est négatif : un loyer reçu est une recette, un loyer payé une charge.
  Une maison qui reçoit et paie des loyers le même jour n'en voit que le solde, dont `my_cash_flows` donne le détail.
  Hors exploitation (`non_operating`) : acquisitions de sites, de navires et de biens immobiliers, cession d'un bien à une autre maison, dotation de départ, et `other` pour tout le reste.
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
  Bilan (`my_balance_sheet`) : trésorerie, séquestre (nul tant que la maison n'a pas eu d'achat en attente), valeur des stocks qui ont un prix, et nombre de stocks sans prix, que cette valeur ignore.
  Les sites, les navires et les biens immobiliers n'y figurent pas : leur prix d'acquisition est détruit, ou versé au vendeur d'un bien revendu.
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
  Dans la première version (ticket 255), les travailleurs sont attachés à leur site : sa recette dit combien il en faut (`workers`), et il n'y a pas de commande d'embauche.
  Chacun est payé chaque jour le salaire du jour de la cité du site, un paramètre du back-office par cité (`staff.dailyWageOboles`), nul dans la configuration initiale ; une version publiée avant le personnel, ou une cité qu'elle ne nomme pas, ne paie aucun salaire.
  Une section `staff` non vide nomme chaque cité de la configuration, et elles seules.
  Salaires d'un site pour un jour = travailleurs × salaire du jour, en oboles, sans arrondi.
  Ils sont payés à la clôture avec l'entretien du site, en entier ou pas du tout, et détruits (puits `sink_npc_wages`, 5.5) ; un site dont les salaires sont impayés est à l'arrêt comme un site dont l'entretien l'est.
  Le salaire du jour est une règle publique, lue par les joueurs avec les règles des sites (vue `site_rules`, clé `staff` de la colonne `sites`).
  Le salaire d'équilibre, le logement et le moral viendront ensuite (#258).
- **Artisans** : personnages nommés, avec métier, niveau, traits et prétentions. Ils se forment, se débauchent et peuvent partir.
- **Intendants** : PNJ animés par IA qui gèrent un site selon des consignes en langage naturel (« vends l'huile au-dessus de 12 drachmes, sinon stocke »), traduites en règles vérifiables. Un intendant = une file d'opérations parallèle.

## 4.5 L'immobilier urbain

Héritage direct des jeux de référence, relié au reste de l'économie.

- **Biens** : immeubles de rapport, maisons, boutiques, entrepôts, auberges, bains.
- **Loyer d'équilibre** : fonction de l'attractivité du quartier (temples, marché, sécurité, nuisances des ateliers) et de la population de la cité. Les travailleurs des joueurs doivent être logés : la pénurie de logements fait monter les salaires.
- **Cycle** : achat, rénovation, location, revente ; vétusté et entretien ; ventes aux enchères après saisie.
- **Urbanisme** : le zonage et les permis sont décidés par le magistrat élu (astynome).

Phase 2, première version (#256) :

- **Un seul bien, le logement, en deux tailles** : la maison de ville (`townhouse`) et l'immeuble de rapport (`tenement`).
  Boutiques, entrepôts, auberges, bains, zonage, permis et ventes aux enchères attendent la phase 3.
- **Configuration** (section `properties`, publique) : par taille, le prix d'achat à la cité, la capacité en logements, l'entretien quotidien, la vétusté perdue à chaque clôture, le seuil d'état sous lequel le bien ne loge plus personne, et le coût de la rénovation, en oboles (toujours positif) et en biens ;
  par cité, le nombre de biens de chaque taille (`countsByCity`).
  L'état d'un bien va de 0 à 10 000 (neuf).
  Entretien et vétusté entrent à zéro dans la configuration initiale (paramètres neutres) ; une version publiée avant l'immobilier n'a aucun bien.
- **Parc** : chaque cité a un parc fini, d'abord détenu par elle, que le moteur crée au premier tick qui la connaît (comme sa population, 5.2) et complète jusqu'au nombre de la configuration ;
  baisser ce nombre ne retire aucun bien.
- **Achat** (`property.buy`, bien et prix vu) : une maison achète à la cité un bien qu'elle détient encore, dans n'importe quelle cité de son monde (investir ailleurs comme métèque, 6).
  Le prix de la taille est détruit (puits `sink_property_purchase`), comme l'acquisition d'un site, plutôt que versé au trésor de la cité ; un autre prix que celui vu est refusé (`PRICE_CHANGED`).
  Refus sans effet : bien déjà vendu (`PROPERTY_NOT_FOR_SALE`), taille retirée de la configuration, trésorerie qui ne couvre pas le prix.
  L'achat prend le verrou de l'agora du monde, puis la trésorerie, puis le bien : deux achats du même bien se suivent, et le second le trouve vendu.
- **Rénovation** (`property.renovate`, bien et coût vu en oboles et en biens) : la maison propriétaire rend le bien neuf (état 10 000), à tout moment, même entretien impayé.
  Le coût en oboles est détruit (puits `sink_property_works`) par une écriture `property.renovate` dont le débit est marqué `upkeep` ; les biens sortent du stock libre de la maison dans la cité du bien (hors réservations des ventes en attente) vers l'extrémité `consumption` du journal des stocks, rattachés à cette écriture, dans la même transaction.
  Refus sans effet : bien d'une autre maison ou de la cité (`PROPERTY_NOT_OWNED`), bien déjà neuf (`NOTHING_TO_RENOVATE`), taille retirée, coût changé (oboles ou biens, `PRICE_CHANGED`), stock ou trésorerie insuffisants.
- **Vétusté** : à chaque clôture, juste avant l'entretien (étape `propertyWear`), chaque bien, à la cité comme à une maison, perd la vétusté du jour de sa taille, sans passer sous zéro, une seule fois par jour de jeu (garde de la base, 12) ;
  sous le seuil de sa taille, il ne loge plus personne jusqu'à sa rénovation.
  Une clôture manquée n'use pas : comme pour l'entretien, seul le jour joué compte.
- **Entretien** : chaque clôture demande à chaque bien d'une maison, acheté avant l'instant de la clôture, l'entretien d'un jour de sa taille, dans l'écriture `upkeep.daily` de la maison, par une ligne marquée `upkeep` vers le puits `sink_property_upkeep`, après ses sites et ses navires et avec ce qui reste de la trésorerie, dans l'ordre des achats, chaque bien en entier ou pas du tout (5.5).
  Impayé, le bien ne loge personne jusqu'à la clôture qui le paie (`upkeep_unpaid_since`) ; il n'y a ni relance ni arriéré.
  Une taille retirée de la configuration ne doit rien ; un bien de la cité ne doit rien.
  L'événement `UpkeepSettled` en porte le détail (`properties` : payés, impayés, impayés constatés et levés par cette clôture).
- **Lecture** : les règles (`property_rules`) et le parc de chaque cité, par bien, sans propriétaire nommé et avec l'état des seuls biens à vendre (`city_properties`), sont publics pour tout joueur connecté ; une maison lit ses biens, leur état et leur impayé par `my_properties`.
  L'écran attend #259.
- **Logements utiles** : un bien loge sa capacité si son état atteint le seuil de sa taille et que son entretien est payé, personne sinon (`usableHousingUnits`, `packages/sim`).

Phase 2, seconde version (#257) : les biens se louent et se revendent entre maisons.
Ces mouvements transfèrent de la monnaie d'une maison à une autre sans en créer ; seule la taxe de la revente en détruit une part.

- **Offres** : la maison propriétaire offre un bien à la location, au loyer quotidien qu'elle fixe (`property.offerLease`), ou à la vente, à prix affiché (`property.listForSale`), et retire son offre (`property.withdrawOffer`).
  Une seule offre est ouverte par bien, de vente ou de location (`PROPERTY_ALREADY_LISTED`) : pour en changer, on retire la première.
  Un bien loué ne s'offre ni à la vente ni à la location avant la fin du bail (`PROPERTY_LEASED`).
  Il n'y a ni enchère ni négociation : l'offre se prend à son prix, ou se retire.
- **Bail** (`property.lease`, bien et loyer vu) : une autre maison loue le bien au loyer de l'offre ; un autre loyer est refusé (`PRICE_CHANGED`), et une maison ne loue pas son propre bien (`OWN_PROPERTY`).
  Rien n'est payé à la signature : le premier loyer est celui de la première clôture qui suit.
  Le bail n'a pas de durée : il court jusqu'à ce que l'une ou l'autre partie en demande la fin (`property.endLease`), une fois et sans retour, ou jusqu'à un loyer impayé.
  La fin demandée prend effet à la clôture suivante, qui ne demande alors plus de loyer.
  Une fin demandée entre l'instant de jeu d'une clôture et son passage réel, quand la clôture est jouée en retard, termine le bail à cette clôture, sans loyer du jour.
- **Loyer** : chaque clôture, avant la vétusté et l'entretien (étape `leaseRent`), met d'abord fin aux baux dont la fin est demandée, puis demande à chaque autre bail signé avant l'instant de la clôture le loyer d'un jour, dans l'ordre des signatures, de la trésorerie du locataire à celle du propriétaire, par une écriture `lease.rent` par bail (`settleRents`, `packages/sim`).
  Le loyer est payé en entier si la trésorerie du locataire le couvre, sinon le bail prend fin, impayé ; la monnaie sous séquestre ne paie pas.
  Un loyer reçu est disponible aussitôt : il peut payer, plus loin dans l'ordre, un loyer dû par le propriétaire, puis l'entretien de ses sites, navires et biens.
  Les loyers passent les premiers de ce qui touche la monnaie pour cette raison, et parce que le logement des travailleurs (#258) lira les baux restés en cours.
  Une clôture manquée ne demande pas de loyer pour le jour manqué, comme l'entretien.
  Chaque bail terminé, demandé ou impayé, a son événement `LeaseEnded`.
- **Revente** (`property.buyListed`, bien et prix vu) : une autre maison achète le bien mis en vente, au prix affiché ; un autre prix est refusé (`PRICE_CHANGED`), une maison n'achète pas son propre bien (`OWN_PROPERTY`), et une trésorerie qui ne couvre pas le prix ne paie rien.
  Une seule écriture `property.sale` débite l'acheteur du prix, crédite le vendeur du net, et prélève la taxe de marché de la cité du bien comme à l'agora (5.3) : même calcul (`marketTax`), même répartition entre le puits `sink_market_tax` et le trésor de la cité.
  Le bien change de maison dans la même transaction et garde son état et son entretien impayé ; son instant d'achat devient celui de la revente.
  Un bien revendu entre l'instant de jeu d'une clôture et son passage réel a donc un instant d'achat postérieur à la clôture, qui ne prélève son entretien du jour ni sur l'ancien propriétaire ni sur le nouveau (seuls les biens achetés avant l'instant de la clôture le doivent).
  Événement `PropertySold`, avec le prix, le net et les deux parts de la taxe.
- **Concurrence** : toutes ces commandes prennent le verrou de l'agora du monde, puis le bien (la revente, ensuite, les deux trésoreries par identifiant) ; deux locations ou deux achats du même bien se suivent, et le second trouve l'offre fermée.
  Une offre retirée pendant qu'on l'achète ou qu'on la loue n'est ni vendue ni louée : l'un ou l'autre passe, jamais les deux.
  La base vérifie à la validation qu'une offre vendue a cédé le bien à l'acheteur et qu'un bail a fermé son offre louée (12).
- **Lecture** : les offres ouvertes de toutes les cités sont publiques pour tout joueur connecté (`property_offers` : le bien, sa cité, sa taille, son numéro, son état, la nature de l'offre et son prix ou loyer, sa date), sans la maison qui offre ; offrir un bien rend son état public.
  Chaque partie lit les baux dont elle est partie, en cours et terminés, avec les deux maisons, le loyer, la demande de fin et la fin (`my_leases`).
  L'écran attend #259 ; le loyer d'équilibre et le logement des travailleurs, #258.

## 4.6 La flotte et les caravanes

Les prix diffèrent d'une cité à l'autre ; le transport est le métier qui les rapproche.
Un trajet a une durée (2 à 20 heures réelles), un coût, une capacité et un risque (tempête, piraterie), réduit par la saison, l'escorte et la faveur de Poséidon.
Trois classes de navires au lancement : caboteur, navire rond de commerce, galère d'escorte.
La phase 2 n'en a que deux, le caboteur et le navire rond : la galère d'escorte et l'escorte attendent les conflits de la phase 3 (décision du ticket #251).
Le fret peut être vendu à d'autres joueurs.

Navires, dans la phase 2 (#251) :

- Une classe de navire (`ships.classes`) a une capacité en unités de biens, tous biens confondus, une vitesse en points de base (10 000 tient la durée de référence d'une route), un prix d'achat et un entretien par jour de jeu, en oboles.
  L'entretien entre à zéro dans la configuration initiale (paramètres neutres) ; la clôture le prélève (voyages, ci-dessous).
  Une version de configuration publiée avant le transport se lit sans aucune classe : aucun navire ne s'y achète.
- La commande `ship.acquire` (classe, prix vu) achète un navire neuf : il naît armé, à quai dans la cité de la maison, et son prix est détruit (puits `sink_ship_purchase`, 5.5) par une écriture `ship.acquire`, annoncée par un événement de domaine `ShipAcquired`.
  Elle est refusée sans rien payer si la classe n'est pas dans la configuration en vigueur, si la cité de la maison n'a pas de port (6.1), si la trésorerie ne couvre pas le prix, ou si le prix en vigueur n'est pas celui que le joueur a vu (« le prix a changé », comme pour `site.acquire`).
  La monnaie sous séquestre à l'agora ne paie pas un navire.
  Le prix vu est obligatoire, à la différence de `site.acquire` : aucun client antérieur ne l'omet.
  Il n'y a pas de limite de flotte : seul le prix borne le nombre de navires d'une maison.
- Un navire ne change jamais de maison ni de classe, et il n'y a pas de revente.
  À quai, il est dans une cité de son monde ; il n'en part qu'avec un voyage, et n'accoste qu'au terme de celui-ci, dans la cité d'arrivée.
- Les classes et leurs tarifs sont des règles publiques (vue `ship_rules`, la section `ships` de la configuration en vigueur, routes et droit de port compris).
  Chaque joueur lit ses propres navires, leur cité de mouillage et leur désarmement (vue `my_ships`).

Voyages, dans la phase 2 (#252) :

- Une route (`ships.routes`) relie deux cités à port, dans les deux sens, en 2 à 20 heures pour un navire de vitesse 10 000.
  Un trajet dure ⌈heures × 3 600 × 10 000 ÷ vitesse⌉ secondes : un navire plus lent met plus longtemps, jamais moins que la durée exacte.
  Chaque route porte les provisions d'un voyage par classe de navire, en oboles, détruites au départ (puits `sink_voyage_provisions`).
- Le droit de port de la cité d'arrivée (`ships.portDues`, 5.6) est un forfait par classe, multiplié par le coefficient de la cité (10 000 = ×1 ; une cité sans coefficient est à ×1), arrondi à l'obole supérieure, et payé au départ.
  Ce coefficient est celui du dernier décret appliqué de la cité, sinon celui de la configuration (#262) ; l'écran de départ le lit dans la vue `city_rates` et n'annonce aucun coût avant de l'avoir lu.
  Sa part détruite (`burnShareBps`, arrondie à l'obole supérieure) va au puits `sink_port_dues`, le reste au trésor de la cité d'arrivée, comme la taxe de marché.
  Provisions et droit de port entrent à zéro dans la configuration initiale (paramètres neutres).
  Une version publiée avant les voyages se lit sans route ni droit de port : aucun départ n'y est possible.
- La commande `voyage.depart` (navire, cité de départ vue, cité d'arrivée, cargaison, coût vu) fait partir un navire armé de la maison, à quai dans la cité de départ, vers une cité reliée par une route.
  La cargaison est une liste de biens et de quantités prise dans le stock libre de la maison dans la cité de départ (quantité moins ce que réservent ses ventes en attente), dans la capacité de la classe, tous biens confondus.
  Décision : une cargaison vide est admise, le navire part sur lest (pour aller acheter ailleurs).
  Elle est refusée sans rien payer ni charger si le navire est en mer, à quai ailleurs, désarmé, d'une classe retirée de la configuration, sans route vers la destination, si un bien est inconnu, si la cargaison dépasse sa capacité ou le stock libre, si la trésorerie ne couvre pas le coût, ou si le coût en vigueur n'est pas celui que le joueur a vu (« le prix a changé »).
  Dans une seule transaction, le voyage part (arrivée prévue : le départ plus la durée du trajet), la cargaison sort du stock vers l'extrémité système `in_transit` du journal des stocks, rattachée au voyage, le navire quitte le quai, et provisions et droit de port sont payés par une écriture `voyage.departure` (nature `transport`, 4.1) ; un montant nul n'a pas de ligne, et un départ qui ne coûte rien n'a pas d'écriture.
  Un événement de domaine `VoyageDeparted` l'annonce.
  La commande prend le verrou d'agora du monde, puis la trésorerie, le navire et les stocks dans l'ordre des biens : elle ne s'intercale pas dans l'entretien d'une clôture, qui prend le même verrou d'abord.
- Le stock en mer n'est dans aucun stock de la maison : aucun ordre ne le réserve, aucun PNJ ne l'achète, et la demande des PNJ, qui ne lit pas les stocks, n'en dépend pas.
- L'arrivée est une étape du tick, jouée par le moteur après la demande des PNJ (#253, écart assumé avec l'évaluation paresseuse des trajets, 13).
  Chaque tick décharge les voyages de son monde dont l'arrivée prévue est atteinte à son instant de jeu (début de son intervalle), et seulement eux.
  Dans la transaction du tick, l'arrivée est datée de cet instant, la cargaison passe de l'extrémité `in_transit` au stock de la maison dans la cité d'arrivée (ouvert s'il n'existait pas), exactement ce qui a été chargé, et le navire y est à quai ; un événement de domaine `VoyageArrived` l'annonce.
  Un voyage échu pendant une panne du moteur est déchargé par le premier tick, rattrapé ou non, qui commence à son échéance ou après, et daté de ce tick : son arrivée peut donc être antérieure à l'écriture du déchargement.
  Un navire désarmé en mer accoste et reste désarmé ; un navire sur lest accoste sans rien décharger ; un bien retiré de la configuration se décharge comme les autres.
  Rejouer un tick, ou deux moteurs à la fois, ne décharge rien deux fois : le tick n'est joué qu'une fois, l'étape prend le verrou d'agora du monde puis les voyages échus (un voyage verrouillé ailleurs est laissé au tick suivant), et la base refuse un second déchargement.
  Tous les voyages échus d'un monde sont déchargés dans la seule transaction de son tick : une erreur sur l'un d'eux fait échouer tout le tick du monde, demande des PNJ comprise, repris au passage suivant.
  Limite connue : le tick peut s'interbloquer avec une récolte de la même maison dans la cité d'arrivée, qui verrouille ses stocks sans le verrou d'agora, quand la demande des PNJ a déjà verrouillé un de ses stocks vendus ; PostgreSQL annule l'une des deux en entier, sans double effet, et un nouvel essai automatique est prévu par un ticket à venir.
  La Vigie compte les voyages en retard de déchargement de plus d'un tick (15).
  La cargaison déchargée est dans le stock libre de la maison : elle se vend aussitôt à l'agora de la cité d'arrivée ; les PNJ, qui n'achètent qu'aux ventes en attente, ne l'achètent qu'au premier tick qui suit sa mise en vente.
- L'entretien d'un navire est celui de sa classe, par jour de jeu, sans coefficient (décision : le coefficient d'entretien des sites, 5.5, ne s'y applique pas).
  La clôture examine les navires d'une maison après ses sites, avec ce qui reste de la trésorerie, par date de création puis identifiant, chacun payé en entier ou pas du tout, dans l'écriture `upkeep.daily` de la maison, par une ligne marquée `upkeep` vers le puits `sink_ship_upkeep`.
  Un navire impayé est désarmé jusqu'à une clôture qui le paie ; il n'a pas de commande de relance, et ne part pas tant qu'il est désarmé.
  Un navire désarmé en mer poursuit son voyage.
  Comme un site, un navire acquis à l'instant de jeu de la clôture ou après ne doit rien pour ce jour, et une classe retirée de la configuration ne doit rien (désarmé, son navire est réarmé sans payer).
  `UpkeepSettled` dit, pour une maison qui a des navires, leur entretien payé et impayé, et les navires désarmés et réarmés.
- Chaque joueur lit ses voyages et leur cargaison (vue `my_voyages`).

## 4.7 Le savoir

La recherche est collective : chaque cité finance une école et choisit par vote les savoirs étudiés (irrigation, voile, comptabilité, alliages). Un savoir acquis profite à tous les citoyens, ce qui différencie les cités et nourrit les migrations.
