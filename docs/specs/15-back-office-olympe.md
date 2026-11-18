# 15. Back-office « Olympe »

Olympe est une application distincte, sur son propre sous-domaine, d'où l'équipe surveille, modère, règle et anime le jeu sans toucher au code ni à la base. Tout ce qui s'y fait est tracé, et les actions sensibles demandent une double validation.

## 15.1 Modules

| Module | Fonctions |
| --- | --- |
| Vigie | Joueurs connectés, actifs du jour, durée des ticks, erreurs, files de tâches, coût IA du jour, état des services |
| Économie | Masse monétaire, robinets et puits ligne par ligne, indice des prix, prix par bien et par cité, inégalité de fortune (Gini), volumes, alertes de dérive |
| Paramètres | Édition de toutes les tables d'équilibrage, validation par schéma, comparaison de versions, programmation, retour arrière en un clic |
| Simulateur | Rejoue N jours sur une copie du monde avec une configuration candidate et des agents automates, puis compare les indicateurs à la référence |
| Animation | Calendrier des événements, déclenchement manuel, création d'événements par modèle, annonces, validation des propositions du maître du jeu |
| Joueurs | Recherche, fiche complète (comptes, écritures, commandes, sessions, comptes liés), vue du jeu en lecture seule, compensation et correction par écritures tracées |
| Modération | File des signalements pré-triée par l'IA, contexte de la conversation, sanctions graduées (avertissement, silence, suspension, exclusion), appels, filtres de vocabulaire |
| Cités et politique | État des institutions, mandats, décrets en vigueur, intervention d'urgence sur une cité bloquée |
| IA | Prompts versionnés, journal des appels, coût par usage, taux de sorties rejetées, interrupteurs, jeux d'essai de non-régression |
| Support | Tickets, réponses types, historique par joueur |
| Boutique | Commandes, abonnements, remboursements, droits accordés |
| Conformité | Export et suppression des données d'un joueur, registre des demandes |
| Accès et audit | Rôles, double authentification, journal d'audit consultable et non modifiable |

