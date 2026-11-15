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
  Le jour de jeu commence à la clôture : c'est le jour civil local (fuseau et heure de clôture de la configuration) dont la clôture a eu lieu, et avant elle on est encore dans le jour précédent.
  Il y a une clôture par jour de jeu, à son premier instant. Ni le jour de jeu ni l'instant de sa clôture ne dépendent de la durée du tick.
  L'horloge d'un monde, elle, ne change pas (décision de #123) : une version de configuration qui change la durée du tick, l'heure ou le fuseau de clôture est refusée à la publication comme à la programmation (`CONFIG_CLOCK_CHANGED`, champs désignés) ;
  la durée des saisons reste réglable. Un fuseau valide pour `Intl` mais inconnu de la base (absent de `pg_timezone_names`, casse ignorée) est refusé lui aussi, à la publication (`CONFIG_TIMEZONE_UNKNOWN`), sauf s'il est celui de la version en vigueur : un monde dont le fuseau sortirait de la liste de la base après une mise à jour de tzdata ne pourrait sinon plus rien publier, ni sous ce nom (inconnu) ni sous son nom actuel (changement d'horloge).
  Le changement d'horloge est contrôlé avant lui : un fuseau différent de celui en vigueur est refusé par `CONFIG_CLOCK_CHANGED`, si bien qu'aucune commande de l'API ne produit `CONFIG_TIMEZONE_UNKNOWN`.
  Le seul refus effectif est celui de la configuration initiale, publiée sans version en vigueur au démarrage sur une base vide (`ensureInitialConfig`, `publishVersion`) : le démarrage échoue alors (`ConfigError`).
  La programmation ne contrôle pas le fuseau, puisqu'elle refuse déjà tout changement d'horloge.
  Les comptes d'un monde dont le fuseau en vigueur a quitté la liste de la base restent sans jour de jeu ni saison (12) tant qu'un humain n'a pas traité son fuseau.
  Il l'apprend par la Vigie (15), qui nomme le fuseau en vigueur et dit s'il est inconnu de la base (même contrôle qu'à la publication).
  La configuration étant globale, ce fuseau est celui de tous les mondes : « par monde », la Vigie dit donc une seule fois qu'il vaut pour tous, avec leur nombre, et l'alerte les concerne tous.
  Ce qu'il doit faire : rendre ce nom à la base des fuseaux de PostgreSQL, sur le serveur (données tzdata de PostgreSQL qui le connaissent encore, ou lien de ce nom vers la zone qui l'a remplacé), ce qui demande un humain (`needs-human`) ;
  changer de fuseau n'est pas une issue, puisque c'est un changement d'horloge, refusé.
  L'alerte disparaît à la lecture suivante de la Vigie, et rien n'est à réparer : jour de jeu et saison des comptes sont calculés à la lecture, et aucun flux n'a disparu entre-temps.
  Le moteur, lui, compte ses jours avec `Intl` : ticks et clôtures continuent.
  Sans configuration en vigueur, la Vigie le dit au lieu du fuseau ;
  si la version en vigueur ne respecte plus le schéma (l'API et le moteur ne la chargent pas), elle le dit aussi, et lit son fuseau tel qu'enregistré, comme `game.clock_rules()`, pour le signaler s'il est inconnu.
  Sans aucun monde, l'alerte dit que tout monde créé serait touché ;
  la durée des saisons, elle, est d'au plus 366 jours (4.1). L'indice d'un tick se compte en durées de tick depuis l'origine : changer la durée changerait l'échelle des indices déjà joués et bloquerait le monde.
  Changer l'heure ou le fuseau déplacerait le jour de jeu d'une version programmée « à la prochaine clôture » : elle entrerait en vigueur à l'ancienne heure, et la clôture de ce jour la lirait ou non selon le sens du changement.
  Le tick qui porte la clôture (drapeaux `daily_close` et `season_switch`) et l'échéance d'une programmation sont calculés comme la clôture elle-même (`dailyCloseAt`) : c'est le premier tick qui commence à l'instant de la clôture ou après, le premier du nouveau jour de jeu, celui qui lit la version activée à cette clôture, y compris un jour où l'heure de clôture est sautée par l'heure d'été ou dans un fuseau décalé d'une demi-heure ou d'un quart d'heure.
  Un monde dont l'horloge recule derrière son dernier tick joué ne joue rien, et chaque passage inscrit un échec à la télémétrie des ticks, que la Vigie compte.
  Une activation programmée avant ce refus, dont la version changerait l'horloge en vigueur, est annulée au déploiement et à chaque démarrage du moteur (`config.cancel_clock_changing_activations`, annulation portée par l'identifiant nul, qui n'est pas un compte) et signalée dans le journal du moteur ;
  à moins d'une minute de son échéance, elle ne peut plus être annulée et le journal dit qu'elle s'appliquera (#213).
  Le tick de clôture se reconnaît au changement de jour de jeu entre son début et celui du tick précédent, sans hypothèse sur l'ampleur d'un saut d'heure : un saut de trois heures (Antarctica/Casey, octobre 2009) ou d'un jour (Pacific/Apia, décembre 2011) porte sa clôture comme un autre.
  Si l'heure de clôture est sautée par le passage à l'heure d'été, la clôture a lieu au premier instant qui suit ;
  si elle se répète au retour à l'heure d'hiver, à sa première occurrence.
  Une clôture n'est jouée qu'une fois par monde et par jour de jeu, quel que soit le nombre de moteurs : ses effets et sa ligne (`daily_closes`) sont validés ensemble, et une clôture en échec n'a rien écrit.
  Le moteur vérifie à chaque passage (chaque minute) si la clôture du jour de jeu en cours est jouée : une clôture manquée parce qu'il était arrêté à l'heure dite est rattrapée au premier passage, une seule fois.
  Après une panne de plusieurs jours, seule la clôture du jour en cours est jouée : les jours manqués n'ont pas de clôture, et ce qu'une clôture prélève (l'entretien, 5.5) n'est demandé qu'une fois.
  La clôture lit la configuration en vigueur à son instant de jeu, version programmée à cette clôture comprise.
  Les clôtures d'un monde se jouent l'une après l'autre et jamais en arrière : une clôture plus ancienne que la dernière jouée ne l'est plus, même par un moteur en retard.
  L'heure de clôture et le fuseau sont ceux de la configuration en vigueur à l'instant présent.
  Un monde neuf commence à la clôture du jour en cours si une configuration était en vigueur à cet instant, sinon à la suivante.
  La clôture d'un monde est une seule transaction, au niveau d'isolation READ COMMITTED fixé par le moteur (chaque instruction voit ce que les commandes ont validé avant elle, et un verrou de ligne attend au lieu d'échouer) : une maison en erreur la fait donc échouer entière, et elle est reprise au passage suivant.
  Chaque tentative est notée avec sa durée (`telemetry.close_runs`) ;
  un échec y porte son erreur, qui nomme l'étape et la maison en cause, et la Vigie (15) compte les échecs des dernières 24 heures et affiche le dernier.
  Les passages de tick et de clôture plus anciens que la rétention de la configuration (`telemetry.retentionDays`, 90 jours au départ, au moins 2) sont supprimés par le moteur à chaque passage, par une fonction du propriétaire qui garde toujours le dernier jour : `close_runs` reste en ajout seul pour le service.
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
   Le joueur choisit à la fondation sa cité d'accueil parmi les quatre de l'Archipel, présentées avec leur dieu protecteur, leur port et leur terroir (6.1).
   Le premier site lance la recette de départ de cette cité, sinon la recette commune : un champ de blé à Kallistè et à Elaia, une vigne à Ampelos, une pêcherie à Halos.
2. **Citoyen (semaine 1).** Citoyenneté, droit de vote, choix du dieu protecteur, premier intendant.
3. **Notable (mois 1).** Plusieurs sites, un navire, accès au crédit, première magistrature mineure.
4. **Grande maison (mois 2 à 4).** Filière intégrée ou banque, présence dans plusieurs cités, liturgies.
5. **Légende (au-delà).** Titres d'Olympiade, merveilles, hégémonie, héritiers. Le but de fin de partie est le prestige, pas l'accumulation.

## Rang et classements

Le rang d'une maison est un score composite : patrimoine net (40 %), Timè (25 %), Charis (15 %), contribution à la cité (20 %). Les pondérations sont paramétrables. Les classements sont multiples (par voie, par cité, par ligue, nouveaux joueurs) pour que chacun ait un podium atteignable.
