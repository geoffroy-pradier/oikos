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
2. Fiche de site : recette, personnel, stocks, marge unitaire.
3. Carnet d'ordres d'un bien : profondeur, historique de prix, saisie d'ordre.
4. Carte de la cité avec parcelles et quartiers.
5. Séance de l'assemblée : décrets en cours, vote, débats.
6. Comptes : résultat, bilan, flux, par période.
   Première version : ouvert au clavier depuis le tableau de bord (`/comptes`), l'écran montre le bilan en fiches (trésorerie, séquestre, stocks au prix moyen observé, total calculé à l'affichage ; les stocks sans prix observé sont comptés à part, hors du total). Les montants s'y écrivent en drachmes et oboles (« 1 drachme 1 obole », 6 oboles pour 1 drachme) : une part nulle est tue, un montant nul s'écrit « 0 obole », le signe porte sur tout le montant. Une lecture en échec ou illisible est annoncée et se réessaie, jamais prise pour un bilan nul. Sous le bilan, les stocks valorisés : une fiche par stock sur téléphone ; à partir de la largeur d'ordinateur, un tableau (bien, quantité, prix moyen observé et sa date, valeur) trié par défaut de la plus forte valeur à la plus faible, dont chaque en-tête est un bouton qui change le tri au clavier (`aria-sort` et flèche sur la colonne triée ; chaque changement de tri est annoncé aux lecteurs d'écran). Un stock sans prix observé est dit tel, non valorisé, et reste en fin de liste quel que soit le tri.
7. Temple : Charis, grâces, offrandes, oracle.

## Direction artistique

Inspiration de la céramique grecque à figures noires et rouges : aplats terre cuite, noir, ocre et bleu égéen, frises géométriques, icônes au trait. Illustrations fixes en 2D (pas de 3D), carte en vectoriel. Thèmes clair et sombre. Un guide de style unique sert de référence à toutes les images générées pour garder la cohérence.

## Exigences

- Premier affichage en moins de 2,5 s sur réseau mobile 4G ; application installable, consultation hors ligne des dernières données.
- Une nouvelle version du client est proposée par un bandeau (« Mettre à jour » ou « Plus tard ») et ne s'installe qu'à la demande du joueur : rien ne recharge la page pendant une saisie.
- Notifications push web paramétrables par type (ordre exécuté, navire arrivé, vote ouvert).
- Français et anglais dès la structure du code, aucun texte en dur.
- Accessibilité : contrastes AA, navigation clavier, tailles de police réglables, aucune information portée par la couleur seule. Un graphique est une image décrite, doublée d'un tableau des mêmes valeurs accessible au clavier ; sur les chandeliers de l'agora, hausse et baisse se distinguent par la forme (corps vide ou plein).
- Accueil : 15 minutes guidées qui mènent à une première vente, puis objectifs quotidiens du mentor pendant 7 jours.
