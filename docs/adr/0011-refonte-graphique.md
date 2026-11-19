# ADR 0011 — Refonte graphique : interface épurée, deux thèmes, actions en feuilles

Date : 2026-11-19 · Statut : acceptée · Remplace en partie l'ADR 0010

## Contexte

Le propriétaire juge l'interface très loin de ce qu'il attend, le 19 novembre 2026.
Il écarte la direction artistique inspirée de la céramique grecque (terre cuite, ocre, frises) et demande une interface épurée, moderne et dynamique, pour le web et le téléphone, avec un thème clair et un thème sombre.
Il demande des formulaires et des boutons soignés, une expérience sans formulaires tous ouverts ni champs dans tous les sens, des icônes, une vraie carte et des illustrations là où elles aident.
Toutes les illustrations doivent être dessinées par les agents, en SVG, sans aucune image sous licence.
Il a délégué les choix de détail aux agents ; les maquettes de référence sont dans l'artefact « OIKOS — nouvelle interface » (Maison, Carte, Olympe, Maison sur téléphone, Agora sur téléphone).

## Décision

- Le mécanisme de l'ADR 0010 reste : toute valeur visuelle est un jeton de `packages/ui/src/theme.css`, pour chaque thème ; chaque couple texte/fond est vérifié AA par `contrast.test.ts` ; la page `catalogue.html` montre chaque composant dans les deux thèmes.
- Palette : un fond neutre (graphite en sombre, gris très clair en clair), deux plans de surface et un plan d'accent, du texte en trois niveaux, deux bordures.
  Un seul accent, orange, pour l'action principale, l'état actif et les données mises en avant.
  Trois couleurs d'état (succès, alerte, danger) et une couleur d'information, chacune avec un fond atténué.
  Le bleu de la mer n'est employé que par la carte.
- Typographie : Inter seule, auto-hébergée, chiffres tabulaires pour tout montant ou quantité ; Fraunces est retirée.
- Plus aucun ornement : le composant `Frieze` et les frises sont retirés.
- Rayons de 10 à 24 px selon la taille de l'élément, ombres discrètes en clair, bordures plutôt qu'ombres en sombre.
- Coquille : barre latérale à partir de 1 024 px de large, barre d'onglets en bas en dessous ; les sous-sections d'un onglet sont des onglets en pastilles.
  Olympe partage les jetons et la coquille.
- Interaction : une action qui demande plus d'un choix s'ouvre dans une feuille (montée du bas sur téléphone, panneau latéral ou boîte de dialogue sur ordinateur), jamais dans un formulaire ouvert en permanence dans l'écran.
  Une action à plusieurs champs se fait par étapes (`Stepper`), avec validation à la saisie et un récapitulatif chiffré avant la confirmation.
  Les saisies numériques ont des boutons ± et des raccourcis (25 %, 50 %, tout) quand une borne est connue.
- Chiffres clés en cartes (`StatCard`), tableaux denses et triables sur ordinateur, fiches sur téléphone.
- Icônes : lucide-react, au trait, réexportées par `packages/ui/src/icons.ts` ; ce sont des icônes d'interface sous licence ISC, pas des illustrations.
- Illustrations : uniquement des SVG dessinés dans le dépôt par les agents, rangés dans `packages/ui/src/illustrations`, sans image matricielle ni source externe, colorés par les jetons pour suivre le thème.
- Carte : l'archipel est un dessin SVG fait main (côtes, îles, hauts-fonds), déplaçable et zoomable au doigt, à la souris et au clavier, doublé d'une liste accessible des mêmes informations.
- Mouvement : les durées et la courbe de l'ADR 0010 restent ; feuilles et panneaux glissent, rien ne boucle sans raison, tout est coupé sous `prefers-reduced-motion`.

## Conséquences

- Les comportements décrits dans la spécification 10 (clés d'idempotence, régions vivantes, foyer, relectures) ne changent pas : la refonte change la présentation et l'enchaînement des écrans, pas les règles.
  Les tests de bout en bout gardent leurs assertions ; un nom accessible qui change le fait dans la même demande de fusion que l'écran.
- Les écrans sont refaits un par un, chacun dans son ticket ; pendant la transition, un écran ancien s'affiche avec les nouveaux jetons.
- La police de titrage disparaît du premier affichage : une police en moins à charger.
- Les illustrations sont du code relu comme le reste ; aucune question de droits d'auteur ne se pose.
