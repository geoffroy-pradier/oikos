# 10. Expérience et interface

L'interface est conçue d'abord pour le téléphone, puis densifiée pour l'ordinateur : même application web responsive, deux mises en page. La règle est qu'une action courante se fait en trois touches au plus.

## Navigation

| Onglet | Contenu |
| --- | --- |
| Maison | Tableau de bord, sites, personnel, comptes, famille |
| Carte | Archipel, cité, parcelles, routes et navires en mer |
| Agora | Carnets d'ordres, contrats, enchères, fret, travail |
| Cité | Assemblée, magistrats, trésor, temples, chronique |
| Messages | Canaux, messagerie, notifications, mentor |

Sur téléphone, barre d'onglets en bas et écrans en fiches empilées. Sur ordinateur, barre latérale, panneaux multiples redimensionnables et tableaux denses triables, parce que les joueurs de gestion veulent voir leurs chiffres.

## Écrans clés à maquetter en premier

1. Tableau de bord de la maison : trésorerie, alertes, production en cours, tâches du jour.
   Première version des alertes (#259) : travailleurs sans logement dans les cités où une nuit d'hébergement coûte, bien à rénover (état sous le seuil où il ne loge plus personne) ou dont l'entretien est impayé, bail résilié pour loyer impayé à la dernière clôture du monde de la maison, chacune avec un lien vers l'écran Personnel ou Immobilier.
   Rien à signaler : la carte se tait.
   Le tableau de bord ouvre aussi l'écran Personnel (`/personnel`) : les travailleurs des sites de la maison, cité par cité, logés par ses biens ou hébergés chez les habitants, et le coût d'un jour de cet hébergement au prix du jour de la cité.
   Il ouvre l'écran Immobilier (`/immobilier`) : les biens que la cité vend encore et les offres des maisons de son monde, les biens de la maison (état, entretien, entretien impayé) et ses baux.
   Chaque commande de l'immobilier (achat, location, rénovation, mise en vente ou en location, retrait d'une offre, fin de bail) part au prix affiché ; restée sans réponse, elle repart sous la même clé au même prix.
   Ces clés sont gardées en stockage de session, comme celles des sites et des navires : elles survivent au changement d'onglet et au rechargement.
   Après chaque relecture, l'écran rend les clés des commandes qu'il ne propose plus, parce que leur effet est lu ou qu'elles ne peuvent plus être demandées : la même demande, proposée de nouveau plus tard, part sous une clé neuve.
   Le prix de vente et le loyer par jour ont chacun leur saisie et leur libellé.
   Sous le prix de vente, l'écran annonce le net du vendeur après la taxe de marché de la cité du bien (vue `city_rates`, même calcul et même arrondi que l'API), comme l'agora ; tant que ce taux n'est pas lu, ou s'il est nul, il n'annonce rien.
   Ce net est calculé au taux en vigueur à l'affichage, et le texte le dit : un décret peut changer le taux avant la vente.
