# 4. Systèmes de gestion

La maison se gère sur sept systèmes qui partagent les mêmes stocks, la même trésorerie et le même personnel. Chaque système est jouable seul, mais la rentabilité vient de leur combinaison.

## 4.1 La maison (oikos)

- **Siège** : bâtiment évolutif (10 niveaux) qui fixe le nombre de sites gérables et de postes d'intendant.
- **Trésor et comptes** : compte de résultat et bilan tenus automatiquement, consultables par jour, saison et année, avec marge par filière et par site.
  Dans la première version, les comptes sont trois vues en lecture seule, que le joueur lit pour sa seule maison ; elles sont calculées à la lecture depuis le grand livre, qui fait foi, et rien n'y est recopié.
  Flux de trésorerie (`my_cash_flows`) : par compte (trésorerie, séquestre), jour de jeu et nature, en oboles, crédit positif. Natures : ventes (`sales`, au brut : prix × quantité de l'échange), taxes (`taxes` : l'écart entre ce brut et le net crédité), achats (`purchases`), entretien (`upkeep` : clôture et relance), acquisitions (`acquisitions`), dotation de départ (`grant`), séquestre (`escrow` : monnaie retenue pour un achat en attente, ou rendue) et `other` pour toute écriture d'une nature que la vue ne connaît pas encore. Chaque ligne du grand livre y est comptée une fois et en entier : la somme des flux d'un compte sur une période est la variation de son solde, et un flux de somme nulle n'est pas affiché. Un achat en attente quitte la trésorerie le jour où son prix est retenu (nature séquestre) ; servi plus tard, c'est un achat du compte de séquestre, pas de la trésorerie. Le jour de jeu d'une écriture (section 3) est celui de sa date, le début de sa transaction, lu avec l'heure de clôture et le fuseau de la configuration en vigueur à la lecture : changer l'horloge reclasse donc les écritures passées, et sans horloge en vigueur le jour est inconnu sans qu'aucun flux disparaisse. Limite : une vente dont la taxe prend tout le montant (une obole) ne crédite rien au vendeur et n'apparaît donc ni en vente ni en taxe.
  Compte de résultat (`my_income_statement` par jour de jeu, `my_income_statement_by_season` par saison) : dérivé des flux de trésorerie, en oboles, tenu au flux de trésorerie. Un produit ou une charge est compté le jour où la monnaie change de mains, avec le signe du flux (une charge est négative) ; il n'y a ni variation de stock ni amortissement, les stocks sont au bilan. La monnaie de la maison y est sa trésorerie plus son séquestre : retenir ou rendre le prix d'un achat en attente est un mouvement entre ses deux comptes, sans effet sur le résultat, et l'achat est une charge le jour où il est servi (au flux de la seule trésorerie, un achat payé par le séquestre ne serait jamais une charge). Exploitation : ventes au brut, achats, taxes, entretien ; leur somme est le résultat (`operating_result`). Hors exploitation (`non_operating`) : acquisitions de sites, dotation de départ, et `other` pour tout le reste. Résultat plus hors exploitation font la variation de la monnaie de la maison sur la période (`cash_change`), dont `escrow_change` est la part du séquestre : la variation de la trésorerie seule est leur différence. La saison d'un jour de jeu est celle du moteur (`seasonIndexAt`) : des saisons de `seasonDays` jours de jeu comptés depuis le lundi 5 janvier 1970, lues comme le jour avec l'horloge en vigueur à la lecture ; la vue par saison donne le premier et le dernier jour de jeu de chacune. Sans durée de saison utilisable, la saison est inconnue et la vue par saison rend une seule ligne par maison ; si la base ne connaît pas le fuseau de la configuration, le jour et la saison sont inconnus. Dans les deux cas aucun montant ne disparaît.
  Stocks valorisés (`my_valued_stocks`) : chaque stock non vide, part réservée par les ventes en attente comprise, au prix de référence observé du marché de sa cité (5.3), le dernier calculé, avec sa date. Ce prix moyen est préféré au prix du dernier échange : un échange isolé à un prix aberrant ne déplace pas le bilan. Un bien qui n'a jamais eu de prix observé dans la cité n'a ni prix ni valeur ; aucun prix n'est inventé à sa place.
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

