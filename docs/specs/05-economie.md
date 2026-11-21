# 5. Économie

L'économie est fermée et comptabilisée en partie double : chaque drachme et chaque unité de bien a une origine et une destination tracées. Les joueurs fixent tous les prix ; les PNJ n'interviennent que comme consommateurs finaux et comme prêteur de dernier ressort.

## 5.1 Les biens

Le lancement compte 60 biens en quatre niveaux. Le catalogue est une table de configuration : ajouter un bien ne demande aucun code.

Retirer un bien (décision de #191). Un bien détenu ou en carnet est un actif de joueur : le retirer de la configuration le rendrait invendable sans le détruire, ce qui revient à confisquer sa valeur.
Une version de configuration qui retire un bien que l'état du monde porte encore, dans n'importe quel monde (stock non nul, réservé ou non ;
ordre ouvert d'achat, donc séquestre, ou de vente), est donc refusée à la programmation (`CONFIG_GOOD_IN_USE`, qui nomme chaque bien), et Olympe le dit avant, sous la version (15.4) ;
la publication, elle, l'accepte, pour qu'on prépare le retrait.
Les chandeliers et le prix observé d'un bien (5.3) ne bloquent pas son retrait : ce sont des historiques, qui ne portent ni monnaie ni stock ;
ils restent en base et lisibles. Un retour arrière vers une version sans ce bien est refusé de même.
C'est le contraire du choix fait pour les recettes (4.2) : une recette retirée arrête un site sans rien prendre au joueur, alors qu'un bien retiré figerait son stock et sa monnaie.
Pour retirer un bien, on attend qu'il ne soit plus détenu, ou on le rachète (décision de #229).
Rachat : la commande d'Olympe `admin.buyBackGood`, réservée au super-administrateur et tracée, vaut pour un bien que la configuration en vigueur connaît encore.
En une transaction, tous mondes confondus, elle annule chaque ordre ouvert du bien comme son joueur l'aurait fait (séquestre rendu à la trésorerie, réservation levée), puis rachète tout son stock, de toutes les maisons et dans toutes les cités, au prix de référence de la configuration en vigueur.
Chaque maison est payée par une écriture du grand livre (`admin.good_buyback`), depuis le robinet du rachat de son monde (5.5) ; son stock part, par le journal des stocks, vers l'extrémité système `good_buyback`, dont rien ne ressort.
Chaque maison concernée reçoit un événement de domaine `GoodBoughtBack` (bien, unités, oboles, prix, ordres annulés), même sans unité quand seul un ordre d'achat la concernait ; chaque ordre annulé produit aussi son `OrderCancelled`.
La commande porte les totaux qu'Olympe a montrés (maisons, unités, ordres annulés, oboles) : si l'état du monde n'est plus celui-là (ordre placé, récolte, rachat déjà fait), elle est refusée sans rien faire (`BUYBACK_CHANGED`), comme un prix changé.
Dans les comptes de la maison (4.1), son paiement tombe parmi les autres flux, hors exploitation : ce n'est ni une vente à l'agora ni une dotation.
Le rachat ne convertit le bien en aucun autre, et n'est pas annoncé dans la chronique.
Le contrôle porte sur l'état du monde au moment de la programmation : ce qui est acquis entre elle et la clôture (production, achat) n'est pas rattrapé.
Repli pour ce cas, ou pour un bien retiré avant ce contrôle : le stock reste au journal des stocks et le séquestre au grand livre, rien n'est créé ni détruit ;
aucun nouvel ordre n'est accepté (`GOOD_NOT_FOUND`), les PNJ n'achètent plus le bien, mais un ordre ouvert s'annule toujours, sans lire la configuration (le séquestre d'un achat revient à la trésorerie, la réservation d'une vente est levée) ;
une version qui rend le bien rend le marché. Le client joueur n'a de nom traduit que pour les biens de ses fichiers de traduction : un bien ajouté par Olympe y est montré par son identifiant.

| Niveau | Exemples | Nombre |
| --- | --- | --- |
| Matières | Blé, orge, olives, raisin, figues, bois, miel, argile, marbre, cuivre, étain, fer, argent, laine, peaux, lin, poisson, sel | 18 |
| Intermédiaires | Farine, farine d'orge, huile, moût, planches, bronze, fer forgé, fil, tissu, toile de lin, cuir, charbon, pigments, cire, lingots d'argent, blocs de marbre | 16 |
| Finis | Pain, vin, amphores, galettes d'orge, poisson salé, garum, lampes à huile, sandales, outils, vêtements, céramique peinte, parfums, bijoux, meubles, statues, armes, voiles, bougies, mosaïques, gâteaux de figues | 20 |
| Services | Fret, logement, spectacle, banquet, crédit, escorte | 6 |

Décision (#708, ambiguïté de cette section) : les soixante biens sont les 54 biens stockables du catalogue (18 matières, 16 intermédiaires, 20 finis) et les six services, qui sont des mécaniques et non des lignes du catalogue.
Depuis #708, la configuration initiale compte les dix-huit matières premières : aux huit de la phase 2 s'ajoutent orge, lin, figues, peaux, miel, marbre, cuivre, étain, fer et argent, chacune avec sa recette (4.2).
Leur prix de référence et leur élasticité sont dans la configuration.
Au prix de référence, entretien et salaires déduits, la marge nette quotidienne de chacune de leurs recettes est entre la moitié et le double de la médiane des huit matières premières de la phase 2 (899 oboles) : un test de la configuration le vérifie, bornes écrites à la main.
Décision (paramètres neutres, #708) : aucun bien nouveau n'entre dans un panier des PNJ, dans l'indice des prix ni dans le domaine d'un dieu ; #713 règle les paniers.
D'ici les ateliers de #709 et ces paniers, ils ne s'échangent qu'entre maisons.
Depuis #709, la configuration initiale compte les seize intermédiaires : aux quatre de la phase 2 (farine, huile d'olive, charbon de bois, tissu) s'ajoutent douze biens, chacun avec la recette d'un atelier (4.3).
Le tableau donne l'atelier, ses intrants et son extrant par cycle, la durée du cycle et la marge nette quotidienne au prix de référence, entretien et salaires déduits.

| Bien (prix de référence) | Atelier | Intrants par cycle | Extrant par cycle | Cycle | Marge |
| --- | --- | --- | --- | ---: | ---: |
| Farine d'orge (9) | `mill_barley` | 10 orges | 9 | 60 min | 682 |
| Moût (30) | `press_must` | 10 raisins | 6 | 120 min | 898 |
| Planches (20) | `saw_planks` | 8 bois | 6 | 90 min | 834 |
| Bronze (32) | `smelt_bronze` | 6 cuivres, 1 étain, 1 charbon | 9 | 180 min | 924 |
| Fer forgé (42) | `forge_iron` | 6 fers, 2 charbons | 5 | 120 min | 916 |
| Fil (24) | `spin_thread` | 10 lins | 8 | 120 min | 922 |
| Cuir (55) | `tan_leather` | 6 peaux, 2 sels | 5 | 240 min | 856 |
| Toile de lin (60) | `weave_linen` | 3 fils | 3 | 180 min | 796 |
| Pigments (30) | `grind_pigments` | 8 argiles, 2 cuivres | 6 | 180 min | 770 |
| Cire (48) | `render_wax` | 6 miels, 1 charbon | 7 | 240 min | 778 |
| Lingots d'argent (150) | `cast_silver` | 4 argents, 2 charbons | 4 | 360 min | 924 |
| Blocs de marbre (56) | `cut_marble` | 8 marbres | 6 | 240 min | 886 |

Décision (#709) : les recettes de la phase 2 ne changent pas.
Le vin reste fait de raisin et d'amphores, le tissu de laine : les marges de #285 et les mesures des bancs restent celles d'avant.
Le moût et la toile de lin sont de nouveaux biens à côté du vin et du tissu, pas leurs intrants.
Un test de la configuration borne la marge de chaque atelier nouveau entre la moitié et le double de la médiane des matières premières de la phase 2 (899 oboles, écrite à la main).
Chaque intermédiaire et chaque matière première est l'intrant d'au moins une recette, sans exception depuis #711 : voir plus bas.
Comme pour les matières de #708, aucun intermédiaire nouveau n'entre dans un panier des PNJ, dans l'indice des prix ni dans le domaine d'un dieu.
Depuis #710, la configuration initiale compte dix biens finis : aux trois de la phase 2 (pain, vin, amphores) s'ajoutent sept biens du quotidien, chacun avec la recette d'un atelier (4.3).

| Bien (prix de référence) | Atelier | Intrants par cycle | Extrant par cycle | Cycle | Marge |
| --- | --- | --- | --- | ---: | ---: |
| Galettes d'orge (16) | `bake_cakes` | 6 farines d'orge, 1 charbon | 8 | 90 min | 866 |
| Poisson salé (30) | `salt_fish` | 6 poissons, 2 sels | 5 | 120 min | 706 |
| Garum (100) | `brew_garum` | 10 poissons, 3 sels, 1 amphore | 3 | 240 min | 676 |
| Lampes à huile (40) | `mould_lamps` | 1 huile d'olive, 3 argiles | 4 | 180 min | 858 |
| Sandales (75) | `make_sandals` | 2 cuirs, 2 fils | 3 | 120 min | 742 |
| Outils (100) | `forge_tools` | 3 fers forgés, 3 planches | 3 | 240 min | 616 |
| Vêtements (110) | `sew_clothes` | 3 tissus, 3 fils | 3 | 240 min | 724 |

Décision (#710) : la liste de départ du ticket est tenue telle quelle, avec les intrants suivants.
Les galettes consomment la farine d'orge, les sandales le cuir et le fil, les outils le fer forgé et les planches, les vêtements le tissu et le fil, les lampes l'huile d'olive.
Le poisson salé et le garum se font de poisson et de sel ; le garum se met en amphore, seul bien fini qui sert d'intrant.
Les recettes de la phase 2 ne changent pas, et aucun bien fini nouveau n'est l'intrant d'un autre, sauf l'amphore, que consomme l'atelier de garum : pas d'autre chaîne de biens finis.
Un test de la configuration borne la marge de chaque atelier nouveau entre la moitié et le double de la médiane des matières premières de la phase 2 (899 oboles, écrite à la main).
Décision (#710) : chaque atelier livre au moins trois unités par cycle.
Raison : l'atelier inspiré (7.1) ajoute ⌊extrant × 35 % ⌋ unités, et le test des grâces exige qu'il en ajoute au moins une au plus petit extrant d'un atelier.
Les cuirs, fers forgés, planches et farines d'orge trouvent preneur : la liste d'attente de #709 ne garde plus que sept intermédiaires et la figue, que #711 consomme.
Décision (paramètres neutres, #710) : aucun des sept biens n'entre encore dans un panier des PNJ, dans l'indice des prix ni dans le domaine d'un dieu ; #713 règle les paniers.
Un test de la configuration tient la liste des biens finis que les paniers n'achètent pas encore, comme pour les intermédiaires.
Depuis #711, la configuration initiale compte vingt biens finis : aux dix de la phase 2 et de #710 s'ajoutent dix biens de luxe et d'ouvrage, chacun avec la recette d'un atelier (4.3).

| Bien (prix de référence) | Atelier | Intrants par cycle | Extrant par cycle | Cycle | Marge |
| --- | --- | --- | --- | ---: | ---: |
| Céramique peinte (55) | `paint_ceramics` | 6 argiles, 1 pigment, 1 charbon | 4 | 240 min | 802 |
| Parfums (125) | `blend_perfumes` | 4 huiles d'olive, 1 cire | 3 | 360 min | 766 |
| Bijoux (200) | `craft_jewelry` | 2 lingots d'argent, 2 bronzes | 3 | 360 min | 876 |
| Meubles (140) | `build_furniture` | 8 planches, 2 cuirs | 3 | 240 min | 832 |
| Statues (200) | `carve_statues` | 5 blocs de marbre, 1 bronze | 3 | 480 min | 796 |
| Armes (175) | `forge_weapons` | 6 bronzes, 3 fers forgés | 3 | 360 min | 760 |
| Voiles (130) | `sew_sails` | 3 toiles de lin, 3 fils | 3 | 240 min | 760 |
| Bougies (32) | `dip_candles` | 2 cires, 1 fil | 6 | 120 min | 802 |
| Mosaïques (190) | `lay_mosaics` | 4 blocs de marbre, 4 pigments | 3 | 360 min | 836 |
| Gâteaux de figues (42) | `press_fig_cakes` | 8 figues, 2 moûts | 6 | 180 min | 834 |

Décision (#711) : les navires n'entrent pas au catalogue.
Ils restent achetés à la cité (4.6, `ship.acquire`) : un bien échangeable à l'agora en ferait un second marché de navires, que la flotte ne prévoit pas.
Les voiles prennent leur place parmi les vingt biens finis.
Décision (#711) : la liste de départ du ticket est ajustée sur un point.
Les cordages sont remplacés par les gâteaux de figues.
Raison : la liste ne donnait de débouché ni à la figue ni au moût, et les gâteaux de figues les consomment tous deux.
Le lin, lui, est déjà l'intrant du fil.
Les intrants sont les suivants.
Les bijoux consomment l'argent et le bronze, les armes le bronze et le fer forgé, les statues et les mosaïques le marbre taillé, les voiles la toile de lin et le fil, les meubles les planches et le cuir.
La céramique prend l'argile et les pigments, les parfums l'huile d'olive et la cire, les bougies la cire et le fil.
Aucun bien fini nouveau n'est l'intrant d'un autre, et les recettes d'avant ne changent pas.
Chaque atelier livre au moins trois unités par cycle, pour la même raison qu'en #710.
Un test de la configuration borne la marge de chaque atelier nouveau entre la moitié et le double de la médiane des matières premières de la phase 2 (899 oboles, écrite à la main).
Décision (#711) : les soixante biens sont au complet, et plus aucune liste d'attente d'intrant ne reste.
Chaque matière première et chaque intermédiaire est l'intrant d'au moins une recette : un test de la configuration initiale nomme le bien sans débouché, sans aucune exception.
La figue, le moût, le bronze, la toile de lin, les pigments, la cire, les lingots d'argent et les blocs de marbre y entrent avec #711.
Seuls restaient en attente les dix-sept biens finis de #710 et #711, que les paniers des PNJ n'achetaient pas encore : #713 vide cette liste et la retire.
Décision (paramètres neutres, #711) : jusqu'à #713, aucun des dix biens n'entrait dans un panier des PNJ ni dans le domaine d'un dieu, et aucun n'entre dans l'indice des prix.
Depuis #713, chaque bien du catalogue a un usage : l'intrant d'une recette, le panier d'une classe de PNJ (5.2), une offrande qu'un dieu accepte (7.1), un bien de fête (7.5) ou de rénovation (4.5).
Un test de la configuration initiale nomme le bien sans usage, sans aucune exception.
Les dix-sept biens finis de #710 et #711 entrent dans les paniers des classes aisées, en confort et en luxe, et chacun dans le domaine d'un dieu ; l'indice des prix ne change pas (5.5).
Chaque bien du catalogue a son pictogramme dessiné (10, direction artistique ; les douze intermédiaires de #709 et les dix-sept biens finis de #710 et #711 sont dessinés à la main, dans le trait et les aplats des autres) ; un bien sans dessin propre prend celui de son niveau (corbeille, ballot ficelé, coffre) quand l'écran connaît ce niveau, sinon une caisse neutre.
Depuis #873, la vue `good_tiers` publie au client le niveau de chaque bien de la configuration en vigueur (12) : un bien ajouté par Olympe sans dessin propre prend celui de son niveau dans tous les écrans du jeu.
Un bien que la vue ne connaît pas, ou dont elle n'a pas encore été lue, garde la caisse ; un service aussi, faute de dessin de niveau.

## 5.2 La demande finale

Chaque cité a une population de PNJ répartie en quatre classes de revenu, inspirées des classes de Solon. Chaque classe a un panier de besoins (vital, confort, luxe) et une sensibilité au prix et à la qualité. La population croît quand ses besoins sont couverts et émigre sinon : approvisionner sa cité est un enjeu collectif.

La quantité demandée par tick suit une élasticité constante autour d'un prix de référence :

```latex
Q = Q_0 \cdot N \cdot \left(\frac{P}{P_{ref}}\right)^{-\varepsilon} \cdot \left(1 + \beta \cdot \frac{q - 50}{50}\right)
```

Où N est la population de la classe, P le meilleur prix offert, ε l'élasticité du bien (0,3 pour le pain, 1,8 pour les bijoux), q la qualité et β la sensibilité de la classe à la qualité. Tous ces coefficients sont des paramètres du back-office.

Trois précisions rendent cette formule applicable à un carnet d'ordres, et bornent la création de monnaie.

- **Prix par niveau.** Le carnet présente plusieurs prix à la fois. Les PNJ achètent de l'offre la moins chère à la plus chère, chaque unité au prix demandé par son vendeur ; à chaque niveau de prix P, la quantité cumulée achetée ne dépasse jamais Q(P). « Le meilleur prix offert » est le cas d'un carnet à un seul niveau.
- **Budget.** La formule seule ne borne pas la dépense : pour un bien vital (ε inférieur à 1), la recette des vendeurs croît sans limite avec le prix.
  Chaque classe a donc un revenu par tick, paramètre du back-office, et la dépense des PNJ d'une cité pour un bien ne dépasse jamais, sur la durée, le budget que ce revenu lui alloue ;
  à un tick donné, elle peut le dépasser du report du budget non dépensé des ticks précédents (voir plus bas).
  Le revenu d'une classe est réparti entre les biens de son panier au prorata de leur dépense de référence (Q0 × prix de référence) ;
  le budget d'un bien est la somme des parts des classes, arrondie à l'obole inférieure.
  C'est le levier « revenu des classes PNJ » de la section 5.5.
  Depuis #632, ce revenu par tick est un plafond : les achats des PNJ d'une cité sont payés par sa bourse (5.5, 12), que remplissent les salaires et l'hébergement versés par les maisons et le revenu public.
  Si la bourse ne couvre pas le revenu du tick de toutes ses classes (somme des revenus × populations ÷ 1 000, arrondie à l'obole supérieure, `tickIncome`), le budget de chaque bien est réduit dans la proportion bourse ÷ revenu, arrondi à l'obole inférieure (`purseBudget`).
  La dépense d'un tick d'une cité, hausses des fêtes et des caravanes comprises, ne dépasse jamais ce qui reste dans sa bourse : aucun achat ne la rend débitrice, et une bourse vide n'achète rien.
  Ce qu'un tick ne dépense pas du budget d'un bien se reporte au tick suivant (#675), par cité et par bien (table `npc_demand_carry`).
  Sans ce report, l'arrondi aux unités entières perdrait de la demande : à Kallistè, un budget de 13 oboles par tick ne paie qu'un sel à 7 quand la demande (1,52 unité par tick) en veut deux un tick sur deux, et au plus 66 % du besoin vital en sel serait servi, quelle que soit l'offre.
  Avec le report, 13 oboles en paient un, les 6 restantes et 13 de plus en paient deux au tick suivant, et tout le besoin est servi.
  Le report est borné à un nombre d'unités du bien au prix de réserve, paramètre du back-office (`market.npcBudgetCarryUnits`, 2 au départ ; `budgetCarryCap`).
  Il grossit à chaque tick de ce que le tick avait le droit de dépenser et n'a pas dépensé, que l'offre du carnet ou la bourse de la cité l'ait empêché.
  Pendant une pénurie de l'offre comme de la bourse, il grossit donc jusqu'à sa borne, et pas au-delà : il ne devient pas une épargne sans limite, et la dépense d'un tick ne dépasse jamais son budget de plus de ce nombre d'unités.
  Une bourse vide ne le fait pas grossir : son budget du tick, réduit dans la proportion bourse ÷ revenu, est nul.
  Un tick sans aucune offre de vente du bien au prix de réserve ou en dessous le laisse tel quel, comme le report de demande.
  Le paramètre vaut au moins 2.
  Une seule unité ne suffirait pas : quand le budget d'un tick ne paie pas une unité, la demande d'une unité arrivée avant que le report puisse la payer est perdue (voir « Unités entières »), et un report déjà plafonné attendrait la suivante sans plus rien accumuler ; avec un bien vendu au prix de réserve, jusqu'à un tiers du budget se perd.
  Une version de configuration publiée sans ce paramètre ne reporte rien : elle garde son comportement.
  Le report lu à un tick est ramené à la borne de la version en vigueur : un report écrit sous un prix de réserve ou une borne plus hauts ne les prolonge pas.
  Le budget offert à un tick pour un bien est son budget du tick, réduit par la bourse et relevé par les fêtes et caravanes comme ci-dessus, plus le report, dans la seule limite de l'excédent de ce qui reste dans la bourse sur les budgets du tick de ce bien et des biens de la cité qui restent à servir (`offeredNpcBudget`) ; le tout ne dépasse jamais ce qui reste dans la bourse.
  Les biens sont servis dans un ordre fixe : sans cette limite, les reports des premiers prendraient sur une bourse courte la part proportionnelle des suivants, que la règle de la bourse leur garantit.
  Le report suivant est ce à quoi le tick avait droit, son budget du tick et le report lu, moins ce qu'il a dépensé, borné : ce que la bourse n'a pas laissé offrir reste dû, pour une bourse regarnie.
  Le report ne vient que du revenu des ticks déjà joués : sur la durée, les PNJ ne dépensent jamais plus que leur revenu cumulé, et un budget qui ne couvre pas la demande est dépensé en entier.
- **Unités entières.** La demande est un nombre réel et les biens se comptent en unités : la fraction non servie d'un tick est reportée au tick suivant.
  La demande non servie faute d'offre, elle, n'est pas reportée.
  Le report est toujours inférieur à une unité ; il est celui de la demande au dernier niveau de prix examiné.
  Un tick sans aucune vente au prix de réserve ou en dessous laisse le report tel quel : sans prix offert, la demande n'a pas de valeur.
  Il laisse de même le report du budget non dépensé (« Budget »).
  Une unité voulue que le budget du tick ne paie pas ne se reporte pas comme demande, puisque le report reste inférieur à une unité : c'est le budget non dépensé, reporté, qui paie une unité suivante.
- **Population.** À chaque clôture quotidienne, la population de chaque classe de chaque cité évolue d'après la couverture du jour de ses besoins vitaux : quantités servies sur quantités demandées, en points de base.
  Au-dessus du seuil de couverture, la classe croît, en proportion de l'excédent, jusqu'au taux de croissance quand la couverture est complète (exactement au seuil, elle ne bouge pas ;
  un seuil de 100 % ne fait croître qu'à couverture complète, au taux plein) ;
  en dessous, elle émigre, en proportion du manque, jusqu'au taux d'émigration quand rien n'est servi.
  La variation est arrondie vers zéro, à l'habitant entier, puis la population est tenue entre deux bornes exprimées en part de sa population initiale.
  Seuil, taux et bornes sont des paramètres du back-office (`populationDynamics`) ;
  une version de configuration publiée sans eux laisse la population constante, à sa valeur initiale.
  Une classe compte au plus 100 millions d'habitants : au-delà, le calcul ne serait plus exact en entiers, et cette limite l'emporte sur la borne haute.
  Le calcul est pur (`nextPopulation`, `packages/sim`) : croissant en couverture comme en population, toujours entier et dans les bornes.
- **État de la population.** La population par cité et par classe est un état du monde (table `npc_population`), distinct de la configuration.
  C'est le moteur qui le crée : au premier tick de demande qui connaît une cité et une classe, la classe naît à sa population de configuration.
  La même règle vaut pour un monde déjà en service, un monde neuf, une cité ou une classe ajoutée plus tard : il n'y a pas de reprise de données, parce que seul le moteur sait quelle configuration est en vigueur à un instant de jeu.
  Ensuite la configuration ne fixe plus la population, elle ne donne que la référence de ses bornes ;
  la demande et le budget des PNJ se calculent sur la population courante.
  Une classe retirée de la configuration garde son état, que plus rien ne lit ni ne fait évoluer ;
  Olympe le dit avant la programmation et la fait confirmer par la version qui la retire alors que la version en vigueur la contient encore, pas par les suivantes, qui la laissent absente ;
  réintroduite puis retirée de nouveau, elle se fait confirmer de nouveau (15.2).
  Réintroduite par une version ultérieure (décision de #200), elle reprend cet état : la demande et le budget de ses PNJ se calculent dès le premier tick sur la population gardée, et la première clôture qui suit un jour mesuré la ramène dans les bornes de la nouvelle configuration.
  Repartir de la population initiale demanderait d'effacer un état du monde, ce que le service de jeu ne peut pas faire, ou de relire l'historique des versions pour savoir que la classe a été retirée ;
  une cité absente de la configuration n'a pas d'état. La population n'évolue qu'à la clôture : la base refuse une évolution hors de la transaction qui enregistre la clôture de son jour (`daily_closes`), donc sur une clôture déjà enregistrée comme sur un jour sans clôture, une seconde évolution pour le même jour de jeu et tout retour en arrière ;
  le service de jeu ne peut ni supprimer un état ni en changer la cité ou la classe.
  La population et la dernière couverture retenue de chaque classe sont des données publiques de la cité, comme les prix du marché : tout joueur connecté les lit pour toutes les cités (vue `city_population` : habitants, couverture en points de base, jour de jeu de la clôture qui l'a retenue ;
  ces deux dernières sont vides tant qu'aucune clôture n'a fait évoluer la classe), un visiteur anonyme ne lit rien.
- **Mesure de la couverture.** « Demandé » est le besoin de référence : pour chaque bien vital du panier de la classe, Q0 × N ÷ 1000 par tick, soit sa demande au prix de référence et à qualité neutre, que le marché offre quelque chose ou non (sans offre, la demande à un prix n'a pas de valeur ;
  le besoin, si). « Servi » est la part de la classe dans les unités de ce bien que les PNJ de la cité ont achetées pendant le tick, au prorata des besoins de référence de toutes les classes qui veulent le bien, vital pour elles ou non : il n'est jamais servi plus d'unités qu'il n'en a été acheté.
  La couverture d'une classe agrège ses biens vitaux au plus simple : somme des unités servies sur somme des unités demandées, tous biens vitaux confondus, bornée à 100 % et arrondie au point de base inférieur.
  Un seul rapport par classe, lisible par le joueur et vérifiable à la main ;
  un minimum ou une moyenne des rapports par bien demanderait une mesure par bien et par classe, et ferait émigrer une classe pour un seul bien manquant, si mineur soit-il dans son panier.
  Conséquences assumées : un bien vital acheté au-delà du besoin (prix sous la référence) compense en partie un autre qui manque, et un bien pèse à proportion de ses unités, pas de sa valeur.
  À l'inverse, un bien vendu cher est moins acheté, donc moins servi : avec les valeurs initiales (élasticités de 0,3 à 0,5, seuil à 100 % depuis le calibrage de #78, 5.5), un bien vital vendu durablement au-dessus de son prix de référence fait passer la couverture sous le seuil, à moins qu'un autre bien vital, vendu sous le sien et acheté au-delà du besoin, ne compense.
  La cherté fait émigrer comme la pénurie ; c'est un réglage de l'équilibrage.
  Chaque tick de demande ajoute ces deux quantités, en unités réelles, à la mesure du jour de jeu de son instant de jeu (table `npc_vital_coverage` : une ligne par cité, classe et jour de jeu, non exposée aux clients).
  La clôture qui ouvre un jour lit la mesure de la veille et ne remet rien à zéro : ni un tick ni une clôture rejoués ne comptent deux fois.
  Seul un tick joué pendant son intervalle alimente la mesure. Un tick rattrapé (joué après la fin de son intervalle, moteur arrêté ou en retard) achète ce que le carnet offre, mais ne compte ni dans le demandé ni dans le servi : les ticks rejoués d'affilée vident un carnet que personne n'a pu regarnir entre eux, et compteraient une pénurie que le marché n'a pas connue.
  Un jour mesuré en partie donne donc la couverture des ticks joués à l'heure ;
  le premier tick à l'heure après une panne, lui, est mesuré contre le carnet que le rattrapage a laissé.
  Une classe sans aucune mesure la veille ne bouge pas : une panne du moteur ne fait ni croître ni émigrer.
  Une mesure sans rien de demandé (classe vide, ou sans bien vital) vaut couverture complète.
  Un tick de la veille validé après la clôture (deux moteurs à la même seconde) arrive trop tard pour elle : il complète la mesure, sans effet.
  La clôture garde dans son résumé, par classe, la couverture retenue et la population avant et après ;
  elle fait évoluer la population avant de prélever l'entretien (5.5).
- **Affichage.** L'onglet Cité montre au joueur la population de sa cité, classe par classe, et la couverture des besoins vitaux retenue à la dernière clôture (vue `city_population`) ; tant qu'aucun tick de demande n'a créé l'état, il le dit.
- **Cités.** Une cité du monde est rattachée à sa population de configuration par son identifiant court (`slug`). Une cité absente de la configuration n'a pas de demande de PNJ.
- **Fêtes de la cité** (#263, 7.5). Pendant une fête appliquée de sa cité, la demande des PNJ de chacun des biens de la fête est relevée, à tout prix, et son budget du tick avec elle, arrondi à l'obole inférieure.
  La hausse, en points de base, est la part de `decrees.models.festival.demandBoostBps` que fait la dépense de la fête par jour : ⌊demandBoostBps × montant ÷ (maxOboles × jours)⌋, montant et jours ramenés au plus aux maximums du modèle en vigueur.
  Elle vaut donc toute la hausse pour une fête au montant maximal d'un seul jour ; une fête plus longue ou moins coûteuse relève moins la demande chaque jour.
  Plusieurs fêtes d'un même bien s'ajoutent, ensemble au plus `demandBoostBps` ; une configuration sans cette hausse, ou qui ne borne plus les fêtes, ne relève rien.
  Le besoin mesuré pour la couverture ne change pas : ce que les PNJ achètent en plus pendant une fête compte comme servi au-delà du besoin (couverture bornée à 100 %).
  Le calcul est pur (`festivalDemandBoosts`, `packages/sim`).
  La hausse se calcule à chaque tick sur le montant voté, ramené au maximum du modèle en vigueur à ce tick, et non sur le montant payé à la clôture : les deux ne diffèrent que si la configuration a changé entre-temps.
  Un tick du jour de jeu D joué avant la validation de la clôture qui ouvre D (clôture en retard, ou en cours) ne voit pas encore la fête : la fête commence pour lui au tick suivant.
  Une fête est un puits, mais la demande qu'elle crée fait payer des achats par la bourse des PNJ de la cité (avant #632, par le robinet des PNJ).
  Ordre de grandeur : sur toute sa durée, une fête fait payer à la bourse au plus `demandBoostBps` ÷ 10 000 × (dépense de référence d'un jour de ses biens) ÷ `maxOboles` fois son montant, quels que soient son montant et sa durée, et seulement si l'offre suit.
  Avec la configuration initiale (Kallistè, 144 ticks par jour), la dépense de référence d'un jour vaut environ 31 000 oboles pour le pain, 8 400 pour le vin, 8 200 pour le poisson et 7 200 pour l'huile : la fête la plus favorable (pain, vin, poisson) en mobilise environ 47 700, soit 1,6 fois `maxOboles` (30 000).
  À 5 000 points, la dépense induite vaudrait donc jusqu'à 0,8 fois le montant de la fête, qui ne serait presque plus un puits ; la valeur initiale est de 2 500 points, soit au plus 0,4 fois le montant environ.
  Ce réglage, comme les bornes des fêtes, se fait dans Olympe par une version de configuration.
- **Caravanes étrangères** (#267, 7.4). Pendant les jours de jeu d'une caravane de sa cité, la demande des PNJ du bien de la caravane est relevée de son ampleur, comme pour une fête, budget du tick compris.
  Plusieurs caravanes du même bien ne s'ajoutent pas : seule la plus forte compte.
  Décision : la hausse d'une caravane s'ajoute à celle des fêtes du même bien (fêtes bornées ensemble par `demandBoostBps`, lui-même au plus 10 000, caravane par son ampleur, au plus 10 000).
  Quand les deux se cumulent au plus fort, la demande au prix de référence va donc jusqu'au triple du besoin (+200 %), et le budget du tick de ce bien jusqu'au triple du sien (#446), plus le report du budget non dépensé (« Budget »).
  Comme pour une fête, le besoin mesuré ne change pas, et le jour est celui du tick ; une caravane est une demande de plus, que la bourse des PNJ paie si l'offre suit et si elle le peut.
- **Événements.** Chaque achat des PNJ émet un événement de domaine `TradeExecuted`, le même qu'un échange entre joueurs, sans ordre d'achat (`buyOrderId` nul) et sans commande : il est écrit dans la transaction du tick, donc jamais pour un tick annulé ou simulé à blanc.

**Prix de réserve des PNJ.** Les PNJ n'achètent pas un bien au-delà d'un multiple de son prix de référence (paramètre du back-office, 3 au départ).
 Le budget borne la dépense totale ; le prix de réserve empêche qu'un vendeur seul capte ce budget avec une poignée d'unités à prix démesuré.
 Le revenu initial de chaque classe vaut 125 % de la dépense de référence de son panier ;
 un site accumule au plus trois jours de production.

**Paniers des classes aisées (#713).** Les thètes gardent le panier de la phase 2 : le peuple achète le prix (4.3).
Les zeugites, les hippeis et les pentacosiomédimnes y ajoutent les dix-sept biens finis de #710 et #711, en confort et en luxe, sans besoin vital nouveau.

| Classe | Confort | Luxe | Revenu (avant) | Part publique |
| --- | --- | --- | ---: | ---: |
| Zeugites | Galettes d'orge, poisson salé, gâteaux de figues, lampes, bougies, sandales, outils, vêtements | | 84 (73) | 8 690 |
| Hippeis | Poisson salé, gâteaux de figues, bougies, lampes, sandales, vêtements, garum | Céramique peinte, parfums, meubles, armes | 107 (82) | 7 663 |
| Pentacosiomédimnes | Bougies, garum | Vêtements, céramique peinte, parfums, bijoux, meubles, statues, mosaïques, armes, voiles | 188 (120) | 6 382 |

Le panier de la phase 2 de chaque classe ne change pas : besoins vitaux, mesure de la couverture et panier de l'indice des prix (5.5) restent ceux d'avant.
Les quantités sont dans la configuration ; un test vérifie que les PNJ des douze cités, à leur population initiale, demandent chaque jour au prix de référence au moins l'extrant d'un jour d'un atelier de chaque bien nouveau.
Le revenu d'une classe aisée suit son panier : 125 % de sa dépense de référence, arrondi à l'obole supérieure.
Décision (#713) : le revenu public d'un jour de chaque classe reste celui d'avant ses biens nouveaux.
Sa part publique (5.5) est celle qui rend le revenu d'avant, arrondie au point inférieur ; les thètes gardent 10 000 points.
Raison : avec 10 000 points, le revenu public créerait environ 10 % de monnaie de plus chaque jour, alors que les bancs ne vendent aucun de ces biens, et la masse du banc à quatre cités approcherait sa borne de 200 %.
Les achats de ces biens sont payés par la bourse de la cité, que remplissent le revenu public, les salaires et l'hébergement (5.5).
Limite connue : une bourse que ces achats vident réduit le budget de chaque bien de la cité, besoins vitaux compris (« Budget » plus haut) ; le calibrage des ateliers qui font ces biens, et dont les salaires vont à la bourse, en jugera.

## 5.3 Les marchés

- **Agora** : un carnet d'ordres par cité et par bien (ordres à cours limité, exécution immédiate, historique des prix en chandeliers). Taxe de marché fixée par la cité.
  L'écran Agora affiche une cité à la fois : la cité d'origine de la maison par défaut, ou une autre cité où elle a un stock ou un site (vues `my_inventories` et `my_sites`).
  Carnet, historique des prix et ordres en attente suivent la cité choisie ; un ordre à distance dans une cité où la maison n'a rien reste hors périmètre.
  Dans la première version : un ordre s'exécute à son arrivée contre le côté opposé du carnet, du mieux placé au moins bien placé (la vente la moins chère pour un achat, l'achat le plus offrant pour une vente), puis par ancienneté à prix égal ;
  chaque échange se fait au prix de l'ordre qui attendait. Le reste attend dans le carnet.
  Un ordre de vente réserve le stock qu'il propose (ce stock ne peut plus sortir par un autre chemin tant que l'ordre est ouvert).
  Un ordre d'achat qui attend met son prix sous séquestre : prix limite × reste quitte la trésorerie de la maison pour son compte de séquestre, qui paie le vendeur à chaque exécution ;
  la base garantit que ce compte retient exactement la somme des restes à payer des achats ouverts de la maison, et qu'il ne paie que les échanges de cette maison ou sa propre trésorerie (12).
  Un achat ne dépense jamais plus que la trésorerie : il s'exécute pour la part qu'elle peut payer, de la vente la moins chère à la plus chère ;
  son reste n'attend que si la trésorerie, une fois les échanges payés, peut en retenir le prix en entier, sinon il est annulé et l'achat le signale.
  Il n'est refusé que si rien n'est possible : pas une unité payable, ni de quoi retenir le prix d'un ordre en attente.
  Un ordre ouvert s'annule par sa maison : ce qui a déjà été servi reste acquis, le reste quitte le carnet, le stock qu'une vente réservait est libéré et la monnaie qu'un achat retenait revient à la trésorerie.
  Une suspension ou une exclusion n'empêche pas cette annulation, et une exclusion validée annule elle-même tous les ordres ouverts du compte (15.4, #528).
  Une maison n'échange pas avec elle-même : son ordre ignore ses propres ordres du côté opposé, même mieux placés, et peut donc attendre à côté d'eux à un prix qui les croise.
  Les autres joueurs ne voient du carnet que la quantité par côté et par niveau de prix, jamais l'identité des maisons.
  Taxe de marché : chaque échange, entre joueurs comme avec les PNJ, prélève sur le vendeur une taxe proportionnelle à son montant brut (prix × quantité), dans la même écriture que le paiement ;
  l'acheteur paie le brut, le vendeur reçoit le net. Règlement d'un échange, tenu par la base : son écriture débite le brut, prix × quantité, en une seule ligne, du compte de l'acheteur (pour les PNJ, la bourse des PNJ de la cité du marché depuis #632, le robinet des achats des PNJ avant ;
  pour un joueur, son séquestre si son ordre attendait dans le carnet, sa trésorerie s'il arrive), et le crédite en entier, réparti entre la trésorerie du vendeur (le net), le puits de la taxe de marché du monde (la part détruite) et le trésor de la cité du marché (le reste de la taxe) ;
  une part nulle n'a pas de ligne. Un échange de 5 unités à 8 réglé par une écriture de 30 est donc refusé.
  La base ne lit pas la configuration : le taux appliqué, lui, est vérifié par la commande, qui calcule la taxe.
  Elle ne borne pas non plus la part détruite ni celle du trésor (décision du ticket 205) : sans le taux ni la part de la configuration, la seule borne d'un échange est que chaque part est positive ou nulle et que leur somme est le brut, ce que le règlement impose déjà (« part détruite ≤ taxe » n'ajoute rien : la taxe est cette somme).
  Vérifier que les échanges d'une même transaction ont des parts compatibles avec un même taux et une même part demanderait à la base de reconnaître la transaction et de supposer qu'elle n'applique qu'une version de configuration, pour un contrôle qui n'attraperait pas l'erreur la plus probable, un taux faux appliqué à tous les échanges.
  Une erreur de répartition déplace de la monnaie entre le vendeur, le puits et la cité sans en créer ;
  elle est exclue par le calcul de la taxe (`packages/sim`, testé par propriétés) et par les tests de la commande et du tick.
  Deux paramètres du back-office, en points de base (1 pour 10 000) : le taux, borné à 50 %, et la part de la taxe qui est détruite, le reste allant au trésor de la cité (5.6).
  Ce taux est celui du monde : une cité le remplace sur son agora par un décret appliqué (5.6, 6.3), et chaque échange est taxé au taux de la cité du marché ; la part détruite reste celle du monde.
  Arrondi à l'obole, par échange et toujours vers le haut : taxe = ⌈brut × taux⌉, part détruite = ⌈taxe × part⌉, trésor = taxe − part détruite, net = brut − taxe.
  L'arrondi ne joue donc jamais en faveur de la monnaie en circulation, et découper une vente en petits ordres ne fait jamais payer moins (arrondie vers le bas, la taxe d'un échange de moins de 1 ÷ taux oboles serait nulle).
  En contrepartie, un échange paie au plus une obole de plus que le taux exact : une vente servie en plusieurs échanges peut rapporter quelques oboles de moins que le net annoncé pour un échange unique.
  Un taux nul ne prélève rien ; une version de configuration publiée avant la taxe se lit avec un taux nul.
  La revente d'un bien immobilier entre maisons (#257, 4.5) paie la même taxe, à la cité du bien, par le même calcul et la même répartition, dans son écriture `property.sale`.
  Le taux et la part détruite sont des règles du jeu publiques : les joueurs connectés les lisent (vue `market_rules`), rien d'autre de la configuration du marché ne l'est.
  Le taux en vigueur de chaque cité (5.6) se lit dans la vue `city_rates`, une ligne par cité, et la feuille de vente annonce le net au taux de la cité du marché, avec la part détruite du monde ; sans taux de la cité lisible, il n'annonce rien plutôt que le taux du monde.
  Décision (ticket 262, qui demandait ce taux dans `market_rules`) : une vue à part, parce que les taux sont une ligne par cité quand `market_rules` est une ligne pour tout le jeu, et que sa colonne `market_tax` rend la section de la configuration telle quelle, sans valeur calculée en base (pgTAP 019).
  Historique des prix : les échanges d'un bien dans une cité, entre joueurs comme avec les PNJ, sont résumés par période en chandeliers (table `price_candles`) : ouverture (prix du premier échange de la période), plus haut, plus bas, clôture (prix du dernier), volume (unités échangées) et montant (somme des prix × quantités, brut, avant taxe de marché).
  Une période est l'intervalle [début, début + durée), son début étant un multiple de la durée depuis l'époque Unix, en temps universel ;
  une période sans échange n'a pas de chandelier. La durée est un paramètre du back-office (`priceHistory.candleMinutes`, d'une minute à une journée ;
  une heure pour une version de configuration publiée avant l'historique) et chaque chandelier porte la sienne : en changer ouvre une nouvelle série à côté de l'ancienne, sans la réécrire.
  L'ouverture et la clôture suivent l'ordre d'exécution des échanges, qui départage ceux d'une même transaction.
  Une étape du tick, après les achats des PNJ, remplit les chandeliers de chaque monde : elle relit les échanges depuis le début de la période qui précède le dernier chandelier de la série, recalcule en entier chaque chandelier concerné et remplace la ligne de même clé, si bien que rejouer un tick ne double rien.
  Elle relit la période précédente parce qu'un échange est daté du début de sa transaction et peut être validé après le calcul de sa période ;
  un échange validé plus tard encore n'est pas rattrapé. Une série vide (monde neuf, durée changée) est reconstruite depuis le premier échange.
  Le rang d'exécution d'un échange est donné par la base, unique, et le service de jeu ne choisit ni ce rang ni la date d'un échange.
  La base refuse un chandelier incohérent (période mal alignée, prix hors de l'intervalle plus bas – plus haut, volume nul, montant hors de plus bas × volume – plus haut × volume).
  C'est un agrégat des échanges, recalculable, dont ni la monnaie ni les stocks ne dépendent : le moteur le remplit et en recalcule les valeurs, sans jamais en supprimer.
  L'historique est une donnée publique du marché, comme le carnet agrégé : tout joueur connecté lit celui de toutes les cités (vue `price_candles`), sans identité de maison ni d'ordre ;
  un visiteur anonyme ne lit rien. La durée des chandeliers et la fenêtre du prix observé sont des règles publiques, lues par les joueurs connectés avec la taxe (vue `market_rules`, section `priceHistory` de la version en vigueur).
  Affichage de l'historique : l'écran montre la série en cours, c'est-à-dire les chandeliers dont la durée est celle de la configuration en vigueur.
  Après un changement de durée, l'ancienne série reste en base et recouvre la nouvelle dans le temps ;
  rien dans les chandeliers ne dit laquelle est en cours, le client lit donc la durée dans `market_rules` et n'affiche que cette série.
  Le dernier prix est la clôture du chandelier le plus récent de la série.
  Le graphique trace les chandeliers sur une échelle verticale logarithmique, du plus bas au plus haut de ceux qu'il montre : un doublement de prix occupe partout la même hauteur, et un échange à un prix aberrant n'écrase pas les autres.
  La variation sur 24 heures compare ce dernier prix à la clôture du dernier chandelier entièrement clos 24 heures avant l'instant de lecture (début de période ≤ instant − 24 h − durée) : (dernier prix − prix de comparaison) ÷ prix de comparaison, arrondie au millième.
  Si rien ne s'est échangé depuis plus de 24 heures, ce chandelier est le dernier lui-même et la variation est nulle ;
  sans chandelier aussi ancien parmi ceux que l'écran a lus, elle est annoncée inconnue, jamais nulle.
  L'instant de lecture est l'heure du navigateur : une horloge mal réglée déplace la coupure des 24 heures, donc le chandelier de comparaison ;
  l'indication est approximative et ne règle rien du jeu. Le prix moyen observé du marché est affiché selon son âge, jugé de la même façon : si l'instant de lecture − `observed_at` ≤ `window_seconds` (bord compris), il est annoncé « sur N h », N étant la durée de sa fenêtre ;
  sinon c'est un prix passé, donné avec sa date. Dans les deux cas la fenêtre annoncée se terminait à `observed_at`, pas à l'instant de lecture.
  Sans ligne pour ce marché, rien n'est affiché ; une ligne illisible donne l'alerte de lecture.
  L'instant de lecture étant l'heure du navigateur, une horloge en avance présente comme passé le prix d'un marché actif ;
  une horloge en retard, ou un `observed_at` postérieur à l'instant de lecture, fait annoncer « sur N h » un prix périmé.
  Prix de référence observé : pour chaque bien d'une cité, le prix moyen des échanges récents, pondéré par les volumes (somme des montants ÷ somme des unités des chandeliers retenus), arrondi à l'obole la plus proche, la demi-obole vers le haut.
  La fenêtre a pour durée `priceHistory.referenceWindowHours` (paramètre du back-office, d'une heure à trente jours ;
  24 heures pour une version de configuration publiée avant lui) et se termine à l'instant de jeu T du tick qui calcule.
  Un chandelier de la série en cours (durée `candleMinutes` de la même version) est retenu en entier si sa période commence à T − durée ou après, période en cours comprise ;
  un chandelier commencé avant est écarté en entier, si bien que la fenêtre réelle peut être plus courte d'au plus une période.
  La fenêtre dure donc au moins un chandelier : une configuration où `referenceWindowHours` × 60 est inférieur à `candleMinutes` est refusée.
  Un tick joué en retard date de T un prix qui peut inclure des échanges postérieurs à T, puisqu'il lit les chandeliers tels qu'ils sont au moment où il est joué.
  Une étape du tick, après celle des chandeliers, recalcule ainsi le prix observé de chaque marché et remplace sa ligne.
  Rien du jeu ne se règle sur ce prix : ni la demande, ni le budget, ni le prix de réserve des PNJ ne le lisent.
  Il sert à l'affichage et au tableau de bord économique ; les PNJ, eux, achètent selon le prix de référence de la configuration, qui reste caché.
  Une ligne par marché (table `observed_prices` : prix, unités sur lesquelles il s'appuie, durée de la fenêtre, instant du calcul), dont le moteur remplace les valeurs ;
  un marché sans échange récent garde son dernier prix observé, daté.
  Donnée publique comme l'historique : tout joueur connecté la lit (vue `observed_prices`), un visiteur anonyme ne lit rien.
- **Contrats** : livraison à terme entre joueurs, avec quantité, qualité minimale, prix, échéance et pénalité. Le défaut coûte de la Timè.
- **Enchères** : concessions minières, parcelles, biens saisis, charges publiques affermées.
- **Appels d'offres** : la cité achète pour ses grands travaux et ses fêtes.
- **Marché du travail et marché du fret** : mêmes mécaniques de carnet d'ordres.

## 5.4 La finance

- **Banque de joueur** (trapeza) : collecte de dépôts rémunérés, prêts à taux libre avec garantie (parcelle, navire, stock), ratio de réserve minimal imposé. Une ruée sur les dépôts est possible.
- **Prêt maritime** : prêt à taux élevé remboursé seulement si le navire arrive. C'est l'assurance du jeu, et elle est historique.
- **Trésor du temple** : prêteur PNJ au taux directeur, plafonné par la Timè. Levier de politique monétaire des administrateurs.
  Dans la première version (#724), un prêt du temple porte un intérêt simple, fixé à l'emprunt pour toute sa durée : principal × taux directeur annuel (points de base) × jours ÷ (10 000 × 365), arrondi à l'obole supérieure (`templeLoanInterest`, `packages/sim`, que la base vérifie).
  Paramètres du back-office (`templeTreasury`) : le taux directeur (`policyRateBps`), les durées admises en jours de jeu (`termDays`) et le plafond du principal par palier de Timè (`principalCaps`, paliers croissants qui ne prêtent pas moins) ; une version publiée avant eux ne prête pas.
  Décision (paramètres neutres) : plafonds nuls au départ, si bien que le temple ne prête rien tant que les administrateurs ne les ouvrent pas.
  Une maison emprunte au plus le plafond du plus haut palier que sa Timè atteint (`templeLoanCap`), rien sous le premier, et n'a qu'un prêt du temple à la fois, en cours ou en défaut (index unique).
  La commande `loan.borrowFromTemple` porte le principal, la durée et le taux que le joueur a vu (`temple_treasury_rules`) : un autre taux est refusé (`RATE_CHANGED`), comme une autre durée, un principal au-delà du plafond, un second prêt du temple (un prêt de banque, #728, ne compte pas) ou une maison sous une marque de déshonneur (`DISHONORED`).
  Décision (#724) : jusqu'à #725, qui la bornera dans le temps, la marque de déshonneur est un prêt en défaut de la maison, de tout prêteur.
  L'échéance est la clôture `termDays` jours de jeu après le jour de l'emprunt ; l'échéance et le défaut viennent avec #725.
  La commande `loan.repay` (prêt, montant) paie les intérêts d'abord, puis le principal, en une écriture `loan.repay` ; elle est refusée au-delà du reste dû ou de la trésorerie, et pour le prêt d'une autre maison, qui lui est inconnu, comme un prêt d'un autre prêteur jusqu'à #728.
  Un remboursement complet éteint le prêt, et la maison peut emprunter de nouveau.
  Événements de domaine : `LoanDisbursed` à l'emprunt, `LoanRepaid` à chaque remboursement (parts des intérêts et du principal, reste dû, état).
- **Sociétés** (après le lancement) : une activité peut être apportée à une société dont les parts s'échangent, avec dividendes et prises de contrôle.
- **Défaut** : saisie de la garantie, vente aux enchères, marque de déshonneur temporaire. Pas de faillite définitive : une maison ruinée repart avec un bien insaisissable.

## 5.5 Robinets et puits

La masse monétaire est pilotée. Le tableau de bord économique (section 15) suit chaque ligne en continu.

| Création de drachmes | Destruction de drachmes |
| --- | --- |
| Revenu public des PNJ (#632) | Entretien des bâtiments et navires |
| Prêts du Trésor du temple | Taxes de marché et droits de port (part détruite) |
| Récompenses de quêtes et de Jeux | Offrandes, liturgies et fêtes de la cité |
| Dotation de départ | Intérêts payés au Trésor du temple |
| Rachat du stock d'un bien à retirer (Olympe, 5.1) | Grands travaux et merveilles |
| Dotation des maisons PNJ de secours (8.3, #715) | Acquisition de sites et achat de navires |
|  | Surplus des maisons PNJ de secours (8.3, #716) |

Salaires et hébergement versés aux PNJ (#632) : ni création ni destruction, mais un transfert des maisons à la bourse des PNJ de la cité, que la masse monétaire compte.
Les achats des PNJ aux joueurs, payés par cette bourse, sont le transfert inverse : depuis #632, ils ne créent plus de monnaie, et le robinet `faucet_npc_purchases` reste au catalogue pour l'historique, sans mouvement nouveau.
La base n'admet au crédit d'une bourse que ces natures d'écriture (#651) : les salaires des sites et des intendants (`upkeep.daily`, `upkeep.restart`), l'hébergement (`lodging.daily`, `lodging.restart`) et le revenu public de sa propre cité (`npc.public_income`) ; toute autre écriture qui la crédite, droit de port, revente ou taxe d'un échange, est refusée, quel que soit le rôle.
Elle vérifie aussi qui paie (#655) : salaires et hébergement ne viennent que de la trésorerie d'une maison qui a un site dans la cité de la bourse, le revenu public que de son robinet.
La boucle se ferme ainsi : sans robinet ni puits, la masse d'un monde ne change pas, quels que soient les ticks et les clôtures (propriété testée dans `packages/sim`).

Robinet des maisons PNJ de secours (`faucet_npc_house_grant`, #715) : il ne paie que la dotation d'une maison PNJ (8.3), une fois, à sa fondation par la clôture, au montant que la configuration fixe pour sa filière (`npcHouses`).
Il reste à part de la dotation de départ des joueurs (`faucet_starting_grant`) : le tableau de bord suit les deux séparément.
Comme pour les autres robinets, la base ne lie pas ce compte à sa mécanique (12).
Une maison PNJ paie ensuite l'entretien, les salaires et l'hébergement comme toute maison ; elle n'entre dans aucun classement, fortune et Gini compris (8.3).

Puits du surplus des maisons PNJ de secours (`sink_npc_house_surplus`, #716) : chaque clôture, juste avant l'entretien, y verse la trésorerie d'une maison PNJ au-delà du plafond de sa cité (`npcHouses.<cité>.treasuryCapOboles`), par une écriture `npc_house.surplus`.
Une maison PNJ ne thésaurise donc pas et ne gonfle pas la masse ; elle paie ensuite l'entretien avec ce qui reste.
Seule sa trésorerie compte : le séquestre de ses achats en attente reste à l'agora jusqu'à leur service ou leur annulation.
Une cité que la configuration ne nomme plus n'a pas de plafond, et ses maisons PNJ ne versent rien.
Aucun robinet ne paie une maison PNJ après sa dotation : faute d'entretien, ses sites s'arrêtent comme ceux d'une autre maison.
Dissolution (#717) : une maison PNJ qui s'est retirée de tous ses sites (8.3) vend son stock au prix de référence ; une fois rien en stock ni en attente, sa trésorerie va au même puits, par une écriture `npc_house.dissolution`, et elle se dissout.
La masse ne garde rien d'une maison PNJ dissoute, ni sa dotation, ni ce que ses ventes lui ont rapporté.

Robinet du rachat (`faucet_good_buyback`, #229) : il ne paie que le rachat du stock d'un bien à retirer (5.1), au prix de référence en vigueur, et chaque obole qu'il crée a pour contrepartie une unité retirée de la circulation (extrémité `good_buyback` du journal des stocks).
Comme pour les autres robinets, la base ne lie pas ce compte à sa mécanique (12) : seule la commande d'Olympe l'écrit, et le tableau de bord le suit comme les autres.

Achat de navires (`sink_ship_purchase`, #251) : le prix d'un navire neuf, fixé par la configuration pour sa classe, est détruit par une écriture `ship.acquire` (4.6).
Il n'y a pas de revente, donc aucun robinet en face.
Voyages (#252, 4.6) : les provisions d'un voyage sont détruites par le puits `sink_voyage_provisions`, la part détruite du droit de port par `sink_port_dues`, l'entretien quotidien des navires par `sink_ship_upkeep`.
La configuration initiale les règle depuis #668 (4.6) : l'entretien est la solde de l'équipage, les provisions ses vivres pendant le trajet, le droit de port 1 % d'une soute pleine de blé.

Immobilier (#256, 4.5) : le prix d'achat d'un bien à la cité est détruit par le puits `sink_property_purchase` (écriture `property.buy`), son entretien quotidien par `sink_property_upkeep` (dans l'écriture `upkeep.daily` de la clôture) et le prix d'une rénovation par `sink_property_works` (écriture `property.renovate`).
Les biens se louent et se revendent entre maisons (#257, 4.5) : le loyer (`lease.rent`) et le prix d'une revente (`property.sale`) passent d'une maison à une autre sans création de monnaie, donc sans robinet en face.
La revente paie la taxe de marché de la cité du bien, comme un échange de l'agora : sa part détruite va au puits `sink_market_tax`, le reste au trésor de la cité.
Depuis #668, la configuration initiale règle aussi l'entretien et la vétusté (4.5), si bien que les quatre puits de l'immobilier sont en jeu.

Hébergement (#258, 4.4) : chaque travailleur d'un site que sa maison ne loge pas coûte chaque jour une nuit chez les PNJ, au prix du jour de la cité.
Depuis #632, elle est versée à la bourse des PNJ de la cité du site, comme les salaires : c'est un transfert, pas un puits ; le puits `sink_npc_lodging` reste au catalogue pour l'historique, sans mouvement nouveau.
Le prix de base est d'une obole dans la configuration initiale, jusqu'à trois au plus fort de la pénurie (#668, 4.4).

Revenu public des PNJ (#632) : chaque jour de jeu, la bourse des PNJ de chaque cité de la configuration reçoit son revenu public par le robinet `faucet_npc_public_income`, une écriture `npc.public_income` par cité (`meta` : la cité et le jour de jeu).
Le premier tick de demande du jour la verse, avant les achats ; la clôture, après la population et avant l'entretien, ne la verse que si aucun tick du jour ne l'a fait.
En production, le moteur joue les ticks avant les clôtures à chaque passage (`apps/engine/src/main.ts`) : c'est donc presque toujours le premier tick du jour qui verse, sur la population de la veille, et la clôture n'est qu'un secours.
Une bourse n'attend ainsi jamais la clôture (déploiement après la clôture du jour, monde neuf, cité ajoutée après la clôture).
Le premier des deux qui passe verse, sur la population qu'il lit ; l'autre ne fait rien : la base tient une seule écriture `npc.public_income` par cité et par jour de jeu (index unique `ledger_entries_npc_public_income_once`), même en concurrence.
Elle exige pour cela la cité et le jour de jeu sous une seule forme, comme pour l'entretien (#651) : un identifiant en minuscules, un jour entier sans zéro de tête ni décimale.
Son montant est, pour chaque classe, le revenu d'un jour de la classe (revenu par tick × ticks d'un jour de 24 heures × population ÷ 1 000) fois sa part publique (`npcClasses[].publicIncomeBps`, de 0 à 10 000 points), sommé sur les classes, fois le multiplicateur de la cité (`cities[].npcPublicIncomeBps`, de 0 à 20 000 points, 10 000 = ×1, #657), puis arrondi une fois à l'obole inférieure (`dailyPublicIncome`, `packages/sim`).
La population est la population courante lue par celui qui verse (celle de la veille pour le premier tick, celle que la clôture vient de fixer pour la clôture), ou celle de la configuration pour une classe que le moteur n'a pas encore fait naître ; une cité absente de la configuration ne reçoit rien, et un revenu nul n'a pas d'écriture.
Une classe dont la version de configuration ne donne pas ce paramètre prend sa valeur par défaut (`DEFAULT_NPC_PUBLIC_INCOME_BPS`), 10 000 points : le revenu d'un jour entier, de quoi payer exactement les achats que payait le robinet d'avant #632.
L'équivalence ne vaut que pour les achats : la bourse reçoit le revenu d'un jour entier, dépensé ou non, alors que le robinet ne créait que ce qui était acheté ; la masse croît donc plus vite qu'avant.
Décision (#632, règle de #621) : « neutre » veut dire ici « comportement inchangé » ; un monde en service sur une version publiée avant le paramètre continue d'acheter comme avant, et la configuration initiale écrivait cette même valeur pour chaque classe jusqu'à #713, qui baisse celle des classes aisées (5.2, « Paniers des classes aisées »).
Ce qu'ils ne dépensent pas reste dans la bourse et compte dans la masse ; le calibrage de #283 baissera cette part à mesure que les salaires et l'hébergement remplissent les bourses.
C'est le plancher qui fait encore acheter une cité sans emploi, et le levier « revenu des classes PNJ » de cette section ; son calibrage est celui de #283.
Ce levier se règle aussi par cité (#657) : les salaires vont à la bourse de la cité du site, si bien que l'argent qu'une cité importatrice dépense en biens des autres cités ne lui revient pas ; le multiplicateur de cette cité comble son déficit sans gonfler la masse ni les prix des cités exportatrices, comme le ferait une part de classe plus haute partout.
Une cité dont la version de configuration ne donne pas ce multiplicateur prend ×1 (`DEFAULT_CITY_PUBLIC_INCOME_BPS`) : une version publiée avant lui garde son revenu public (règle de #621), et la configuration initiale écrit cette même valeur pour chaque cité.
Il ne transfère rien d'une bourse à l'autre : c'est le même robinet, plus ou moins ouvert selon la cité ; ses valeurs sont celles du calibrage de #283.

Décrets de dépense (#263, 6.3) : les grands travaux et les fêtes votés par une cité sont payés par son trésor, à la clôture qui les applique, au puits `sink_public_works` (écriture `city.public_works`) ou `sink_festivals` (écriture `city.festival`).
Le trésor ne paie rien d'autre, et ces puits ne détruisent que de la monnaie déjà prélevée par la taxe de marché et le droit de port : ils ramènent dans les puits la part de ces taxes que la cité gardait.
Le puits des offrandes (`sink_offerings`) ne compte plus les fêtes : il reste celui des seules offrandes, les liturgies ayant le leur depuis #720.

Trésor du temple (#724, 5.4) : le principal d'un prêt est créé par le robinet `faucet_temple_loans` (écriture `loan.temple_disburse`), et le principal remboursé recrédite ce robinet, qui ne compte donc en net que le principal encore dû.
Les intérêts sont détruits par le puits `sink_temple_interest` (dans l'écriture `loan.repay`) : c'est le coût du crédit pour la masse, et le taux directeur est le levier de cette ligne.
La base vérifie que chaque prêt est décaissé par sa propre écriture `loan.temple_disburse` et chaque remboursement payé par sa propre écriture `loan.repay`, et qu'une écriture de ces natures règle un prêt (12).
Elle ne lie pas pour autant ces comptes à ces natures : comme pour les autres robinets et puits, une écriture d'une autre nature peut encore mouvoir `faucet_temple_loans` ou `sink_temple_interest`.

Offrandes (#265, 7.1) : les oboles qu'une maison offre à un dieu sont détruites par le puits `sink_offerings` (écriture `temple.offering`).
Les biens offerts sortent de la circulation vers l'extrémité système `offering` du journal des stocks, d'où rien ne revient : c'est aussi un puits de biens.
Rien n'est créé en face : une offrande ne rapporte que de la Charis, qui n'est pas de la monnaie et ne s'échange pas.
Offrir n'est jamais obligatoire : ce puits ne pèse sur la masse monétaire qu'autant que les joueurs le choisissent.

Liturgies (#719, 6.4) : la première clôture de chaque saison désigne les maisons les plus riches de chaque cité et fixe leur dû, une part bornée de leur fortune (4.1).
Cette désignation ne fait bouger aucune monnaie : c'est l'accomplissement ou le prélèvement d'office (#720) qui verse le dû à un puits, proportionnel à la richesse comme l'attend la borne de masse (#721).
Puits des liturgies (`sink_liturgies`, #720) : il détruit le dû et le faste d'une liturgie accomplie (écriture `liturgy.perform`) et ce que le prélèvement d'office prend à l'échéance (écriture `liturgy.levy`).
Décision (#720) : un puits à part de celui des offrandes, pour que le tableau de bord distingue ce que les joueurs donnent de ce que la cité leur impose.
La base vérifie que chaque règlement est payé par sa propre écriture, de la trésorerie de sa maison à ce puits, et qu'un prélèvement partiel vide la trésorerie ; elle ne lie pas, en sens inverse, une écriture vers ce puits à une liturgie, comme pour les autres puits (12).
Le prélèvement d'office vient après les loyers et avant l'entretien : un dû qui vide la trésorerie peut laisser l'entretien impayé (sites à l'arrêt).
Dans l'ordre de la clôture, elle vient après la planification des événements du monde et avant le déclin de la Charis, donc avant tout ce qui touche la monnaie et avant l'entretien.

Masse monétaire, dans la première version : la somme des soldes de tous les comptes du grand livre qui ne sont pas des comptes système, soit les trésoreries des maisons, leurs séquestres à l'agora et les trésors des cités.
Depuis #632, elle compte aussi les bourses des PNJ des cités (12), une nature à part du tableau de bord (`npcPurses`) : ce que les maisons versent aux PNJ circule encore.
Le trésor d'une cité est compris : sa monnaie n'est pas détruite, la cité la dépensera ;
seule la monnaie passée à un puits ne circule plus. La masse égale à tout instant ce que les robinets ont créé moins ce que les puits ont détruit (l'opposé du cumul des comptes système).

Suivi des robinets et des puits : chacun est un compte système, mesuré en net.
Un robinet a créé l'opposé de la somme de ses lignes, un puits a détruit la somme des siennes : un remboursement à un robinet réduit sa création du jour, et un jour dont le net est nul n'a pas de mouvement.
Une écriture compte dans le jour de jeu de sa date, le jour commençant à l'instant de sa clôture, bord compris, avec l'horloge de la configuration en vigueur à la lecture, comme les comptes de la maison (4.1) : changer l'heure de clôture ou le fuseau redécoupe les jours passés.
Le tableau de bord se lit par `GET /api/admin/economy` (section 15) : pour chaque monde, la masse par nature de compte, et pour chaque robinet et chaque puits son cumul depuis l'origine et son net par jour de jeu sur les 30 derniers jours, jour en cours compris (paramètre `days`, tout entier positif ;
au-delà de 90, la fenêtre est bornée à 90 et la réponse le dit).
Le jour en cours est celui de l'horloge de la base, qui date les écritures, lue dans le même instantané ;
une écriture datée après la fin de ce jour ne compte que dans les cumuls.
La lecture se fait dans un seul instantané du grand livre, sans agrégat intermédiaire : masse, cumuls et jours se recoupent toujours.

Indice des prix et inflation, dans la première version : l'indice suit le coût d'un panier de référence, quantités fixes de biens (paramètre du back-office `priceIndex.basket` ;
au départ, la consommation de référence d'un jour de la population initiale de Kallistè pour ses six biens principaux, soit 88 % de sa dépense de référence depuis les paniers de #713, 97 % avant).
Le prix d'un bien sur une fenêtre est le prix moyen de ses échanges dans toutes les cités du monde, pondéré par les volumes (somme des montants ÷ somme des unités des chandeliers de la série en cours dont la période commence dans la fenêtre : à son début ou après, strictement avant sa fin ;
un chandelier daté au-delà de l'horloge de la base n'est jamais compté), sans arrondi intermédiaire.
L'indice est le coût du panier rapporté à son coût aux prix de référence de la configuration en vigueur, en points de base (10 000 : prix de référence).
L'inflation compare deux fenêtres consécutives de `priceIndex.windowDays` jours (30 au départ ;
chacune de ce nombre de fois 24 heures, la plus récente finissant à l'horloge de la base, lue dans le même instantané que le grand livre) : coût du panier sur la fenêtre courante ÷ coût sur la précédente − 1, en points de base, arrondie au point le plus proche, le demi-point vers le haut, sans passer par les deux indices déjà arrondis.
Un bien du panier sans échange sur une fenêtre rend l'indice de cette fenêtre inconnu, et l'inflation avec lui : jamais de prix inventé ;
la lecture nomme les biens en cause, fenêtre par fenêtre. L'inflation est donc connue dès qu'un échange par bien du panier tombe dans chacune des deux fenêtres, soit vers le 31e jour d'échanges et non après 60 : la fenêtre précédente n'est alors mesurée que sur sa fin.
Une fenêtre est partielle quand l'historique des prix du monde (le premier chandelier de la série, tous biens et toutes cités) commence strictement à l'intérieur ;
au plus une l'est, car si c'est la courante, la précédente est vide.
La lecture le signale (`partialWindow`) sans rien estimer ni retenir l'alerte : l'indice et l'inflation restent calculés sur les échanges qui existent.
Un panier vide (version de configuration publiée avant l'indice) donne un indice inconnu.
La cible (`priceIndex.inflationTargetBps`, de 0 à 300 points au départ, bornes comprises) situe l'inflation : dans la cible, en dessous, au-dessus, ou inconnue ;
hors de la cible, le tableau de bord alerte. Rien du jeu ne se règle sur l'indice.
`GET /api/admin/economy` rend pour chaque monde l'indice des deux fenêtres, l'inflation et sa situation, les biens sans échange par fenêtre (`unpricedByWindow`, et leur réunion `unpricedGoods`) et la fenêtre partielle ;
elle dit aussi, une fois pour tous les mondes, si le panier est vide (`basketEmpty`) : « pas de panier » se lit dans ce champ, jamais dans une liste de biens vide.

Inégalité des fortunes (#718) : le tableau de bord suit, pour chaque monde et chacune de ses cités, le coefficient de Gini des fortunes des maisons (4.1), en points de base (0 : fortunes égales ; vers 10 000 : une maison a tout).
Il est calculé en entiers par `giniBps` (`packages/sim`), sur les fortunes triées, arrondi au point le plus proche, le demi-point vers le haut ; une fortune négative (une dette plus grande que l'actif, #724) y compte pour zéro.
Une maison compte dans sa cité de citoyenneté, et toujours dans son monde ; les maisons PNJ de secours (8.3) n'entrent dans aucun Gini, comme dans aucun classement de fortune.
Sans maison, le Gini est inconnu, jamais nul ; toutes les fortunes nulles donnent un Gini nul.
`GET /api/admin/economy` le rend dans `inequality`, avec le nombre de maisons comptées et celui des stocks sans prix observé, que leurs fortunes ignorent (15.1).
Aucune borne ne s'y applique encore : c'est une mesure, que les liturgies (#719) et l'Hybris liront.

Entretien des sites, dans la première version : à chaque clôture quotidienne (section 3), chaque site d'une maison doit un entretien, détruit (puits « entretien »).
Deux paramètres du back-office : un montant de base par jour de jeu et par type de site (`sites.upkeep.dailyOboles`) et un coefficient global en points de base (`sites.upkeep.coefficientBps`, 10 000 = ×1, de ×0 à ×10), qui est le levier « coefficient d'entretien » ci-dessous.
Dû par site = ⌈base × coefficient ÷ 10 000⌉, arrondi à l'obole supérieure : l'arrondi ne joue jamais en faveur de la monnaie en circulation.
Un montant nul ne prélève rien ; une version de configuration publiée avant l'entretien se lit sans entretien.
Ces paramètres sont des règles publiques, lues par les joueurs avec le reste de la section `sites` (vue `site_rules`).
Chaque site doit aussi, chaque jour, les salaires de ses travailleurs (4.4) : son dû d'un jour est son entretien plus ses salaires, chacun calculé à part puis additionné (`siteDailyDue`).
Depuis #258, il doit aussi l'hébergement de ses travailleurs sans logement (non logés × prix du jour de sa cité), compté dans le même dû et payé avec lui, en entier ou pas du tout : un site dont l'hébergement ne peut être payé est à l'arrêt comme les autres.
Le salaire et l'hébergement du jour sont ceux que la clôture vient de fixer pour la cité du site (4.4).

Ce qui est dû : chaque clôture demande à chaque site, à l'arrêt ou non, l'entretien et les salaires d'un jour, au tarif de la configuration en vigueur après l'activation éventuelle d'une version programmée à cette clôture (activation d'abord, entretien ensuite).
Payé à la clôture, le site tourne, ou repart s'il était à l'arrêt ;
impayé, il est à l'arrêt jusqu'à la clôture suivante ou jusqu'à une relance.
Il n'y a pas d'arriéré : un jour passé à l'arrêt ne crée aucune dette.
Deux exceptions : un site acquis à l'instant de jeu de la clôture ou après ne doit rien pour ce jour, même si la clôture est jouée en retard ;
un site dont la recette n'est plus dans la configuration n'a plus de type, donc pas de tarif — il ne doit rien, n'est pas arrêté, et repart sans payer s'il était à l'arrêt.
Le prélèvement d'une maison est une seule écriture du grand livre (`upkeep.daily`) qui porte la maison, le jour de jeu et les sites payés, avec le dû de chacun par nature, puis les navires payés (4.6), puis les biens immobiliers payés (`meta.properties`, 4.5) ;
elle a une ligne de débit de la trésorerie par nature, marquée (4.1), et une part nulle n'a pas de ligne : l'entretien va au puits « entretien » (`sink_upkeep`), les salaires à la bourse des PNJ de la cité de chaque site (#632 ; avant, au puits `sink_npc_wages`), une ligne de crédit par bourse ;
les intendants payés (4.4, #278) y ont chacun leur dû avec son site (`meta.stewards`), et leur somme une ligne `wages`, versée à la bourse de la cité du site de chacun, examinés après les biens immobiliers ;
l'hébergement des sites payés va à la bourse des PNJ de la cité de chaque site par une écriture à part, `lodging.daily`, de la même transaction, une par maison et par jour (`meta.sites` : chaque site, ses non logés et leur hébergement), de nature 4.1 `lodging` ;
une maison qui ne paie rien n'a pas d'écriture. Chaque maison à qui la clôture a demandé quelque chose reçoit un événement de domaine `UpkeepSettled` : ce qui a été payé, au total et par nature, ce qui ne l'a pas été, les sites arrêtés et les sites relancés.

Maison qui ne peut pas tout payer : ses sites sont examinés par date de création, puis par identifiant.
Chacun est payé en entier, entretien et salaires, si ce qui reste de la trésorerie le couvre ;
sinon il n'est pas payé du tout, et l'examen continue (un site moins cher peut encore être payé).
Il n'y a ni paiement partiel, ni solde négatif. La monnaie sous séquestre à l'agora n'est pas comptée dans la trésorerie disponible : c'est un choix, elle est déjà engagée.

Effet de l'arrêt : un site à l'arrêt ne produit ni n'accumule, et le temps passé à l'arrêt n'est jamais récolté ensuite.
Ce qu'il avait accumulé avant l'arrêt reste récoltable. Cela vaut pour une production sans intrant ;
un atelier, lui, ne se récolte pas à l'arrêt, puisqu'il ne consomme rien : ses cycles écoulés avant l'arrêt restent dus et tournent après la relance (4.3).
Un site à l'arrêt, quel qu'il soit, compte toujours dans la limite de sites de la maison.

Relance : la maison peut relancer un site à l'arrêt sans attendre la clôture, par une commande qui paie l'entretien et les salaires d'un jour (aux puits, au tarif de la configuration en vigueur), en entier ou pas du tout ;
le site repart à cet instant, et la clôture suivante lui demande son dû (entretien et salaires) normalement.
La commande (`site.restart`) est refusée si le site tourne déjà ou si la trésorerie ne couvre pas le dû du site (entretien et salaires) ;
elle porte le prix que le joueur a vu (`expectedUpkeepOboles` : entretien et salaires d'un jour ; un client qui n'annonce que l'entretien voit son prix refusé dès qu'il y a des salaires), et l'API refuse (« le prix a changé », rien n'est payé) plutôt que de prélever un autre tarif, plus haut comme plus bas, par exemple après l'activation d'une version entre l'affichage et le clic.
Ce prix attendu est facultatif : un client antérieur, qui ne l'envoie pas, est servi au tarif en vigueur comme avant ;
le refuser casserait les clients restés en cache (application installée) jusqu'à leur mise à jour, et le champ deviendra obligatoire quand plus aucun client ne l'omettra.
Le prix envoyé est retenu avec la clé d'une relance restée sans réponse, et un nouvel essai renvoie ce prix sous cette clé, même si le tarif affiché a changé entre-temps : une clé neuve au nouveau prix pourrait payer une seconde fois une commande déjà aboutie, et la même clé avec un autre prix serait refusée.
Si le premier envoi avait abouti, l'API rejoue sa réponse ; sinon elle refuse ce prix, et le joueur confirme le nouveau d'un nouvel essai, sous une clé neuve ;
son paiement est une écriture du grand livre d'une nature à part (`upkeep.restart`), avec une ligne marquée par nature comme à la clôture, annoncée par un événement de domaine `SiteRestarted` qui distingue entretien et salaires.
Depuis #258, la relance paie le salaire du jour de la cité et, au prix du même jour, une nuit d'hébergement pour chaque travailleur du site que les logements de sa maison, lus à l'instant de la commande, ne logent pas ; l'hébergement part par une écriture `lodging.restart`, et le prix vu (`expectedUpkeepOboles`) le comprend.
Depuis #632, les salaires et l'hébergement d'une relance vont à la bourse des PNJ de la cité du site, et l'entretien seul au puits.
Les relances et l'entretien de la clôture verrouillent les puits dans le même ordre (entretien, puis salaires, puis hébergement), puis la trésorerie, puis le site ; la clôture prend ceux des navires et des biens entre les salaires et l'hébergement.
Les puits des salaires et de l'hébergement restent verrouillés à leur place depuis #632, sans rien recevoir ; juste après eux, la relance verrouille la bourse des PNJ de la cité du site, et la clôture toutes les bourses du monde, par cité, avant toute trésorerie.
Le tick de demande des PNJ, qui ne prend pas ces puits, verrouille toutes les bourses du monde juste après le verrou de l'agora, avant toute trésorerie de vendeur.
La clôture verrouille en plus, après ces deux puits, ceux de l'entretien des navires et des biens immobiliers, qu'elle seule prélève, et, après les sites d'une maison, ses navires (4.6) puis ses biens (4.5).
Elle prend avant tout le verrou de l'agora du monde, et la vétusté des biens le prend juste avant l'entretien : l'achat et la rénovation d'un bien le prennent aussi d'abord, si bien qu'aucun d'eux ne verrouille un bien que la clôture attendrait.
Les loyers des baux (#257), avant la vétusté, prennent le verrou de l'agora, puis les puits de l'entretien dans le même ordre (cinq depuis l'hébergement, #258), sans les mouvementer, puis les trésoreries des parties par identifiant : la relance d'un site, qui verrouille ses puits avant sa trésorerie sans prendre l'agora, ne peut donc pas attendre une trésorerie que la clôture tient pendant que la clôture attend ses puits.
Un site dont la recette n'est plus dans la configuration, qui n'a pas de tarif, est relancé sans rien payer.
La monnaie sous séquestre ne paie pas non plus une relance. Les relances d'un monde se font l'une après l'autre et, quand une clôture a commencé à prélever l'entretien, attendent qu'elle soit validée tout entière (l'entretien est donc la dernière étape d'une clôture, pour que cette attente soit la plus courte) ;
si la clôture vient d'arrêter le site pendant cette attente, la relance est refusée (« le site vient de changer ») et se rejoue.
Une relance validée alors qu'une clôture est déjà commencée n'en dispense pas : si la trésorerie ne couvre plus le dû du site (entretien et salaires), le site est arrêté de nouveau par cette clôture, à l'instant où elle a commencé — le cycle repris y perd au plus la durée de la clôture.

À l'écran : la fiche de chaque site annonce son entretien quotidien (lu dans les règles publiques des sites), et, s'il est à l'arrêt, depuis quand et pourquoi, avec un bouton de relance qui en dit le prix. Ce qu'elle annonce « à récolter » s'arrête à l'instant de l'arrêt, et un atelier à l'arrêt n'annonce rien ; l'API reste seule à décider. Un essai de relance refusé repart d'une demande neuve.

Impayé volontaire : il est admis et ne coûte que l'arrêt du site (une mise en sommeil). Éviter le prélèvement de la clôture puis relancer coûte le même entretien : il n'y a aucun gain à l'esquiver.

Règle de conception : l'inflation mensuelle cible est comprise entre 0 % et 3 %. Trois leviers l'ajustent sans patch : taux directeur, coefficient d'entretien, revenu des classes PNJ.

Calibrage de la cité prototype (ticket #78), décidé pour la phase 1 et éprouvé par le banc d'équilibrage (`apps/api/src/balance.integration.test.ts`) :

- **Taille.** Kallistè garde ses 10 000 habitants, mais leur consommation de référence (Q0) et le revenu de leurs classes sont divisés par 15 par rapport aux premières valeurs.
  La cité est ainsi approvisionnée par une trentaine de maisons de quatre sites, la communauté attendue pour le prototype et l'alpha, et non par plus de 300.
  Une cité plus peuplée de joueurs se recalibre par une version de configuration, sans patch.
- **Blé.** Chaque maison commence par le site de départ de sa cité (6.1) : à Kallistè, un champ de blé (40 blés par cycle de quatre heures).
  Pour que ces champs trouvent preneur sans faire chuter le prix, les thètes et les zeugites mangent plus de blé que de pain (Q0 de 4,2 et 2,1 pour mille par tick).
  Leur revenu suit, à 1,25 fois leur dépense de référence comme pour les autres classes.
- **Population.** Le seuil de couverture est de 100 % : une classe ne croît que si ses besoins vitaux sont entièrement couverts, et émigre dès qu'ils ne le sont plus.
  À ce seuil, la population se règle sur l'offre au prix de référence, au lieu de s'installer sur une pénurie qui ferait monter les prix.
  Croissance de 0,2 % par jour au plus, émigration de 1 % par jour au plus, bornes de 50 % à 200 % de la population initiale : la cité suit l'offre lentement, sans à-coup de prix.
- **Mesure.** Avec 28 maisons scriptées, dont l'offre couvre d'environ 100 à 110 % de la demande de référence de chaque bien vital (un peu moins pour le pain, que la farine limite), le banc tient sur 30 jours une hausse du coût du panier de 0 à 2 % entre les dix premiers et les dix derniers jours, et des besoins vitaux couverts à 98 % au moins pour chaque classe.
- **Limite connue.** La masse monétaire croît d'environ 60 000 oboles par jour et par cité (mesure du banc, à une cité ; un monde de quatre cités en crée donc à peu près quatre fois plus) : les achats des PNJ créent plus de monnaie que l'entretien, la taxe et l'acquisition de sites n'en détruisent.
  Depuis #632, ils n'en créent plus : la monnaie vient du revenu public, versé en entier chaque jour, dépensé ou non.
  À quatre cités (#283), la masse du monde croît de 179 % sur les 30 jours mesurés, soit environ 46 800 oboles par jour : le revenu public en crée environ 52 600, les puits n'en détruisent qu'environ 5 800.
  Les prix n'en dépendent pas tant que les PNJ sont les seuls acheteurs finaux.
  Les puits de la phase 2 (immobilier, décrets) ne prennent pas sur les bénéfices des maisons : seul un puits proportionnel à la richesse, les liturgies de la phase 3, peut contenir la masse sans faire tomber les marges des ateliers ni arrêter de sites.

Marges des ateliers (#285, 4.3) : la configuration initiale règle les intrants de quatre recettes d'atelier (pressoir, tissage, poterie, chai) et le prix de référence de l'amphore, pour que chaque atelier rapporte, dans le banc à quatre cités, de la moitié au double de la médiane des sites de matières premières.
Aucun robinet ni puits n'est réglé : l'entretien des sites, la taxe et le revenu public restent ceux d'avant, et le rapport du simulateur ne voit bouger la masse du monde que de 0,2 % sur 30 jours.
Le banc à une cité garde ses bornes : hausse du coût du panier de 0,87 % (0,55 % avant), besoins vitaux couverts à 98 % au moins, population qui ne baisse pas.
Depuis #668, il compte les salaires et l'hébergement que ses maisons versent aux bourses des PNJ ; ses maisons jouent leur matinée chacune à son tour en premier, et sa mise en route dure douze jours au lieu de dix (hausse du coût du panier de 0,08 %, besoins vitaux couverts à 99,1 % au moins, population de 9 775 à 10 236).
À ordre fixe, le dernier des trois meuniers ne vendait jamais sa farine, que les deux premiers vendaient chaque matin aux boulangers, et ne payait plus ses salaires dès le sixième jour ; gardant de quoi payer salaires et hébergement, les maisons acquièrent aussi leurs sites plus tard, et au dixième jour les hippeis n'étaient couverts qu'à 94 %.
Décision : ce démarrage à froid, où les besoins vitaux d'une classe restent sous 98 % pendant environ deux jours, est connu et accepté ; la mise en route est une fenêtre de mesure choisie, et les bornes ne valent que pour les 30 jours mesurés.
Des ateliers moins gourmands laissent des olives, du raisin, de l'argile et de la laine sans preneur : ces matières premières s'y vendent un peu moins cher, sans toucher au panier.
Depuis #668, la configuration initiale paie une drachme par travailleur et par jour : un atelier de deux travailleurs paie 12 oboles de salaires par jour, et les marges, salaires et hébergement déduits, restent dans leur borne (de 495 oboles pour le charbon à 1 120 pour le moulin, le chai à 448, borne basse 425).
Depuis #669, la configuration initiale retire la laine au terroir de Kallistè (6.1).
Le banc à une cité, qui joue Kallistè seule et sans armateur, lui rend toutes ses matières premières dans son scénario, pour que ses tisserands tondent leurs moutons sur place.
Ses mesures n'en changent pas, ni ses bornes : hausse du coût du panier de 0,08 %, besoins vitaux couverts à 99,1 % au moins, population de 9 775 à 10 236.

Terroirs resserrés (#714, 6.1) : la configuration initiale retire aussi le sel au terroir de Kallistè, qu'Elaia et Halos raffinent.
Chacune des douze cités importe désormais au moins un bien vital, ou l'intrant d'un bien vital ; un test sur la configuration initiale le vérifie cité par cité.
Le banc à une cité rend toujours toutes ses matières premières à Kallistè, le sel compris : ses mesures et ses bornes sont celles d'avant (hausse du coût du panier de 0,08 %, besoins vitaux couverts à 99,1 % au moins, population de 9 775 à 10 236).
Dans le banc à quatre cités, la maison de Kallistè qui raffinait le sel pêche un second site de poisson, un armateur d'Elaia porte le sel à Kallistè, et un d'Halos à Ampélos, qui le tenait de Kallistè.
Un armateur de plus à chaque bout suffit : la demande de sel est la plus faible des quatre biens vitaux.
À quatre cités : coût du panier inchangé, besoins vitaux couverts à 100 %, masse de 2 177 949 oboles au dernier jour mesuré, population de 1 252 à 1 259 habitants par cité.
À douze cités : coût du panier inchangé dans chaque cité, besoins vitaux couverts à 98,4 % au moins (les hippeis d'Agrotera), marges des ateliers dans leur borne, aucun site arrêté, masse de 6 544 860 oboles au dernier jour mesuré, population de 1 247 (Delphis) à 1 268 (Agrotera) habitants par cité.
Le rapport du simulateur, configuration d'avant #714 contre configuration d'après, n'a aucun écart aux bancs à quatre et à douze cités, hors la marge du sel de Kallistè, qu'elle ne mesure plus.
Un test du banc vérifie que chaque scénario a un armateur pour chaque bien vital que le terroir d'une cité ne produit pas (sauf le bois, qu'une cité tire de ses voisines).

Calibrage à quatre cités (#283), éprouvé par le banc à quatre cités (`apps/api/src/balance-world.bench.ts`, graine fixe, 10 jours de mise en route puis 30 jours mesurés) :

- **Configuration.** Le banc joue la configuration initiale, salaires, marché du travail, transport, entretien et vétusté des biens et événements du monde compris (#668) ; il n'en remplace que la population des cités (divisée par huit), la dotation des maisons de son scénario (15 000 oboles, de quoi acquérir leurs sites et un navire dès les premiers jours), le prix d'achat et de rénovation des logements (divisés par cinq, rénovation au blé), et le simulateur le dit.
  Kallistè y joue le terroir de la configuration initiale, sans laine depuis #669 : aucune de ses maisons scriptées n'en tondait, et les mesures ci-dessous n'ont pas bougé.
- **Événements (#668).** Le banc planifie après chaque clôture les événements qu'elle aurait planifiés, sur sa graine fixe : sept en 40 jours, une bonne année à Elaia, deux tempêtes (Elaia–Halos, Elaia–Kallistè), deux sécheresses (Kallistè, pendant la mise en route ; Ampélos, qui n'a pas de champ) et deux caravanes (tissu à Elaia, vin à Halos).
- **Approvisionnement.** Kallistè et Elaia produisent pour elles et pour Ampélos et Halos, qui pêchent leur poisson ; trois armateurs par cité importatrice la ravitaillent par caboteur, un autre porte le vin de Kallistè à Elaia, un à Halos.
  Un armateur affiche ses prix : il vend les biens du panier à leur référence, le vin 52 oboles (ce qu'un tick du revenu des PNJ d'Ampélos ou d'Halos en paie), et n'achète jamais au-dessus de la référence.
  Chaque maison confie à un intendant ses récoltes, vendues à 90 % de la référence, et les biens du panier que font ses ateliers, vendus à leur référence.
  Le blé de Kallistè et d'Elaia couvre de 104 à 121 % de sa demande ; le pain, l'huile et le vin manquent un peu (deux moulins et un pressoir par cité, cinq chais à Kallistè), mais leurs intendants les vendent à la référence, et les armateurs n'en paient pas plus.
- **Mesure.** Le coût du panier ne bouge dans aucune cité, les besoins vitaux sont couverts à 100 % chaque jour, la population croît de 2,4 % dans chaque cité, aucun site ne s'arrête, et les marges des ateliers restent dans leur borne (#285).
  Les prix du panier sont donc ceux qu'affichent armateurs et intendants : la borne de 0 à 2 % vérifie que l'approvisionnement les tient et que chaque bien s'échange dans chaque cité à chaque fenêtre ; elle ne mesure pas l'inflation que produirait un marché sans prix affichés.
- **Masse.** Une borne contre l'emballement : moins de +200 % sur les 30 jours mesurés, ce que ferait le seul revenu public sans aucun puits (+201 % mesuré), et une création nette quotidienne des dix derniers jours d'au plus 110 % de celle des dix premiers (99 % mesuré).
  Avec les paramètres de #668, la masse croît de 178 % : le revenu public crée environ 52 700 oboles par jour, les puits en détruisent environ 6 600.
- **Puits (#668).** Part de chaque puits dans la monnaie détruite des jours mesurés : entretien des sites 41,6 %, taxe de marché 31,9 %, grands travaux 7,8 %, fêtes 7,7 %, droit de port 3,8 %, provisions 2,2 %, entretien des navires 2,2 %, rénovations 1,8 %, entretien des biens 0,9 %.
  Les achats de sites, de navires et de biens tombent dans la mise en route.
  La borne de −5 % à +25 % attend un puits proportionnel à la richesse, les liturgies, que la feuille de route place en phase 3 (17).

Calibrage à douze cités (#712), éprouvé par le même banc avec `BALANCE_SCENARIO=twelve` (graine fixe, 10 jours de mise en route puis 30 mesurés), dans le workflow `balance-nightly` :

- **Où et pourquoi.** Le banc à douze cités joue chaque nuit et à chaque envoi sur `main`, sans bloquer les demandes de fusion ; un échec y laisse un job rouge sur `main`.
  Décision (#712) : il dure trop pour chaque demande de fusion (36,2 minutes en local, où le banc à quatre cités en dure 10,9, soit environ 17 minutes en `ci`), et le banc à quatre cités reste dans le job `balance` (celui à une cité, dans les tests d'intégration).
  Le workflow joue aussi le test du simulateur (#284) sur ce scénario (10 minutes en local, sous sa limite de 30) ; la commande `simulate` le joue avec `BALANCE_SCENARIO=twelve`.
  Un simulateur en mémoire, sans base, a été écarté (#904, ADR 0012) : les règles du jeu n'ont qu'une source, la base et le moteur, et le temps du banc est dans les allers-retours à la base, pas dans le calcul.
  Le simulateur joue à la place sa référence et sa candidate en parallèle.
- **Scénario.** La configuration initiale entière, ses vingt-trois routes (#707), la population de chaque cité divisée par huit, comme à quatre cités, dont les maisons et les armateurs restent.
  Dikaia fait le blé, le pain et le vin de Delphis, Gamelia ceux d'Emporion, Phrourion ceux de Myrrhinè et de Chalkeia ; Agrotera fait les siens ; 131 % de la demande de blé, de 99 à 124 % de celle de pain.
  Delphis, Emporion, Myrrhinè et Chalkeia pressent l'huile, pêchent le poisson ou raffinent le sel de leurs voisines ; une maison de plus pêche à Ampélos, une autre coupe le bois et tire l'argile de Gamelia à Halos.
  Le boulanger cuit son charbon et le garde : vendu, le surplus d'une charbonnière ferait tomber le prix du charbon du monde, et la marge de la filière sous sa borne (309 oboles au premier essai).
- **Armateurs.** Dix-sept caboteurs de plus : trois pour chaque cité ravitaillée en blé et en pain, quatre pour Chalkeia, qu'aucune cité à blé ne borde, par une escale à Myrrhinè (4.6), où l'armateur ne vend ni n'achète rien.
  Un relais porte pour une autre cité ce qu'un second armateur y apporte (le sel d'Elaia pour Dikaia, par Delphis) : la demande de la cité de relais compte celle de la cité servie.
- **Mesure.** Le coût du panier ne bouge dans aucune cité, les besoins vitaux sont couverts à 98,4 % au moins chaque jour mesuré (les hippeis d'Agrotera), et aucun site ne s'arrête.
  Les quatre premières cités gardent leurs mesures de #283 ; la population des douze croît de 1,4 % (Delphis) à 2,4 %.
  Les marges des ateliers vont de 437 oboles (le chai) à 1 169 (le moulin), dans la borne de 421 à 1 685 : la médiane des dix-huit matières premières, toutes au terroir d'une cité, est de 842,5 oboles.
- **Masse.** Elle croît de 170 % sur les 30 jours mesurés, sous la borne de 200 % ; la création nette quotidienne des dix derniers jours vaut 99,5 % de celle des dix premiers (environ 137 000 oboles par jour).

Paniers des classes aisées (#713, 5.2) : aucune maison des bancs ne fait encore les biens finis nouveaux, et la part publique des classes aisées garde leur revenu public d'un jour.
Les trois bancs gardent leurs mesures et leurs bornes, avant comme après.
À une cité : hausse du coût du panier de 0,08 %, besoins vitaux couverts à 99,1 % au moins, population de 9 775 à 10 236.
À quatre cités : coût du panier inchangé, besoins vitaux couverts à 100 %, masse +177,6 %.
À douze cités : coût du panier inchangé, besoins vitaux couverts à 98,4 % au moins, masse +169,6 %, création nette des dix derniers jours à 99,5 % de celle des dix premiers.
Seul l'arrondi de la part publique au point inférieur bouge la masse : 208 oboles de moins dans les douze cités au dernier jour (rapport du simulateur).

Maisons PNJ de secours dans la configuration initiale (#717, 8.3) : une filière par bien vital brut que le terroir d'une cité admet, quinze dans onze cités, réglées pour la cité entière.
Un champ récolte 240 blés par jour, une pêcherie 108 poissons, une saline 115 sels, pour une demande d'environ 4 385 blés, 687 poissons et 219 sels par jour dans une cité de 10 000 habitants : dix-huit champs, six pêcheries et deux salines, de quoi couvrir les besoins vitaux bruts de la cité sans joueur.
Leur dotation paie une semaine d'entretien et de salaires (7 500 oboles pour le blé, 3 000 pour le poisson, 1 000 pour le sel), sous un plafond de 15 000 oboles par maison ; elles vendent à leur prix de référence, comme le veut 8.3.
Retrait : au-dessus de 75 % des ventes du bien pour les joueurs, sur trois clôtures, deux clôtures de suite ; retour sous 25 %.
Décision : le pain, fait d'intrants, n'a pas de filière de secours ; une maison qui achète farine et charbon au plus à leur référence ne tiendrait pas une cité sans meunier ni charbonnier, et le blé, vital lui aussi, la nourrit en attendant.
Les bancs jouent ces maisons à deux paramètres de scénario près : leurs sites divisés par huit comme la population (arrondis au-dessus), et sans règle de récolte, le banc récoltant leurs sites à l'heure de jeu.
Dans le scénario à douze cités, la maison d'Emporion qui raffinait le sel ne fait plus que pêcher : la saline PNJ tient le sel d'Emporion et celui que son armateur porte à Gamelia.
Le banc à une cité garde son scénario sans maison PNJ, et ses mesures : hausse du coût du panier de 0,08 %, masse de 4 149 089 oboles, comme avant.
À quatre cités, les sept maisons PNJ se retirent pendant la mise en route (pêcheries au troisième jour, salines au sixième, greniers au septième et au huitième) ; coût du panier inchangé, besoins vitaux couverts à 100 %, masse de +167,1 % (+171,5 % avant), création nette des dix derniers jours à 99,4 % de celle des dix premiers, population de 1 259 à 1 264 habitants au dernier jour (1 252 à 1 259 avant).
À douze cités, les quatorze maisons des filières que les maisons scriptées tiennent se retirent du troisième au huitième jour ; la saline d'Emporion tient sa filière jusqu'au bout, et Emporion et Gamelia restent couvertes à 100 %.
Coût du panier inchangé partout, besoins vitaux couverts à 98,1 % au moins (98,4 % avant, les hippeis d'Agrotera), masse de +163,9 % (+167,7 % avant), création nette des dix derniers jours à 99,1 % de celle des dix premiers, population de 1 254 à 1 272 habitants (1 247 à 1 268 avant).
Aucune ne s'est encore dissoute à la fin des bancs : leur stock, au prix de référence, se vend après celui des joueurs, à 90 % de la référence.

Inégalité des fortunes (#718) : le banc mesure chaque jour le Gini des fortunes de ses maisons, par cité et pour le monde, par `game.house_wealth`, et le rapporte au premier et au dernier jour mesurés, sans borne (journal du test et champ `gini` du fichier `BALANCE_REPORT`).
Le simulateur le compare de même (groupe `gini`, `gini/<cité>/first` et `gini/<cité>/last`).
Les mesures et les bornes des bancs ne changent pas : la mesure ne fait que lire.
Les chiffres ci-dessous ont été mesurés avant les terroirs resserrés de #714, qui changent le banc à quatre cités : ils donnent un ordre de grandeur, pas une référence.
À quatre cités, le Gini du monde passe de 2 305 à 3 966 points de base sur les 30 jours mesurés, de 870 à 1 215 à Kallistè et de 1 826 à 4 644 à Ampélos (10,5 minutes en local).
À douze cités, il passe de 2 476 à 3 886 points dans le monde ; Phrourion reste la plus égale (de 531 à 862), Delphis et Chalkeia finissent au-delà de 6 000 points (de 2 840 à 6 221 et de 2 895 à 6 073) (38 minutes en local, dont une partie en parallèle d'un autre banc).

## 5.6 Fiscalité

Chaque cité vote ses taux dans des bornes fixées par le monde : droit de port, taxe de marché, impôt sur la fortune levé en cas de crise, taxe de résidence des métèques.
Les recettes alimentent le trésor de la cité, dépensé par les magistrats.
La concurrence fiscale entre cités est un ressort de jeu assumé.

Droit de port, décision du ticket #252 : un forfait par arrivée et par classe de navire, payé au départ, que la cité module par son coefficient, et non 2 % de la valeur de la cargaison, qui n'a pas de valeur publique sûre (4.6).
Une part est détruite, le reste va au trésor de la cité d'arrivée, comme la taxe de marché ; le coefficient de chaque cité est un paramètre de configuration, à 10 000 (×1) au départ, que les décrets règlent (#262).

Taux par cité, décisions du ticket #262 : la taxe de marché d'une cité et le coefficient de son droit de port sont ceux de son dernier décret appliqué (6.3), ramenés dans les bornes que la configuration fixe aux décrets (`decrees.models`), sinon ceux de la configuration (`marketTax.rateBps`, `ships.portDues.cityCoefficientBps`).
Tant qu'aucun décret n'est appliqué, rien ne change donc pour la cité.
Les bornes encadrent les votes des cités, pas le monde : le taux de la configuration n'y est pas ramené.
Un décret devenu hors bornes, parce qu'une version de configuration les a resserrées depuis son vote, s'applique quand même et vaut la borne la plus proche, à son application comme ensuite ; il retrouve sa valeur votée si les bornes s'élargissent.
Un modèle que la configuration ne borne plus rend à chaque cité la valeur de la configuration : le monde a repris ce taux aux cités, et leurs décrets retrouvent leur effet s'il le rouvre.
Le dernier décret appliqué est le plus récemment appliqué ; deux décrets d'une même cité appliqués à la même clôture se départagent par la fin de leur vote, la plus tardive l'emportant, puis par leur identifiant.
Un seul calcul, celui de la base (`game.city_rates`), donne ces taux à toutes les commandes et étapes qui taxent : l'agora (`market.placeOrder`), les achats des PNJ, la revente d'un bien (`property.buyListed`) et le départ d'un navire (`voyage.depart`).
Chacune le lit sous le verrou de l'agora du monde, que prend aussi la clôture qui applique un décret : un échange ou un départ validé après elle paie le taux nouveau.

Dans la première version : le trésor de la cité est un compte du grand livre, un par cité, ouvert par la base à la création de la cité.
Il n'est jamais débiteur (la cité ne dépense que ce qu'elle a reçu), et le service de jeu ne peut ni l'ouvrir ni en modifier le solde hors des journaux.

Dépenses du trésor, décisions du ticket #263 : le trésor d'une cité ne paie que ses décrets de dépense appliqués (6.3), grands travaux et fêtes, chacun à son puits (5.5).
La clôture qui trouve un décret de dépense adopté le règle une fois, sous le verrou du trésor de sa cité : elle paie le montant voté, ramené au plus au maximum du modèle en vigueur, s'il ne dépasse pas la part `spendingCapShareBps` du trésor à cet instant, arrondie à l'obole inférieure, comme à la proposition.
Sinon le décret est caduc (`lapsed`), rien n'est payé, et l'événement `DecreeLapsed` le dit, avec ce que le trésor permettait ; un modèle que la configuration n'ouvre plus rend aussi le décret caduc.
Le trésor n'est donc jamais débiteur.
Les décrets d'une même clôture se règlent dans l'ordre de la fin de leur vote, chacun contre le trésor que les précédents ont laissé.
Un décret adopté depuis longtemps (par exemple avant ce ticket) est réglé à la première clôture qui le trouve, contre le trésor et la configuration de cette clôture ; une fête court à partir du jour que cette clôture ouvre, jamais sur une période passée.

Comptes publics du trésor, décision du ticket #263 (6.2 : « comptes publics visibles de tous ») : tout joueur connecté lit, pour chaque cité, le solde de son trésor (vue `city_treasury`) et ses flux par jour de jeu et par nature (vue `city_treasury_flows`), un visiteur anonyme rien.
Les natures sont la part de la taxe de marché que garde la cité (échanges de l'agora, achats des PNJ, revente d'un bien), celle du droit de port, les grands travaux et les fêtes ; `other` recueille toute nature d'écriture que la vue ne connaît pas encore, pour que la somme des flux reste le solde.
Le jour de jeu se compte comme dans les comptes de la maison (4.1), avec l'horloge en vigueur à la lecture ; un jour dont le net d'une nature est nul n'a pas de ligne.
Les joueurs ne lisent ni le compte lui-même ni ses lignes : seulement ces agrégats.