2. Fiche de site : recette, personnel, stocks, marge unitaire.
   Première version du personnel (#259) : travailleurs requis, logés ou non, salaire du jour de la cité et coût d'un jour (entretien, salaires et hébergement), qui est aussi le prix d'une relance.
   Un champ ou un verger dit la sécheresse ou la bonne année en cours dans sa cité (#417, vue `world_events`), avec sa fin et son ampleur.
   Sa récolte est estimée comme l'API la calculera (`cycleYield`, 4.3 et 7.4), à l'heure du serveur, sous les événements qui finissent après le début de son cycle en cours, et l'écart dû à l'événement est dit.
   L'arrondi se fait cycle par cycle, à l'unité inférieure : la baisse réelle peut dépasser le pourcentage annoncé ; deux événements d'un même modèle ne s'additionnent pas, le plus fort en cours compte.
   Une récolte estimée à zéro par une sécheresse est expliquée : récolter fait quand même avancer les cycles.
   Tant que ces événements ne sont pas lus, la récolte d'un champ ou d'un verger n'est pas estimée ; une lecture en échec est annoncée et se relit.
   Ces événements ne sont lus qu'une fois les sites lus, et seulement s'il y en a.
   Un site à l'arrêt n'annonce pas l'événement en cours : ses cycles sont gelés, sa récolte estimée est celle des cycles faits avant l'arrêt.
   L'issue d'une récolte faite explique l'écart de la quantité rendue par l'API à `cycles` × extrant : réduite à zéro ou de combien par une sécheresse, accrue par une bonne année ; « Tout récolter » nomme les sites touchés.
   Cette explication se déduit de la réponse de la récolte et du type du site, sans dépendre de la lecture des événements.
   Un écart d'un autre signe que celui du modèle (sécheresse en moins, bonne année en plus), par exemple après une version de configuration qui change l'extrant entre l'affichage et la récolte, n'est pas expliqué.
   « Tout récolter » entièrement réduit à zéro le dit « à rien », comme une récolte seule.
   L'onglet Cité montre le marché du travail du jour de la cité (salaire, taux d'emploi, prix de l'hébergement, travailleurs sans logement) et son parc de logements par taille.
   L'onglet Cité montre aussi les événements du monde en cours dans la cité (#417, vue `world_events`) : sécheresse, bonne année et caravane étrangère, chacune avec sa fin et son ampleur en pourcentage (pour une caravane, le bien demandé).
   « En cours » se lit à l'heure du serveur, relue chaque minute et au retour sur l'onglet ; un événement à venir n'est pas lisible (7.3), un événement fini disparaît sans rechargement.
   Seuls sont lus les événements qui finissent après une borne : l'heure du serveur à l'ouverture de l'écran, avancée à l'heure de la relecture qui suit la fin d'un événement lu ; une longue session ne garde pas les événements finis.
3. Carnet d'ordres d'un bien : profondeur, historique de prix, saisie d'ordre.
4. Carte de la cité avec parcelles et quartiers.
   Première version (#254) : l'onglet Carte montre l'archipel en vectoriel, sans parcelles.
   Les cités y sont placées sur une ellipse, dans l'ordre de leurs identifiants de configuration : un schéma stable, qui ne prétend à aucune distance, la durée d'une route venant de la configuration.
   Le dessin montre les routes et leur durée de référence, les navires de la maison à quai près de leur cité et ceux en mer sur leur route, à la part du trajet faite à l'heure du serveur.
   Il est doublé d'une liste au clavier qui porte les mêmes informations : les routes, puis chaque navire et son état (à quai, en mer vers sa destination avec l'arrivée prévue, désarmé).
   Le chantier naval propose chaque classe à son prix, en drachmes et oboles ; l'achat suit l'acquisition d'un site (4.2) : un achat resté sans réponse garde sa clé jusqu'à la relecture qui montre un navire de plus.
   Sans réponse mais un navire de plus à la relecture, la même clé repart une fois pour connaître l'issue ; un navire de plus après une issue inconnue prévient le joueur, rappelé à chaque ouverture de l'écran tant qu'il n'a pas dit avoir vérifié sa flotte.
   La fiche d'un navire liste ses voyages (départ, arrivée prévue ou faite, cargaison) ; un voyage en mer à une lecture et arrivé à la suivante est annoncé, la flotte étant relue chaque minute ou à la demande.
   Le départ se fait depuis la fiche en deux touches : la destination, qui dit la durée pour la classe du navire et le coût, puis « Partir ».
   Pendant une tempête en cours sur la route (#417, vue `world_events`, à l'heure du serveur), la destination dit la durée allongée comme l'API la comptera (`stormDurationSeconds`, la plus forte tempête de la route ; à égalité, la plus ancienne) et celle par temps calme ; la destination choisie dit la tempête, sa fin et son ampleur.
   Tant que les tempêtes ne sont pas lues, la durée annoncée est celle du calme, et l'écran dit qu'elle est provisoire ; une lecture en échec le dit et se relit.
   Après un « Réessayer » réussi, le foyer va au titre de la carte.
   Une durée allongée égale à celle du calme une fois arrondie n'est pas annoncée comme allongée.
   L'arrivée annoncée après le départ est celle que rend l'API.
   La cargaison est facultative, prise dans le stock libre de la cité, et bornée par la cale et par ce stock ; le coût est annoncé avant l'envoi, et « le prix a changé » rend la main à une demande neuve au coût relu.
   La même saisie restée sans réponse repart sous la même clé ; une autre saisie (destination, cargaison ou coût) est une autre demande, sous une clé neuve : si l'essai précédent avait abouti, le navire est en mer et la demande est refusée, sans second départ.
   L'entrepôt de l'onglet Maison montre aussi les cargaisons en mer, sous leur cité d'arrivée.
5. Séance de l'assemblée : décrets en cours, vote, débats.
   Première version (#264), dans l'onglet Cité : la vie politique (statut de la maison relu dans sa ligne de la vue `houses`, archonte en charge, élection en cours avec sa phase, son calendrier et ses candidats, résultats de la dernière élection dépouillée), l'assemblée et le trésor public ; les débats attendent la discussion de la cité (#274).
   Une citoyenne se porte candidate ou se retire pendant le dépôt, et vote pour une candidature pendant le vote ; votée, elle lit seulement qu'elle a voté.
   Elle vote un décret pour ou contre en deux touches (Tab puis Entrée), chaque bouton nommant le décret ; l'archonte en charge propose un décret d'un modèle ouvert, chaque paramètre avec ses bornes annoncées d'après `decree_rules`, et rien ne part hors des bornes.
   Chaque paramètre est jugé par le schéma borné de `@oikos/contracts`, le même que l'API, et le message tombe sous le champ fautif ; les bornes s'affichent au format de la langue (séparateur des milliers).
   Une saisie s'écrit comme les bornes s'affichent (« 30 000 », ou « 30,000 » en anglais) ; une saisie illisible a son propre message, distinct de « Hors des bornes ».
   Sur un champ entier (montant en oboles, durée en jours), une partie décimale d'exactement trois chiffres (« 30,000 » ou « 30.000 » en français) est refusée comme ambiguë, avec son propre message : lue comme des décimales, elle rendrait mille fois plus petit un montant écrit avec des milliers à l'anglaise ou à l'allemande.
   Une autre saisie décimale sur un champ entier (« 300,5 ») dit « Nombre entier attendu », pas « Hors des bornes » ; les champs décimaux (taux, coefficient) ne changent pas.
   Une fête sans bien coché ou avec trop de biens le dit dans une région toujours présente, reliée au groupe de cases ; une proposition réussie remet le formulaire à zéro, biens compris.
   Une lecture en échec ou illisible (charges ou règles) se dit et se relit ; après un « Réessayer » réussi, le foyer va au titre « Proposer un décret ».
   Les décrets adoptés, en vigueur, rejetés ou caducs s'affichent avec leur décompte après le dépouillement.
   Un métèque voit tout, sans bouton, et l'écran dit pourquoi.
   Le trésor public montre le solde, la taxe de marché et le droit de port en vigueur, et les recettes et dépenses par nature des sept derniers jours où le trésor a bougé.
   Ces écrans ne lisent dans la vue `houses` que les maisons qu'ils nomment (archonte en charge, candidats de l'élection en cours, résultats de la dernière élection, auteurs des décrets au vote) et la ligne de la maison du joueur, d'où vient son statut (#441) : la vue rend au plus 1 000 lignes par lecture.
   Ces maisons sont lues par paquets de 100, en 10 lectures au plus (1 000 maisons), la maison du joueur et l'archonte d'abord ; au-delà, une maison s'affiche « Maison inconnue ».
   La date depuis laquelle la maison est métèque ou citoyenne n'est pas encore affichée : il faut d'abord l'exposer dans une vue publique (#420).
   Un retrait de candidature est définitif : l'écran en avertit avant, et ne propose plus de se présenter après.
   Un décret de taux appliqué est dit « en vigueur » seulement s'il est le dernier appliqué de son modèle ; les autres décrets appliqués disent leur date d'application.
   Le résultat de chaque commande s'annonce près de l'action, dans une région vivante présente avant lui ; restée sans réponse, la commande repart sous la même clé au même contenu.
6. Comptes : résultat, bilan, flux, par période.
   Première version : ouvert au clavier depuis le tableau de bord (`/comptes`), l'écran montre le bilan en fiches (trésorerie, séquestre, stocks au prix moyen observé, total calculé à l'affichage ;
   les stocks sans prix observé sont comptés à part, hors du total).
   Les montants s'y écrivent en drachmes et oboles (« 1 drachme 1 obole », 6 oboles pour 1 drachme) : une part nulle est tue, un montant nul s'écrit « 0 obole », le signe porte sur tout le montant.
   Une lecture en échec ou illisible est annoncée et se réessaie, jamais prise pour un bilan nul.
   Sous le bilan, les stocks valorisés : une fiche par stock sur téléphone ;
   à partir de la largeur d'ordinateur, un tableau (bien, quantité, prix moyen observé et sa date, valeur) trié par défaut de la plus forte valeur à la plus faible, dont chaque en-tête est un bouton qui change le tri au clavier (`aria-sort` et flèche sur la colonne triée ;
   chaque changement de tri est annoncé aux lecteurs d'écran). Un stock sans prix observé est dit tel, non valorisé, et reste en fin de liste quel que soit le tri.
   Enfin le compte de résultat (4.1), par journée de jeu ou par saison au choix, borné aux 7, 30 ou 90 dernières périodes : mêmes fiches et même tableau triable, périodes les plus récentes d'abord.
   Une journée de jeu porte la date civile du jour où sa clôture l'ouvre, une saison celles de son premier et de son dernier jour ;
   sans horloge lisible, la période est dite inconnue et ses montants restent affichés.
   Un compte dont les totaux ne tombent pas juste n'est pas affiché : la lecture est annoncée en échec.
   Sous le compte de résultat, les flux de trésorerie (#272, `my_cash_flows`, compte `treasury`) : pour chacun des 7 derniers jours de jeu où la trésorerie a bougé, son net et le détail par nature, chacune libellée.
   Les offrandes et les consultations de la Pythie y sont sous « Offrandes et consultations de la Pythie » (nature `offerings`) ; une nature que le client ne connaît pas encore est dite par son identifiant.
   Décision (le ticket ne dit pas où libeller `offerings`) : ce détail est la seule place de la nature, le compte de résultat la gardant dans « Offrandes et autres mouvements » (4.1).
7. Temple : Charis, grâces, offrandes, oracle.
   Première version (#272) : l'écran du temple (`/cite/temple`) s'ouvre au clavier depuis l'onglet Cité, auquel il appartient.
   Il montre la Charis de la maison envers chaque dieu de la configuration (`temple_rules`, `my_favor` ; nulle sans ligne), et son déclin du jour : ce que la prochaine clôture lui retirera (`charisDecay`, 7.1), ou rien.
   Il montre la Charis de la cité de la maison envers son dieu protecteur (`city_charis`), ou dit que la cité n'en a pas ; une maison métèque lit qu'elle n'y compte pas.
   Une offrande choisit un dieu parmi ceux qui acceptent un don, puis des oboles (s'il prend la monnaie, saisie en oboles) et des biens qu'il accepte, pris dans le stock libre de la maison dans sa cité, hors réservations.
   La Charis qu'elle rapportera est annoncée avant l'envoi (`offeringCharis`, au taux de `temple_rules`) et envoyée telle quelle ; un autre taux en vigueur est refusé, rien n'est offert.
   Une saisie illisible, au-delà du stock libre ou au-delà de la borne des oboles du contrat de la commande est dite et n'envoie rien.
   La même offrande restée sans réponse repart sous la même clé, une autre saisie sous une clé neuve.
   La clé est rendue dès qu'une relecture montre une autre Charis de la maison envers ce dieu que celle lue à la demande : l'offrande a abouti, ou un déclin, une grâce l'a changée ; la même saisie est alors une demande neuve, jamais le rejeu d'une offrande déjà faite.
   Chaque grâce de la configuration dit son effet, son ampleur, la Charis requise et dépensée et sa recharge, puis son état pour la maison (`my_graces`, à l'heure du serveur relue chaque minute) : en attente de l'action qui la consommera, en recharge jusqu'à une date, Charis insuffisante (de combien), ou à invoquer.
   Une grâce à invoquer s'invoque en deux touches au plus, Tab jusqu'à son bouton puis Entrée ; le bouton nomme la Charis dépensée, envoyée telle quelle.
   Restée sans réponse, l'invocation repart sous la même clé et la même Charis dépensée ; une autre Charis dépensée en vigueur est une demande neuve, sous une clé neuve ; la clé est rendue dès que la grâce se lit en attente ou en recharge.
   Décision (le ticket ne dit rien d'une grâce retirée) : une grâce que la configuration ne porte plus reste affichée, sans bouton, tant qu'une invocation de la maison l'attend ou la recharge (ce qui est payé est servi, 7.1).
   La Pythie dit le prix d'une consultation (`temple_rules`, colonne `oracle`) et la Charis qu'elle rapporte à son dieu ; la consultation part au prix vu, et un autre prix en vigueur est refusé, rien n'est payé.
   Une consultation sans oracle est dite payée : la Pythie se tait, aucun événement ne s'annonce.
   Restée sans réponse, la consultation repart sous la même clé et au même prix ; un autre prix en vigueur est une demande neuve, sous une clé neuve.
   La clé est rendue, comme celle d'une offrande, dès qu'une relecture montre une autre Charis de la maison envers le dieu de la Pythie que celle lue à la demande : une consultation suivante n'est jamais le rejeu d'une consultation déjà faite.
   Les oracles consultés (`my_oracles`, les 20 plus récemment consultés) s'affichent dans la langue de l'interface, chacun avec sa date de consultation ; la date de leur événement est dite imprécise, à venir après la consultation.
   Le texte d'un oracle, peut-être réécrit par l'IA (et alors dit tel), s'affiche en texte brut : aucun balisage n'y est interprété (#270).
8. Messages (#274) : le canal de la cité et les conversations privées de la maison, chacun avec ses messages non lus, puis les derniers messages du canal ouvert, nommés et datés ; un message masqué est dit tel.
   Décision (le ticket ne dit pas où se tient la lecture) : les non lus se comptent sur l'appareil, par une marque de lecture de chaque canal en stockage local, l'instant du dernier message lu.
   Un autre appareil, ou un stockage effacé, compte de nouveau comme non lus tous les messages encore conservés ; au-delà des 100 messages les plus récents des autres maisons, un compte est dit « 100 messages non lus ou plus ».
   Le canal ouvert est lu jusqu'à son dernier message tant que l'onglet est visible.
   Chaque canal a sa saisie, envoyée par son bouton, par Ctrl+Entrée ou par Cmd+Entrée.
   Son brouillon survit au changement de canal, d'onglet et au rechargement (stockage de session), à un refus et à une réponse perdue ; il n'est effacé que si le texte envoyé est encore celui de la saisie.
   Sans stockage de session, il est gardé en mémoire : il survit au changement de canal et d'onglet, pas au rechargement.
   La même saisie restée sans réponse repart sous la même clé ; un autre texte est une autre demande, sous une clé neuve.
   Une conversation s'ouvre par le nom d'une maison du monde, sans tenir compte de la casse.
   Un message reçu est annoncé poliment aux lecteurs d'écran, sans déplacer le foyer : son auteur et son texte dans le canal ouvert, le canal où il est arrivé sinon.
   Une annonce qui nomme une maison pas encore lue attend son nom, au plus `chatPollSeconds` secondes, puis la dit « Maison inconnue ».
   Les messages arrivent par Realtime (ADR 0008) ; quand Realtime ne répond pas, l'écran relit toutes les `chatPollSeconds` secondes (15, réglage du client dans `packages/config`) et le dit.
   L'écran relit aussi dès que ses abonnements sont établis, et toutes les `chatSafetyRereadSeconds` secondes (120) en direct, sans le dire.
   Hors de l'onglet Messages, rien n'est encore signalé : le nombre de non lus sur l'onglet viendra avec les notifications.

## Direction artistique

Inspiration de la céramique grecque à figures noires et rouges : aplats terre cuite, noir, ocre et bleu égéen, frises géométriques, icônes au trait. Illustrations fixes en 2D (pas de 3D), carte en vectoriel. Thèmes clair et sombre. Un guide de style unique sert de référence à toutes les images générées pour garder la cohérence.

## Exigences

- Premier affichage en moins de 2,5 s sur réseau mobile 4G ; application installable, consultation hors ligne des dernières données.
- Une nouvelle version du client est proposée par un bandeau (« Mettre à jour » ou « Plus tard ») et ne s'installe qu'à la demande du joueur : rien ne recharge la page pendant une saisie. Un onglet resté ouvert vérifie lui-même qu'une version est parue, à intervalle régulier (`updateCheckMinutes`, réglage du client dans `packages/config`, une heure au départ), tant qu'il est visible et en ligne.
- Notifications push web paramétrables par type (ordre exécuté, navire arrivé, vote ouvert).
- Français et anglais dès la structure du code, aucun texte en dur.
- Montants : partout dans le client, un seul format, en drachmes et oboles (« 1 drachme 1 obole », 6 oboles pour 1 drachme ; une part nulle est omise, un montant nul s'écrit « 0 obole »), comme l'écran Comptes. Seules les saisies de prix restent en oboles, l'unité des commandes, et le disent dans leur libellé ; les prix des carnets et des chandeliers sont des nombres d'oboles, annoncés comme tels.
- Une commande dont un appel lève (relecture ou annonce en échec ; un réseau coupé, lui, rend déjà une erreur) est annoncée comme une erreur et rend l'écran utilisable : les contrôles ne restent jamais en attente.
- Accessibilité : contrastes AA, navigation clavier, tailles de police réglables, aucune information portée par la couleur seule.
  Un graphique est une image décrite, doublée d'un tableau des mêmes valeurs accessible au clavier ;
  sur les chandeliers de l'agora, hausse et baisse se distinguent par la forme (corps vide ou plein).
  Le résultat d'une action paraît près de l'action, dans une région vivante présente avant lui ;
  si le contrôle qui l'a lancée disparaît ou devient inactif, le foyer passe sur ce résultat, sinon il reste sur le contrôle.
- Accueil : 15 minutes guidées qui mènent à une première vente, puis objectifs quotidiens du mentor pendant 7 jours.
