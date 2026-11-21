# 7. Dieux, faveur et événements

La religion est un système de gestion à part entière : on investit dans la faveur d'un dieu comme dans un actif, et l'excès de puissance attire la sanction divine. C'est aussi le mécanisme d'équilibrage le plus important du jeu.

## 7.1 La Charis

La Charis se gagne par dieu : offrandes de biens (chaque dieu a ses préférences), construction de temples, financement de fêtes, actes conformes à son domaine. Elle décroît lentement, ne s'achète pas en argent réel et ne se transfère pas.

| Usage | Effet |
| --- | --- |
| Paliers passifs (5 par dieu) | Bonus permanents modérés, de 2 % à 10 %, dans le domaine du dieu |
| Grâces (3 par dieu) | Pouvoirs actifs à temps de recharge : vent favorable, récolte bénie, inspiration d'un artisan |
| Présages | Information avancée sur un événement à venir |
| Rang sacerdotal | Accès aux charges religieuses de la cité |

La Charis de cité est la somme pondérée des offrandes de ses citoyens envers son dieu protecteur. Elle débloque les miracles collectifs (année sans tempête, filon révélé).

Dans la phase 2 (ticket 265), la Charis ne se gagne que par offrandes de biens ou de monnaie.
Temples, fêtes privées, actes, paliers passifs, présages et rang sacerdotal attendent la phase 3.
Depuis #720, une liturgie accomplie (6.4) rapporte aussi de la Charis envers le dieu protecteur de la cité de la liturgie, `liturgies.charisGain` grandi par le faste : une ligne `liturgy` du journal de la Charis (12), rattachée à sa liturgie, une fois.
Seule la maison qui accomplit la gagne, et la base vérifie qu'elle est celle que la liturgie a fixée, envers son dieu.
Le catalogue des dieux est la liste `gods` de la configuration (6.1) : les dieux protecteurs des douze cités, dont Apollon, qui protège Delphis et tient la Pythie (7.3).
Chaque dieu y porte sa Charis : par obole offerte (nulle, il refuse la monnaie), par unité de chaque bien qu'il accepte (un bien absent est refusé), son déclin quotidien en points de base et le poids de sa Charis de cité.
Ajouter un dieu ne demande aucun code.
Une offrande rapporte la somme de ses dons au taux du dieu, en entiers et sans arrondi ; un seul don refusé fait refuser toute l'offrande (`offeringCharis`, `packages/sim`).
À chaque clôture, la Charis d'une maison envers un dieu perd ⌊Charis × déclin ÷ 10 000⌋, arrondi vers zéro (`charisDecay`).
Conséquence de cet arrondi : une Charis trop petite pour perdre une unité ne décline plus (sous 100 avec un déclin de 1 %).
La clôture joue ce déclin dans son étape `favorDecay`, après la population des PNJ et avant tout ce qui touche la monnaie : elle ne prend pas l'agora.
Chaque perte est une ligne `decay` du journal de la Charis (12), une par maison, dieu et jour de jeu (index unique) : une clôture rejouée ne fait pas décliner deux fois.
Un dieu sans déclin, ou retiré de la configuration, ne fait rien perdre.
Configuration initiale : chaque dieu prend la monnaie à 1 Charis par obole, et les biens de son domaine (2) à autant de Charis par unité que leur prix de référence en oboles.
Depuis #706, sept dieux s'y ajoutent : Zeus, Héra, Artémis, Arès, Aphrodite, Héphaïstos et Hermès.
Artémis prend le bois, Aphrodite l'huile d'olive et le tissu, Héphaïstos l'argile, le charbon de bois et les amphores.
Zeus, Héra, Arès et Hermès n'avaient pas de bien du jeu à leur domaine (loi, lignée, escortes, négoce) et ne prenaient que la monnaie, comme Apollon, jusqu'à #713.
Leurs grâces et leurs paliers viendront avec leurs temples.
Déméter prend le blé, la farine et le pain ; Athéna les olives, l'huile et le tissu ; Dionysos le raisin et le vin ; Poséidon le poisson et le sel ; Apollon la seule monnaie.
Depuis #713, chacun des douze dieux prend aussi des biens de #708 à #711, ceux de son domaine (2), au même taux.
Déméter prend l'orge, la farine d'orge et les galettes d'orge ; Athéna, patronne des ateliers, les lampes à huile, les outils et la céramique peinte ; Dionysos les figues, le moût et les gâteaux de figues.
Poséidon prend le poisson salé, le garum et les voiles ; Apollon, dieu de la lumière et des arts, les bougies et les mosaïques ; Zeus le marbre, les blocs de marbre et les statues.
Héra prend les vêtements et les meubles de la maison ; Artémis les peaux et le miel des terres sauvages ; Arès le bronze et les armes.
Aphrodite prend les parfums et les bijoux ; Héphaïstos le cuivre, l'étain, le fer et le fer forgé ; Hermès l'argent, les lingots d'argent et les sandales du messager.
Un bien peut appartenir au domaine de deux dieux, comme l'huile et le tissu à Athéna et à Aphrodite.
La laine, le lin, le fil, la toile de lin, le cuir, les planches, les pigments et la cire ne sont au domaine d'aucun dieu : ils servent d'intrants.
Le déclin est de 100 points de base (1 % par jour) et le poids de cité de ×1 ; revus au calibrage (#668), ils restent tels.
Le déclin coûte à qui garde la Charis requise par une grâce (600) 6 Charis par jour, soit 42 sur la saison de sa recharge, quand une invocation en dépense 300 : l'offrande reste le vrai prix d'une grâce, et une faveur laissée à elle-même perd la moitié en 69 jours.
Le poids ×1 garde la Charis de cité égale à la somme des Charis de ses citoyennes, la même règle pour les quatre protecteurs : aucune cité n'a d'avance pour les miracles collectifs de la phase 3, qui le régleront.
Une version publiée avant la Charis se lit sans taux : aucun dieu n'y accepte d'offrande, rien ne décline, et la Charis de cité est nulle.
Une offrande (`temple.makeOffering`) donne à un dieu des oboles, détruites par le puits `sink_offerings` (5.5), et des biens du stock libre de la maison dans sa cité, hors réservations des ventes, qui partent vers l'extrémité `offering` du journal des stocks.
Le joueur envoie la Charis qu'il a vue : un autre taux en vigueur est refusé (`CHARIS_CHANGED`), rien n'est offert.
Oboles, biens et Charis passent dans une seule transaction, contrôlée par la base (12), et la commande émet `OfferingMade`.
Seule la maison qui offre gagne de la Charis : aucune commande n'en prend à une maison pour en donner à une autre, et la base refuse toute autre nature de mouvement.
La commande verrouille la maison, puis sa Charis envers le dieu, avant l'agora : le déclin de la clôture tient les Charis avant de prendre l'agora aux étapes suivantes, et l'ordre inverse les ferait s'interbloquer.
La Charis de cité d'une cité est la Charis de ses citoyennes envers son dieu protecteur, sommée, fois le poids de ce dieu (10 000 = ×1), arrondie vers zéro : les métèques n'y comptent pas.
Décision (ambiguïté de cette section) : elle suit la Charis courante, déclin et grâces compris, plutôt que le cumul des offrandes.
La Charis qu'une citoyenne dépense pour une grâce envers le dieu protecteur de sa cité baisse donc d'autant, au poids près, la Charis de cité ; les miracles collectifs qui la consommeraient attendent la phase 3.
Lectures : `temple_rules` (publique : la section `gods` de la configuration en vigueur), `my_favor` (privée : la Charis de sa maison par dieu) et `city_charis` (publique : la Charis de chaque cité envers son dieu protecteur).
Une maison seule citoyenne de sa cité y révèle donc sa Charis envers le dieu protecteur, au poids près.

Grâces, dans la phase 2 (ticket 266).
Décision (ambiguïté de cette section) : trois effets, chacun appliqué à la prochaine action admise de la maison qui a invoqué la grâce.
Le catalogue des effets est fermé : une grâce nouvelle ne demande aucun code, un effet nouveau si.
La configuration (`graces`) donne à chaque grâce son dieu, son effet, son ampleur en points de base, la Charis requise envers ce dieu pour l'invoquer, la Charis dépensée (au plus la requise) et sa recharge en jours de jeu (de 1 à 366).
Décision : le tableau ci-dessus prévoit trois grâces par dieu ; la phase 2 n'en vise qu'une par dieu concerné (une récolte bénie pour Déméter, un atelier inspiré pour Athéna, un vent favorable pour Poséidon), et le schéma ne borne pas leur nombre par dieu.
Configuration initiale (#668) : une récolte bénie de Déméter (+25 %) et un atelier inspiré d'Athéna (+35 %), chacun requérant 600 Charis, en dépensant 300 et se rechargeant en une saison (7 jours) ; un vent favorable de Poséidon (−25 %), requérant 300 Charis, en dépensant 150 et se rechargeant en 3 jours.
Offertes en monnaie, 300 Charis coûtent 300 oboles, ou 50 blés : la récolte bénie d'un jour de champ (240 blés) en rend 60, soit 360 oboles au prix de référence, celle d'un champ au plafond de son accumulation (720 blés) 180 : elle rapporte un peu plus qu'elle ne coûte, beaucoup plus à qui la garde pour une grosse récolte, une fois par saison.
Le vent favorable, moins cher et plus fréquent, gagne une heure sur un trajet de quatre : il sert l'armateur qui veut arriver avant les autres plus qu'il ne rapporte de monnaie.
Décision : en phase 2, l'effet d'une grâce n'est pas limité au domaine de son dieu ; une récolte bénie vaut pour tout site de matière première, quel que soit le dieu qui l'accorde.
Récolte bénie (`blessed_harvest`) : une récolte d'un site de matière première rend, pour chaque extrant, ⌊quantité × ampleur ÷ 10 000⌋ unités de plus, arrondi vers le bas sur la quantité de toute la récolte (`graceSurplus`, `packages/sim`).
Atelier inspiré (`inspired_workshop`) : de même pour une récolte d'atelier, sans intrant supplémentaire.
Vent favorable (`fair_wind`) : le prochain départ d'un navire dure ⌈durée × (10 000 − ampleur) ÷ 10 000⌉ secondes, arrondi vers le haut comme la durée elle-même (`fairWindSeconds`).
L'ampleur est bornée par effet : une récolte au plus doublée (10 000), un trajet au plus deux fois plus court (5 000), jamais instantané.
Une version publiée avant les grâces se lit sans grâce.
Recharge : invoquée le jour de jeu J, une grâce se réinvoque à partir de la clôture qui ouvre le jour J + recharge, et pas tant qu'une de ses invocations attend encore son action ; une invocation en attente n'expire pas.
Décision : ce qui est payé est servi ; l'effet, l'ampleur, le dieu, la Charis dépensée et la recharge sont ceux de la version en vigueur à l'invocation, même si une version plus récente change ou retire la grâce.
Décision : une action consomme au plus une grâce, la plus ancienne en attente de son effet (à égalité, le plus petit identifiant), et une seule fois ; les grâces ne se cumulent jamais.
Décision : une grâce n'est consommée que si elle ajoute quelque chose (au moins une unité à la récolte, au moins une seconde retirée au trajet) ; sinon elle reste en attente, et une grâce plus récente n'est pas essayée à sa place.
Une grâce qui attend bloque sa réinvocation (`GRACE_PENDING`) et les grâces plus récentes du même effet ; deux causes, distinctes, la font attendre longtemps.
La première est une ampleur trop faible pour rien ajouter : par exemple, un vent favorable à 1 point de base ne retire une seconde qu'à un trajet d'au moins 10 000 secondes.
Le calibrage (#668) choisit des ampleurs qui évitent ce cas : chacune ajoute au moins une unité au plus petit extrant d'un cycle de son effet (3 tissus pour l'atelier inspiré, d'où +35 %) et au moins une seconde au plus court des trajets.
Limite connue : la seconde est l'absence d'action qui convienne, que le calibrage des ampleurs n'évite pas.
Un atelier inspiré invoqué par une maison sans atelier attend qu'elle en récolte un, et un vent favorable invoqué par une maison sans navire attend qu'elle en fasse partir un.
Décision (ordre d'application) : l'événement du monde d'abord, la grâce ensuite.
Pour une récolte, sécheresses et bonnes années jouent cycle par cycle (7.4), puis la grâce sur la quantité de toute la récolte : une récolte réduite à rien par une sécheresse au plus fort ne rend rien de plus.
Pour un départ, la tempête allonge le trajet (4.6), puis le vent raccourcit la durée allongée.
Grâce et bonne année se multiplient : au plus fort de l'une et de l'autre, un verger rend jusqu'au quadruple de son extrant.
Exception à la règle de 4.2 (récolter en une ou plusieurs fois rend la même quantité) : le surplus d'une grâce s'arrondit sur toute la récolte qui la consomme, et sa taille dépend donc du moment de la récolte.
La commande `temple.invokeGrace` (grâce, Charis dépensée vue) invoque une grâce de la configuration en vigueur pour la maison du joueur.
Elle est refusée sans rien dépenser si la grâce est inconnue, si la Charis dépensée en vigueur n'est pas celle vue (`CHARIS_CHANGED`), si une invocation de cette grâce par la maison attend encore son action (`GRACE_PENDING`), si elle se recharge (`GRACE_RECHARGING`) ou si la Charis de la maison envers le dieu est sous la Charis requise (`INSUFFICIENT_CHARIS`).
Une grâce à recharge d'un jour invoquée juste avant une clôture se réinvoque dès cette clôture.
La Charis dépensée est une ligne `grace` du journal de la Charis (12), dans la transaction de l'invocation, et la commande émet `GraceInvoked`.
La commande verrouille la maison, puis sa Charis envers le dieu, comme une offrande ; elle ne prend pas l'agora.
Une récolte admise d'un site de matière première consomme une récolte bénie en attente de la maison, une récolte d'atelier un atelier inspiré.
Le surplus vient de l'extrémité `production` du journal des stocks, par des mouvements `grace.surplus` rattachés à la grâce, vers le stock où entre la récolte ; un atelier n'y consomme aucun intrant de plus.
La réponse et l'événement `SiteCollected` le portent à part (`grace`), hors des extrants de la recette.
Une récolte verrouille les grâces en attente de sa maison après ses stocks : de deux récoltes concurrentes, une seule consomme une grâce en attente, et l'autre se fait sans elle.
Un départ admis d'un navire (4.6) consomme un vent favorable en attente de la maison, quel que soit le navire ; un départ refusé ne consomme rien.
La tempête garde son retard dans `event_effects`, le vent ses secondes retirées dans `graces_used` (12).
La réponse et l'événement `VoyageDeparted` portent le vent consommé (`fairWind`).
Lectures : `temple_rules` gagne la colonne `graces`, la section `graces` de la configuration en vigueur (une liste vide pour une version publiée avant elles), et `my_graces` (privée) rend les grâces de sa maison en attente (`consumed_at` nul) ou consommées et en recharge jusqu'à `ready_at`, sans l'action qui les a consommées.
L'écran du temple est un autre ticket (#272).
L'écran de départ annonce la durée après le vent favorable que le départ consommerait, et l'issue d'une récolte le surplus de sa grâce (#477, 10).

## 7.2 Hybris et Némésis

Chaque maison a une jauge d'Hybris cachée, dont seul le niveau approximatif est visible. Elle monte avec la part de marché excessive sur un bien (au-delà de 35 % d'une cité), l'écart de fortune avec la médiane, le refus des liturgies et les ententes sur les prix. Elle baisse avec le mécénat et les offrandes.

Au-delà d'un seuil, Némésis frappe : incendie d'entrepôt, procès, artisan qui déserte, navire perdu. La sanction est toujours annoncée par des présages, proportionnée et évitable. Le joueur dominant doit choisir entre redistribuer et risquer.

Dans la phase 3 (#734), la jauge est un entier, de zéro au plus grand entier sûr, que chaque clôture fait varier par `hubrisDelta` (`packages/sim`), une ligne du journal `hubris_ledger` par cause (12).
Seules les maisons de joueur en ont une : une maison PNJ de secours n'a pas de jauge, et sa fortune n'entre pas dans la médiane ; ses ventes comptent dans les échanges d'un marché.
Part de marché : pour chaque bien dans chaque cité, la part des ventes de la maison dans tout ce qui s'y est échangé sur les `hubris.marketShareWindowDays` jours qui précèdent l'instant de la clôture, au-delà de `marketShareThresholdBps` (3 500 points, les 35 % ci-dessus), fait monter la jauge de `marketShareWeight` par part entière au-delà du seuil, au prorata, arrondi vers le bas.
Fortune : la fortune de la maison (4.1), au-delà de `wealthMultipleBps` fois la fortune médiane des maisons de joueur du monde, la fait monter de `wealthWeight` par médiane au-delà, au prorata, arrondi vers le bas.
Une médiane nulle ou négative ne fait rien monter ; la médiane d'un nombre pair de maisons est la moyenne des deux du milieu, arrondie vers le bas.
Refus des liturgies : chaque liturgie prélevée d'office (6.4) la fait monter de `leviedLiturgyWeight`.
Décision (ambiguïté de cette section) : le mécénat est la liturgie accomplie et son faste ; chaque liturgie accomplie la fait baisser de `performedLiturgyRelief`, et son faste compte comme des oboles offertes.
Offrandes : chaque obole offerte la fait baisser de `offeringReliefBps` dix-millièmes, arrondi vers le bas ; une offrande de biens ne la fait pas baisser.
Enfin elle décline de `dailyDecay` à chaque clôture, jusqu'à zéro.
Les gains s'appliquent d'abord, puis les baisses, puis le déclin, chacun rogné pour que la jauge reste dans ses bornes : une baisse ne s'éponge pas d'avance sur un gain du même jour.
Décision : ce que la maison fait compte avec une clôture de retard.
Une clôture compte les liturgies prélevées à la dernière clôture enregistrée, et les offrandes et les liturgies accomplies datées de l'avant-dernière clôture enregistrée à la dernière.
Une commande commencée avant l'instant d'une clôture peut être validée après que la clôture l'a lue ; une clôture plus tard, aucune ne l'est plus, et chaque acte compte une fois, même après une clôture manquée.
Ce qu'est la maison, sa part de marché et sa fortune, compte à la clôture du jour.
Décision : les ententes sur les prix attendent une détection ; aucune ne fait encore monter la jauge.
La clôture joue l'Hybris dans son étape `hubrisGauge`, après la planification des événements du monde et avant tout ce qui touche la monnaie ; rejouée, elle n'écrit rien deux fois (12).
Le joueur ne lit que le palier de sa jauge (`public.my_hubris_tier`) : le nombre de bornes de `hubris.tiers`, dans la configuration en vigueur, que sa jauge atteint ; il ne lit jamais sa valeur, ni rien de la jauge d'une autre maison.
Configuration initiale : seuil de 35 %, fenêtre de 7 jours, trois fois la médiane, paliers à 1 000, 3 000, 6 000 et 10 000 ; poids, baisses et déclin nuls : la jauge ne bouge pas avant le calibrage.
Une version publiée avant l'Hybris ne change aucune jauge, et tout palier y est nul.
Décision : une clôture jouée sous une telle version ne compte pas non plus les actes de sa période (les liturgies prélevées à la clôture précédente, les offrandes et liturgies accomplies de la période d'avant) : ils restent ignorés, la période suivante commençant à la dernière clôture enregistrée.
La médiane compte chaque maison de joueur du monde ; une maison absente de `game.house_wealth`, qui les rend pourtant toutes, y compterait pour une fortune nulle.
Limites connues : la fortune est lue quand la clôture se joue, et non à son instant de jeu, comme pour la désignation des liturgies ; un échange en cours à l'instant de la clôture n'entre dans la fenêtre qu'aux clôtures suivantes.
Une maison seule à vendre un bien peu échangé dans une cité y détient toute la part, quelle que soit la quantité : le calibrage en tiendra compte.
Dans la phase 3 (#735), Némésis suit la jauge : la section `hubris.nemesis` fixe le seuil (`threshold`), le délai du présage (`omenLeadDays`), l'excès plein (`fullExcess`) et les modèles en jeu, avec les bornes de la part que prennent l'incendie et le procès.
La clôture joue Némésis dans son étape `nemesis`, après le retrait des maisons PNJ et avant le marché du travail et l'entretien : d'abord l'échéance, puis les présages.
Présage : une maison de joueur dont la jauge dépasse strictement le seuil, sans présage en attente, en reçoit un (`OmenReceived`), d'un modèle tiré avec la même chance parmi ceux en jeu, échu `omenLeadDays` jours plus tard.
Décision (règle 6) : le présage est un texte de repli écrit à la main, trois par modèle, en `fr` et en `en` (`apps/engine/src/nemesis/locales`), tiré avec le modèle par une graine à sens unique du monde, de la maison et du jour, et enregistré avec lui ; il dit à mots couverts ce qui menace, sans chiffre ni jour.
Échéance : la clôture du jour d'échéance, ou la suivante après une clôture manquée, règle le présage une fois.
Si la jauge, après la variation du jour, dépasse encore le seuil en vigueur, la sanction frappe (`NemesisStruck`) ; sinon, ou sous une version sans `hubris.nemesis`, ou sans le modèle du présage, elle est évitée (`NemesisAverted`) et rien n'arrive.
Ampleur : de la borne basse du modèle au moindre excès à sa borne haute à l'excès plein, au prorata entre les deux, arrondie vers le bas (`nemesisMagnitudeBps`, `packages/sim`).
Décision (ambiguïté de cette section) : la jauge redescend de l'excès compté, plafonné à `fullExcess` (`nemesisRelief`), par une ligne `nemesis` de son journal ; une jauge loin au-delà du seuil y reste, et reçoit un présage nouveau à la même clôture.
Modèles :
- incendie d'entrepôt (`warehouse_fire`) : la part de l'ampleur, arrondie vers le bas, du stock libre (hors réservations des ventes ouvertes) le plus fourni de la maison, toutes cités confondues, part à l'extrémité `nemesis` du journal des stocks ;
- procès (`lawsuit`) : une amende, part de la trésorerie (hors séquestre), détruite par le puits `sink_nemesis` (5.5) ;
- artisan qui déserte (`artisan_desertion`) : le plus ancien atelier en marche de la maison s'arrête, ne doit rien à l'entretien de cette clôture, dont le marché du travail ne compte pas ses travailleurs, et ne repart pas avant l'instant de la clôture suivante, qui le relance s'il est payé ; une relance est refusée d'ici là (`SITE_DESERTED`) ;
- navire perdu (`ship_lost`) : le voyage en mer de la maison qui porte le plus de marchandises est condamné ; à son arrivée, toute sa cargaison part à l'extrémité `nemesis`, comme une perte en mer (4.6), et le navire accoste à vide.
Décision : une maison qui n'a rien à perdre (trésorerie ou stock vides, part arrondie à zéro, aucun atelier en marche, aucun voyage chargé en mer) est frappée sans rien perdre, et sa jauge redescend quand même.
Le joueur lit ses présages (`public.my_omens`) : textes, jours du présage et de l'échéance, puis l'issue et ce que la sanction a pris ; le modèle seulement une fois réglée, jamais l'ampleur ni la baisse de la jauge, rien d'une autre maison.
Configuration initiale : seuil au plus grand entier sûr, que la jauge ne dépasse jamais, délai de trois jours, excès plein de 10 000, incendie de 5 à 30 %, procès de 5 à 20 % : aucun présage avant le calibrage.
Limites connues : une maison qui vide sa trésorerie ou son stock avant l'échéance échappe à l'amende ou à l'incendie, pas à la baisse de sa jauge ; la cargaison d'un navire condamné compte encore dans la fortune jusqu'à son arrivée, comme celle de tout voyage en mer.
Une sanction réglée par le code nouveau suppose le moteur nouveau : revenu au moteur précédent, l'arrivée d'un voyage condamné serait refusée par la base, et le tick de son monde échouerait jusqu'au retour du code nouveau.
Hors périmètre : présage réécrit par la Pythie et l'IA, procès devant un tribunal de joueurs, écran.

## 7.3 La Pythie

Les événements du monde sont planifiés par le moteur plusieurs jours à l'avance. La Pythie en tire des oracles volontairement ambigus, rédigés par l'IA à partir de l'événement réel. Consulter l'oracle coûte des offrandes ; bien l'interpréter permet de se positionner avant les autres. Les oracles s'échangent et se discutent : c'est un marché de l'information.

Dans la phase 2 (ticket 267), la planification est une étape de la clôture quotidienne, avant l'entretien.
La clôture qui ouvre le jour J planifie les événements qui commencent au jour J + `worldEvents.planningLeadDays` (délai de planification, en jours de jeu, au moins un).
Leur graine est celle de ce jour : SHA-256 de la graine du monde et du numéro du jour, à sens unique (13).
Un événement commence à la clôture qui ouvre son premier jour et finit à celle qui ouvre le jour qui le suit ; il est enregistré avant de commencer, et ne change plus.
Les joueurs ne lisent un événement qu'une fois commencé (`public.world_events`) ; Olympe montre aussi ceux à venir (15).
Rejouer une clôture ne planifie rien deux fois : un seul événement d'un modèle commence un jour donné.
Une clôture manquée (panne) ne planifie pas son jour : ce jour n'a pas d'événement, ce qui ne coûte rien aux joueurs.
Une clôture jouée en retard ne planifie pas non plus un jour dont le début est déjà atteint selon l'heure de la base (`now()` de sa transaction), par exemple avec un délai d'un jour quand elle est rattrapée après l'heure de la clôture suivante.
Ce jour n'a pas d'événement, et le reste de la clôture (loyers, entretien) se joue normalement.

Dans la phase 2 (ticket 270), chaque événement planifié a son oracle, écrit dans la transaction qui le planifie.
Décision (règle 6) : l'oracle de repli est écrit à la main, plusieurs par modèle d'événement, en `fr` et en `en` (`apps/engine/src/oracle/locales`), et choisi par la graine de l'événement et son modèle ; l'IA ne fait ensuite que le réécrire, et le jeu s'en contente IA coupée.
Un oracle de repli ne dit que la nature de l'événement, et le bien d'une caravane : ni la cité, ni le jour, ni l'ampleur, ni la durée.
Décision : la tempête d'une route est un événement de chacune de ses deux cités.
Après chaque clôture, une tâche du moteur essaie une fois de réécrire, par la passerelle IA (usage `oracle`, 8.4), chaque oracle encore en repli d'un événement qui n'a pas commencé ; IA coupée, elle ne lit ni n'essaie rien.
Le modèle reçoit la nature de l'événement, le bien d'une caravane et l'oracle de repli, jamais la cité, le jour, l'ampleur ni un texte de joueur.
Sa sortie est rejetée, et le repli reste, si un texte est vide ou plus long que `oracle.maxTextLength`, ou s'il cite un nombre ou une cité (contrôle ci-dessous).
L'issue de l'essai est gardée : un oracle n'est pas réessayé, même après un délai dépassé ou un plafond atteint, et l'issue gardée reste définitive, même après le changement de mois qui lève le plafond.
Limite connue : si le moteur s'arrête, ou si l'écriture échoue, entre la réponse du modèle et l'enregistrement de l'issue, l'oracle est essayé à nouveau, et payé une seconde fois au fournisseur.
Contrôle d'un oracle réécrit (`oracleTextIssues`) : il rejette tout caractère numérique Unicode (chiffres latins ou non, chiffres romains Unicode, fractions, exposants), tout nombre que relève le contrôle de la chronique (6.6 : nombres, ordinaux et quantités en lettres, en français et en anglais, chiffres romains en capitales, mots qui mêlent plusieurs écritures), « premier » et « first », et toute lettre hors de l'écriture latine.
Il rejette aussi tout mot qui est à lui seul un chiffre romain valide d'au moins deux lettres, en minuscules ou en casse mêlée (« xii », « Xii »), sauf « ci », « mi » et « mix », mots courants (#495).
Il rejette encore toute lettre latine qui, décomposée, n'est ni une lettre de `a` à `z` ni `æ`, `œ`, `ø`, `ß`, `ı` ou `ł` : les lettres accentuées passent, mais pas les petites capitales, les lettres de l'alphabet phonétique, les lettres d'allure de chiffre (« Ƨ », « ƻ », « Ƽ », « Ʒ », « Ȝ », « Ȣ ») ni les autres lettres des latins étendus (« Ɨ », « ȴ », « ŋ », « ð ») (#495).
Il rejette aussi tout nom de cité : les traductions de toutes les cités connues, et l'identifiant et le nom en base de chaque cité du monde.
Un nom est cherché après repliement NFKC, sans caractère invisible, sans diacritique, en minuscules, ligatures défaites, lettres d'allure trompeuse confondues (`l`, `ł`, `ƚ`, `ʟ`, `ꞁ`, `ȴ`, `ɫ`, `ɬ`, `ɭ`, `ⱡ`, `ǀ`, `ı`, `ɩ`, `ɪ`, `ɨ` et `i` ; `ǁ` et `ll` ; `rn` et `m` ; `vv` et `w`), dans la suite de toutes les lettres du texte : en mot entier, en début, au milieu ou en fin de mot (« Kallistéens »), espacé ou ponctué lettre à lettre (« K.a.l.l.i.s.t.è »).
Limites connues : un nom de moins de quatre lettres n'est cherché qu'en mot entier ; un dérivé qui ne contient pas le nom entier (« Ampélote »), une traduction ou une allusion (« la cité de la vigne ») ne sont pas relevés, ni un nombre écrit sous une forme absente de la liste du contrôle de la chronique, ou dans une autre langue.
Ne sont pas relevés non plus : les signes qui ne sont pas des lettres mais ont l'allure d'un `l` ou d'un `i` (« Ka||istè », « ¦ », « ∣ »), qui séparent les lettres au lieu d'en tenir lieu ; un nombre dit par un mot hors de la liste du contrôle de la chronique (« l'an mil ») ; un chiffre romain en minuscules suivi d'une marque d'ordinal (« xiie ») ou coupé par une ponctuation (« x.i.i ») ; des durées comme « fortnight » ou « once ».
Le risque reste faible, puisque le modèle ne reçoit jamais ni la cité ni le jour.
Inversement, un mot ou une suite de mots qui contient un nom par hasard (« halos », pour Halos) fait rejeter un oracle correct, qui garde son repli.
Décision : consulter la Pythie (`temple.consultOracle`, prix vu) est une offrande de monnaie au dieu de la Pythie (`oracle.godId`, Apollon), au prix de la configuration (`oracle.consultationOboles`) ; la configuration exige que ce dieu accepte la monnaie.
Ses oboles vont au puits `sink_offerings` par une écriture `temple.oracle` (nature `offerings`, 4.1), sa Charis entre au journal comme celle d'une offrande (7.1), et elle rend les oracles des événements de la cité de la maison qui n'ont pas commencé, tels qu'ils sont écrits à cet instant.
Le tout se fait dans une transaction, avec les verrous d'une offrande, et la commande émet `OracleConsulted`.
Un autre prix en vigueur est refusé (`PRICE_CHANGED`), et une version publiée avant la Pythie ne se consulte pas (`ORACLE_UNAVAILABLE`) : rien n'est payé.
Décision : une consultation est payée même quand aucun événement ne s'annonce ; la refuser dirait gratuitement que rien ne vient.
Décision : un joueur relit les oracles qu'il a consultés (`public.my_oracles`) dans leur dernier texte : un oracle consulté en repli, puis réécrit, se relit réécrit.
Il n'y lit ni l'événement qu'un oracle annonce, ni son jour ; un autre joueur, même de la même cité, ne les lit pas sans consulter à son tour.
Un oracle a un identifiant aléatoire : un identifiant horodaté dirait la clôture qui a planifié son événement, donc son premier jour.
Limite connue : un joueur qui consulte chaque jour voit un oracle nouveau paraître après la clôture d'un jour J, et en déduit que son événement commence au jour J + `worldEvents.planningLeadDays` ; l'identifiant aléatoire n'empêche que de le lire sans consulter chaque jour.
Le prix de la consultation se lit dans la colonne `oracle` de `public.temple_rules`, nulle pour une version publiée avant la Pythie.
Configuration initiale : 60 oboles, à revoir au calibrage (#283).
Limite connue : un événement planifié par le code précédent pendant un déploiement n'a pas d'oracle, et aucune consultation ne le rend.
Hors périmètre : marché des oracles, présages de Némésis réécrits par la Pythie (7.2), écran du temple (#272).

## 7.4 Événements

| Famille | Exemples | Portée |
| --- | --- | --- |
| Naturels | Sécheresse, tempêtes, bonne année d'olives, épidémie du bétail | Cité ou région |
| Économiques | Filon découvert, mode des parfums, caravane étrangère, pénurie d'étain | Monde |
| Mythiques | Un monstre ferme une route maritime, un héros de passage commande des armes | Région, résolution coopérative |
| Divins | Querelle entre deux dieux qui oppose leurs protégés pendant une saison | Monde |
| Personnels | Quêtes narratives de la maison, proposées selon son histoire | Maison |

Dans la phase 2 (ticket 267), un petit catalogue fermé de modèles naturels et économiques, planifiés par le moteur (7.3) :

| Modèle | Portée | Effet de l'ampleur |
| --- | --- | --- |
| Sécheresse (`drought`) | Une cité | Rendement des champs réduit |
| Bonne année (`good_year`) | Une cité | Rendement des vergers accru |
| Tempête (`storm`) | Une route | Trajets qui partent pendant la tempête allongés, et risque de perte majoré (#730) |
| Caravane étrangère (`caravan`) | Une cité et un bien | Demande des PNJ de la cité pour ce bien accrue |

La configuration (`worldEvents.models`) donne à chaque modèle une probabilité par jour, une durée en jours de jeu et une ampleur en points de base, bornées (au plus 10 000 : rendement nul ou doublé, trajet deux fois plus long, demande doublée).
Chaque jour planifié, chaque modèle tire de son propre générateur (graine du jour et nom du modèle) : s'il survient, puis sa portée (cité, route ou bien, uniformes), sa durée et son ampleur, uniformes entre leurs bornes.
Changer les règles d'un modèle ne change donc pas les tirages des autres ; au plus un événement par modèle et par jour de début.
La cité est tirée parmi celles du monde connues de la configuration, la route parmi les routes entre elles, le bien d'une caravane parmi `goodIds`, des biens achetés par au moins une classe de PNJ.
Configuration initiale (#668) : chaque modèle a une chance sur trente par jour (333 points de base), soit environ un événement de chaque modèle par mois dans le monde ; durées et ampleurs restent celles du catalogue.
Les bancs closent des jours passés, et une clôture ne planifie pas un jour dont le début est déjà atteint (7.3) : le banc à quatre cités planifie donc lui-même, après chaque clôture, ce qu'elle aurait planifié, avec le même tirage et sa graine fixe, et en joue les effets (`apps/api/src/balance/events.ts`) ; le banc à une cité de #78 n'en joue aucun.
Décision (phase 2) : une tempête retarde, elle ne fait rien perdre.
Décision (#730) : une tempête majore en outre le risque de perte des voyages qui partent pendant elle, de la majoration de sa route (`stormLossRiskBps`, 4.6), quelle que soit son ampleur ; le tirage se fait à l'arrivée.
Des événements d'un même modèle qui se chevauchent sur une même portée ne s'ajoutent pas : seul le plus fort agit, et à égalité celui du plus petit identifiant, soit la planification la plus ancienne.
Les identifiants sont des UUID v7, croissants dans le temps, et une clôture ne planifie qu'un jour : deux événements d'un même modèle viennent de deux clôtures, dans l'ordre de leurs identifiants.
Ce départage ne se voit que pour une tempête (le retard est attribué à l'une d'elles dans `event_effects`) ou un événement de rendement (l'écart est attribué de même) ; deux caravanes égales relèvent la demande d'autant.
Décision : un cycle de champ ou de verger est touché par un événement de rendement si sa fin, dans le temps propre du site (gelé pendant un arrêt, 4.2), tombe dans la fenêtre de l'événement ; pour un site jamais arrêté, c'est le temps réel.
Limite connue : après un arrêt et une relance, un événement peut toucher des cycles faits avant l'arrêt, ou les épargner ; les récolter avant ou après la relance peut donc différer.
Hors périmètre : déclenchement manuel et création depuis Olympe, maître du jeu par IA, événements mythiques, divins et personnels.

## 7.5 Calendrier sacré

Chaque saison porte une fête majeure (les Dionysies, les Panathénées, les fêtes de Déméter, les Jeux). Une fête crée un pic de demande prévisible sur certains biens, un concours et une occasion de mécénat. Le calendrier donne au monde un rythme lisible et aux commerçants des anticipations à jouer.

Dans la phase 2 (ticket 263), une fête est un décret de la cité (6.3) : un montant, une durée en jours de jeu et des biens, pris dans la liste de la configuration.
Décision (ambiguïté de cette section) : la fête paie son montant du trésor de la cité à un puits, qui le détruit (`sink_festivals`, 5.5), à la clôture qui l'applique.
Elle relève ensuite, pendant ses jours de jeu à compter du jour que cette clôture ouvre, la demande des PNJ de sa cité pour ses biens (5.2) : le pic est annoncé dès le vote, et les commerçants peuvent s'y préparer.
Son effet sur la Charis de la cité, le concours et le mécénat attendent la phase 3.
Depuis #713, la liste des biens de fête (`decrees.models.festival.goodIds`) compte, après le pain, le vin, l'huile et le poisson, huit biens finis nouveaux.
Ce sont ceux d'un banquet : galettes d'orge, poisson salé, garum, gâteaux de figues, lampes à huile, bougies, parfums et vêtements.
Chacun est au panier d'une classe de PNJ : une fête relève la demande des PNJ (5.2), et n'aurait aucun effet sur un bien qu'aucune classe n'achète.
Une fête prend toujours au plus trois biens (`maxGoods`).