Passerelle IA dans la Vigie (ticket #268, ADR 0005) : pour chaque usage, son état (ouvert, coupé par la configuration, coupé au plafond du mois), son coût estimé du jour et du mois (UTC), son plafond et ses sorties rejetées sur les réponses du mois.
Ces chiffres sont des estimations tirées des jetons et des prix de la configuration, pas la facture du fournisseur.
Le module IA (prompts, jeux d'essai) attend une phase suivante.

Modération dans la phase 2, côté joueur (ticket #275) : signalements (`game.reports`) et sanctions graduées (`admin.sanctions` : avertissement, silence, suspension, exclusion), dont l'effet est tenu par l'API (13) et l'appel ouvert au joueur (18).
La configuration porte les motifs de signalement, les termes interdits et la longueur d'un appel (section `moderation`).
Une exclusion est définitive et n'est en vigueur qu'une fois validée par une seconde personne (15.4) ; avant, elle n'est ni annoncée au joueur ni appliquée.
Un joueur ne voit ni l'auteur ni le validateur d'une sanction : les modérateurs peuvent être des joueurs bénévoles.
Commandes d'administration de la modération (ticket #276) : ouvertes au super-administrateur, au responsable communauté et au modérateur (`MODERATION_ROLES`), sous second facteur, rôle relu et journal comme toute commande d'administration (15.4) ; l'écran du module vient avec #277 (ci-dessous).
- `admin.sanction` prononce, à partir de maintenant, un avertissement, un silence ou une suspension d'une des durées de la configuration (`moderation.sanctionHours`, en heures ; par défaut 168 pour un avertissement, 1, 24 ou 72 pour un silence, 24, 168 ou 720 pour une suspension), ou propose une exclusion, sans durée.
  Une autre durée est refusée (`DURATION_NOT_OFFERED`), comme le compte qui se sanctionne lui-même (`SELF_SANCTION`) ou un compte inconnu (`ACCOUNT_NOT_FOUND`).
- `admin.confirmExclusion` valide une exclusion proposée, une fois (`ALREADY_CONFIRMED`) : ni son auteur ni le compte exclu ne la valident (`SECOND_PERSON_REQUIRED`), tout autre compte d'un rôle de la modération le peut, et l'exclusion commence à sa validation.
  Dans la même transaction, elle annule les ordres ouverts de toutes les maisons du compte exclu et rend leur séquestre (15.4, #528).
  Une exclusion retirée ne se valide plus (`EXCLUSION_WITHDRAWN`).
- `admin.decideAppeal` tranche un appel, une fois (`APPEAL_DECIDED`), par un autre compte que l'auteur de la sanction et que le compte sanctionné (`SECOND_PERSON_REQUIRED`) : accueilli, il lève la sanction si elle n'est pas finie, et sa fin devient l'instant de la levée ; rejeté, la sanction court jusqu'à sa fin.
- `admin.withdrawExclusion` retire une exclusion proposée et pas encore validée, qui quitte la file et n'a jamais agi (#531) ; sa fin devient l'instant du retrait.
  Retirer ne demande pas de seconde personne : son auteur le peut, comme tout autre compte d'un rôle de la modération, sauf le compte exclu (`SECOND_PERSON_REQUIRED`).
  Une exclusion validée ne se retire pas, elle se lève (`ALREADY_CONFIRMED`) ; une exclusion retirée ne se retire pas deux fois (`EXCLUSION_WITHDRAWN`).
- `admin.resolveReport` écarte ou retient un signalement ouvert, et avec lui les autres signalements ouverts du même message (une entrée de la file) ; un signalement déjà traité est refusé (`ALREADY_RESOLVED`), comme le compte de la maison signalée et celui d'une maison qui a signalé ce message (`SECOND_PERSON_REQUIRED`).
- `admin.hideMessage` masque un message, signalé ou non, une fois (`MESSAGE_HIDDEN`) : il reste listé, sans son texte pour les joueurs (6.6).

La base tient les mêmes règles (migrations 260 et 390) : elle date chaque validation, décision, proposition de levée, levée, retrait et traitement, n'admet chacun qu'une fois, et refuse ceux d'une personne qui n'y a pas droit.
Avec une décision sur l'appel, elle n'admet une levée qu'avec l'appel accueilli, dans la même écriture et par le même compte, et l'exige quand la sanction n'est pas finie.
Sans décision, elle admet le retrait d'une exclusion proposée, la levée seule d'une autre sanction que l'exclusion, et celle d'une exclusion validée par une autre personne que celle qui l'a proposée ; jamais pendant qu'un appel attend, ni d'une sanction finie.
Traiter un signalement ne masque ni ne sanctionne rien : ce sont deux commandes de plus, au choix de la modération.
Décision (ambiguïté du ticket) : une exclusion proposée qui n'est pas validée n'agit jamais ; elle se retire par `admin.withdrawExclusion` (#531).
Décision (relecture de #275) : une sanction ne retire pas ses commandes d'administration à un compte de l'équipe, que son rôle seul ouvre ou ferme (`admin.revokeRole`) ; sans cela, un modérateur pourrait suspendre tous les super-administrateurs et fermer Olympe.
Décision (relecture de #275) : un message signalé est purgé avec les autres, au bout de `chat.retentionDays` jours (18) ; la file garde alors le signalement et la maison signalée, sans texte ni contexte, et le seuil d'alerte de 24 heures (15.5) le veut traité bien avant ; l'alerte de la Vigie qui le surveille lit son compte dans `GET /api/admin/vigie` (#530).
Écran du module Modération (ticket #277) : il lit `GET /api/admin/reports` et liste la file, du plus ancien au plus signalé, dans l'ordre de l'API.
Chaque entrée dit la maison signalée, les motifs et l'ancienneté du plus ancien signalement, et montre le message dans la conversation autour de lui (`contextSize` messages de chaque côté) ; un message purgé n'a ni texte ni contexte.
Les gestes d'une entrée sont : masquer le message, avertir, réduire au silence, suspendre, proposer une exclusion, retenir le signalement, le classer sans suite.
Chaque geste demande une confirmation qui nomme la maison visée ; le foyer clavier va au geste sans effet (« Annuler »), et la répétition d'une touche Entrée tenue n'ouvre ni ne confirme rien, comme dans le module Accès (15.3).
Une sanction à durée demande, dans sa confirmation, l'une des durées proposées et un motif ; une exclusion ne demande que le motif.
Sous la file, l'écran liste les exclusions proposées à valider et les appels à trancher, comptes en entier, avec le motif de la sanction et le texte de l'appel.
Valider une exclusion, accueillir ou rejeter un appel passent par la même confirmation que les gestes de la file.
Décision (ambiguïté du ticket) : `admin.decideAppeal` ne porte pas de motif, seulement la décision ; la décision « motivée » du ticket ne l'est donc pas en base, et l'écran n'ajoute pas de champ qui ne mènerait nulle part.
Un ticket de suite, qui touche à l'API et à la base, ajoutera le motif de décision si la modération le veut.
Durées proposées (#541) : `GET /api/admin/reports` rend `sanctionHours`, les durées de `moderation.sanctionHours` dans la version en vigueur à l'heure de la base, et rien d'autre de la configuration que ce seuil et ces durées.
Elles sont nulles sans version en vigueur lisible, sans laquelle aucune commande ne passe.
L'écran les propose comme un choix exclusif (boutons radio), sans champ libre et sans durée codée ; une seule durée proposée est choisie d'office, et sans durée lisible la sanction ne part pas.
L'API reste juge : une version entrée en vigueur entre la lecture et la commande fait refuser la durée (`DURATION_NOT_OFFERED`), l'écran le dit, relit les durées et fait choisir de nouveau.
Décision (#541) : un champ ajouté à la réponse existante plutôt qu'une route nouvelle ; la version précédente d'Olympe ne valide pas la réponse et l'ignore, et l'écran tient pour indisponibles les durées d'une API qui ne les rend pas encore.
Décision (ambiguïté du ticket) : retenir ou classer un signalement ne sanctionne ni ne masque rien (voir plus haut) ; l'écran propose les trois gestes séparément, à la main du modérateur.
L'alerte « signalements en attente depuis plus de 24 h » (15.5) s'affiche en tête du module quand le plus ancien signalement ouvert attend depuis plus longtemps que le seuil, d'après l'heure de la base rendue par l'API.
Le seuil est `moderation.staleReportHours` (24 par défaut, de 1 à 720 heures) : `GET /api/admin/reports` le rend (`staleAfterHours`) et l'écran n'en code aucun.
Décision (#530) : la Vigie lit ce compte dans `GET /api/admin/vigie`, qui rend `staleReports` : le seuil (`afterHours`), le nombre de signalements ouverts depuis plus longtemps (`count`) et l'ancienneté du plus ancien en heures (`oldestHours`).
`staleReports` est nul sans configuration en vigueur lisible.
Sans elle, `GET /api/admin/reports` rend le seuil par défaut de la configuration, et la file reste lisible.
La Vigie affiche ce nombre, y compris à zéro, et passe en alerte dès qu'il dépasse zéro ; elle le montre à tous les rôles qui la lisent, sans lire la file (`GET /api/admin/reports` reste fermé à ces rôles).
Hors périmètre : toute notification hors d'Olympe.
Décision (relecture de #275) : un nom de maison, texte public, ne passe encore ni par le filtre de vocabulaire ni par le silence à sa fondation ou à son changement ; un ticket de suite les y soumettra.
Décision (relecture de #275, tranchée par #528) : un compte suspendu ou exclu peut toujours annuler ses ordres, et la validation d'une exclusion les annule tous (15.4).

Animation dans la phase 2 (ticket #267) : le seul calendrier des événements du monde (7.3, 7.4), en lecture, ouvert au super-administrateur, au concepteur de jeu, au responsable communauté et à l'observateur.
`GET /api/admin/events` rend, tous mondes confondus, les événements à venir, que les joueurs ne lisent pas encore, et ceux en cours ou finis depuis 30 jours, des plus tardifs aux plus anciens (au plus 1 000 : la limite coupe les plus anciens, et ceux à venir seulement s'ils sont plus de 1 000), avec l'heure de la base et cette fenêtre : monde, modèle, portée (cité, route ou cité et bien, par identifiant de la configuration), début, fin, ampleur et jour de planification, jamais la graine.
L'écran dit l'état de chacun (à venir, en cours, passé) à l'heure de l'API, pas du navigateur.
La réponse est décrite par un schéma partagé de `@oikos/contracts` (#446), qui en choisit les champs : une colonne lue en plus ne sort pas.
Elle dit aussi si la liste est coupée (plus de 1 000 événements dans la fenêtre), et l'écran le signale sous sa légende.
Cette lecture, faite sur la fin des événements et non sur leur monde, a son propre index.
Déclenchement manuel, création d'événements et propositions du maître du jeu attendent une phase suivante.

## 15.2 Cycle de vie d'un changement d'équilibrage

1. **Brouillon** : un concepteur modifie des valeurs ; le schéma refuse les valeurs hors bornes.
2. **Simulation** : le simulateur compare 30 jours simulés avant et après (inflation, marges par filière, temps de progression).
3. **Revue** : une seconde personne approuve le différentiel.
4. **Programmation** : activation à la prochaine clôture quotidienne, annoncée aux joueurs dans la chronique.
5. **Suivi** : alerte automatique si un indicateur sort de sa plage dans les 72 heures ; retour arrière en un clic.

L'annonce paraît dans la chronique publiée à la clôture où la version entre en vigueur (6.6, décision de #271) : la clôture a lu une autre version que la précédente ; une programmation annulée n'est pas annoncée.

Avant la programmation (étape 4), Olympe dit sous chaque version ce qu'elle retire et que l'état du monde porte encore, tous mondes confondus : les biens détenus ou portés par un ordre ouvert (la programmation est alors refusée : 5.1), les recettes que des sites exploitent encore, avec le nombre de sites et de maisons (ces sites seront à l'arrêt faute de recette : 4.2), et les classes de PNJ qui ont encore un état de population, avec le nombre de cités et d'habitants gardés (5.2).
Une recette ou une classe en usage ne refuse pas la programmation (décision de #97) mais la soumet à une confirmation explicite (#200) : une case à cocher sous la version, sans laquelle le bouton de programmation reste inactif ;
l'API, elle, refuse une programmation non confirmée (`CONFIG_RETIRED_UNCONFIRMED`, qui nomme chaque recette et chaque classe ;
drapeau `confirmRetiredInUse` de `admin.scheduleConfig`). La case vaut pour la liste lue à l'écran, et pour elle seule : si la liste relue nomme d'autres recettes ou classes, elle se décoche.
L'API, elle, ne compare pas la liste confirmée à celle que l'écran a montrée : le drapeau confirme tout ce que la version retire et qui est en usage au moment où elle contrôle, et l'événement `ConfigActivationScheduled` garde cette liste (`confirmedRetired`, vide si la version ne retire rien en usage) pour l'audit.
Seule la version qui retire une recette ou une classe en fait confirmer l'usage (décision de #234) : la confirmation n'est exigée que pour celles que la version en vigueur connaît encore.
Celles que la version en vigueur ne connaît déjà plus et que l'état du monde porte encore (une classe garde son état, même à zéro habitant, et un site oublié sa recette : 5.2, 4.2) ne sont à confirmer pour aucune version qui les laisse absentes : elle ne les retire pas, elle ne les rend pas.
Olympe les dit une seule fois, à titre d'information et sans case à cocher, en tête de la liste des versions.
La comparaison se fait avec la version en vigueur à l'instant de la base où la commande s'exécute, lue dans sa transaction, et pas à l'instant où l'API a reçu la commande : une clôture passée entre les deux compte.
La lecture des paramètres la charge de même, à l'instant de la base où elle désigne la version en vigueur.
C'est elle que la clôture visée remplacera : on ne programme que la prochaine clôture, et la dernière version programmée pour une clôture l'emporte sur les précédentes.
Une version programmée plus tôt pour la même clôture n'entre donc pas en compte : elle n'entrera pas en vigueur si celle-ci tient, et une annulation les annule toutes deux (15.4).
Sans version en vigueur lisible, la lecture tient pour retiré par la version tout ce qui est en usage, à confirmer ; l'API, elle, ne programme rien sans configuration chargée.
`confirmedRetired` ne garde que ce qui a été confirmé, jamais ce qui était déjà retiré.
La confirmation ne lève jamais le refus d'un bien. Le contrôle se fait à la programmation, sur l'état du monde de cet instant, pas à l'activation : un site qui adopte la recette, ou une classe dont l'état naît, entre la programmation et la clôture n'est ni signalé ni confirmé.
Une fois la version en vigueur, un tel élément est rangé avec ce qu'elle a déjà retiré : aucune version suivante ne le fait confirmer.
De même, une version entrée en vigueur sans confirmation (la configuration initiale, activée immédiatement, ou une version programmée avant #200) ne fait plus confirmer ce qu'elle a retiré.
À l'inverse, une recette ou une classe réintroduite par une version entrée en vigueur se fait confirmer de nouveau par la version qui la retire ensuite.
Rien n'est migré ni dédommagé (recettes et classes).
Un bien retiré encore détenu se reprend par un rachat (5.1, décision de #229).
Sous l'avertissement d'un tel bien, si la configuration en vigueur le connaît encore, le super-administrateur, et lui seul, voit un bouton « Racheter le stock de … ».
Sa confirmation dit les totaux lus (unités, prix de référence, maisons de tous les mondes, oboles créées, ordres ouverts annulés), pose le foyer sur « Ne pas racheter », et une touche Entrée tenue ne rachète rien.
Les totaux confirmés partent avec la commande : si l'état du monde a changé depuis la lecture, rien n'est racheté et l'écran le dit ; on relit les totaux, puis on confirme de nouveau.
Après le rachat, la version qui retire le bien se programme, si rien n'a été acquis entre-temps.

Quand le schéma refuse une configuration, l'écran désigne chaque valeur fautive en clair, dans la langue de l'écran : la table, la ligne et le champ (« Biens › wheat › élasticité »), suivis du chemin rendu par l'API, qui situe la valeur dans le texte JSON, et de son diagnostic (en anglais).
Une ligne est désignée par son identifiant tel qu'il figure dans la configuration envoyée (pas dans le texte du moment, qui a pu changer depuis le refus), sinon par sa position comptée à partir de 1 : identifiant absent ou illisible, ou programmation refusée d'une version enregistrée, que l'écran n'a pas.
Toutes les tables ont un libellé ; les champs des biens, des recettes et des classes de PNJ aussi, les autres gardent leur clé.
Un chemin que l'écran ne sait pas découper est rendu tel quel.
L'écran ne contrôle rien lui-même : `apps/admin` ne dépend de `packages/config` que dans ses tests, qui vérifient que ces libellés suivent le schéma (une table ou un champ ajouté sans libellé les fait échouer).

## 15.3 Rôles

| Rôle | Peut |
| --- | --- |
| Super-administrateur | Tout, dont la gestion des rôles |
| Concepteur de jeu | Paramètres, simulateur, animation |
| Responsable communauté | Annonces, animation, modération, cités |
| Modérateur | Modération et fiche joueur en lecture |
| Support | Tickets, fiche joueur, compensation sous plafond |
| Observateur | Lecture seule des tableaux de bord |

Dans la phase 2 (#276), le modérateur n'a que le module Modération, sans la fiche joueur, qui attend une phase suivante : il ne lit que la file des signalements, les messages signalés et leur contexte, les appels à trancher et les exclusions à valider, jamais une donnée économique ni un tableau de bord (15.4).
Le responsable communauté et le super-administrateur ont aussi ce module.

Un compte porte un seul rôle : pas de cumul en v0. Une personne qui tient deux fonctions reçoit le rôle le plus large des deux ; le cumul sera rouvert si les modérateurs bénévoles le demandent.

La liste des rôles admis dans chaque module est écrite une seule fois, dans les contrats partagés (`ADMIN_MODULE_ROLES`) : l'API ouvre ses routes de lecture d'après elle, l'application compose sa navigation d'après elle.
Un compte connecté sans rôle n'a accès à rien ; il voit son identifiant, à transmettre à un super-administrateur.
Le module Accès, réservé au super-administrateur, liste les comptes qui portent un rôle par `GET /api/admin/roles` : identifiant du compte, rôle, compte qui l'a accordé et date, du plus ancien au plus récent (la date et l'ordre sont ceux du dernier changement de rôle du compte : un rôle remplacé repart de l'instant du remplacement) ;
ni adresse ni autre donnée du compte. Il y accorde un rôle à un compte désigné par son identifiant (un rôle déjà porté est remplacé, et l'écran le dit) et retire un rôle après confirmation : la confirmation nomme le compte et le rôle, pose le foyer sur « Annuler », et la répétition d'une touche Entrée tenue n'ouvre, ne valide ni n'annule rien, de sorte qu'un retrait demande toujours un second geste voulu ;
chaque refus de l'API y est expliqué.

## 15.4 Exigences de sécurité

- Double authentification obligatoire, session courte, accès restreint par VPN ou liste d'adresses.
- Double validation pour tout crédit de monnaie au-dessus d'un seuil, toute exclusion définitive et toute mise en production de paramètres.
- Aucun accès direct aux tables : le back-office appelle des commandes d'administration, soumises aux mêmes règles de journalisation que les commandes de jeu.
- Les modérateurs peuvent être des joueurs bénévoles : leur rôle ne donne accès à aucune donnée économique privée.

Un nom de maison est un texte public : `house.create` et `house.rename` passent par le filtre de vocabulaire de la discussion (`moderation.bannedTerms`, 6.6) et par le silence (ticket 527).
Un nom qui contient un terme interdit est refusé avec le même code que la discussion, `MESSAGE_REJECTED`, avant toute écriture ; le terme n'est ni rendu ni journalisé, et le journal des commandes ne garde pas le nom refusé.
Décision (ambiguïté du ticket) : un compte réduit au silence ne fonde ni ne renomme sa maison (`SILENCED`), par cohérence avec la discussion ; il le peut de nouveau à la fin de la sanction.
Une suspension ou une exclusion refuse déjà toute commande de jeu (`SUSPENDED`), sauf l'appel de la sanction et `market.cancelOrder` (#528).
Le renommage d'office par la modération reste hors de cette règle et attend une phase suivante.

Ordres de marché d'un compte suspendu ou exclu (#528).
L'annulation d'un ordre est la seule commande de jeu qui ne crée rien : elle rend ce que l'ordre engageait (séquestre d'un achat, réservation d'une vente).
Sans elle, les ordres d'un compte suspendu resteraient sous séquestre et pourraient s'exécuter pendant toute la suspension ; ils le peuvent encore s'il ne les annule pas, et c'est son choix.
La validation d'une exclusion (`admin.confirmExclusion`) annule, dans sa transaction, les ordres ouverts de toutes les maisons du compte exclu, tous mondes confondus, comme `market.cancelOrder` : ce qui a été servi reste acquis, la réservation d'une vente est levée, et le séquestre des achats revient à la trésorerie de leur maison, en une écriture `market.escrow_release` par maison au grand livre.
Chaque ordre annulé produit son `OrderCancelled`, sous la commande de validation.
Une exclusion proposée et pas encore validée n'annule rien, et son retrait non plus (#531).
Ses stocks et sa trésorerie restent à la maison : leur saisie attend un ticket de suite.
La réponse de la commande et le journal d'audit ne disent rien de ces ordres ni de ces oboles : un modérateur ne lit aucune donnée économique privée.
Ordre des verrous : la validation prend le verrou d'agora de chaque monde où le compte a une maison, dans l'ordre des identifiants, avant toute ligne, comme un ordre placé, la demande des PNJ, la clôture et le rachat ;
puis les ordres, la trésorerie et le séquestre de chaque maison, dans l'ordre de `market.cancelOrder`.
Le registre lit la sanction au début de la transaction d'une commande ; `market.placeOrder` la relit sous le verrou d'agora, à l'heure de l'instruction, et refuse alors un compte suspendu ou exclu (`SUSPENDED`), sans rien écrire.
Un ordre que le compte place pendant la validation, déjà passé au contrôle du registre, est donc annulé avec les autres s'il a pris le verrou avant elle, et refusé (`SUSPENDED`) s'il le prend après : jamais laissé ouvert ;
une annulation par le joueur au même instant passe avant ou après, et le séquestre n'est rendu qu'une fois.
Un intendant du compte relit aussi la sanction sous ce verrou, avant l'opération (4.4) : il ne place pas d'ordre pour un compte exclu pendant qu'il attendait, et rien n'est noté.
Reste une fenêtre : une maison fondée dans un autre monde pendant la validation, et qui y place aussitôt un ordre ; elle demande deux commandes du compte à l'instant de la validation, et n'est pas couverte.

Dans la première version, une commande d'administration (`admin.*`) n'est exécutée que si la session porte le second facteur (niveau `aal2` du jeton) et si le compte a, dans `admin.roles`, l'un des rôles que la commande autorise ;
le rôle est relu à chaque commande. Tout refus (`FORBIDDEN`) est journalisé comme une commande rejetée.
Chaque ligne du journal des commandes porte le niveau d'assurance de la session, le rôle d'administration relu à cet instant et la version de configuration en vigueur.
Ce qui est refusé avant d'atteindre ce journal (jeton absent ou invalide, corps trop volumineux, débit dépassé, lecture d'administration refusée) est compté par heure, sans contenu de requête ni identité ;
chaque lecture du back-office par un compte admis est tracée (compte, rôle, route sans ses paramètres, issue).
La Vigie affiche ces compteurs sur 24 heures, ainsi que les clôtures quotidiennes en échec (nombre, et dernière erreur, qui nomme l'étape et la maison en cause : 3), et le fuseau de la configuration en vigueur, qui vaut pour tous les mondes : s'il est inconnu de la base, elle le nomme et alerte, avec le nombre de mondes concernés et ce qu'il faut faire ;
elle alerte aussi quand la version en vigueur ne respecte plus le schéma (3).
Elle compte aussi les voyages en retard de déchargement de plus d'un tick (4.6, #253), tous mondes confondus : ceux encore en mer alors que le tick qui devait les décharger, le premier qui commence à leur échéance ou après, est terminé.
Ce compte n'est pas nul quand le moteur est arrêté ou ses ticks en échec ; il est inconnu sans configuration en vigueur lisible, qui donne la durée du tick.
Les passages de tick et de clôture sont gardés `telemetry.retentionDays` jours, puis supprimés par le moteur (3).
Pour la configuration, deux commandes : `admin.publishConfig` enregistre une version de configuration sans l'activer, `admin.scheduleConfig` programme son activation à la prochaine clôture quotidienne (un retour arrière est la programmation d'une version antérieure ;
si plusieurs versions sont programmées pour la même clôture, la dernière programmée l'emporte ;
une version dont le contenu ne respecte plus le schéma est refusée, comme une version qui change l'horloge du monde : durée du tick, heure ou fuseau de clôture (`CONFIG_CLOCK_CHANGED`, refusée aussi à la publication : 3) ;
un fuseau inconnu de la base n'ajoute aucun refus : différent de celui en vigueur, il change l'horloge, et celui en vigueur n'est jamais refusé comme inconnu, si bien qu'aucune commande ne produit `CONFIG_TIMEZONE_UNKNOWN`, que seule rencontre la configuration initiale, au démarrage sur une base vide : 3 ;
une version qui retire une recette qu'un site exploite encore ne l'est pas, ce site étant alors à l'arrêt faute de recette jusqu'à ce que sa maison en change : 4.2 ;
elle demande en revanche une confirmation explicite, comme une version qui retire une classe de PNJ qui a encore un état de population, si la version en vigueur connaît encore cette recette ou cette classe (`CONFIG_RETIRED_UNCONFIRMED` sans elle : 15.2) ;
une version qui retire un bien qu'une maison détient encore en stock, ou qu'un ordre ouvert porte, est refusée (`CONFIG_GOOD_IN_USE`, chaque bien nommé : 5.1)).
Une troisième, `admin.cancelActivation`, annule une programmation à venir, désignée par l'identifiant d'une activation : elle annule toutes les programmations encore en attente pour la même clôture, si bien que la version en vigueur le reste à cette clôture (annuler la seule dernière programmée aurait remis en jeu, sans le dire, une programmation antérieure).
Le journal des activations reste en ajout seul : chaque annulation est une ligne de plus, que la lecture de la version en vigueur prend en compte ;
les versions restent enregistrées et se reprogramment. Une programmation ne s'annule plus à moins d'une minute de son échéance, ni après (`CONFIG_ACTIVATION_PAST`) ;
de même, la base refuse de programmer à moins d'une minute de l'échéance (`CONFIG_ACTIVATION_TOO_LATE` : on réessaie après la clôture).
Ces marges sont tenues par la base à l'inscription, et la base contrôle de nouveau l'échéance à la validation (déclencheurs différés) : une annulation ou une programmation validée après l'échéance est refusée avec la même erreur métier, et rien n'est écrit.
Chaque instruction des deux commandes est en plus bornée à dix secondes (une instruction plus longue fait échouer la commande, sans rien écrire).
Passé l'échéance, on programme un retour arrière. Une activation immédiate (sans échéance) n'est pas une programmation : elle sert à la configuration initiale, n'est pas visée par la marge, et la base la refuse si sa transaction est validée plus de cinq secondes après son début.
Une programmation déjà annulée ne s'annule pas une seconde fois (`CONFIG_ACTIVATION_CANCELLED`).
La lecture des paramètres rend les programmations annulées, marquées comme telles ;
l'écran ne signale comme programmée qu'une version dont une programmation tient toujours.
Tout éditeur de configuration peut annuler, l'auteur de la version compris : retirer une programmation ne demande pas de seconde personne.
Une version programmée par un autre compte que son auteur reste tenue pour revue même si cette programmation a été annulée : la revue porte sur le contenu, l'annulation sur le moment.
Le journal ne garde d'une commande d'administration refusée que la taille et l'empreinte de son entrée.
Elles sont ouvertes au super-administrateur et au concepteur de jeu.
La revue par une seconde personne (15.2, étape 3) est imposée à la programmation : l'auteur d'une version ne peut pas la programmer lui-même (`CONFIG_REVIEW_REQUIRED`), un autre compte autorisé doit le faire.
Une version déjà programmée une fois par un autre compte que son auteur est tenue pour revue : son auteur peut alors la reprogrammer, pour un retour arrière en un clic.
Une version sans auteur (la configuration initiale) se programme sans revue.
Pour un monde de test tenu par une seule personne, la variable d'environnement de l'API `OLYMPE_ALLOW_SELF_REVIEW=true` lève cette règle ;
elle est désactivée par défaut, l'API le signale à son démarrage, et une programmation faite sous ce réglage ne vaut pas revue ;
la Vigie dit si la double validation est exigée ou levée, pour que le réglage ne reste pas actif par oubli ;
si l'API ne l'indique pas (version antérieure à ce champ), elle affiche un état inconnu plutôt que « Exigée ».
Cette règle est tenue par l'API, pas par la base : le compte de service de l'API peut écrire une activation, comme toute écriture du jeu.
Le premier super-administrateur est inscrit en base par un humain.
Les rôles suivants s'accordent et se retirent par `admin.grantRole` et `admin.revokeRole`, ouvertes au seul super-administrateur : le compte est désigné par son identifiant, accorder un rôle à un compte qui en porte déjà un le remplace, nul ne s'accorde un autre rôle que le sien (un super-administrateur peut en revanche se retirer lui-même s'il en reste un autre), et il reste toujours au moins un super-administrateur (le dernier ne peut ni être retiré ni se retirer ;
quand deux retraits se croisent, la base n'en laisse passer qu'un).
Un rôle retiré cesse d'agir dès la requête suivante. Accorder à un compte le rôle qu'il porte déjà est refusé (`ROLE_UNCHANGED`), retirer le rôle d'un compte qui n'en a pas aussi (`ROLE_NOT_FOUND`) : le journal ne garde que des changements réels.
L'API n'écrit pas la table des rôles elle-même : elle passe par une fonction de la base qui porte ces règles et vérifie que l'auteur désigné est super-administrateur.
Cette fonction ne sait pas qui l'appelle : c'est l'API qui établit l'identité de l'auteur (jeton vérifié, second facteur, rôle relu) avant de la lui transmettre ;
le compte de service de l'API est donc de confiance pour cette identité, comme pour toutes les écritures du jeu.
Les lectures du back-office passent par des routes `GET /api/admin/*` de l'API, soumises au même contrôle (second facteur et rôle relu à chaque requête) : Vigie, économie (masse monétaire, robinets et puits : 5.5) et paramètres pour le super-administrateur, le concepteur de jeu et l'observateur ;
journal d'audit pour le super-administrateur et l'observateur.
Le calendrier des événements du monde (`GET /api/admin/events`) se lit par la même voie, pour le super-administrateur, le concepteur de jeu, le responsable communauté et l'observateur, et chacune de ses lectures est tracée comme les autres, sous sa route, refusée ou non.
La file de la modération (`GET /api/admin/reports`, #276) se lit par la même voie, pour les rôles de la modération, et ses lectures sont tracées de même.
Elle rend une entrée par message qui a des signalements ouverts, la plus ancienne d'abord, puis la plus signalée (au plus 200), avec la maison signalée et son compte, le message, même masqué, ses signalements (motif et date, jamais la maison qui signale) et les cinq messages qui le précèdent et les cinq qui le suivent dans son canal ;
un signalement dont la purge a emporté le message fait son entrée seul, sans texte ni contexte.
Elle rend aussi les appels à trancher et les exclusions à valider, les plus anciens d'abord.
La base la compose par une fonction accordée au seul service de l'API (`admin.moderation_queue`) : un modérateur connecté au jeu n'en lit rien par Supabase, et son rôle ne lui ouvre aucune lecture de plus qu'à un joueur.
Décision (ambiguïté de 15.1) : le pré-tri par l'IA attend une phase suivante.
Le journal d'audit rend le résultat de chaque commande d'administration, jamais son entrée.
Il est trié par ordre d'inscription ; l'heure affichée est celle du début de la commande, si bien que deux commandes simultanées peuvent y apparaître dans l'ordre inverse de leurs heures.
L'application `apps/admin` ne parle qu'à Supabase Auth (lien magique, puis second facteur TOTP : enrôlement d'une application d'authentification à la première connexion, code à chaque session) et à ces routes ;
elle n'affiche aucun module avant que l'API ait confirmé le rôle du compte.
Le module Économie (5.5) montre, pour chaque monde, l'indice des prix des deux fenêtres, l'inflation et sa situation par rapport à la cible, la masse monétaire par nature de compte, puis le net de chaque robinet et de chaque puits depuis l'origine et par jour de jeu (une fiche par jour, du plus récent au plus ancien) ;
hors de la cible, une alerte écrite dit l'inflation, le sens de l'écart et la cible ;
une mesure inconnue est dite telle, avec chaque bien du panier sans échange et la fenêtre en cause, ou l'absence de panier ;
une fenêtre partielle est signalée à côté de l'indice et dans l'alerte ;
avec plusieurs mondes, ceux qui sont hors de la cible sont rappelés en tête de page, avec un lien vers chacun ;
un net négatif est affiché avec son signe. Un « Actualiser » en échec laisse les chiffres précédents à l'écran et dit qu'ils sont anciens.
L'écran se lit à 360 px, même avec une clé de compte inconnue et longue.
Le module Paramètres liste les versions de configuration, signale celle en vigueur et les programmations à venir, dit sous chaque version les biens qu'elle retire et que le monde porte encore (par bien, tous mondes confondus : nombre de maisons, unités en stock, ordres ouverts, oboles sous séquestre ;
l'avertissement est lu avec le bouton de programmation, que l'API refusera), puis les recettes et les classes de PNJ qu'elle retire et que le monde porte encore, dont la programmation se confirme par une case à cocher, et une seule fois, en tête de la liste, sans case, celles que la version en vigueur a déjà retirées (15.2), ouvre une version sous forme de texte JSON, affiche ses différences avec la version en vigueur (listes comparées par identifiant), enregistre le texte modifié comme nouvelle version, programme une version à la prochaine clôture et annule, après confirmation, une programmation à venir (l'écran prévient que toutes celles de la même clôture le seront) ;
l'observateur consulte et compare sans pouvoir modifier. Une action renvoyée après une panne réutilise sa clé d'idempotence : elle n'est pas exécutée deux fois.

Rachat du stock d'un bien à retirer (5.1, décision de #229).
`admin.buyBackGood`, ouverte au seul super-administrateur, prend le bien et les totaux qu'Olympe a montrés (maisons, unités, ordres à annuler, oboles), et refuse sans rien faire si l'état du monde n'est plus celui-là (`BUYBACK_CHANGED`), ou si la configuration en vigueur ne connaît pas le bien (`GOOD_NOT_FOUND`).
C'est un crédit de monnaie sans double validation par un second compte, par décision de #229, et une exception à la règle ci-dessus : il ne paie qu'au prix de référence en vigueur et contre le stock retiré, la commande est réservée au super-administrateur, et le journal d'audit en garde le résultat, qui nomme chaque maison (monde, unités, oboles, ordres annulés, séquestre rendu).
`GET /api/admin/config/versions` rend les totaux de chaque rachat possible (`buybacks` : bien, prix de référence en vigueur, totaux), que la commande recompte avec les mêmes règles.
Sans configuration en vigueur lisible, ou si unités × prix dépasse les entiers sûrs, la liste est vide plutôt qu'en erreur : la commande n'en ferait aucun.
Un rachat prend d'abord le verrou d'agora de chaque monde concerné, comme un ordre : deux rachats simultanés du même bien n'en laissent passer qu'un, l'autre trouvant l'état changé.
Rejouer la commande sous la même clé rend la même réponse, sans rien racheter de plus.
Dans le module Paramètres, le bouton de rachat et sa confirmation suivent 15.2 ; une action renvoyée après une panne y réutilise sa clé, comme les autres.

Saisie dans le module Paramètres. Ouvrir une version porte le foyer sur le titre de son contenu.
Tant que le texte ouvert a été modifié sans être enregistré comme nouvelle version, ouvrir une version (la même comprise) demande confirmation avant de le remplacer : la confirmation nomme les deux versions et pose le foyer sur « Garder le texte modifié », le bouton d'ouverture reste affiché, et y renoncer lui rend le foyer.
Dans la liste des versions, la répétition d'une touche Entrée tenue n'ouvre, ne confirme ni n'annule rien ;
le second clic d'un double clic n'agit pas et ne prend pas le foyer, ni un clic au pointeur dans la demi-seconde qui suit la disparition d'une confirmation (les fiches suivantes remontent alors, et un bouton qui programme peut venir sous le pointeur) ;
un clic né du clavier n'est pas concerné. Un texte enregistré comme nouvelle version n'est plus une saisie à perdre ;
si l'issue de l'enregistrement est inconnue (panne), il le reste.
Une frappe dans le texte pendant qu'une version se charge l'emporte : la réponse de cette ouverture est ignorée.
La note de version n'a pas cette protection : elle est vidée à chaque ouverture, sans avertissement.
Le texte n'est contrôlé (objet JSON valide) qu'à la sortie du champ et à l'envoi, jamais à la frappe : le message est annoncé une fois, par la seule zone attachée au champ (la zone des résultats ne le redit pas), il s'efface dès que le texte redevient valide et ne revient qu'au contrôle suivant ;
un envoi refusé pour cette raison rend le foyer au champ, où la répétition de la touche Entrée restée enfoncée n'écrit rien.

Formulaire des biens. Sous le texte JSON, les biens de la version ouverte s'éditent aussi par un formulaire, replié à l'ouverture de l'écran (un bouton « Biens » le déplie : ses champs, quatre par bien, ne s'intercalent pas au clavier entre le texte et l'enregistrement) : un groupe par bien, nommé par son identifiant (sinon par son rang, « élément 2 »), et un champ par valeur du schéma (identifiant, niveau, prix de référence, élasticité), sous les libellés qui désignent les erreurs de schéma (15.2).
Le formulaire n'a pas d'état propre : il montre les biens du texte, et chaque saisie réécrit le texte entier, indenté de deux espaces, sans rien changer d'autre que la valeur saisie (les autres tables, les autres biens et les clés que le formulaire ne connaît pas sont gardés).
Une saisie dans le formulaire est donc une saisie dans le texte : même avertissement avant de la remplacer, même priorité sur une ouverture en cours, même comparaison avec la version en vigueur.
Le formulaire ne contrôle rien, l'API fait foi : il compose une valeur JSON et ne devine jamais.
Le prix, en oboles, n'écrit un nombre que pour une saisie faite de chiffres seuls, sans zéro en tête (signe moins admis, l'API le refusera) : « 1.000 », « 1,000 », « 1 200 », « 1e3 », « 5. », « 007 » et « 1.5 » sont écrits comme des textes, aucun ne devient 1, 1 000, 5 ou 7.
L'élasticité écrit un nombre pour une écriture décimale, virgule ou point, exposant admis.
Toute autre saisie, un entier au-delà de 2^53 compris, est écrite comme un texte, que l'API refuse en nommant le champ.
Un champ vidé retire sa clé. Pendant la frappe, le champ garde ce qui est tapé ;
à sa sortie, il montre la valeur du texte, et une valeur d'un autre type que celui du champ y est montrée en JSON (`"12"`, `null`), pour qu'un texte ne passe pas pour un nombre.
Un niveau absent de la liste reste affiché et n'est remplacé que par un choix.
Les niveaux proposés sont ceux du schéma : un test les compare, comme les champs.
Quand le texte n'est pas un objet JSON dont `goods` est une liste d'objets, le formulaire le dit et ne montre aucun champ ;
il revient dès que le texte est lisible. Un bouton « Ajouter un bien » écrit en fin de liste un bien vide, sans aucune valeur (le formulaire n'invente aucun paramètre : l'API refuse ce bien, champ par champ, tant qu'il n'est pas rempli), et pose le foyer sur son identifiant.
Chaque bien a un bouton « Retirer », nommé par le bien comme son groupe (« Retirer wheat », « Retirer élément 2 ») : il retire ce bien du texte, sans confirmation puisque rien n'est enregistré, et l'annonce (« wheat retiré du texte, pas encore enregistré », tant que le texte reste celui que le retrait a écrit) ;
la comparaison avec la version en vigueur montre le bien retiré.
Le foyer va ensuite à l'identifiant du bien suivant, sinon du précédent, sinon au bouton d'ajout : jamais sur un autre bouton « Retirer », si bien qu'une touche Entrée tenue ne retire qu'un bien ;
sur le bouton d'ajout, où le foyer arrive après le retrait du seul bien, la répétition de la touche n'ajoute rien.
Deux retraits de suite au même nom sont annoncés deux fois. Après un ajout ou un retrait au pointeur, le second clic d'un double clic, ou un toucher dans la demi-seconde, n'agit pas : les biens viennent de bouger sous le pointeur.
À la souris, seul le compte de clics compte : un clic simple voulu, même aussitôt après, agit.
Ajouter ou retirer réécrit le texte comme une saisie (mêmes avertissement, priorité et comparaison).
Retirer un bien encore désigné par une recette, un panier de classe ou le panier de l'indice des prix, ou retirer le dernier, est refusé à l'enregistrement par le schéma, qui nomme chaque référence ;
les stocks et les ordres déjà en base pour ce bien ne sont pas contrôlés à l'enregistrement, mais à la programmation (15.4, 5.1).
L'observateur voit le formulaire en lecture seule, sans bouton d'ajout ni de retrait.

Formulaire des recettes. Sous celui des biens, replié de même (bouton « Recettes »), les recettes de la version ouverte s'éditent selon les mêmes principes : pas d'état propre, chaque saisie réécrit le texte entier et suit le chemin d'une frappe, rien n'est contrôlé ni deviné, l'API fait foi, l'observateur lit sans modifier.
Un groupe par recette, nommé par son identifiant (sinon par son rang), porte un champ par valeur du schéma hors listes : identifiant, type de site (les types du schéma, qu'un test compare, un type inconnu restant affiché), durée en minutes, personnel et cycles accumulés au plus.
Ces trois entiers suivent la règle d'écriture du prix : un nombre pour des chiffres seuls sans zéro en tête, un texte sinon.
Dans chaque recette, un groupe « intrants » et un groupe « extrants » montrent une ligne par élément, nommée par son bien (sinon par son rang), avec le bien et la quantité (entier, même règle) ;
une liste absente ou vide est dite telle. Le bien est un texte libre : les identifiants des biens du texte sont proposés en suggestions, sans rien imposer, et un bien inconnu est refusé par le schéma à l'enregistrement.
Quand le texte n'est pas un objet dont `recipes` est une liste d'objets, ou qu'une liste d'intrants ou d'extrants présente n'est pas une liste d'objets, le formulaire le dit et ne montre aucun champ.
Les recettes s'ajoutent et se retirent au formulaire comme dans le texte, avec les règles des biens (« Ajouter une recette » écrit un objet vide en fin de liste ;
« Retirer bake » ; même foyer, même annonce dans un nœud neuf, même garde contre Entrée tenue et le double appui ;
aucun bouton pour l'observateur) ; une liste de recettes vide ou absente est dite telle (« Aucune. »).
Chaque formulaire est un groupe nommé par son bouton (« Biens », « Recettes », « Classes de PNJ ») : deux lignes de même nom dans deux formulaires (« élément 2 ») se distinguent par lui.
Retirer une recette que la dotation de départ désigne encore (`starting.siteRecipeId`) est refusé par le schéma ;
les sites déjà en base qui la font tourner ne sont pas contrôlés à l'enregistrement.
Les intrants et les extrants s'ajoutent et se retirent de même, au formulaire comme dans le texte : « Ajouter une ligne (intrants de bake) » écrit un objet vide en fin de liste, et crée la liste, en dernière clé de la recette, si elle manquait ;
« Retirer wheat (intrants de bake) » retire la ligne et l'annonce.
Le foyer va au bien de la nouvelle ligne ; après un retrait, à celui de la ligne suivante, sinon de la précédente, sinon au bouton d'ajout de la liste, avec la même garde contre Entrée tenue et le double appui.
Retirer le seul extrant laisse une liste vide, que le schéma refuse à l'enregistrement.

Formulaire des classes. Sous celui des recettes, replié de même (bouton « Classes de PNJ »), les classes de PNJ de la version ouverte s'éditent selon les mêmes principes.
Un groupe par classe, nommé par son identifiant (sinon par son rang), porte l'identifiant, la sensibilité à la qualité (décimale, écrite comme l'élasticité) et le revenu pour 1 000 habitants (entier, écrit comme le prix).
Le groupe « panier » montre une ligne par élément, nommée par son bien (sinon par son rang), avec le bien (texte libre, les biens du texte proposés en suggestions), le besoin (les niveaux du schéma, qu'un test compare ;
un niveau inconnu reste affiché) et la quantité pour 1 000 habitants (décimale) ;
un panier absent ou vide est dit tel, et le schéma le refuse à l'enregistrement.
Quand le texte n'est pas un objet dont `npcClasses` est une liste d'objets, ou qu'un panier présent n'est pas une liste d'objets, le formulaire le dit et ne montre aucun champ.
Les classes s'ajoutent et se retirent au formulaire comme dans le texte, avec les mêmes règles que les recettes (« Ajouter une classe », « Retirer plebs », « Aucune. » pour une liste vide).
Une classe ajoutée ou retirée doit l'être aussi dans la population de chaque cité, sinon le schéma refuse l'enregistrement en nommant chaque cité.
Les lignes de panier s'ajoutent et se retirent comme les intrants (« Ajouter une ligne (panier de plebs) », « Retirer bread (panier de plebs) ») ;
un panier vidé est refusé par le schéma à l'enregistrement.

## 15.5 Indicateurs d'alerte par défaut

| Indicateur | Seuil d'alerte |
| --- | --- |
| Inflation sur 7 jours | Hors de la plage -1 % à +2 % |
| Part de marché d'une maison sur un bien vital | Plus de 50 % dans une cité |
| Tick économique | Plus de 10 s |
| Signalements en attente | Plus de `moderation.staleReportHours` heures (24 par défaut) |
| Coût IA du jour | Plus de 150 % de la moyenne sur 7 jours |
| Sauvegarde | Dernière archive de plus de 15 min |

## 15.6 Procédures d'exploitation

- [Accès à Olympe](../exploitation/acces-olympe.md) : premier super-administrateur et enrôlement du second facteur, accès accordé à une autre personne, appareil perdu (dernier super-administrateur compris), retrait d'accès. Les étapes en base y sont faites par un humain ; celles qui touchent au schéma de Supabase Auth ne sont couvertes par aucun test du dépôt et sont à répéter en préproduction.
