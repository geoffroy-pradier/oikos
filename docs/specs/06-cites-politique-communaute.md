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
Dans la phase 2 (ticket 263), les comptes publics sont le solde et les flux du trésor de chaque cité, lisibles de tous les joueurs connectés (5.6), et le plafond de dépense d'un décret est une part du trésor, contrôlée à la proposition puis au règlement (6.3).

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

Dans la phase 2 (tickets 261 à 263), l'archonte en charge propose seul, sans conseil, et le catalogue n'a que quatre modèles, saisis par formulaire, sans IA : taux de la taxe de marché de la cité, coefficient de son droit de port, grands travaux et fête.
La conversion d'une intention en langage naturel attend une phase suivante.
Les bornes de chaque paramètre et les règles du vote viennent de la configuration (`decrees`) ; un modèle qu'elle ne borne pas ne se propose pas (`DECREE_MODEL_CLOSED`).
Taux de la taxe et coefficient du droit de port sont bornés par le monde.
Une dépense (grands travaux, fête) a un montant borné, et ne dépasse pas à la proposition la part `spendingCapShareBps` du trésor de la cité, arrondie à l'obole inférieure ; elle sera contrôlée de nouveau à son application (ticket 263).
Une fête a aussi une durée en jours de jeu et des biens, chacun une fois, pris dans la liste de la configuration, au plus `maxGoods`.
Une cité a au plus `maxOpenPerCity` décrets au vote ; ses propositions se suivent, si bien que des propositions simultanées ne dépassent jamais ce nombre.
Le vote dure au moins `votingDays` jours de jeu pleins : il se clôt à la clôture qui ouvre le jour `g + votingDays + 1`, g étant le jour de jeu de la proposition.
Le quorum est fixé à la proposition, comme le calendrier d'une élection à son ouverture : une version de configuration publiée ensuite ne vaut que pour les décrets suivants.
Un décret proposé reste au vote même si le mandat de son auteur prend fin entre-temps.
Commandes : `city.proposeDecree` (l'archonte en charge) et `city.voteDecree` (un citoyen de la cité, pour ou contre, une fois par maison, pendant le vote).
Décision (ambiguïté de cette section, ticket 261) : comme pour l'élection, le vote est secret ; un joueur lit que sa maison a voté, jamais son choix, et le décompte n'est public qu'après le dépouillement.
Comme pour l'élection de l'archonte (ADR 0007), ce secret vaut envers les joueurs, pas envers l'exploitant : le choix reste lié à la maison dans `decree_votes`, et en clair dans le journal des commandes (entrée de `city.voteDecree`).
La clôture qui suit la fin du vote dépouille le décret, avant l'entretien, une seule fois même rejouée.
Il est adopté si les votes exprimés, pour et contre, atteignent le quorum, `quorumBps` des citoyens de la cité devenus citoyens avant la fin du vote, et si les votes pour sont strictement plus nombreux que les votes contre ; il est rejeté sinon, égalité comprise.
Une cité sans citoyen atteint donc le quorum sans vote, mais n'adopte rien.
Les effets d'un décret adopté viennent avec les tickets 262 (taux) et 263 (dépenses) : le ticket 261 ne fait bouger aucune monnaie.
Application d'un décret de taux (ticket 262) : la clôture qui le trouve adopté, celle de son dépouillement d'ordinaire, l'applique, après la population des PNJ et avant tout ce qui taxe ou paie.
Il passe à l'état `applied`, une seule fois même rejouée, et l'événement `DecreeApplied` donne sa valeur votée et la valeur qu'il met en vigueur.
Ses paramètres sont revalidés à ce moment contre les bornes de la configuration en vigueur : hors des bornes, il s'applique quand même et vaut la borne la plus proche ; si la configuration ne borne plus son modèle, il est sans effet tant qu'elle ne le rouvre pas (5.6).
Le taux de la cité est désormais celui de son dernier décret appliqué de ce modèle (5.6).
Règlement d'un décret de dépense (ticket 263) : la clôture qui le trouve adopté le règle juste après les décrets de taux, une seule fois même rejouée.
Couvert par le trésor de sa cité à cet instant (au plus la part `spendingCapShareBps`, contrôlée de nouveau sous le verrou du trésor), il est payé, passe à `applied` et `DecreeApplied` dit le montant payé ; sinon, ou si son modèle n'est plus ouvert, il devient caduc (`lapsed`) et `DecreeLapsed` dit pourquoi (5.6).
Une fête relève ensuite la demande des PNJ de sa cité pour ses biens, pendant ses jours (5.2, 7.5).
Les joueurs connectés lisent les règles en vigueur (`decree_rules`), les décrets de chaque cité et leur décompte après le dépouillement (12).

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

Dans la phase 2 (ticket 273), la discussion compte deux sortes de canaux.
Décision (ambiguïté de cette section) : un canal par cité, où écrit et lit toute maison de la cité, citoyenne ou métèque, et des conversations privées entre deux maisons d'un même monde, de la même cité ou non.
Les canaux de ligue, de confrérie et de marché et le forum de la cité viennent avec les phases suivantes.
Une conversation privée s'ouvre par `chat.openDirect` ; elle est unique pour une paire de maisons, quel que soit qui l'ouvre, et une maison ne converse pas avec elle-même.
Un message s'écrit par `chat.post`, dans le canal de sa cité ou dans l'une de ses conversations, nulle part ailleurs ; un canal où la maison n'écrit pas est refusé sous le même code qu'un canal inconnu (`CHANNEL_NOT_FOUND`), pour ne pas révéler les conversations des autres.
Le texte est débarrassé de ses blancs de début et de fin, ne peut être vide ni porter de caractère de contrôle (hors saut de ligne et tabulation), et compte au plus `chat.maxMessageLength` caractères (500).
Une maison écrit au plus `chat.rateLimit.messages` messages (10), tous canaux confondus, sur toute fenêtre glissante de `chat.rateLimit.windowSeconds` secondes (60) ; au-delà, `TOO_MANY_MESSAGES`.
Ce débit s'ajoute à la limite générale de l'API par commande (13).
Son refus est un refus métier, journalisé comme les autres (statut 409), et non un refus avant exécution : il n'entre pas dans les compteurs `rate_limited` de la Vigie.
Un message masqué par la modération (#275, #276) reste listé, dit masqué, mais ne rend plus son texte aux joueurs.
Décision (18, conservation limitée) : le moteur supprime chaque message `chat.retentionDays` jours après son écriture (30) ; le journal des commandes n'en garde pas le texte (ADR 0002).
Le temps réel et l'onglet Messages viennent avec le ticket 274.

## 6.7 Formes de concurrence

Guerre des prix, course à la qualité, verrouillage d'une ressource, débauchage d'artisans, surenchère sur une concession, prise de contrôle d'une société, campagne électorale, concurrence fiscale entre cités, contrefaçon et renseignement commercial (voie d'Hermès, avec risque d'être découvert).