Dans la première version : une maison acquiert un site dans sa cité en choisissant sa recette ; le type du site est celui de la recette, et son prix, fixé par type dans la configuration, est détruit (puits « acquisition de sites »). Le nombre de sites d'une maison est borné par le niveau de son siège (toute maison est au premier niveau). Un site peut changer de recette parmi celles de son type : ce qu'il a déjà produit doit d'abord être récolté, le cycle entamé est perdu et le nouveau commence à l'instant du changement. Il n'y a encore ni carte des parcelles, ni fertilité, ni marché foncier. Un site à l'arrêt faute d'entretien payé (5.5) se récolte pour ce qu'il avait accumulé avant son arrêt, et pas davantage (un atelier, lui, ne se récolte pas à l'arrêt : voir 4.3) : pour lui, le temps s'est arrêté à cet instant, le cycle entamé reste gelé et reprend à la relance. Il ne change pas de recette tant qu'il est à l'arrêt (refus « site à l'arrêt ») : il faut le relancer d'abord.

Partage des contrôles : la base garantit qu'un changement de recette repart d'un cycle neuf, si bien qu'aucune production de l'ancienne recette n'est récoltée sous la nouvelle. Un site n'a pas de type enregistré : son type se déduit de sa recette, que seule la configuration connaît. L'existence de la recette et sa compatibilité avec le type du site sont donc vérifiées par la commande, pas par la base. Si une récolte du même site aboutit pendant le changement de recette, celui-ci est refusé (« le site vient de changer ») : le joueur réessaie, et le client envoie alors une nouvelle clé d'idempotence, puisqu'un refus reste attaché à la sienne.

## 4.3 Les ateliers

Un atelier applique des recettes : intrants, durée, personnel requis, extrant. Trois leviers le différencient.

- **Qualité** (0 à 100) : dépend de la qualité des intrants, du niveau de l'artisan et de l'outillage. Elle segmente la demande : le peuple achète le prix, les riches achètent la qualité.
- **Marque** : à partir d'un seuil de volume et de qualité, une maison peut déposer un sceau. Un sceau reconnu se vend plus cher et se contrefait (voie d'Hermès).
- **Cadence** : production normale, forcée (plus rapide, usure et fatigue) ou soignée (plus lente, qualité accrue).

Dans la première version : un atelier se récolte comme un site de matière première. À la récolte, chaque cycle écoulé consomme ses intrants dans le stock libre de la maison dans la cité du site (le stock réservé par des ordres de vente n'est pas touché) et livre ses extrants. À court d'intrants, le cycle attend : les cycles que le stock permet tournent, le temps des autres reste dû et se rattrape à une récolte suivante, une fois l'atelier réapprovisionné. Ce rattrapage ne dépasse jamais le plafond d'accumulation du site : à tout moment, les cycles récoltés d'un coup et les cycles encore dus ne font pas ensemble plus que ce plafond ; au-delà, le temps perdu est perdu. Les intrants ne sont demandés qu'au moment de la récolte. Un atelier change de recette comme tout site (4.2) : il doit d'abord être récolté s'il a de quoi tourner ; à court d'intrants, il n'a rien produit, change de recette aussitôt, et ses cycles en attente sont perdus avec le cycle entamé. Qualité, marque, cadence et personnel ne sont pas encore simulés. Un atelier à l'arrêt faute d'entretien payé (5.5) ne consomme aucun intrant : il ne se récolte pas tant qu'il est à l'arrêt (refus « site à l'arrêt »), même réapprovisionné entre-temps. Pour un atelier, rien n'est « accumulé » tant que les intrants ne sont pas consommés : les cycles écoulés avant l'arrêt restent dus, dans la limite du plafond, et tournent à la première récolte après la relance.

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
