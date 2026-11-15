# 6. Cités, politique et communauté

La cité est l'unité sociale du jeu : 12 cités au lancement, 100 à 400 joueurs actifs chacune, gouvernées par des joueurs élus ou tirés au sort qui disposent de vrais leviers. Un joueur a une seule citoyenneté mais peut investir ailleurs comme métèque.

## 6.1 Identité d'une cité

Chaque cité a un terroir (ressources abondantes et absentes), un port ou non, un dieu protecteur, un trésor, des bâtiments publics et des lois. Aucune n'est autosuffisante : la carte des ressources impose le commerce.

Dans la première version (ticket 250), l'Archipel compte quatre cités, décrites par la configuration sous leur identifiant court.
Chacune y porte son terroir, son port, son dieu protecteur et, si elle le veut, sa propre recette de départ (3, progression) ; à défaut, c'est la recette de départ commune.
Le terroir est la liste des productions de matière première qu'un site de la cité peut lancer ; les ateliers sont admis partout (4.2).
Les dieux sont une liste `gods` de la configuration, réduite pour l'instant à leurs identifiants, que la Charis complétera (7.1).
Le schéma refuse un dieu, une recette ou une classe de PNJ inconnus, un atelier cité dans un terroir, et une cité dont la recette de départ n'est pas dans son terroir.
Retirer une recette qu'un terroir cite demande donc de la retirer aussi de ce terroir.

| Cité | Dieu protecteur | Terroir | Premier site |
| --- | --- | --- | --- |
| Kallistè | Déméter | Toutes les matières premières de la phase 1 | Champ de blé |
| Elaia | Athéna | Olives, blé, sel, bois | Champ de blé |
| Ampelos | Dionysos | Raisin, poisson, laine, argile | Vigne |
| Halos | Poséidon | Poisson, sel, argile, bois, laine | Pêcherie |

Aucune des trois nouvelles cités n'a toutes les matières premières du panier de ses PNJ.
Kallistè, cité fondatrice, les garde toutes, pour que le banc d'équilibrage de la phase 1 et ses tests restent tels quels ; resserrer son terroir revient à une version de configuration éprouvée par le banc à quatre cités (#283).
Décision (ambiguïté de cette section) : les quatre cités ont un port, puisque le seul transport de la phase 2 est maritime ; les cités sans port attendent les caravanes terrestres (4.6) et une carte.
Chaque cité a la population de la cité prototype (5.5), et la demande des PNJ y est jouée comme à Kallistè.
Les joueurs connectés lisent l'identité des cités dans la vue publique `city_identity` ; l'écran de fondation présente les quatre cités, et l'onglet Cité celle de la maison.
Une version de configuration publiée avant les quatre cités se lit sans terroir (toute production admise), avec un port et sans dieu protecteur.
Une cité du monde absente de la configuration n'a pas de terroir, donc admet toute production, mais n'a pas de port : on n'y crée rien de plus qu'avant les quatre cités, et aucun navire ne doit pouvoir y accoster tant qu'elle n'est pas décrite.

## 6.2 Institutions

| Institution | Désignation | Pouvoirs réels |
| --- | --- | --- |
| Assemblée (ecclésia) | Tous les citoyens | Vote des décrets, du budget, des alliances, de l'ostracisme |
| Conseil (boulè) | Tirage au sort parmi les volontaires, chaque saison | Prépare l'ordre du jour, filtre les propositions |
| Archonte | Élu pour une année de jeu (4 semaines) | Propose le budget, nomme, représente la cité |
| Agoranome | Élu | Taxe de marché, contrôle des prix abusifs, poids et mesures |
| Trésorier | Élu | Exécute les dépenses, place le trésor, publie les comptes |
| Astynome | Élu | Zonage, permis, travaux publics |
| Stratège | Élu | Escortes, diplomatie de ligue, conflits |
| Grand prêtre | Désigné par la Charis | Calendrier des fêtes, offrandes publiques |

Garde-fous : mandats limités à deux consécutifs, comptes publics visibles de tous, motion de destitution à la majorité des deux tiers, plafonds de dépense par décision.

