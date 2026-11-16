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
Configuration initiale : chaque dieu prend la monnaie à 1 Charis par obole, et les biens de son domaine (2) à autant de Charis par unité que leur prix de référence en oboles.
Déméter prend le blé, la farine et le pain ; Athéna les olives, l'huile et le tissu ; Dionysos le raisin et le vin ; Poséidon le poisson et le sel ; Apollon la seule monnaie.
Le déclin est de 100 points de base (1 % par jour) et le poids de cité de ×1 : ces valeurs ne touchent ni la monnaie ni les stocks, et seront revues avec les grâces (#266).
Une version publiée avant la Charis se lit sans taux : aucun dieu n'y accepte d'offrande, rien ne décline, et la Charis de cité est nulle.
La Charis de cité d'une cité est la Charis de ses citoyennes envers son dieu protecteur, sommée, fois le poids de ce dieu (10 000 = ×1), arrondie vers zéro : les métèques n'y comptent pas.
Décision (ambiguïté de cette section) : elle suit la Charis courante, déclin compris, plutôt que le cumul des offrandes, et rien ne la consomme encore (miracles : phase 3).
Lectures : `temple_rules` (publique : la section `gods` de la configuration en vigueur), `my_favor` (privée : la Charis de sa maison par dieu) et `city_charis` (publique : la Charis de chaque cité envers son dieu protecteur).
Une cité dont on est la seule citoyenne révèle donc sa Charis envers le dieu protecteur, au poids près.

## 7.2 Hybris et Némésis

Chaque maison a une jauge d'Hybris cachée, dont seul le niveau approximatif est visible. Elle monte avec la part de marché excessive sur un bien (au-delà de 35 % d'une cité), l'écart de fortune avec la médiane, le refus des liturgies et les ententes sur les prix. Elle baisse avec le mécénat et les offrandes.

Au-delà d'un seuil, Némésis frappe : incendie d'entrepôt, procès, artisan qui déserte, navire perdu. La sanction est toujours annoncée par des présages, proportionnée et évitable. Le joueur dominant doit choisir entre redistribuer et risquer.

## 7.3 La Pythie

Les événements du monde sont planifiés par le moteur plusieurs jours à l'avance. La Pythie en tire des oracles volontairement ambigus, rédigés par l'IA à partir de l'événement réel. Consulter l'oracle coûte des offrandes ; bien l'interpréter permet de se positionner avant les autres. Les oracles s'échangent et se discutent : c'est un marché de l'information.

## 7.4 Événements

| Famille | Exemples | Portée |
| --- | --- | --- |
| Naturels | Sécheresse, tempêtes, bonne année d'olives, épidémie du bétail | Cité ou région |
| Économiques | Filon découvert, mode des parfums, caravane étrangère, pénurie d'étain | Monde |
| Mythiques | Un monstre ferme une route maritime, un héros de passage commande des armes | Région, résolution coopérative |
| Divins | Querelle entre deux dieux qui oppose leurs protégés pendant une saison | Monde |
| Personnels | Quêtes narratives de la maison, proposées selon son histoire | Maison |

## 7.5 Calendrier sacré

Chaque saison porte une fête majeure (les Dionysies, les Panathénées, les fêtes de Déméter, les Jeux). Une fête crée un pic de demande prévisible sur certains biens, un concours et une occasion de mécénat. Le calendrier donne au monde un rythme lisible et aux commerçants des anticipations à jouer.

Dans la phase 2 (ticket 263), une fête est un décret de la cité (6.3) : un montant, une durée en jours de jeu et des biens, pris dans la liste de la configuration.
Décision (ambiguïté de cette section) : la fête paie son montant du trésor de la cité à un puits, qui le détruit (`sink_festivals`, 5.5), à la clôture qui l'applique.
Elle relève ensuite, pendant ses jours de jeu à compter du jour que cette clôture ouvre, la demande des PNJ de sa cité pour ses biens (5.2) : le pic est annoncé dès le vote, et les commerçants peuvent s'y préparer.
Son effet sur la Charis de la cité, le concours et le mécénat attendent la phase 3.
