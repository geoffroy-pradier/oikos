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
Chaque onglet porte une icône au trait ; l'onglet actif est marqué par sa couleur et un trait (#575).
L'onglet Messages porte le nombre de messages non lus de tous les canaux, compté comme dans l'onglet sans rien marquer lu : une pastille chiffrée sur ordinateur, un point sur téléphone, et le compte en clair dans le nom du lien.
Hors de l'onglet Messages, ce compte est relu à chaque changement d'écran, au retour sur l'onglet du navigateur, à intervalle (`chatSafetyRereadSeconds`) et quand un canal est marqué lu.
À partir de 1 024 px, la barre latérale porte la marque, la carte de la maison (blason, nom, cité, statut et trésorerie), les cinq onglets et, en bas, un bouton Réglages.
En dessous, un en-tête compact montre le blason, le nom et la cité de la maison et l'heure de jeu, avec le bouton Réglages réduit à son icône, sous le même nom accessible.
Le bouton Réglages ouvre une feuille : thème (clair, sombre ou celui de l'appareil), langue et déconnexion ; Échap la referme et rend le foyer au bouton.
Le thème de l'appareil n'est pas mémorisé : il suit le réglage du système, même quand celui-ci change en cours de partie.
L'onglet Maison a ses rubriques en pastilles, en tête de la vue d'ensemble et de l'écran Sites (#693) : Vue d'ensemble (le tableau de bord, `/`), Sites (`/sites`), Personnel, Immobilier et Comptes.
Ce sont des liens, un par écran ; celui de l'écran ouvert est plein et marqué comme la page courante, et la gélule défile quand elle est plus large que l'écran.
Quand l'API refuse une session (`UNAUTHENTICATED`, #565), le jeu comme Olympe la renouvellent d'abord : un jeton expiré au réveil d'un appareil, ou sous une horloge en retard, ne déconnecte personne.
Renouvelée, la session reste ouverte et l'écran invite à réessayer dans un instant ; la commande repart sous la même clé, que l'API n'a pas consommée.
Si Supabase Auth ne répond pas, la session reste aussi ouverte, avec son jeton de renouvellement.
Si Supabase Auth refuse le renouvellement (compte effacé depuis la connexion, session révoquée), la session est fermée sur l'appareil et l'application revient à la connexion.
Un seul renouvellement par jeton refusé : si l'API refuse encore le jeton issu d'un renouvellement (compte effacé sans que ses sessions soient fermées, par exemple), la session est fermée sans nouvel essai, et aucune boucle de renouvellements ne s'installe.
L'écran de connexion dit alors pourquoi, en français et en anglais, et donne le foyer au champ de l'adresse, que ce message décrit ; il ne le dit plus après la connexion suivante.
La connexion tient en une carte centrée : sur téléphone la scène d'accueil la surmonte, sur ordinateur elle se tient à son côté.
Un envoi refusé s'affiche sous le champ de l'adresse, qu'il décrit et marque invalide.
Dans un Stepper, Entrée dans un champ de saisie vaut Continuer ; une étape peut garder le joueur sur place (`check`) en expliquant pourquoi, et un refus de l'API qui se corrige à une étape y ramène le joueur (`initialStep`).
La création de maison se fait en quatre étapes : le nom, le blason, la cité d'accueil, puis un récapitulatif confirmé par « Fonder la maison ».
Un nom invalide garde l'étape et se dit sous le champ ; continuer sans cité choisie est refusé de même, aucune cité n'étant choisie d'avance.
Un refus de l'API qui se corrige au nom (nom pris, refusé par la modération, compte réduit au silence) ou à la cité (plus de travailleurs libres) ramène le joueur à cette étape, saisie conservée, le message près du champ.
Tout autre refus reste affiché sur le récapitulatif.
À l'étape de la cité, chaque cité est une carte de choix : sa vignette, son nom, l'emblème de son dieu protecteur, son terroir, son port et son premier site, lus dans la configuration.
Sous 768 px la vignette se place à gauche du texte, au-delà elle le surmonte.
La carte choisie se reconnaît à sa bordure de 2 px, son fond léger et sa coche ; le foyer clavier s'affiche sur la carte.
Le nom accessible de la carte est celui de la cité seule, et sa description reprend en texte dieu, port, terroir et premier site.
Le récapitulatif reprend le nom, le blason, la cité et son dieu protecteur.
Les clés d'idempotence, les régions vivantes et le foyer sont ceux des autres commandes.

## Écrans clés à maquetter en premier

1. Tableau de bord de la maison : trésorerie, alertes, production en cours, tâches du jour.
   Il s'ouvre sur quatre chiffres clés (#693) : la trésorerie, avec sa variation sur les 7 derniers jours de jeu, le séquestre de ses achats et ses ordres ouverts à l'agora ; le résultat d'exploitation du jour de jeu en cours, avec ses ventes et ses charges ; les stocks valorisés du bilan ; les sites en activité (ni à l'arrêt, ni sans production), avec leurs travailleurs et intendants.
   Le solde de fin de chaque jour se retrouve à rebours du solde lu et des flux nets de la trésorerie (`my_cash_flows`) ; sans horloge du monde, aucun jour n'est daté : ni variation, ni résultat du jour, et une valeur non lue s'écrit « — », jamais zéro.
   Première version des alertes (#259) : travailleurs sans logement dans les cités où une nuit d'hébergement coûte, bien à rénover (état sous le seuil où il ne loge plus personne) ou dont l'entretien est impayé, bail résilié pour loyer impayé à la dernière clôture du monde de la maison, chacune avec un lien vers l'écran Personnel ou Immobilier.
   Rien à signaler : la carte se tait.
   Ces alertes forment la carte « À faire aujourd'hui » (#693) : une ligne par alerte, avec son icône, qui est tout entière le lien vers l'écran où y répondre.
   La courbe de la trésorerie montre le solde de fin de chacun des 14 derniers jours de jeu ; c'est une image décrite (premier et dernier solde, plus haut, plus bas), doublée d'un tableau des mêmes soldes et de leur mouvement, ouvert au clavier, le jour le plus récent d'abord.
   Sur ordinateur, la courbe et les tâches se partagent une rangée, la courbe seule quand rien n'est à faire ; sur téléphone, les tâches viennent d'abord, puis la production, puis la courbe.
   La production en cours (#693) range chaque site sur une ligne, en tableau sur ordinateur et en fiche sur téléphone : sa cité, l'avancement de son cycle à l'heure du serveur (ou son plafond atteint, son arrêt), ce qu'une récolte donnerait (« — » tant qu'elle n'est pas estimée), « Récolter » tant que sa production existe, et un lien vers sa fiche dans l'écran Sites.
   « Récolter » reste proposé quand rien n'est prêt : l'API dit pourquoi ; « Tout récolter » ne compte que les sites prêts, et chaque issue s'annonce sous sa ligne.
   L'avertissement d'une acquisition restée sans réponse y est rappelé, avec un lien vers l'écran Sites, tant que le joueur n'a pas dit avoir vérifié la liste.
   Le tableau de bord ouvre aussi l'écran Personnel (`/personnel`) : les travailleurs des sites de la maison, cité par cité, logés par ses biens ou hébergés chez les habitants, et le coût d'un jour de cet hébergement au prix du jour de la cité.
   Refonte (#694) : Personnel, Immobilier et Comptes s'ouvrent sur l'en-tête de page et les rubriques de l'onglet Maison en pastilles.
   Personnel donne ses totaux en cartes (travailleurs, logés par ses biens, hébergés, hébergement d'un jour), puis les cités en tableau triable, en fiches sur téléphone (`DataTable`) ; une cité dont le prix n'est pas encore fixé le dit et reste hors du total, qui le dit aussi.
   Il ouvre l'écran Immobilier (`/immobilier`) : les biens que la cité vend encore et les offres des maisons de son monde, les biens de la maison (état, entretien, entretien impayé) et ses baux.
   Chaque commande de l'immobilier (achat, location, rénovation, mise en vente ou en location, retrait d'une offre, fin de bail) part au prix affiché ; restée sans réponse, elle repart sous la même clé au même prix.
   Ces clés sont gardées en stockage de session, comme celles des sites et des navires : elles survivent au changement d'onglet et au rechargement.
   Après chaque relecture, l'écran rend les clés des commandes qu'il ne propose plus, parce que leur effet est lu ou qu'elles ne peuvent plus être demandées : la même demande, proposée de nouveau plus tard, part sous une clé neuve.
   Le prix de vente et le loyer par jour ont chacun leur saisie et leur libellé.
   Sous le prix de vente, l'écran annonce le net du vendeur après la taxe de marché de la cité du bien (vue `city_rates`, même calcul et même arrondi que l'API), comme l'agora ; tant que ce taux n'est pas lu, ou s'il est nul, il n'annonce rien.
   Ce net est calculé au taux en vigueur à l'affichage, et le texte le dit : un décret peut changer le taux avant la vente.
2. Fiche de site : recette, personnel, stocks, marge unitaire.
   L'écran Sites (`/sites`, #693) porte les fiches des sites de la maison, avec en chiffres clés la trésorerie, le nombre de sites sur la limite du siège, les sites prêts à récolter (« — » tant que l'heure du serveur ou le stock ne sont pas lus) et le coût d'un jour des sites qui tournent (celui de leurs relances, que la clôture prélèvera ; « — » tant qu'un prix manque).
   Chaque fiche porte le pictogramme de sa production, son type et sa cité ; « Détails » du tableau de bord ouvre l'écran sur elle (`/sites#site-…`) et pose le foyer sur son titre.
   « Acquérir un site » ouvre une feuille, par étapes : la production, chacune avec son pictogramme, son type et son prix, puis un récapitulatif chiffré (cycle, intrants, travailleurs, entretien par jour, prix, trésorerie après l'achat).
   Confirmer referme la feuille et envoie le prix vu ; l'issue s'annonce dans la région de l'acquisition, sous son bouton, comme l'avertissement d'une acquisition restée sans réponse, que le récapitulatif rappelle avant un nouvel achat.
   « Changer la production… » ouvre aussi une feuille par étapes : la production, parmi celles que la cité du site admet (Continuer reste inactif sur l'actuelle), puis ce qui change (extrants, intrants, travailleurs, entretien).
   Confirmer referme la feuille, rend le foyer à son bouton et annonce l'issue sur la fiche ; après un refus (récolter d'abord), le choix est gardé pour l'essai suivant.
   « Relancer » (5.5) ouvre une feuille qui détaille le prix d'un jour (entretien, salaires et hébergement, total) ; la relance part au prix vu, et son bouton disparaissant avec l'arrêt, le foyer passe à l'issue annoncée.
   L'intendant d'un site (4.4) se lit sur sa fiche : son état, le nombre de ses règles, ses dernières opérations et ses ordres ouverts.
   L'embauche (salaire d'un jour, postes occupés), la consigne (#280) et les règles s'ouvrent chacune dans sa feuille ; les règles, voie complète du jeu sans IA, gardent leur formulaire, sur lequel leur feuille pose le foyer, et la consigne y mène (IA coupée, refus, « Modifier »).
   Envoyer referme la feuille ; l'issue s'annonce sur la fiche, et une proposition de l'intendant y est signalée jusqu'à ce qu'on l'ouvre.
   La consigne écrite est gardée par la fiche jusqu'à un envoi réussi : un échec la rend à la feuille rouverte.
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
   L'issue d'une récolte qui a consommé une grâce (#477) dit ensuite son surplus bien par bien, tel que la réponse le porte (`grace`), après l'écart dû à l'événement.
   « Tout récolter » le dit site par site, à part du total des extrants, comme l'API le porte à part.
   L'onglet Cité montre le marché du travail du jour de la cité (salaire, taux d'emploi, prix de l'hébergement, travailleurs sans logement) et son parc de logements par taille.
   L'onglet Cité montre aussi les événements du monde en cours dans la cité (#417, vue `world_events`) : sécheresse, bonne année et caravane étrangère, chacune avec sa fin et son ampleur en pourcentage (pour une caravane, le bien demandé).
   « En cours » se lit à l'heure du serveur, relue chaque minute et au retour sur l'onglet ; un événement à venir n'est pas lisible (7.3), un événement fini disparaît sans rechargement.
   Seuls sont lus les événements qui finissent après une borne : l'heure du serveur à l'ouverture de l'écran, avancée à l'heure de la relecture qui suit la fin d'un événement lu ; une longue session ne garde pas les événements finis.
3. Carnet d'ordres d'un bien : profondeur, historique de prix, saisie d'ordre.
   Refonte (#695) : la fiche du bien porte son pictogramme, son stock libre dans la cité, le dernier prix en grand avec sa variation sur 24 heures, le meilleur achat et la meilleure vente du carnet, puis les boutons Vendre et Acheter.
   Les chandeliers, doublés de leur tableau, le carnet par niveau de prix et les ordres de la maison, chacun avec « Annuler », suivent ; sur ordinateur, le bien et le carnet sont à gauche, les chandeliers et les ordres à droite.
   Vendre et Acheter ouvrent une feuille en deux étapes : la quantité et le prix limite, puis le récapitulatif et le dépôt ; le bien et la cité sont ceux de l'écran.
   La quantité a des boutons ± et les raccourcis 25 %, 50 % et tout, bornés par le stock libre du bien dans la cité pour une vente, par ce que la trésorerie paie au prix saisi pour un achat.
   Le stock libre et la trésorerie sont relus à chaque ouverture de la feuille ; tant que cette lecture n'a pas abouti, la feuille ne borne rien et l'API juge seule.
   Une vente au-delà du stock libre ainsi lu est refusée à l'étape de la quantité, sans rien envoyer ; un achat au-delà de la trésorerie reste permis, il s'exécute pour la part payable (5.3).
   Sous le prix, la feuille propose le meilleur niveau du côté opposé qui n'est pas fait des seuls ordres de la maison, et dit ce qui s'y échangerait tout de suite.
   Le récapitulatif donne le brut, la taxe de marché et le net d'une vente (le brut seul tant que la taxe n'est pas lue ou si elle est nulle), le coût au plus et le séquestre d'un achat.
   Un refus est dit dans la feuille, près du dépôt, qui garde le foyer ; un dépôt réussi ferme la feuille, son résultat paraît sous les boutons et y prend le foyer.
   La saisie survit à la fermeture de la feuille : restée sans réponse, la même saisie repart sous la même clé, même après une annulation entre-temps.
4. Carte de la cité avec parcelles et quartiers.
   Première version (#254) : l'onglet Carte montre l'archipel en vectoriel, sans parcelles.
   Refonte (#696) : l'archipel est un dessin fait à la main (`Archipelago`, `packages/ui/src/illustrations`) : mer et quadrillage discret, deux continents, une île par cité et des îlots, hauts-fonds autour des terres, rose des vents.
   Chaque cité est posée sur son île par sa place dans `CITY_MAP_POSITIONS` (`packages/config/src/client.ts`), en millièmes du dessin : une valeur d'affichage, sans rien d'équilibrage, qui ne prétend à aucune distance, la durée d'une route venant de la configuration.
   Décision : ces places sont un réglage du client, non versionné en base, parce que le dessin des îles est lui-même dans le client.
   Une cité sans place (ajoutée par Olympe avant que le client ne dessine son île) est posée par la règle de la première version : sur une ellipse, dans l'ordre des identifiants de configuration de toutes les cités.
   Le dessin montre les routes en pointillés et leur durée de référence (en accent celles où un navire de la maison est en mer), la cité de la maison en accent, le nombre de navires de la maison à quai sous chaque cité, et ceux en mer sur leur route, à la part du trajet faite à l'heure du serveur, voile tournée vers leur destination et nommés quand la place le permet.
   Une échelle en heures de mer en donne l'ordre de grandeur : la longueur médiane d'une heure de route sur le dessin, pour 1, 2, 4 ou 8 heures.
   Les noms gardent leur taille à l'écran ; sur un dessin petit (téléphone), les durées et les navires à quai ne sont dits que par la liste.
   La carte se déplace et se zoome (de ×1 à ×4), bornée au dessin : en glissant à la souris ou au doigt, à la molette, en pinçant, au clavier (un arrêt de tabulation : flèches, + et −, 0) et par trois boutons (zoomer, dézoomer, recentrer).
   Recentrer mène à la cité de la maison, zoomée au moins à ×2 ; un bouton ou une touche y glisse en 200 ms, sans animation sous `prefers-reduced-motion`.
   Un appui ne devient un glisser qu'au-delà de 4 pixels : en deçà, c'est un clic sur sa cible ; un glisser ne choisit rien. Tant que la carte n'est pas zoomée, le doigt y fait défiler la page verticalement, et pincer zoome.
   Une légende distingue les routes de la maison des autres (couleur et épaisseur, et la liste les dit) ; elle est sur la carte, ou sous elle quand la carte est étroite.
   Deux calques en pastilles, dans l'en-tête : Routes (routes et navires) et Terroirs (sous chaque cité, les biens de son terroir, d'après `city_identity` et les recettes de `site_rules`).
   Un panneau donne la cité choisie, celle de la maison d'abord, choisie par sa liste ou d'un clic sur la carte : population (vue `city_population` ; sans ligne, inconnue), taxe de marché en vigueur (`city_rates`), le prix moyen observé des trois biens les plus échangés à son agora (`observed_prices`), dieu protecteur et terroir, et un lien qui ouvre l'agora sur elle (`/agora?cite=`) quand l'agora la propose (cités où la maison a un stock ou un site) ; sinon il ouvre l'agora de la cité de la maison, la nomme, et le panneau dit pourquoi.
   À côté de la carte (dessous sur téléphone), « Vos navires en mer » donne pour chaque voyage en cours sa route, sa cargaison, son arrivée prévue et une barre de la part du trajet faite, écrite en pourcentage.
   Il est doublé d'une liste au clavier qui porte les mêmes informations : les routes, puis chaque navire et son état (à quai, en mer vers sa destination avec l'arrivée prévue, désarmé).
   Le chantier naval propose chaque classe à son prix, en drachmes et oboles ; l'achat suit l'acquisition d'un site (4.2) : un achat resté sans réponse garde sa clé jusqu'à la relecture qui montre un navire de plus.
   Refonte (#696) : « Acheter » ouvre une feuille qui dit le prix, la cale, l'entretien par jour et la cité où le navire naît, et l'achat se confirme au prix vu ; l'issue s'annonce sous le chantier, où va le foyer, la feuille fermée.
   Sans réponse mais un navire de plus à la relecture, la même clé repart une fois pour connaître l'issue ; un navire de plus après une issue inconnue prévient le joueur, rappelé à chaque ouverture de l'écran tant qu'il n'a pas dit avoir vérifié sa flotte.
   La fiche d'un navire liste ses voyages (départ, arrivée prévue ou faite, cargaison) ; un voyage en mer à une lecture et arrivé à la suivante est annoncé, la flotte étant relue chaque minute ou à la demande.
   Refonte (#696) : ces voyages sont un tableau triable sur ordinateur, des fiches sur téléphone (`DataTable`), du plus récent au plus ancien ; l'arrivée dit « Arrivée prévue » ou « Arrivé » avec sa date.
   Le départ se fait depuis la fiche, dans une feuille (ADR 0011), par étapes : la destination, qui dit la durée pour la classe du navire et le coût, la cargaison, puis un récapitulatif (destination, durée, cargaison, tempête, vent et coût vus) et « Partir ».
   Décision (#696) : la refonte remplace les deux touches de la première version par ces étapes, une étape qui ne se valide pas (cargaison au-delà de la cale ou du stock libre) n'ouvrant pas la suivante.
   Un départ fait ferme la feuille et son issue s'annonce sur la fiche, où va le foyer ; un refus ou une réponse perdue se dit dans la feuille, près de « Partir », qui reste ouverte.
   Tant que la requête est en vol, la feuille ne se ferme pas (Fermer inactif, Échap et le voile sans effet) et le dit : son issue y est toujours lue.
   Pendant une tempête en cours sur la route (#417, vue `world_events`, à l'heure du serveur), la destination dit la durée allongée comme l'API la comptera (`stormDurationSeconds`, la plus forte tempête de la route ; à égalité, celle du plus petit identifiant, soit la planification la plus ancienne) et celle par temps calme ; la destination choisie dit la tempête, sa fin et son ampleur.
   Tant que les tempêtes ne sont pas lues, la durée annoncée est celle du calme, et l'écran dit qu'elle est provisoire ; une lecture en échec le dit et se relit.
   Après un « Réessayer » réussi, le foyer va au titre de la carte.
   Une durée allongée égale à celle du calme une fois arrondie n'est pas annoncée comme allongée.
   Un vent favorable en attente de la maison (#477, vue `my_graces`) raccourcit la durée annoncée comme l'API la comptera : le plus ancien en attente, s'il retire au moins une seconde à la durée allongée par la tempête (`graceToConsume`, `fairWindSeconds`).
   La destination dit alors aussi la durée sans le vent ; la destination choisie dit que le départ consommera ce vent, de quel dieu, et ce qu'il retire au trajet.
   Un vent qui ne retire que quelques minutes au plus ne change pas la durée arrondie, mais la destination choisie dit qu'il sera consommé.
   Tant que les grâces ne sont pas lues, la durée annoncée est sans vent, et l'écran dit qu'elle est provisoire ; une lecture en échec le dit et se relit, avec les tempêtes, par un seul « Réessayer ».
   Décision (le ticket ne dit rien de leur relecture) : les grâces se lisent à l'ouverture de l'écran et après chaque départ, pas chaque minute, une grâce en attente n'expirant pas.
   Le départ fait dit ce que le vent a retiré au trajet, d'après la réponse de l'API (`fairWind`).
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
   Le statut s'affiche avec sa date, « Citoyenne à … depuis le … » ou « Métèque à … depuis le … », lus ensemble dans la ligne de la maison de la vue `my_citizenships` (#420), et ce statut prime sur celui de `houses`, boutons compris.
   La date est le jour de jeu du statut, ou, sans horloge en vigueur, le jour local de son instant ; si la vue ne rend pas de ligne pour la maison, le statut s'affiche seul, relu dans `houses`.
   Un retrait de candidature est définitif : l'écran en avertit avant, et ne propose plus de se présenter après.
   Un décret de taux appliqué est dit « en vigueur » seulement s'il est le dernier appliqué de son modèle ; les autres décrets appliqués disent leur date d'application.
   Le résultat de chaque commande s'annonce près de l'action, dans une région vivante présente avant lui ; restée sans réponse, la commande repart sous la même clé au même contenu.
6. Comptes : résultat, bilan, flux, par période.
   Première version : ouvert au clavier depuis le tableau de bord (`/comptes`), l'écran montre le bilan en fiches (trésorerie, séquestre, stocks au prix moyen observé, total calculé à l'affichage ;
   les stocks sans prix observé sont comptés à part, hors du total).
   Refonte (#694) : le bilan est en cartes (`StatCard`), le total mis en avant, et le compte des stocks sans prix observé se dit sous la carte des stocks.
   Les montants s'y écrivent en drachmes et oboles (« 1 drachme 1 obole », 6 oboles pour 1 drachme) : une part nulle est tue, un montant nul s'écrit « 0 obole », le signe porte sur tout le montant.
   Une lecture en échec ou illisible est annoncée et se réessaie, jamais prise pour un bilan nul.
   Sous le bilan, les stocks valorisés : une fiche par stock sur téléphone ;
   à partir de la largeur d'ordinateur, un tableau (bien, quantité, prix moyen observé et sa date, valeur) trié par défaut de la plus forte valeur à la plus faible, dont chaque en-tête est un bouton qui change le tri au clavier (`aria-sort` et flèche sur la colonne triée ;
   chaque changement de tri est annoncé aux lecteurs d'écran). Un stock sans prix observé est dit tel, non valorisé, et reste en fin de liste quel que soit le tri.
   Refonte (#694) : ces fiches et ce tableau sont ceux du composant `DataTable`.
   Enfin le compte de résultat (4.1), par journée de jeu ou par saison au choix, borné aux 7, 30 ou 90 dernières périodes : mêmes fiches et même tableau triable, périodes les plus récentes d'abord.
   Refonte (#694) : ce tableau défile dans sa carte, montants sur une ligne, et ses trois soldes (résultat d'exploitation, hors exploitation, variation de la monnaie) sont en gras.
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
   Sous chaque message visible d'une autre maison, « Signaler » (#275) ouvre au clavier le choix d'un motif, foyer sur ce choix, puis l'envoi ; un message déjà signalé par la maison est dit tel, et ni ses propres messages ni un message masqué ne se signalent.
   Un motif ajouté par Olympe sans traduction s'affiche sous son identifiant.
   Sur tous les écrans de la maison (#275), les sanctions du compte pas encore finies sont annoncées en tête, à l'heure du serveur : effet, motif, début si elles sont à venir, fin, et l'appel, déjà fait ou à faire par « Faire appel ».
   L'annonce se relit quand l'API refuse une commande pour une sanction, et à la fin de la plus proche.
   Un compte qui n'a pas encore fondé de maison ne la voit pas.

## Direction artistique

Décidée le 19 novembre 2026 (ADR 0011), elle remplace la direction inspirée de la céramique grecque.
L'interface est épurée : fond neutre, graphite en thème sombre et gris très clair en thème clair, un seul accent orange pour l'action principale, l'état actif et les données mises en avant.
Aucun ornement : ni frise, ni texture, ni police de titrage ; Inter seule, avec des chiffres tabulaires pour tout montant ou quantité.
Les chiffres clés sont en cartes, les sous-sections d'un onglet en onglets à pastilles, les listes en tableaux denses et triables sur ordinateur et en fiches sur téléphone.
Sur téléphone, un plan inversé (jetons `inverse`, sombre dans les deux thèmes) met en tête la trésorerie du tableau de bord ; les autres chiffres clés y passent en petites cartes, trois par rangée.
Une action qui demande plus d'un choix s'ouvre dans une feuille (montée du bas sur téléphone, panneau latéral ou boîte de dialogue sur ordinateur) ; une action à plusieurs champs se fait par étapes, avec validation à la saisie et un récapitulatif chiffré avant la confirmation.
Aucun formulaire ne reste ouvert en permanence dans un écran.
Chaque onglet, chaque action et chaque état porte une icône au trait (lucide) ; une icône est décorative, un texte porte toujours l'information.
Les illustrations (accueil, écrans vides, biens, dieux, cités) sont des SVG dessinés dans le dépôt, sans image sous licence ni image matricielle, colorés par les jetons pour suivre le thème.
Elles ne se composent que de tracés (`packages/ui/src/illustrations`), décoratives sauf quand l'appelant leur donne un nom, avec un dessin neutre pour un bien, un dieu ou une cité inconnus ; la page `illustrations.html` les montre dans les deux thèmes.
L'icône de l'application est le soleil levant de la scène d'accueil, orange sur graphite ; ses PNG se régénèrent par `apps/web/scripts/render-icons.mjs`.
La carte est un dessin vectoriel fait main de l'archipel, déplaçable et zoomable.
De courtes animations répondent au survol, à l'appui et à l'apparition d'une feuille ; elles sont coupées sous `prefers-reduced-motion`.
Un chargement se montre par des formes qui annoncent le contenu, et une liste vide dit pourquoi, avec une illustration et l'action qui la remplit.
Une lecture en échec et une adresse inconnue prennent la même présentation : une icône ou une illustration, le message, et l'action qui en sort (« Réessayer », « Revenir à la maison »).
Chaque écran s'ouvre sur un en-tête de page commun (`PageHeader`) : titre de 26 px, heure de jeu et prochaine clôture quotidienne en sous-titre atténué, recherche si l'écran en a une, action principale à droite.
L'heure de clôture et le fuseau du monde sont des règles publiques, lues par les joueurs connectés (vue `clock_rules`, pgTAP 690) ; sans horloge en vigueur, sous un fuseau que la base ou le navigateur ne connaît pas, ou si la lecture échoue, l'en-tête ne donne que l'heure.
Les jetons et les composants de `@oikos/ui` font foi ; la page `catalogue.html` les montre dans les deux thèmes.
Les maquettes de référence sont dans l'artefact « OIKOS — nouvelle interface ».

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
