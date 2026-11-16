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
Le catalogue des dieux est la liste `gods` de la configuration (6.1) : les dieux protecteurs des quatre cités et Apollon (la Pythie, 7.3).
Chaque dieu y porte sa Charis : par obole offerte (nulle, il refuse la monnaie), par unité de chaque bien qu'il accepte (un bien absent est refusé), son déclin quotidien en points de base et le poids de sa Charis de cité.
Ajouter un dieu ne demande aucun code.
Une offrande rapporte la somme de ses dons au taux du dieu, en entiers et sans arrondi ; un seul don refusé fait refuser toute l'offrande (`offeringCharis`, `packages/sim`).
À chaque clôture, la Charis d'une maison envers un dieu perd ⌊Charis × déclin ÷ 10 000⌋, arrondi vers zéro (`charisDecay`).
Conséquence de cet arrondi : une Charis trop petite pour perdre une unité ne décline plus (sous 100 avec un déclin de 1 %).
La clôture joue ce déclin dans son étape `favorDecay`, après la population des PNJ et avant tout ce qui touche la monnaie : elle ne prend pas l'agora.
Chaque perte est une ligne `decay` du journal de la Charis (12), une par maison, dieu et jour de jeu (index unique) : une clôture rejouée ne fait pas décliner deux fois.
Un dieu sans déclin, ou retiré de la configuration, ne fait rien perdre.
Configuration initiale : chaque dieu prend la monnaie à 1 Charis par obole, et les biens de son domaine (2) à autant de Charis par unité que leur prix de référence en oboles.
Déméter prend le blé, la farine et le pain ; Athéna les olives, l'huile et le tissu ; Dionysos le raisin et le vin ; Poséidon le poisson et le sel ; Apollon la seule monnaie.
Le déclin est de 100 points de base (1 % par jour) et le poids de cité de ×1 : ces valeurs ne touchent ni la monnaie ni les stocks, et seront revues avec les grâces (#266).
Une version publiée avant la Charis se lit sans taux : aucun dieu n'y accepte d'offrande, rien ne décline, et la Charis de cité est nulle.
Une offrande (`temple.makeOffering`) donne à un dieu des oboles, détruites par le puits `sink_offerings` (5.5), et des biens du stock libre de la maison dans sa cité, hors réservations des ventes, qui partent vers l'extrémité `offering` du journal des stocks.
Le joueur envoie la Charis qu'il a vue : un autre taux en vigueur est refusé (`CHARIS_CHANGED`), rien n'est offert.
Oboles, biens et Charis passent dans une seule transaction, contrôlée par la base (12), et la commande émet `OfferingMade`.
Seule la maison qui offre gagne de la Charis : aucune commande n'en prend à une maison pour en donner à une autre, et la base refuse toute autre nature de mouvement.
La commande verrouille la maison, puis sa Charis envers le dieu, avant l'agora : le déclin de la clôture tient les Charis avant de prendre l'agora aux étapes suivantes, et l'ordre inverse les ferait s'interbloquer.
La Charis de cité d'une cité est la Charis de ses citoyennes envers son dieu protecteur, sommée, fois le poids de ce dieu (10 000 = ×1), arrondie vers zéro : les métèques n'y comptent pas.
Décision (ambiguïté de cette section) : elle suit la Charis courante, déclin compris, plutôt que le cumul des offrandes, et rien ne la consomme encore (miracles : phase 3).
Lectures : `temple_rules` (publique : la section `gods` de la configuration en vigueur), `my_favor` (privée : la Charis de sa maison par dieu) et `city_charis` (publique : la Charis de chaque cité envers son dieu protecteur).
Une maison seule citoyenne de sa cité y révèle donc sa Charis envers le dieu protecteur, au poids près.

Grâces, dans la phase 2 (ticket 266).
Décision (ambiguïté de cette section) : trois effets, chacun appliqué à la prochaine action admise de la maison qui a invoqué la grâce.
Le catalogue des effets est fermé : une grâce nouvelle ne demande aucun code, un effet nouveau si.
La configuration (`graces`) donne à chaque grâce son dieu, son effet, son ampleur en points de base, la Charis requise envers ce dieu pour l'invoquer, la Charis dépensée (au plus la requise) et sa recharge en jours de jeu (de 1 à 366).
Récolte bénie (`blessed_harvest`) : une récolte d'un site de matière première rend, pour chaque extrant, ⌊quantité × ampleur ÷ 10 000⌋ unités de plus, arrondi vers le bas sur la quantité de toute la récolte (`graceSurplus`, `packages/sim`).
Atelier inspiré (`inspired_workshop`) : de même pour une récolte d'atelier, sans intrant supplémentaire.
Vent favorable (`fair_wind`) : le prochain départ d'un navire dure ⌈durée × (10 000 − ampleur) ÷ 10 000⌉ secondes, arrondi vers le haut comme la durée elle-même (`fairWindSeconds`).
L'ampleur est bornée par effet : une récolte au plus doublée (10 000), un trajet au plus deux fois plus court (5 000), jamais instantané.
Une version publiée avant les grâces se lit sans grâce.
Configuration initiale, à calibrer : Déméter accorde une récolte bénie, Athéna un atelier inspiré, chacun de 20 %, et Poséidon un vent favorable de 25 % ; chacune demande 300 de Charis, en dépense 150 et se recharge en trois jours.

## 7.2 Hybris et Némésis

Chaque maison a une jauge d'Hybris cachée, dont seul le niveau approximatif est visible. Elle monte avec la part de marché excessive sur un bien (au-delà de 35 % d'une cité), l'écart de fortune avec la médiane, le refus des liturgies et les ententes sur les prix. Elle baisse avec le mécénat et les offrandes.

