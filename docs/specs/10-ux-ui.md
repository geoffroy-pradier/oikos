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
   Première version des alertes (#259) : travailleurs sans logement, bien à rénover (état sous le seuil où il ne loge plus personne) ou dont l'entretien est impayé, bail résilié pour loyer impayé depuis moins d'un jour, chacune avec un lien vers l'écran Personnel ou Immobilier.
   Rien à signaler : la carte se tait.
   Le tableau de bord ouvre aussi l'écran Personnel (`/personnel`) : les travailleurs des sites de la maison, cité par cité, logés par ses biens ou hébergés chez les habitants, et le coût d'un jour de cet hébergement au prix du jour de la cité.
   Il ouvre l'écran Immobilier (`/immobilier`) : les biens que la cité vend encore et les offres des maisons de son monde, les biens de la maison (état, entretien, entretien impayé) et ses baux.
   Chaque commande de l'immobilier (achat, location, rénovation, mise en vente ou en location, retrait d'une offre, fin de bail) part au prix affiché ; restée sans réponse, elle repart sous la même clé.
2. Fiche de site : recette, personnel, stocks, marge unitaire.
   Première version du personnel (#259) : travailleurs requis, logés ou non, salaire du jour de la cité et coût d'un jour (entretien, salaires et hébergement), qui est aussi le prix d'une relance.
   L'onglet Cité montre le marché du travail du jour de la cité (salaire, taux d'emploi, prix de l'hébergement, travailleurs sans logement) et son parc de logements par taille.
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
   La cargaison est facultative, prise dans le stock libre de la cité, et bornée par la cale et par ce stock ; le coût est annoncé avant l'envoi, et « le prix a changé » rend la main à une demande neuve au coût relu.
   La même saisie restée sans réponse repart sous la même clé ; une autre saisie (destination, cargaison ou coût) est une autre demande, sous une clé neuve : si l'essai précédent avait abouti, le navire est en mer et la demande est refusée, sans second départ.
   L'entrepôt de l'onglet Maison montre aussi les cargaisons en mer, sous leur cité d'arrivée.
5. Séance de l'assemblée : décrets en cours, vote, débats.
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
7. Temple : Charis, grâces, offrandes, oracle.

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
