# 1. Vision et piliers

OIKOS est un jeu de gestion massivement multijoueur, persistant, jouable sur web et mobile, où chaque joueur dirige une maison (un *oikos*) dans un archipel de cités grecques placées sous le regard des dieux. Le joueur y bâtit un patrimoine, prend part à une économie entièrement tenue par les joueurs, fait de la politique dans sa cité et négocie la faveur de l'Olympe.

**Nom de travail :** OIKOS (« la maison, le domaine, les affaires » en grec, racine du mot *économie*). **Promesse :** « Fais de ta maison une légende que les dieux eux-mêmes jalousent. »

## Positionnement

Les jeux de référence posent la base : immobilier, entreprises, bourse, mairie et vie de ville dans un navigateur ([Empire Immo](https://elmut.itch.io/empire-immo), Citopie, Areapolis). Leur limite commune est un monde générique, des systèmes peu reliés entre eux et un contenu figé. OIKOS garde leur ADN communautaire et ajoute trois choses.

| Axe | Jeux de référence | OIKOS |
| --- | --- | --- |
| Imaginaire | Monde contemporain générique | Grèce mythologique cohérente : chaque mécanique porte un nom et une logique d'époque |
| Profondeur | Systèmes juxtaposés | Une seule économie : production, logistique, finance, politique et religion agissent sur les mêmes prix |
| Façons de jouer | Une voie dominante (accumuler) | Six voies de réussite, toutes viables, et des rôles communautaires distincts |
| Contenu | Écrit à la main, figé | Monde animé par IA : PNJ qui négocient, oracle, chronique quotidienne, événements adaptés à l'état du monde |
| Équilibrage | Manuel, opaque | Tout paramètre est une donnée versionnée, testée en simulation avant mise en ligne |

## Piliers de conception

1. **Une économie réelle.** Chaque bien est produit, transporté et vendu par quelqu'un. Les PNJ ne servent qu'à ancrer la demande finale.
2. **Plusieurs manières de gagner.** Terre, artisanat, négoce, finance, politique, sacré : aucune voie n'écrase les autres.
3. **La cité avant l'individu.** On réussit mieux à plusieurs. Les institutions sont tenues par des joueurs élus ou tirés au sort.
4. **Un monde qui répond.** L'IA donne une voix au monde, mais ne décide jamais d'un chiffre : le moteur reste déterministe et auditable.
5. **Le respect du temps.** Une session utile dure 5 minutes sur mobile ; la profondeur se déploie sur ordinateur. Aucun avantage de puissance ne s'achète.
6. **Tout est réglable.** Pas une constante en dur dans le code : le back-office pilote l'équilibrage.

## Cible

Joueurs francophones de 18 à 45 ans amateurs de jeux de gestion par navigateur, puis public anglophone. Objectif de dimensionnement : 5 000 joueurs actifs par jour sur un seul serveur avant tout découpage.