Dans la phase 2 (ticket 260), l'archonte est le seul magistrat ; les autres charges, le conseil, la destitution et l'ostracisme viennent ensuite.
Seuls les citoyens votent et se présentent, dans leur cité ; une maison y devient citoyenne d'elle-même après `politics.meticDays` jours de jeu comme métèque (3, progression).
Le calendrier vient de la configuration (`politics.archon`) : un mandat de `termDays` jours de jeu (28, une année), précédé du dépôt des candidatures (`candidacyDays`, 4 jours) puis du vote (`votingDays`, 3 jours).
La clôture qui ouvre un mandat dépouille l'élection qui le pourvoit, puis ouvre celle du mandat suivant quand son dépôt doit commencer ; ces deux étapes passent avant l'entretien.
Le premier mandat d'une cité commence `candidacyDays + votingDays` jours après la première clôture qui lit une configuration avec la section `politics` ; chaque mandat suivant commence à la fin du précédent, pourvu ou vacant.
Si les clôtures ont manqué l'ouverture d'une élection (moteur arrêté), son dépôt est écourté ; si elles ont manqué le début de son vote, elle s'ouvre à la clôture suivante avec un calendrier complet, et la charge est vacante d'ici là.
Le calendrier d'une élection est fixé à son ouverture : une version de configuration publiée ensuite ne vaut que pour les suivantes.
Commandes : `city.standForElection` et `city.withdrawCandidacy` pendant le dépôt (un retrait est définitif : la candidature ne se redépose pas), `city.castVote` pendant le vote (un bulletin par maison et par élection, pour une candidature maintenue).
Décision (ambiguïté de cette section) : le vote est secret ; un joueur lit que sa maison a voté, jamais pour qui, et les résultats ne sont publics qu'après le dépouillement.
La charge va à la candidature maintenue qui a le plus de bulletins.
Décision (ticket 260) : une égalité, à zéro bulletin comme ailleurs, est départagée par l'ancienneté de la candidature ; un candidat seul est donc élu même sans voix.
Une élection sans candidat laisse la charge vacante jusqu'au mandat suivant.
Une maison qui a tenu la charge aux `maxConsecutiveTerms` derniers mandats de sa cité (2) ne se présente pas au suivant ; un mandat vacant ou tenu par une autre maison interrompt la suite.
Les joueurs connectés lisent le calendrier de chaque cité, les candidatures, les résultats après dépouillement et les magistrats, en charge ou passés (12).

## 6.3 Décrets

Un décret est un type de loi pris dans un catalogue de 40 modèles paramétrés (taux, durées, cibles) : taxe, subvention d'une filière, embargo, grands travaux, fête, pacte commercial. Le joueur rédige son intention en langage naturel ; l'IA la convertit en décret paramétré qu'il valide avant dépôt. Le moteur n'applique que des paramètres bornés.

## 6.4 Mécaniques civiques

- **Liturgies** : chaque saison, les maisons les plus riches se voient confier une dépense publique (fête, navire d'escorte, chœur). L'assumer avec faste rapporte Timè et Charis ; s'y dérober coûte cher en réputation. C'est le principal frein à l'effet boule de neige.
- **Ostracisme** : une fois par année de jeu, l'assemblée peut écarter un citoyen des charges publiques pour une saison. Ses biens ne sont pas touchés.
- **Tribunal** (après le lancement) : les litiges de contrat sont jugés par un jury de joueurs tirés au sort, sur dossier résumé par l'IA.
- **Grands travaux** : merveilles construites collectivement (port monumental, théâtre, sanctuaire), qui donnent un bonus permanent à la cité.

## 6.5 Au-delà de la cité

- **Ligues** : alliances de 2 à 5 cités avec trésor commun, tarifs préférentiels et défense mutuelle. Une ligue élit un hégémon.
- **Conflits** : embargo, blocus, guerre de course. Un conflit se résout sur plusieurs jours par les contributions des citoyens (navires, mercenaires, vivres). Les effets sont temporaires : droits de port majorés, routes fermées, tribut. Aucun bien de joueur n'est détruit.
- **Confréries de métier** : associations de joueurs d'une même filière, toutes cités confondues. Elles peuvent fixer des normes, mutualiser des achats et tenter des ententes, que l'agoranome et l'Hybris sanctionnent.
- **Sanctuaires communs** : un sanctuaire panhellénique par dieu, géré par les cités qui le financent.

## 6.6 Outils communautaires

- Messagerie privée, canaux par cité, ligue, confrérie et marché ; forum intégré par cité.
- Profil public de maison : blason, devise, palmarès, historique des mandats, avis des partenaires de contrat.
- **Chronique** : journal quotidien de chaque cité rédigé par l'IA à partir des faits du jour, avec tribunes libres des joueurs.
- **Parrainage** : un vétéran devient le proxène d'un nouveau ; les deux sont récompensés aux paliers de progression du filleul.
- **Jeux panhelléniques** : à chaque fin d'Olympiade, épreuves économiques par cité et par maison (meilleure marge, plus belle fête, plus longue route), avec titres permanents.

## 6.7 Formes de concurrence

Guerre des prix, course à la qualité, verrouillage d'une ressource, débauchage d'artisans, surenchère sur une concession, prise de contrôle d'une société, campagne électorale, concurrence fiscale entre cités, contrefaçon et renseignement commercial (voie d'Hermès, avec risque d'être découvert).