Au-delà d'un seuil, Némésis frappe : incendie d'entrepôt, procès, artisan qui déserte, navire perdu. La sanction est toujours annoncée par des présages, proportionnée et évitable. Le joueur dominant doit choisir entre redistribuer et risquer.

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
| Tempête (`storm`) | Une route | Trajets qui partent pendant la tempête allongés |
| Caravane étrangère (`caravan`) | Une cité et un bien | Demande des PNJ de la cité pour ce bien accrue |

La configuration (`worldEvents.models`) donne à chaque modèle une probabilité par jour, une durée en jours de jeu et une ampleur en points de base, bornées (au plus 10 000 : rendement nul ou doublé, trajet deux fois plus long, demande doublée).
Chaque jour planifié, chaque modèle tire de son propre générateur (graine du jour et nom du modèle) : s'il survient, puis sa portée (cité, route ou bien, uniformes), sa durée et son ampleur, uniformes entre leurs bornes.
Changer les règles d'un modèle ne change donc pas les tirages des autres ; au plus un événement par modèle et par jour de début.
La cité est tirée parmi celles du monde connues de la configuration, la route parmi les routes entre elles, le bien d'une caravane parmi `goodIds`, des biens achetés par au moins une classe de PNJ.
Décision (paramètres neutres) : toutes les probabilités sont nulles dans la configuration initiale, si bien que le banc de #78 ne joue aucun événement.
Limite connue : le banc de #78 clôt des jours passés, et une clôture ne planifie pas un jour dont le début est déjà atteint (7.3).
Avec une probabilité non nulle, ses clôtures réussiraient, mais ne planifieraient que des événements qui commencent après l'heure de la base, donc après tous les jours qu'il joue : aucun n'agirait sur sa simulation.
Pour calibrer les événements (#283), il faudra que le banc joue ses jours à venir, ou les planifie autrement.
Décision : une tempête retarde, elle ne fait rien perdre.
Décision : un cycle de champ ou de verger est touché par un événement de rendement si sa fin, dans le temps propre du site (gelé pendant un arrêt, 4.3), tombe dans la fenêtre de l'événement ; pour un site jamais arrêté, c'est le temps réel.
Limite connue : après un arrêt et une relance, un événement peut toucher des cycles faits avant l'arrêt, ou les épargner ; les récolter avant ou après la relance peut donc différer.
Hors périmètre : déclenchement manuel et création depuis Olympe, maître du jeu par IA, événements mythiques, divins et personnels.

## 7.5 Calendrier sacré

Chaque saison porte une fête majeure (les Dionysies, les Panathénées, les fêtes de Déméter, les Jeux). Une fête crée un pic de demande prévisible sur certains biens, un concours et une occasion de mécénat. Le calendrier donne au monde un rythme lisible et aux commerçants des anticipations à jouer.

Dans la phase 2 (ticket 263), une fête est un décret de la cité (6.3) : un montant, une durée en jours de jeu et des biens, pris dans la liste de la configuration.
Décision (ambiguïté de cette section) : la fête paie son montant du trésor de la cité à un puits, qui le détruit (`sink_festivals`, 5.5), à la clôture qui l'applique.
Elle relève ensuite, pendant ses jours de jeu à compter du jour que cette clôture ouvre, la demande des PNJ de sa cité pour ses biens (5.2) : le pic est annoncé dès le vote, et les commerçants peuvent s'y préparer.
Son effet sur la Charis de la cité, le concours et le mécénat attendent la phase 3.
