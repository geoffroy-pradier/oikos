# 5. Économie

L'économie est fermée et comptabilisée en partie double : chaque drachme et chaque unité de bien a une origine et une destination tracées. Les joueurs fixent tous les prix ; les PNJ n'interviennent que comme consommateurs finaux et comme prêteur de dernier ressort.

## 5.1 Les biens

Le lancement compte 60 biens en quatre niveaux. Le catalogue est une table de configuration : ajouter un bien ne demande aucun code.

| Niveau | Exemples | Nombre |
| --- | --- | --- |
| Matières | Blé, olives, raisin, bois, argile, cuivre, étain, fer, argent, marbre, laine, lin, poisson, sel, miel | 18 |
| Intermédiaires | Farine, huile, moût, planches, bronze, fer forgé, fil, tissu, cuir, charbon, pigments | 16 |
| Finis | Pain, vin, amphores, céramique peinte, outils, vêtements, parfums, bijoux, meubles, statues, navires | 20 |
| Services | Fret, logement, spectacle, banquet, crédit, escorte | 6 |

## 5.2 La demande finale

Chaque cité a une population de PNJ répartie en quatre classes de revenu, inspirées des classes de Solon. Chaque classe a un panier de besoins (vital, confort, luxe) et une sensibilité au prix et à la qualité. La population croît quand ses besoins sont couverts et émigre sinon : approvisionner sa cité est un enjeu collectif.

La quantité demandée par tick suit une élasticité constante autour d'un prix de référence :

```latex
Q = Q_0 \cdot N \cdot \left(\frac{P}{P_{ref}}\right)^{-\varepsilon} \cdot \left(1 + \beta \cdot \frac{q - 50}{50}\right)
```

Où N est la population de la classe, P le meilleur prix offert, ε l'élasticité du bien (0,3 pour le pain, 1,8 pour les bijoux), q la qualité et β la sensibilité de la classe à la qualité. Tous ces coefficients sont des paramètres du back-office.

Trois précisions rendent cette formule applicable à un carnet d'ordres, et bornent la création de monnaie.

- **Prix par niveau.** Le carnet présente plusieurs prix à la fois. Les PNJ achètent de l'offre la moins chère à la plus chère, chaque unité au prix demandé par son vendeur ; à chaque niveau de prix P, la quantité cumulée achetée ne dépasse jamais Q(P). « Le meilleur prix offert » est le cas d'un carnet à un seul niveau.
- **Budget.** La formule seule ne borne pas la dépense : pour un bien vital (ε inférieur à 1), la recette des vendeurs croît sans limite avec le prix. Chaque classe a donc un revenu par tick, paramètre du back-office, et la dépense des PNJ d'une cité pour un bien ne dépasse jamais le budget que ce revenu lui alloue. C'est le levier « revenu des classes PNJ » de la section 5.5.
- **Unités entières.** La demande est un nombre réel et les biens se comptent en unités : la fraction non servie d'un tick est reportée au tick suivant. La demande non servie faute d'offre, elle, n'est pas reportée.

**Prix de réserve des PNJ.** Les PNJ n'achètent pas un bien au-delà d'un multiple de son prix de référence (paramètre du back-office, 3 au départ). Le budget borne la dépense totale ; le prix de réserve empêche qu'un vendeur seul capte ce budget avec une poignée d'unités à prix démesuré. Le revenu initial de chaque classe vaut 125 % de la dépense de référence de son panier ; un site accumule au plus trois jours de production.

## 5.3 Les marchés

- **Agora** : un carnet d'ordres par cité et par bien (ordres à cours limité, exécution immédiate, historique des prix en chandeliers). Taxe de marché fixée par la cité.
- **Contrats** : livraison à terme entre joueurs, avec quantité, qualité minimale, prix, échéance et pénalité. Le défaut coûte de la Timè.
- **Enchères** : concessions minières, parcelles, biens saisis, charges publiques affermées.
- **Appels d'offres** : la cité achète pour ses grands travaux et ses fêtes.
- **Marché du travail et marché du fret** : mêmes mécaniques de carnet d'ordres.

## 5.4 La finance

- **Banque de joueur** (trapeza) : collecte de dépôts rémunérés, prêts à taux libre avec garantie (parcelle, navire, stock), ratio de réserve minimal imposé. Une ruée sur les dépôts est possible.
- **Prêt maritime** : prêt à taux élevé remboursé seulement si le navire arrive. C'est l'assurance du jeu, et elle est historique.
- **Trésor du temple** : prêteur PNJ au taux directeur, plafonné par la Timè. Levier de politique monétaire des administrateurs.
- **Sociétés** (après le lancement) : une activité peut être apportée à une société dont les parts s'échangent, avec dividendes et prises de contrôle.
- **Défaut** : saisie de la garantie, vente aux enchères, marque de déshonneur temporaire. Pas de faillite définitive : une maison ruinée repart avec un bien insaisissable.

## 5.5 Robinets et puits

La masse monétaire est pilotée. Le tableau de bord économique (section 15) suit chaque ligne en continu.

| Création de drachmes | Destruction de drachmes |
| --- | --- |
| Achats des PNJ aux joueurs | Salaires versés aux travailleurs PNJ |
| Prêts du Trésor du temple | Entretien des bâtiments et navires |
| Récompenses de quêtes et de Jeux | Taxes de marché et droits de port (part détruite) |
| Dotation de départ | Offrandes, fêtes et liturgies |
|  | Intérêts payés au Trésor du temple |
|  | Grands travaux et merveilles |

Règle de conception : l'inflation mensuelle cible est comprise entre 0 % et 3 %. Trois leviers l'ajustent sans patch : taux directeur, coefficient d'entretien, revenu des classes PNJ.

## 5.6 Fiscalité

Chaque cité vote ses taux dans des bornes fixées par le monde : droit de port (défaut 2 %), taxe de marché, impôt sur la fortune levé en cas de crise, taxe de résidence des métèques. Les recettes alimentent le trésor de la cité, dépensé par les magistrats. La concurrence fiscale entre cités est un ressort de jeu assumé.
