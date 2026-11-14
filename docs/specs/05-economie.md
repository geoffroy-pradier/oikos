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
- **Budget.** La formule seule ne borne pas la dépense : pour un bien vital (ε inférieur à 1), la recette des vendeurs croît sans limite avec le prix. Chaque classe a donc un revenu par tick, paramètre du back-office, et la dépense des PNJ d'une cité pour un bien ne dépasse jamais le budget que ce revenu lui alloue. Le revenu d'une classe est réparti entre les biens de son panier au prorata de leur dépense de référence (Q0 × prix de référence) ; le budget d'un bien est la somme des parts des classes, arrondie à l'obole inférieure. C'est le levier « revenu des classes PNJ » de la section 5.5.
- **Unités entières.** La demande est un nombre réel et les biens se comptent en unités : la fraction non servie d'un tick est reportée au tick suivant. La demande non servie faute d'offre, elle, n'est pas reportée. Le report est toujours inférieur à une unité ; il est celui de la demande au dernier niveau de prix examiné. Un tick sans aucune vente au prix de réserve ou en dessous laisse le report tel quel : sans prix offert, la demande n'a pas de valeur.
- **Cités.** Une cité du monde est rattachée à sa population de configuration par son identifiant court (`slug`). Une cité absente de la configuration n'a pas de demande de PNJ.

**Prix de réserve des PNJ.** Les PNJ n'achètent pas un bien au-delà d'un multiple de son prix de référence (paramètre du back-office, 3 au départ). Le budget borne la dépense totale ; le prix de réserve empêche qu'un vendeur seul capte ce budget avec une poignée d'unités à prix démesuré. Le revenu initial de chaque classe vaut 125 % de la dépense de référence de son panier ; un site accumule au plus trois jours de production.

## 5.3 Les marchés

- **Agora** : un carnet d'ordres par cité et par bien (ordres à cours limité, exécution immédiate, historique des prix en chandeliers). Taxe de marché fixée par la cité.
  Dans la première version : un ordre s'exécute à son arrivée contre le côté opposé du carnet, du mieux placé au moins bien placé (la vente la moins chère pour un achat, l'achat le plus offrant pour une vente), puis par ancienneté à prix égal ; chaque échange se fait au prix de l'ordre qui attendait. Le reste attend dans le carnet. Un ordre de vente réserve le stock qu'il propose (ce stock ne peut plus sortir par un autre chemin tant que l'ordre est ouvert). Un ordre d'achat qui attend met son prix sous séquestre : prix limite × reste quitte la trésorerie de la maison pour son compte de séquestre, qui paie le vendeur à chaque exécution ; la base garantit que ce compte retient exactement la somme des restes à payer des achats ouverts de la maison. Un achat ne dépense jamais plus que la trésorerie : il s'exécute pour la part qu'elle peut payer, de la vente la moins chère à la plus chère ; son reste n'attend que si la trésorerie peut en retenir le prix en entier, sinon il est annulé et l'achat le signale. Il n'est refusé que si rien n'est possible : pas une unité payable, ni de quoi retenir le prix d'un ordre en attente. Un ordre ouvert s'annule par sa maison : ce qui a déjà été servi reste acquis, le reste quitte le carnet, le stock qu'une vente réservait est libéré et la monnaie qu'un achat retenait revient à la trésorerie. Une maison n'échange pas avec elle-même : son ordre ignore ses propres ordres du côté opposé, même mieux placés, et peut donc attendre à côté d'eux à un prix qui les croise. Les autres joueurs ne voient du carnet que la quantité par côté et par niveau de prix, jamais l'identité des maisons.
  Taxe de marché : chaque échange, entre joueurs comme avec les PNJ, prélève sur le vendeur une taxe proportionnelle à son montant brut (prix × quantité), dans la même écriture que le paiement ; l'acheteur paie le brut, le vendeur reçoit le net. Deux paramètres du back-office, en points de base (1 pour 10 000) : le taux, borné à 50 %, et la part de la taxe qui est détruite, le reste allant au trésor de la cité (5.6). Arrondi à l'obole, par échange et toujours vers le haut : taxe = ⌈brut × taux⌉, part détruite = ⌈taxe × part⌉, trésor = taxe − part détruite, net = brut − taxe. L'arrondi ne joue donc jamais en faveur de la monnaie en circulation, et découper une vente en petits ordres ne fait jamais payer moins (arrondie vers le bas, la taxe d'un échange de moins de 1 ÷ taux oboles serait nulle). En contrepartie, un échange paie au plus une obole de plus que le taux exact : une vente servie en plusieurs échanges peut rapporter quelques oboles de moins que le net annoncé pour un échange unique. Un taux nul ne prélève rien ; une version de configuration publiée avant la taxe se lit avec un taux nul. Le taux et la part détruite sont des règles du jeu publiques : les joueurs connectés les lisent (vue `market_rules`), rien d'autre de la configuration du marché ne l'est.
  Historique des prix : les échanges d'un bien dans une cité, entre joueurs comme avec les PNJ, sont résumés par période en chandeliers (table `price_candles`) : ouverture (prix du premier échange de la période), plus haut, plus bas, clôture (prix du dernier), volume (unités échangées) et montant (somme des prix × quantités, brut, avant taxe de marché). Une période est l'intervalle [début, début + durée), son début étant un multiple de la durée depuis l'époque Unix, en temps universel ; une période sans échange n'a pas de chandelier. La durée est portée par chaque chandelier : en changer ouvre une nouvelle série à côté de l'ancienne, sans la réécrire. La base refuse un chandelier incohérent (période mal alignée, prix hors de l'intervalle plus bas – plus haut, volume nul, montant hors de plus bas × volume – plus haut × volume). C'est un agrégat des échanges, recalculable, dont ni la monnaie ni les stocks ne dépendent : le moteur le remplit et en recalcule les valeurs, sans jamais en supprimer. L'historique est une donnée publique du marché, comme le carnet agrégé : tout joueur connecté lit celui de toutes les cités (vue `price_candles`), sans identité de maison ni d'ordre ; un visiteur anonyme ne lit rien.
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
|  | Acquisition de sites |

Règle de conception : l'inflation mensuelle cible est comprise entre 0 % et 3 %. Trois leviers l'ajustent sans patch : taux directeur, coefficient d'entretien, revenu des classes PNJ.

## 5.6 Fiscalité

Chaque cité vote ses taux dans des bornes fixées par le monde : droit de port (défaut 2 %), taxe de marché, impôt sur la fortune levé en cas de crise, taxe de résidence des métèques. Les recettes alimentent le trésor de la cité, dépensé par les magistrats. La concurrence fiscale entre cités est un ressort de jeu assumé.

Dans la première version : le trésor de la cité est un compte du grand livre, un par cité, ouvert par la base à la création de la cité. Il n'est jamais débiteur (la cité ne dépense que ce qu'elle a reçu), le service de jeu ne peut ni l'ouvrir ni en modifier le solde hors des journaux, et les joueurs ne le lisent pas encore.
