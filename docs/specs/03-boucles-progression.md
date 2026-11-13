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
