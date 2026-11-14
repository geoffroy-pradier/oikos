# 3. Boucles de jeu et progression

Le jeu tourne en temps réel persistant : une saison de jeu dure 7 jours réels, une année 4 semaines, une Olympiade 16 semaines. Il n'y a ni jauge d'énergie ni remise à zéro du patrimoine ; la limite du joueur est le nombre d'opérations que ses intendants peuvent mener en parallèle.

## Quatre rythmes emboîtés

| Rythme | Durée réelle | Ce que fait le joueur |
| --- | --- | --- |
| Session | 3 à 10 min | Encaisser la production, relancer les ordres, ajuster ses prix, répondre à un événement, voter |
| Journée | 24 h | Honorer un contrat, lancer une expédition, traiter l'oracle du jour, gérer le personnel |
| Saison | 7 jours | Semer ou récolter, participer à la fête religieuse, clôturer ses comptes, suivre la session de l'assemblée |
| Olympiade | 16 semaines | Élections majeures, grands travaux, Jeux panhelléniques, titres et classements |

## Temps et horloges

- **Tick économique** toutes les 10 minutes : demande des PNJ, prix de référence, avancement des trajets.
- **Clôture quotidienne** à 04 h 00 (heure de Paris) : salaires, loyers, entretien, intérêts, impôts, chronique du jour.
  Le jour de jeu commence à la clôture : c'est le jour civil local (fuseau et heure de clôture de la configuration) dont la clôture a eu lieu, et avant elle on est encore dans le jour précédent. Il y a une clôture par jour de jeu, à son premier instant. Ni le jour de jeu ni l'instant de sa clôture ne dépendent de la durée du tick : la changer dans la configuration ne décale aucune clôture. Si l'heure de clôture est sautée par le passage à l'heure d'été, la clôture a lieu au premier instant qui suit ; si elle se répète au retour à l'heure d'hiver, à sa première occurrence.
  Une clôture n'est jouée qu'une fois par monde et par jour de jeu, quel que soit le nombre de moteurs : ses effets et sa ligne (`daily_closes`) sont validés ensemble, et une clôture en échec n'a rien écrit. Le moteur vérifie à chaque passage (chaque minute) si la clôture du jour de jeu en cours est jouée : une clôture manquée parce qu'il était arrêté à l'heure dite est rattrapée au premier passage, une seule fois. Après une panne de plusieurs jours, seule la clôture du jour en cours est jouée : les jours manqués n'ont pas de clôture, et ce qu'une clôture prélève (l'entretien, 5.5) n'est demandé qu'une fois. La clôture lit la configuration en vigueur à son instant de jeu, version programmée à cette clôture comprise. Un monde neuf commence à la clôture du jour en cours si une configuration était en vigueur à cet instant, sinon à la suivante.
- **Heure de référence** : le moteur lit l'instant présent à l'horloge de la base de données, jamais à celle de son processus. Plusieurs moteurs voient donc la même heure, celle qui date aussi les écritures du jeu.
- **Bascule de saison** le lundi : météo, récoltes, fête du calendrier, ouverture des votes.
- La production est calculée à la demande à partir des horodatages : un joueur absent ne perd rien, il retrouve ses stocks pleins jusqu'à la capacité de ses entrepôts.

## Six voies de réussite

Chaque voie a son arbre de compétences du chef de maison (30 nœuds par arbre, points gagnés par l'expérience de la voie pratiquée). On peut en maîtriser deux, pas six : la spécialisation crée l'interdépendance.

| Voie | Activité centrale | Titre sommital |
| --- | --- | --- |
| Géoros (la terre) | Domaines agricoles, élevage, forêts | Maître des greniers |
| Technitès (l'atelier) | Transformation, qualité, marques | Maître artisan |
| Emporos (le négoce) | Flotte, arbitrage entre cités, contrats | Navarque marchand |
| Trapézite (la finance) | Banque, prêts, parts de sociétés | Grand banquier |
| Politès (la cité) | Mandats, décrets, diplomatie | Archonte, puis hégémon de ligue |
| Hiéreus (le sacré) | Temples, fêtes, oracles | Grand prêtre |

## Progression

1. **Métèque (jours 1 à 3).** Tutoriel guidé par un mentor : une parcelle, un atelier, une première vente à l'agora. À la fondation, la maison reçoit une dotation en monnaie et un premier site de production primaire, exploitable sans rien acheter (paramètres du back-office : 3 000 oboles et un champ de blé au départ) ; l'atelier vient ensuite.
2. **Citoyen (semaine 1).** Citoyenneté, droit de vote, choix du dieu protecteur, premier intendant.
3. **Notable (mois 1).** Plusieurs sites, un navire, accès au crédit, première magistrature mineure.
4. **Grande maison (mois 2 à 4).** Filière intégrée ou banque, présence dans plusieurs cités, liturgies.
5. **Légende (au-delà).** Titres d'Olympiade, merveilles, hégémonie, héritiers. Le but de fin de partie est le prestige, pas l'accumulation.

## Rang et classements

Le rang d'une maison est un score composite : patrimoine net (40 %), Timè (25 %), Charis (15 %), contribution à la cité (20 %). Les pondérations sont paramétrables. Les classements sont multiples (par voie, par cité, par ligue, nouveaux joueurs) pour que chacun ait un podium atteignable.
