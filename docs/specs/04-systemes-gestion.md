# 4. Systèmes de gestion

La maison se gère sur sept systèmes qui partagent les mêmes stocks, la même trésorerie et le même personnel. Chaque système est jouable seul, mais la rentabilité vient de leur combinaison.

## 4.1 La maison (oikos)

- **Siège** : bâtiment évolutif (10 niveaux) qui fixe le nombre de sites gérables et de postes d'intendant.
  Toute maison est au premier niveau : ses postes d'intendant sont le premier nombre de `stewards.limitByHeadquartersLevel` (4.4), comme ses sites celui de `sites.limitByHeadquartersLevel`.
- **Trésor et comptes** : compte de résultat et bilan tenus automatiquement, consultables par jour, saison et année, avec marge par filière et par site.
  Dans la première version, les comptes sont trois vues en lecture seule, que le joueur lit pour sa seule maison ; elles sont calculées à la lecture depuis le grand livre, qui fait foi, et rien n'y est recopié.
  Flux de trésorerie (`my_cash_flows`) : par compte (trésorerie, séquestre), jour de jeu et nature, en oboles, crédit positif.
  Natures : ventes (`sales`, au brut : prix × quantité de l'échange), taxes (`taxes` : l'écart entre ce brut et le net crédité), achats (`purchases`), entretien (`upkeep` : clôture et relance, rénovation d'un bien immobilier, écriture `property.renovate`, 4.5), salaires (`wages` : clôture et relance, 4.4), hébergement (`lodging` : nuits des travailleurs sans logement, écritures `lodging.daily` à la clôture et `lodging.restart` à la relance, 4.4), acquisitions (`acquisitions` : un site, un navire, un bien immobilier acheté à la cité, écriture `property.buy`, ou acheté à une autre maison et cédé par elle, écriture `property.sale`, 4.5), loyers (`rents` : écriture `lease.rent`, négatifs pour le locataire, positifs pour le propriétaire, 4.5), transport (`transport` : provisions et droit de port payés au départ d'un voyage, écriture `voyage.departure`, 4.6), offrandes (`offerings` : oboles offertes à un dieu, écriture `temple.offering`, 7.1, ou payées pour consulter la Pythie, écriture `temple.oracle`, 7.3), liturgies (`liturgies` : dû et faste d'une liturgie accomplie, écriture `liturgy.perform`, ou prélevés d'office, écriture `liturgy.levy`, 6.4), prêts (`loans` : principal emprunté, positif, écriture `loan.temple_disburse`, et remboursé, négatif, part du principal d'une écriture `loan.repay`, 5.4), intérêts (`interest` : part des intérêts d'une écriture `loan.repay`), droit de fondation d'une banque (`bank_charter` : écriture `bank.charter`, 5.4), capital versé au coffre de sa banque, négatif, ou retiré, positif (`bank_capital` : écritures `bank.capital_in` et `bank.capital_out`), dotation de départ (`grant`), séquestre (`escrow` : monnaie retenue pour un achat en attente, ou rendue) et `other` pour toute écriture d'une nature que la vue ne connaît pas encore.
  Une écriture peut porter plusieurs natures : une ligne du grand livre marquée d'une nature (`ledger_lines.nature`, 12) est rangée sous ce marqueur, une ligne sans marqueur sous la nature de son écriture.
  Ainsi l'écriture d'entretien d'une clôture ou d'une relance porte une ligne `upkeep` et une ligne `wages`.
  Le salaire des intendants (4.4, #278) a sa propre ligne `wages` dans l'écriture `upkeep.daily` de la clôture, vers le même puits : il compte donc en salaires, sans changer aucune vue.
  L'hébergement (#258) a sa propre écriture, de la même transaction, plutôt qu'une ligne marquée `lodging` : la migration 60 recrée sans condition sa contrainte de nature avec la seule liste (`upkeep`, `wages`), et son rejeu échouerait sur une base où une ligne porte un autre marqueur (règle 9, ADR 0006).
  La revente d'un bien entre maisons se lit comme une vente de l'agora : le vendeur, qui lit le prix de son offre vendue, voit la cession au brut en `acquisitions` (positive) et l'écart avec le net crédité en `taxes` ; l'acheteur voit le prix en `acquisitions` (négatif).
  L'entretien des navires, prélevé dans la même écriture de clôture, a sa propre ligne marquée `upkeep`, vers son puits (4.6) ; celui des biens immobiliers aussi (4.5).
  La rénovation d'un bien marque elle aussi son débit `upkeep`.
  Un ticket qui ajoute une écriture de maison lui donne sa nature ici.
  Chaque ligne du grand livre y est comptée une fois et en entier : la somme des flux d'un compte sur une période est la variation de son solde, et un flux de somme nulle n'est pas affiché.
  Un achat en attente quitte la trésorerie le jour où son prix est retenu (nature séquestre) ;
  servi plus tard, c'est un achat du compte de séquestre, pas de la trésorerie.
  Le jour de jeu d'une écriture (section 3) est celui de sa date, le début de sa transaction, lu avec l'heure de clôture et le fuseau de la configuration en vigueur à la lecture : changer l'horloge reclasse donc les écritures passées, et sans horloge en vigueur le jour est inconnu sans qu'aucun flux disparaisse.
  Limite : une vente dont la taxe prend tout le montant (une obole) ne crédite rien au vendeur et n'apparaît donc ni en vente ni en taxe.
  Compte de résultat (`my_income_statement` par jour de jeu, `my_income_statement_by_season` par saison) : dérivé des flux de trésorerie, en oboles, tenu au flux de trésorerie.
  Un produit ou une charge est compté le jour où la monnaie change de mains, avec le signe du flux (une charge est négative) ;
  il n'y a ni variation de stock ni amortissement, les stocks sont au bilan.
  La monnaie de la maison y est sa trésorerie plus son séquestre : retenir ou rendre le prix d'un achat en attente est un mouvement entre ses deux comptes, sans effet sur le résultat, et l'achat est une charge le jour où il est servi (au flux de la seule trésorerie, un achat payé par le séquestre ne serait jamais une charge).
  Exploitation : ventes au brut, achats, taxes, charges courantes ; leur somme est le résultat (`operating_result`).
  La colonne de l'entretien (`upkeep`) y porte les charges courantes : entretien des sites, des navires et des biens immobiliers, rénovation des biens, salaires, hébergement et transport, dont `my_cash_flows` donne le détail par nature.
  Décision (#252, ADR 0006) : le transport y entre plutôt que dans une vue nouvelle, comme les salaires avant lui ; l'écran Comptes la libelle « Entretien, salaires et transport ».
  Les colonnes du compte de résultat sont figées : la migration qui l'a créé le recrée tel quel quand la suite des migrations est rejouée, ce qu'une colonne de plus rendrait impossible.
  Une nature nouvelle y entre dans une colonne existante, ou dans une vue nouvelle.
  Décision (#257, ADR 0006) : les loyers d'un jour y entrent par leur net, dans les ventes (`sales`, produits d'exploitation) quand il est positif, dans les charges courantes (`upkeep`) quand il est négatif : un loyer reçu est une recette, un loyer payé une charge.
  Une maison qui reçoit et paie des loyers le même jour n'en voit que le solde, dont `my_cash_flows` donne le détail.
  Hors exploitation (`non_operating`) : acquisitions de sites, de navires et de biens immobiliers, cession d'un bien à une autre maison, dotation de départ, et `other` pour tout le reste.
  Décision (#265, ADR 0006) : les offrandes sont hors exploitation et entrent dans `other`, que la définition du compte de résultat n'a pas à changer pour cela ; l'écran Comptes la libelle « Offrandes et autres mouvements », et `my_cash_flows` en donne le détail.
  Une consultation de la Pythie (#270) est une offrande : elle y entre de même.
  Décision (#720, ADR 0006) : les liturgies sont hors exploitation et entrent aussi dans `other` ; `my_cash_flows` les donne à part (nature `liturgies`).
  Décision (#724, ADR 0006) : le principal emprunté et remboursé est hors exploitation et entre dans `other` ; les intérêts sont une charge courante, comptée dans `upkeep` : un emprunt n'est pas un produit, ses intérêts sont son coût.
  Décision (#726, ADR 0006) : le droit de fondation d'une banque et le capital versé ou retiré de son coffre sont hors exploitation et entrent dans `other`, sans changer la définition du compte de résultat.
  Une écriture `loan.repay` n'a qu'une ligne de trésorerie : `my_cash_flows` la partage en `interest` et `loans` d'après son remboursement (`loan_repayments`), sans marqueur de ligne (ADR 0006).
  Les biens offerts sortent des stocks, donc du bilan, sans flux de trésorerie.
  Résultat plus hors exploitation font la variation de la monnaie de la maison sur la période (`cash_change`), dont `escrow_change` est la part du séquestre : la variation de la trésorerie seule est leur différence.
  La saison d'un jour de jeu est celle du moteur (`seasonIndexAt`) : des saisons de `seasonDays` jours de jeu (au plus 366) comptés depuis le lundi 5 janvier 1970, lues comme le jour avec l'horloge en vigueur à la lecture ;
  la vue par saison donne le premier et le dernier jour de jeu de chacune.
  Sans durée de saison utilisable, la saison est inconnue et la vue par saison rend une seule ligne par maison ;
  si la base ne connaît pas le fuseau de la configuration, le jour et la saison sont inconnus.
  Dans les deux cas aucun montant ne disparaît.
  Stocks valorisés (`my_valued_stocks`) : chaque stock non vide, part réservée par les ventes en attente comprise, au prix de référence observé du marché de sa cité (5.3), le dernier calculé, avec sa date.
  Ce prix moyen est préféré au prix du dernier échange : un échange isolé à un prix aberrant ne déplace pas le bilan.
  Un bien qui n'a jamais eu de prix observé dans la cité n'a ni prix ni valeur ;
  aucun prix n'est inventé à sa place.
  Bilan (`my_balance_sheet`) : trésorerie, séquestre (nul tant que la maison n'a pas eu d'achat en attente), valeur des stocks qui ont un prix, et nombre de stocks sans prix, que cette valeur ignore.
  Décision (#726, ADR 0006) : le bilan, dont les colonnes sont figées, ne montre pas le coffre de la banque de la maison ; il se lit dans `my_bank`, comme une dette dans `my_loans`, et la fortune le compte.
  Les sites, les navires et les biens immobiliers n'y figurent pas : leur prix d'acquisition est détruit, ou versé au vendeur d'un bien revendu.
  Fortune d'une maison (#718) : le total de son bilan, trésorerie, séquestre et valeur des stocks qui ont un prix, en oboles, avec à côté le nombre de stocks sans prix qu'elle ignore, plus les marchandises en mer (#719, ci-dessous).
  Une seule définition sert au Gini du tableau de bord (5.5), puis aux liturgies et à l'Hybris, calculée à l'identique par `houseWealth` (`packages/sim`) et par `game.house_wealth` (base, accordée au seul service), ce qu'un test d'intégration vérifie sur des scénarios tirés au sort.
  Comme au bilan, sites, navires et biens immobiliers n'y entrent pas ; chaque ticket qui ajoute une créance ou une dette (prêts, dépôts) l'ajoute à la fortune.
  Décision (#724) : la fortune déduit le reste dû des prêts de la maison, principal et intérêts, en cours ou en défaut, et peut être négative ; le bilan, qui ne la porte pas, se lit avec `my_loans`.
  Emprunter ne change donc la fortune que de ses intérêts.
  Décision (#726) : la fortune compte le coffre de la banque de la maison, net de ses dépôts (#727, nuls avant) ; verser du capital au coffre ne la change pas, le droit de fondation la baisse.
  Décision (#719) : les marchandises en mer (cargaison d'un voyage, à l'extrémité `in_transit` du journal des stocks, 4.6) y comptent, au prix observé du bien dans la cité d'arrivée, où elles entreront au stock de la maison.
  Elles s'ajoutent à la valeur des stocks, une cargaison sans prix au nombre des stocks sans prix, et la fortune n'est plus le total du bilan, qui les ignore, tant qu'une cargaison est en mer.
  Sans elles, une maison mettrait son stock en mer juste avant la désignation des liturgies (6.4), dont le dû est une part de la fortune, et le Gini perdrait la richesse des négociants au moment où ils naviguent.
  Une cargaison arrivée compte une fois, au stock de la cité d'arrivée (pgTAP 719).
  Aucune vue ni fonction exposée au client ne rend la fortune d'une autre maison, ni un total ou un classement de fortunes (pgTAP 718).
- **Famille** : conjoint, héritiers, parents, chacun avec 2 ou 3 traits. Un membre peut être placé à la tête d'un site ou envoyé en ambassade. Les mariages entre maisons de joueurs créent une alliance formelle (accès croisé aux entrepôts, clause d'entraide).
- **Timè** : monte avec les contrats honorés, les liturgies et les mandats bien tenus ; baisse avec les défauts de paiement et les sanctions. Elle conditionne le crédit, l'éligibilité et les prix obtenus des PNJ.
  Décision (#704) : elle est tenue comme la Charis, entière, par un journal en ajout seul (`honor_ledger`, 12) ; elle n'est pas de la monnaie, ne s'achète pas et ne se transfère pas.
  Elle est publique, comme le nom et la cité de la maison : tout joueur connecté lit la Timè de chaque maison (`house_honor`), et seule sa maison lit le détail de ses lignes (`my_honor_entries`).
  Une maison nouvelle a une Timè nulle.
  Chaque ligne du journal porte une variation non nulle, un motif d'une liste fermée, une référence et un jour de jeu, au plus une ligne par motif et par référence.
  La variation d'un motif vient de la configuration (`honor.changes`), rognée pour que la Timè reste entre `honor.min` et `honor.max` (`honorChange`) ; une variation nulle n'écrit rien.
  Un gain ne fait jamais baisser la Timè, ni une perte monter : des bornes resserrées par une version nouvelle ne ramènent pas d'un coup une Timè déjà au-delà, elles l'empêchent seulement de s'en éloigner.
  Les variations sont nulles au départ (paramètres neutres), et une version publiée avant la Timè n'en fait changer aucune.
  Chaque variation émet `HonorChanged` (maison, variation, motif, Timè après elle).
  Motif `archon_term` (#704) : la clôture qui atteint la fin d'un mandat d'archonte (6.2), celle qui dépouille l'élection du suivant, crédite la maison qui l'a tenu du gain `honor.changes.archon_term`, une fois même rejouée.
  Un mandat est crédité par la première clôture dont l'instant atteint sa fin : un mandat fini avant la clôture précédente du monde ne l'est jamais après coup, même quand une version plus récente rend ce gain non nul.
  Une charge restée vacante ne crédite personne.
  Décision (ambiguïté) : les « sanctions » qui la font baisser sont celles du jeu (défaut de paiement, dérobade à une liturgie, Némésis), jamais celles de la modération (6.6).
  Motifs `liturgy_performed` et `liturgy_evaded` (#720, 6.4) : une liturgie accomplie rapporte `liturgies.honorGain`, grandi par le faste ; une liturgie prélevée d'office coûte `liturgies.evasionHonorLoss` ; l'un ou l'autre une fois par liturgie, rognés aux bornes.
  Le crédit du Trésor du temple la lit (5.4, #724) : son plafond est celui du palier de Timè de la maison.
  Motif `loan_defaulted` (#725, 5.4) : un prêt qui passe en défaut à son échéance coûte `templeTreasury.defaultHonorLoss`, une fois par prêt, rognée aux bornes ; la marque de déshonneur se lit avec la Timè (`house_honor`).
  Les motifs des conflits viendront avec leurs tickets ; l'éligibilité et les prix des PNJ ne la lisent pas encore.

## 4.2 Les domaines

La carte de chaque cité est découpée en parcelles finies (200 à 600 par cité), chacune avec un terrain, une fertilité et un accès à l'eau. La rareté du foncier est voulue : elle crée un marché immobilier rural et une rente.

| Type de site | Production | Particularité |
| --- | --- | --- |
| Champ | Blé, orge, lin | Cycle saisonnier, rotation des cultures, risque météo |
| Verger et vigne | Olives, raisin, figues | 2 saisons avant la première récolte, rendement croissant |
| Pâture | Laine, peaux, lait | Demande du fourrage |
| Forêt | Bois, miel, gibier | S'épuise si surexploitée, se régénère |
| Carrière et mine | Marbre, argile, cuivre, étain, fer, argent | Concession accordée aux enchères par la cité, durée limitée |
| Pêcherie et saline | Poisson, sel | Exige un accès côtier |

Dans la première version : une maison acquiert un site dans sa cité en choisissant sa recette ;
le type du site est celui de la recette, et son prix, fixé par type dans la configuration, est détruit (puits « acquisition de sites »).
La commande porte le prix que le joueur a vu : un autre tarif en vigueur est refusé (« le prix a changé »), rien n'est payé ;
comme pour la relance (5.5), ce prix est facultatif pour un client antérieur, servi au tarif en vigueur, et il est retenu avec la clé d'une acquisition restée sans réponse : un nouvel essai renvoie ce prix sous la même clé, même si le tarif affiché a changé entre-temps.
Le nombre de sites d'une maison est borné par le niveau de son siège (toute maison est au premier niveau).
Un site peut changer de recette parmi celles de son type : ce qu'il a déjà produit doit d'abord être récolté, le cycle entamé est perdu et le nouveau commence à l'instant du changement.
Il n'y a encore ni carte des parcelles, ni fertilité, ni marché foncier.
Depuis #708, dix productions de plus : champs d'orge et de lin, figueraie, pâturage à bovins (peaux), rucher (miel), carrière de marbre et mines de cuivre, d'étain, de fer et d'argent ; leurs durées, travailleurs et plafonds sont dans la configuration.
Décision (#708) : une mine est un site de type carrière, acquis comme les autres, sans enchère de concession.
Le terroir de la cité (6.1) restreint les productions primaires : un site reste dans la cité de sa maison, et n'y lance qu'une production de son terroir ; un atelier est admis partout.
Une acquisition ou un changement de recette hors terroir est refusé (« hors du terroir de la cité »), sans rien payer ni changer : le refus passe avant le prix et avant la relance gratuite d'un site sans recette.
Un site qui exploite une production sortie du terroir (version de configuration qui le resserre) continue de produire, se récolte et se relance comme avant ; une fois qu'il l'a quittée, il n'y revient plus.
Un site à l'arrêt faute d'entretien payé (5.5) se récolte pour ce qu'il avait accumulé avant son arrêt, et pas davantage (un atelier, lui, ne se récolte pas à l'arrêt : voir 4.3) : pour lui, le temps s'est arrêté à cet instant, le cycle entamé reste gelé et reprend à la relance.
Il ne change pas de recette tant qu'il est à l'arrêt (refus « site à l'arrêt ») : il faut le relancer d'abord.
Événements de rendement (7.4, #267) : un cycle d'un champ qui se termine pendant une sécheresse de sa cité, ou d'un verger pendant une bonne année, produit ⌊extrant × (10 000 ∓ ampleur) ÷ 10 000⌋, avec la plus forte des sécheresses (ou bonnes années) en cours à cet instant (à égalité, celle du plus petit identifiant, soit la planification la plus ancienne) ; les autres cycles produisent normalement.
Décision : la fin d'un cycle se lit dans le temps du site, celui de son horodatage de cycle et de la durée de sa recette, gelé pendant un arrêt ; pour un site jamais arrêté, c'est le temps réel.
Limite connue : la relance décale ce temps de la durée de l'arrêt, y compris pour les cycles terminés avant l'arrêt et non récoltés ; un événement peut alors les toucher ou les épargner, si bien que les récolter avant ou après la relance peut différer.
Les deux sens sont possibles (#446) : un cycle terminé pendant un événement et récolté après une relance postérieure à sa fin y échappe, tandis qu'un cycle terminé avant un événement commencé pendant l'arrêt est touché s'il est récolté après une relance faite pendant l'événement.
La relance est celle de la commande `site.restart` ou de la clôture qui paie l'entretien du site (5.5) : toutes deux décalent le cycle de la même façon.
L'arrondi se fait cycle par cycle, à l'unité inférieure : sans arrêt entre elles, récolter en une ou plusieurs fois rend la même quantité, et une sécheresse au plus fort rend zéro, le cycle avançant quand même.
Une grâce (7.1, #266) s'applique après les événements, sur la quantité de toute la récolte qui la consomme : son surplus fait exception à cette règle.
La quantité récoltée passe par le journal des stocks ; l'écart dû à chaque événement est expliqué dans `event_effects` et dans l'événement de domaine `SiteCollected` (`eventEffects`).

Recette retirée : une version de configuration peut retirer une recette qu'un site exploite encore.
Ni la publication ni l'activation ne le refusent (Olympe le dit avant la programmation, nombre de sites et de maisons, et la fait confirmer si la version en vigueur la contient encore : 15.2) : un refus lierait l'équilibrage aux choix passés des joueurs (pilier « Tout est réglable », section 1), et la configuration resterait bloquée tant qu'un seul site exploiterait la recette.
Le repli est dans les commandes. Un tel site n'a plus de type, donc ni tarif ni entretien (5.5), ni production : il est à l'arrêt faute de recette.
Il ne se récolte plus (refus « production retirée »), à l'arrêt ou non, et un atelier n'y consomme aucun intrant.
Il peut changer de recette sans récolte préalable : ce qu'il avait accumulé est perdu avec le cycle entamé, et le nouveau cycle commence à l'instant du changement.
Faute de type, il peut adopter n'importe quelle recette de la configuration que le terroir de sa cité admet, et prend le type de celle-ci ;
chercher son ancien type dans l'historique des versions demanderait à l'écran comme à l'API de relire des versions qui ne sont plus en vigueur, pour un cas que le back-office provoque.
Limite : ce changement de type est gratuit, alors que le prix d'acquisition dépend du type ;
retirer une recette offre donc à chaque site qui l'exploitait le type de son choix, et c'est au concepteur de jeu d'en tenir compte.
Un site sans recette à l'arrêt (arrêté avant le retrait) change de recette quand même : sans tarif, l'arrêt est levé sans rien payer (événement de relance à zéro obole), comme le ferait une relance ou la clôture, puis la nouvelle recette commence.
Une version qui rend la recette la rend aussi aux sites qui ne l'ont pas quittée : ils reprennent leur cycle là où il en est, le temps passé sans recette compté comme du temps de production, dans la limite du plafond d'accumulation.
Rien n'est migré ni dédommagé automatiquement. L'écran dit qu'un tel site est à l'arrêt faute de production (aussi parmi les sites à surveiller), ne propose ni récolte ni relance ni entretien, et propose toutes les productions avec leur type.

Partage des contrôles : la base garantit qu'un changement de recette repart d'un cycle neuf, si bien qu'aucune production de l'ancienne recette n'est récoltée sous la nouvelle.
Un site n'a pas de type enregistré : son type se déduit de sa recette, que seule la configuration connaît.
L'existence de la recette, celle de la recette en cours comprise, et sa compatibilité avec le type du site sont donc vérifiées par la commande, pas par la base.
Si une récolte du même site aboutit pendant le changement de recette, celui-ci est refusé (« le site vient de changer ») : le joueur réessaie, et le client envoie alors une nouvelle clé d'idempotence, puisqu'un refus reste attaché à la sienne.
Une acquisition restée sans réponse garde sa clé, même onglet quitté ou page rechargée (stockage de session, par maison) : la renvoyer rejoue l'achat au lieu de le payer deux fois.
Même aboutie, elle ne rend sa clé qu'à la relecture qui montre le site acquis : un écran rouvert pendant l'envoi, qui lit encore l'ancien nombre de sites, renvoie la même clé (l'API rejoue l'achat) au lieu d'en payer un second.
Un succès reçu par un écran quitté n'est pas annoncé : le nouvel écran rend la clé en silence quand la liste montre le site.
Un clic pendant une autre commande n'envoie rien et ne crée aucune clé.
L'intention comprend le nombre de sites de la maison : si la relecture montre le site acquis, vouloir de nouveau la même production est un nouvel achat.
Tant que les sites de la maison ne sont pas lus (écran qui se rouvre, lecture en échec), leur nombre est inconnu : l'acquisition n'est pas proposée et rien n'est envoyé, car les compter pour zéro donnerait une clé neuve à un achat peut-être déjà abouti.
Sans réponse, si la relecture montre un site de plus qu'à l'envoi, l'écran renvoie de lui-même la même clé, une fois : l'API dit alors l'issue.
Si elle reste inconnue, une lecture qui montre N sites abandonne la clé d'une acquisition demandée avec moins de N sites (le nombre de sites ne diminuant pas dans cette version, elle ne serait plus renvoyée), et l'écran prévient à ce moment-là, à la fin d'une commande comme au retour sur l'écran ou sur l'onglet : un site de plus apparaît, la liste est à vérifier, un nouvel essai serait un nouvel achat.
Cet avertissement est rappelé à chaque ouverture de l'écran tant que le joueur n'a pas dit avoir vérifié la liste ni lancé une nouvelle acquisition.
Pour une acquisition comme pour la relance d'un site, une clé reste aussi en attente après un refus rendu avant le registre de l'API (session expirée, trop de demandes), qui ne dit rien de l'issue, tandis qu'une clé absente ou mal formée, que l'API n'a jamais pu consommer, est rendue.
Sans stockage de session (navigation privée), les clés sont gardées en mémoire : elles survivent au changement d'écran, pas au rechargement de la page.
Le jour où une maison pourra céder un site, ce nombre ne suffira plus à distinguer les intentions.
Ce que l'écran annonce comme récoltable est calculé à l'heure du serveur, lue dans l'en-tête `Date` des réponses de l'API (route de santé à l'ouverture, puis chaque commande), et non à l'horloge du navigateur : l'en-tête, à la seconde près, garde l'horloge du navigateur quand elle lui est compatible et sinon la corrige au milieu de l'intervalle qu'il permet (à une seconde environ près) ;
c'est la commande de récolte qui fait foi. Au retour sur un onglet resté en arrière-plan, l'heure, les sites et leurs règles (prix, entretien) sont relus ;
les sites et les règles le sont aussi chaque minute tant que l'onglet est visible, hors commande en cours.
Un arrêt prononcé par la clôture pendant que la fiche est ouverte est ainsi affiché, et annoncé (région d'alerte) à la relecture qui le découvre ;
la première lecture ne l'annonce pas, la fiche le dit déjà.

## 4.3 Les ateliers

Un atelier applique des recettes : intrants, durée, personnel requis, extrant. Trois leviers le différencient.

- **Qualité** (0 à 100) : dépend de la qualité des intrants, du niveau de l'artisan et de l'outillage. Elle segmente la demande : le peuple achète le prix, les riches achètent la qualité.
- **Marque** : à partir d'un seuil de volume et de qualité, une maison peut déposer un sceau. Un sceau reconnu se vend plus cher et se contrefait (voie d'Hermès).
- **Cadence** : production normale, forcée (plus rapide, usure et fatigue) ou soignée (plus lente, qualité accrue).

Dans la première version : un atelier se récolte comme un site de matière première.
À la récolte, chaque cycle écoulé consomme ses intrants dans le stock libre de la maison dans la cité du site (le stock réservé par des ordres de vente n'est pas touché) et livre ses extrants.
À court d'intrants, le cycle attend : les cycles que le stock permet tournent, le temps des autres reste dû et se rattrape à une récolte suivante, une fois l'atelier réapprovisionné.
Ce rattrapage ne dépasse jamais le plafond d'accumulation du site : à tout moment, les cycles récoltés d'un coup et les cycles encore dus ne font pas ensemble plus que ce plafond ;
au-delà, le temps perdu est perdu. Les intrants ne sont demandés qu'au moment de la récolte.
Un atelier change de recette comme tout site (4.2) : il doit d'abord être récolté s'il a de quoi tourner ;
à court d'intrants, il n'a rien produit, change de recette aussitôt, et ses cycles en attente sont perdus avec le cycle entamé.
Qualité, marque, cadence et personnel ne sont pas encore simulés.
Un atelier dont la recette a quitté la configuration ne se récolte pas non plus (4.2).
Un atelier à l'arrêt faute d'entretien payé (5.5) ne consomme aucun intrant : il ne se récolte pas tant qu'il est à l'arrêt (refus « site à l'arrêt »), même réapprovisionné entre-temps.
Pour un atelier, rien n'est « accumulé » tant que les intrants ne sont pas consommés : les cycles écoulés avant l'arrêt restent dus, dans la limite du plafond, et tournent à la première récolte après la relance.
Un atelier inspiré en attente (7.1, #266) ajoute à une récolte d'atelier ⌊quantité × ampleur ÷ 10 000⌋ de chaque extrant, sans intrant de plus.

Marge nette quotidienne d'un site (#285), telle que la mesure le banc à quatre cités (`recipeMargins`, `apps/api/src/balance/measures.ts`), sur ses dix derniers jours mesurés.
Elle est comptée à pleine cadence : tous les cycles d'un jour, et tous les extrants vendus.
Ventes : les extrants au prix moyen des échanges de la cité, achats des PNJ compris.
Intrants : au prix moyen payé par les maisons de la cité (ordres d'achat servis, sans les achats des PNJ), sinon au prix moyen des échanges.
Un bien sans échange dans la cité est compté au prix du monde, sinon à son prix de référence.
On en retire l'entretien du site (5.5), puis, par travailleur, le salaire moyen de la cité et sa part d'hébergement : le prix d'une nuit fois la part des employés de la cité qui ne sont pas logés (4.4).
Une matière première n'est comptée que dans le terroir de la cité ; la marge du monde (`world`) compte toutes les recettes, aux prix et au marché du travail de toutes les cités.

Borne des ateliers (#285), écrite à la main dans le banc à quatre cités (`apps/api/src/balance-world.bench.ts`) : la marge du monde d'un site de chaque recette d'atelier est entre la moitié et le double de la médiane de celle des sites de matières premières.
Aucune voie n'écrase ainsi l'autre (01, pilier 2).
Depuis #708, cette médiane ne compte que les matières premières du terroir des cités du banc : celles de #708, qu'aucune n'y produit, n'y vaudraient que leur prix de référence.
Décision (#285) : la borne porte sur la marge du monde, pas sur celle de chaque cité.
Cité par cité, le scénario du banc fait passer un bien intermédiaire du plancher au plafond des prix de ses maisons scriptées (70 % et 150 % de la référence) : à Kallistè, le bois manque à la charbonnière, le fournil chôme et le moulin vend sa farine au plancher (201 oboles de marge) ; à Elaia, la farine manque et le fournil la paie au plafond (30 oboles).
Ces écarts tiennent aux nombres de sites du scénario, que la configuration ne corrige pas sans casser le banc à une cité (essais ci-dessous).

Depuis #709, douze ateliers de plus (5.1) : leur marge du monde, aux prix du banc à quatre cités, est de 681 à 1 017 oboles, dans la borne de 453 à 1 810.
Aucune maison du banc n'y joue ces ateliers : leurs extrants, que personne n'échange, comptent à leur prix de référence.
Les marges des sept recettes du tableau ci-dessous et la médiane des matières premières restent celles d'avant, au chiffre près.
Le négociant des bancs n'enchérit plus que sur les biens que les sites du monde livrent.
Raison : il place chaque matin, par bien, une offre d'achat d'un huitième de sa trésorerie restante ; avec trente-sept biens, presque toute sa monnaie serait sous séquestre et l'entretien de ses sites ne serait plus payé.
Ce filtre dépend du nombre de biens produits : depuis #712, le négociant garde aussi une réserve d'entretien.
Chaque offre est d'au plus un huitième de sa trésorerie restante, sans l'entamer sous deux jours de l'entretien de ses sites, quel que soit le nombre de biens ; ces paramètres sont ceux de son rôle dans le scénario du banc.
Décision (#712) : le filtre reste.
Sans lui, les offres sur les trente-neuf biens que personne ne produit tiendraient chaque matin sa trésorerie à sa réserve, sous ce qu'une maison garde pour ses dépenses : il vendrait alors comme une maison à court, et le coût du panier du banc à une cité baisserait de 1,04 %, sous sa borne.
Avec le filtre, la réserve ne joue pas dans le banc à une cité, qui reste identique au chiffre près (hausse du coût du panier de 0,08 %, 10 236 habitants au dernier jour).
Une réserve de deux jours de toutes ses dépenses (salaires et hébergement compris) joue certains matins et fait baisser ce coût de 0,35 %.
Avec une offre d'achat sur chacun des trente-sept biens, le banc à une cité arrêtait un moulin faute d'entretien payé ; les offres sur les douze intermédiaires, que personne n'y produit, ne s'y remplissaient jamais.
Le banc à une cité garde ses bornes, avec des écarts de quelques millièmes (10 236 habitants au dernier jour au lieu de 10 253).

Depuis #710, sept ateliers de biens finis de plus (5.1), jusqu'à quarante-quatre recettes.
Leur marge du monde, aux prix du banc à quatre cités, est de 615 à 857 oboles, dans la borne de 453 à 1 810.
Aucune maison du banc ne les joue : leurs extrants, que personne n'échange, comptent à leur prix de référence.
Les marges des quatorze recettes d'avant, et celles de #709, restent celles d'avant, au chiffre près ; le banc à une cité reste identique, au chiffre près (10 236 habitants au dernier jour).
Le filtre du négociant les laisse de côté pour la même raison que les douze de #709.

Depuis #711, dix ateliers de biens finis de plus (5.1), jusqu'à cinquante-quatre recettes : les soixante biens du lancement sont au complet.
Leur marge du monde, aux prix du banc à quatre cités, est de 759 à 875 oboles, dans la borne de 453 à 1 810.
Aucune maison du banc ne les joue, et le filtre du négociant les laisse de côté pour la même raison.
Les marges des quarante-quatre recettes d'avant restent celles d'avant, au chiffre près.
Le banc à une cité reste identique, au chiffre près (10 236 habitants au dernier jour), et le banc à quatre cités n'a pas d'autre écart que les dix colonnes nouvelles.

Marges retenues dans la configuration initiale (banc à quatre cités, graine par défaut, salaire du banc de 4 oboles) ; la médiane des matières premières est de 905 oboles avant comme après, d'où une borne de 453 à 1 810 oboles :

| Filière | Avant | Après | Réglage |
| --- | ---: | ---: | --- |
| Moulin (`mill_flour`) | 1 130 | 964 | aucun |
| Fournil (`bake_bread`) | 569 | 570 | aucun |
| Charbonnière (`burn_charcoal`) | 550 | 550 | aucun |
| Pressoir (`press_oil`) | 613 | 1 046 | 8 olives par cycle au lieu de 12 |
| Tissage (`weave_cloth`) | 273 | 609 | 3 laines par cycle au lieu de 6 |
| Poterie (`throw_amphorae`) | −239 | 643 | 4 argiles et 1 charbon par cycle au lieu de 8 et 2 ; amphore à 36 oboles au lieu de 24 |
| Chai (`ferment_wine`) | 255 | 531 | 2 raisins par cycle au lieu de 12 |

Raisons des choix :

- Un atelier se règle par ses intrants (son rendement), et non par sa cadence ou ses extrants.
  Le banc à une cité tient la hausse du coût de son panier sur une offre de pain, d'huile et de vin calée sur la demande, qu'un atelier plus productif ferait déborder.
- Le prix de référence d'un bien que consomment les PNJ fixe la part de leur revenu qui va à ce bien (5.2) : il ne monte que pour l'amphore.
  Un vin à 45 oboles portait le chai à 651, mais retirait près de 5 % de couverture vitale aux hippeis et aux pentakosiomedimnoi d'Elaia, qui paient leur poisson au-dessus de sa référence.
- L'amphore est surproduite dans les deux bancs (à Kallistè, deux poteries pour une dizaine d'amphores demandées par jour) et se vend au plancher des maisons : seule une référence plus haute fait vivre la poterie.
  C'est un bien de luxe des deux classes riches, et son poids dans leur budget reste faible.
- Le pressoir tenait déjà la borne dans le banc (613), mais par la seule rareté de l'huile, vendue 41 oboles pour une référence de 30 : aux prix de référence, il rapportait environ 86 oboles, et 518 avec 8 olives.
- Moulin, fournil et charbonnière tiennent la borne sans réglage.
  Les essais qui les touchaient ont été écartés : 12 farines par mouture font déborder la farine du banc à une cité, où un moulin s'arrête faute d'entretien payé ;
  3 bois par fournée de charbon rendent le charbon à Kallistè, dont le fournil manque alors de farine comme à Elaia (154 oboles au monde) ;
  un charbon à 22 oboles fait monter le pain du banc à une cité, et le coût de son panier de 3 % en vingt jours.
- Limite connue : le chai doit encore sa marge à la rareté du vin dans le banc à quatre cités (48 oboles pour une référence de 36), et ne rapporterait qu'environ 314 oboles aux prix de référence.
  Plus de vin par site supposerait moins de chais dans les scénarios des deux bancs (seize chais à une cité, pour 234 vins demandés par jour) : c'est un choix de scénario, pas de configuration.

## 4.4 Le personnel

- **Travailleurs** : salariés recrutés sur le marché du travail de la cité, dont le salaire d'équilibre dépend de l'offre et de la demande locales. Moral influencé par salaire, logement, fêtes et cadence.
  Dans la première version (ticket 255), les travailleurs sont attachés à leur site : sa recette dit combien il en faut (`workers`), et il n'y a pas de commande d'embauche.
  Chacun est payé chaque jour le salaire du jour de la cité du site, un paramètre du back-office par cité (`staff.dailyWageOboles`), une drachme (6 oboles) dans chaque cité de la configuration initiale (#668) ; une version publiée avant le personnel, ou une cité qu'elle ne nomme pas, ne paie aucun salaire.
  Décision : ce salaire est inférieur à la dépense de référence d'un thète (8 oboles par jour) ; un travailleur n'est pas un ménage, et la bourse de sa classe a d'autres revenus que les salaires des maisons.
  Une section `staff` non vide nomme chaque cité de la configuration, et elles seules.
  Salaires d'un site pour un jour = travailleurs × salaire du jour, en oboles, sans arrondi.
  Ils sont payés à la clôture avec l'entretien du site, en entier ou pas du tout, et versés à la bourse des PNJ de la cité du site (#632, 5.5) ; un site dont les salaires sont impayés est à l'arrêt comme un site dont l'entretien l'est.
  Avant #632, ils étaient détruits (puits `sink_npc_wages`, gardé au catalogue pour l'historique, sans mouvement nouveau).
  Le salaire du jour est une règle publique, lue par les joueurs avec les règles des sites (vue `site_rules`, clé `staff` de la colonne `sites`).
  Marché du travail (#258) : l'offre de travail d'une cité est la part de la population de ses classes que la configuration désigne comme travailleuses (`labor.workingShareBps`, arrondie à l'habitant inférieur, sur la population courante ; celle de la configuration pour une classe que le moteur n'a pas encore fait naître).
  Sans classe travailleuse, l'offre est sans limite.
  Ses employés sont les travailleurs des sites de la cité, au nombre de leur recette en vigueur.
  Chaque clôture, juste avant l'entretien, fixe et enregistre une fois par jour de jeu, pour chaque cité, le salaire du jour : le salaire de base de la cité (`staff.dailyWageOboles`) multiplié par une courbe du taux d'emploi (employés ÷ offre), de sa borne basse à sa borne haute (`labor.wage` : bornes et pente, en points de base), arrondi à l'obole supérieure (`equilibriumWage`, `packages/sim`).
  Si la population tombe sous l'emploi, aucun site ne s'arrête pour autant : le salaire est à sa borne haute, et aucun site ne s'ouvre.
  `site.acquire`, `site.setRecipe` (vers une recette qui demande plus de travailleurs) et `house.create` (site de départ) refusent alors, sans rien prélever, un site dont les travailleurs dépasseraient l'offre (`NO_WORKERS_AVAILABLE`) ; l'écran de fondation marque la cité et propose les autres.
  Ces commandes se suivent par cité (verrou consultatif `labor:<cité>`, pris avant la trésorerie et les sites, que la clôture peut tenir) : deux acquisitions simultanées ne prennent pas les mêmes travailleurs.
  La clôture et la relance paient le salaire du jour fixé par la dernière clôture de la cité du site ; sans lui (avant la première clôture qui le fixe), le salaire de base.
  Logement (#258) : une maison loge ses travailleurs dans les logements qu'elle possède ou loue dans la cité de ses sites (4.5), les sites les plus anciens d'abord.
  Chaque travailleur sans logement lui coûte chaque jour une nuit d'hébergement chez les PNJ, versée à la bourse des PNJ de la cité du site (#632, 5.5 ; avant, détruite par le puits `sink_npc_lodging`) : son prix du jour, fixé avec le salaire, est le prix de base de la configuration (`labor.lodging.baseOboles`) multiplié par une courbe de la pénurie de logements de la cité (non logés ÷ employés), bornée de même (`lodgingPrice`).
  La pénurie fait donc monter le coût du travail, ce qui donne un sens économique aux baux.
  Le marché du travail du jour de chaque cité est public (vue `labor_market` : offre, employés, non logés, salaire et hébergement) ; une maison lit ses travailleurs, site par site, logés ou non (vue `my_workforce`, calculée à la lecture comme la relance les compte).
  Configuration initiale (#668) : les thètes travaillent pour 30 % d'entre eux, les zeugites pour 10 %, si bien que chaque cité, même réduite de moitié, offre de quoi faire tourner trente maisons de quatre sites ; la courbe du salaire reste à ×1 ; une nuit d'hébergement coûte 1 obole quand tous les travailleurs de la cité sont logés, jusqu'à 3 (×3, un demi-salaire) quand aucun ne l'est.
  Le moral, les artisans, le débauchage et la migration des travailleurs entre cités viendront ensuite.
- **Artisans** : personnages nommés, avec métier, niveau, traits et prétentions. Ils se forment, se débauchent et peuvent partir.
- **Intendants** : PNJ animés par IA qui gèrent un site selon des consignes en langage naturel (« vends l'huile au-dessus de 12 drachmes, sinon stocke »), traduites en règles vérifiables. Un intendant = une file d'opérations parallèle.
  Dans la première version (#278), le joueur donne les règles par un formulaire, la voie complète du jeu IA coupée ; la consigne en langage naturel (#280) n'en est qu'une traduction.
  Les règles appartiennent à une grammaire fermée (`stewardRuleSchema`, `packages/contracts`), chaque nombre entier et borné comme un ordre de l'agora, une règle par sorte et par bien, au plus 20 :
  récolter le site dès que possible (`collect`) ;
  vendre un bien à un prix plancher l'unité ou plus, en gardant une réserve en stock (`sell`) ;
  racheter un intrant de la recette du site à un prix plafond l'unité ou moins, jusqu'à un stock visé (`buy`).
  La configuration fixe les postes par niveau de siège, le salaire d'un intendant par jour (deux salaires d'un travailleur dans la configuration initiale, #668) et le nombre de règles par intendant (section `stewards`, publique dans `site_rules` sans sa liste de noms) ; une version publiée avant les intendants n'ouvre aucun poste.
  `steward.hire` embauche un intendant pour un site de la maison, un par site, dans la limite des postes ; il ne coûte rien, et reçoit un nom tiré de la liste de la configuration, parmi ceux que la maison n'emploie pas encore quand il en reste.
  `steward.setRules` remplace toutes ses règles, dans l'ordre où il les mènera, par une révision nouvelle : rien n'est effacé, et une liste vide est admise (il ne fait rien).
  La commande refuse un bien que la configuration ne connaît pas et un rachat qui ne vise pas un intrant de la recette du site au moment où les règles sont données.
  `steward.dismiss` le renvoie : son poste et son site se libèrent, rien n'est remboursé, et l'intendant renvoyé ne change plus.
  Décision (#562) : un ordre posé par un intendant le nomme (`steward_id` de `game.orders`, d'un intendant de la maison en poste à la pose).
  `steward.setRules` et `steward.dismiss` annulent, dans leur transaction, les ordres encore ouverts qu'il a posés, chacun comme par `market.cancelOrder` : ce qui a été servi reste acquis, la réservation d'une vente est levée, le séquestre d'un achat revient à la trésorerie par le grand livre (`market.escrow_release`, marquée de l'intendant et de la commande).
  Les laisser aurait gardé au carnet des ventes au prix d'avant et du séquestre retenu pour des règles qui n'existent plus.
  Des règles nouvelles, même identiques, repartent donc d'un carnet vide : l'intendant repose ses ordres aux opérations suivantes, derrière ceux déjà au carnet à leur prix.
  Ces deux commandes prennent d'abord le verrou d'agora du monde, comme une opération d'intendant : une opération en cours finit avant elles, et l'ordre qu'elle a posé est annulé ; une opération qui attend relit ensuite l'intendant, renvoyé ou sous ses règles nouvelles.
  La migration rattache à leur intendant les ordres ouverts posés avant cette version, tant que le journal des commandes et les opérations les nomment encore (ADR 0002).
  Un ordre ouvert d'un intendant déjà renvoyé avant la migration y est rattaché, mais n'est jamais annulé ni montré sur la fiche du site : le joueur l'annule à l'agora.
  La migration, l'API et le moteur de cette version se déploient ensemble : un ordre que le moteur précédent poserait entre-temps resterait sans intendant, et seul le joueur l'annulerait, à l'agora.
  Salaire : chaque clôture examine les intendants d'une maison après ses sites, ses navires et ses biens, dans l'ordre de leur embauche, avec ce qui reste de la trésorerie ; chacun, en poste et embauché avant l'instant de la clôture, doit le salaire d'un jour, payé en entier ou pas du tout (5.5).
  Un intendant impayé est inactif jusqu'à la clôture qui le paie.
  Décision (#278) : un intendant embauché est impayé jusqu'à la première clôture, qui paie d'avance la journée qui commence ; il n'agit donc jamais sans qu'une clôture ait payé son jour, et embaucher puis renvoyer entre deux clôtures n'évite aucun salaire.
  Un salaire nul est payé : la clôture rend alors actif l'intendant tout juste embauché, sans écriture.
  Décision (#278) : une version sans section `stewards` (retour arrière) n'ouvre aucun poste ; la clôture ne prélève alors aucun salaire et tient impayés, donc inactifs, les intendants en poste, jusqu'à une version qui les rétablit.
  Décision (#278) : l'intendant d'un site à l'arrêt est payé s'il reste de quoi, puisque vendre et racheter ne demandent pas que le site tourne.
  Une version qui abaisse le nombre de règles par intendant ne réécrit pas les règles déjà données : l'exécution (#279) n'en mène que les premières.
  Exécution (#279) : après chaque tick, le moteur fait agir chaque intendant actif (en poste, payé, d'un compte ni suspendu ni exclu) au plus `stewards.operationsPerTick` fois (une au départ, une pour une version publiée avant ce paramètre), chaque opération dans sa transaction.
  Une opération est la commande du joueur (`site.collect` ou `market.placeOrder`), menée par le même cœur (ADR 0009) pour la maison de l'intendant : mêmes règles, mêmes refus, mêmes événements, inscrite au journal des commandes au nom de la maison avec l'intendant pour acteur.
  Sa clé d'idempotence est tirée de l'intendant, du tick et du rang de l'opération : rejouer un tick, ou deux moteurs sur le même tick, ne double rien.
  Récolter se fait dès qu'un cycle est écoulé ; vendre place un ordre au prix plancher pour tout le stock libre au-delà de la réserve ; racheter place un ordre au prix plafond pour ce qui manque au stock visé, achats en attente de la maison comptés ; chaque quantité est bornée comme un ordre de l'agora, dans la cité du site.
  Décision (#279) : les règles forment une file circulaire ; chaque opération part de la règle qui suit celle de l'opération précédente sous la même révision, et passe sans la compter une règle qui n'a rien à faire.
  Une règle refusée à chaque tick (trésorerie vide, atelier sans intrant) ne retient donc pas les suivantes, et des règles nouvelles repartent de la première.
  Une opération refusée (stock, trésorerie, prix, bien retiré) n'a aucun effet ; elle est notée au journal, par un événement `StewardActionFailed` et sur la fiche du site, et ne retient ni les règles suivantes ni les autres intendants.
  Une opération en panne n'a aucun effet et ne prend pas sa clé : seule une trace sans clé (`failed`) est inscrite au journal des commandes, et l'opération sera retentée sous le même rang au passage suivant du moteur, tant que son tick est le dernier.
  Décision (#279) : un intendant d'un compte suspendu ou exclu n'agit pas, sans refus noté à chaque tick ; il reprend à la levée de la sanction.
  La sanction est relue sous le verrou d'agora, à l'heure de cette lecture (#528) : une suspension ou une exclusion validée pendant que l'intendant attendait ce verrou l'arrête aussi, sans rien noter.
  C'est la condition du registre de l'API (#563), relue dans la transaction de l'opération, pour une récolte comme pour un ordre ; la liste des intendants à mener n'en écarte d'avance qu'une sanction déjà en vigueur.
  Un rachat garde le bien de sa règle même si la recette du site a changé depuis : les règles sont celles du joueur.
  La fiche du site montre les cinq dernières opérations de son intendant et son dernier refus (vue `my_steward_operations`), privées comme ses règles.
  Elle montre aussi les ordres ouverts qu'il a posés et leur reste (vue `my_steward_orders`, #562), privés de même, et dit que des règles nouvelles ou son renvoi les annulent.
  Conservation (#561) : le moteur supprime les opérations plus anciennes que `stewards.operationsRetentionDays` jours (30 au départ, et pour une version publiée avant ce paramètre ; au moins un jour), par une fonction du propriétaire (ADR 0002).
  Restent, quel que soit leur âge, la dernière opération de chaque intendant, d'où repart la file de ses règles, et celles du dernier tick de son monde, que le moteur relit pour ne mener aucun rang deux fois.
  La fiche peut donc montrer moins de cinq opérations, ou aucun refus, quand les plus anciennes sont échues.
  Décision (#561) : un refus tenté est inscrit en entier, même identique au précédent ; c'est cette conservation qui borne la table.
  L'opération inscrite est la position de la file et la clé d'idempotence de son rang : ne pas l'inscrire ferait reprendre la file à la règle refusée, qui retiendrait alors les suivantes, ou demanderait un état de plus à l'intendant.
  Repos d'une règle refusée (#621) : une règle refusée sous la révision en vigueur se repose `stewards.refusalRestTicks` ticks (5 au départ, de 0 à 1000).
  Une version publiée avant ce paramètre n'en a aucun et garde son comportement : le repos s'active en publiant une version qui le règle.
  Refusée au tick t, elle est passée comme une règle qui n'a rien à faire jusqu'au tick t + repos compris, aux rangs suivants du tick t aussi, puis retentée ; 0 la retente à chaque opération.
  Pendant son repos elle n'est pas tentée : rien n'est inscrit, ni opération, ni ligne du journal des commandes, ni événement.
  Un refus durable n'écrit donc qu'une opération tous les repos + 1 ticks, au lieu d'une par tick, et chacune garde sa ligne du journal et sa clé.
  Les règles suivantes agissent pendant ce repos, et des règles nouvelles, même identiques, repartent sans repos.
  Une règle se repose même si ce qui l'a refusée a changé entre-temps (trésorerie renflouée) : elle agit au tick qui suit son repos.
  La purge des opérations (`stewards.operationsRetentionDays`) peut abréger un repos plus long que la conservation : le refus purgé ne compte plus, et la règle est retentée plus tôt, sans effet sur l'idempotence, puisque chaque tentative prend la clé d'un rang neuf.
  La fiche du site dit, sous le dernier refus, que la règle refusée se repose et l'heure à partir de laquelle l'intendant la retentera (#640) : le début du tick t + repos + 1.
  Elle lit pour cela la révision des règles de chaque opération (`rules_revision` de `my_steward_operations`), et la durée du tick sous la clé `clock` de la colonne `sites` de `site_rules`, comme le repos sous `stewards`.
  Un tick est le rang de l'intervalle depuis l'époque Unix : son heure est ce rang fois la durée du tick.
  Rien n'est annoncé pour un refus d'une autre révision que celle en vigueur, sans repos, pour un intendant qui n'agit pas (en attente de paie, impayé), une fois l'heure passée, ou quand le refus n'est plus lu (purgé).
  Seul le dernier refus est lu : une autre règle refusée plus tôt peut encore se reposer sans que la fiche le dise.
  L'annonce peut être fausse si une version nouvelle baisse `stewards.rulesPerSteward` sous la position de la règle refusée : le moteur ne mène plus cette règle, et ne la retente donc pas à l'heure annoncée.
  Décision (#621) : ce repos plutôt que le partitionnement des journaux, pour la raison et aux conditions de l'ADR 0002.
  Le journal des commandes et les événements des refus inscrits se purgent avec ces journaux, au partitionnement (ADR 0002).
  Les intendants et leurs règles sont privés : une maison lit les siens en poste (`my_stewards`, `my_steward_rules`), jamais ceux d'une autre (12).
  Maisons PNJ de secours (8.3, #716) : leurs sites portent des règles de la même grammaire, écrites dans la configuration de leur filière (`npcHouses`), que le moteur mène au même pas, après les intendants, sans intendant ni salaire.
  Une vente y a un prix plancher au plus égal au prix de référence du bien ; la file, le repos et les refus sont ceux d'un intendant, la dernière opération de chaque site tenant lieu de journal (`npc_site_queues`).
  La fiche de chaque site a sa section Intendant : embaucher, l'état de l'intendant (actif, en attente de la clôture qui le paie, impayé), ses règles par le formulaire, le renvoyer.
  Consigne en langage naturel (#280) : le joueur écrit une consigne à son intendant (`steward.submitInstruction`, 500 caractères au plus), qui n'est qu'une demande de traduction ; il valide toujours les règles par `steward.setRules`.
  La commande la refuse (`AI_UNAVAILABLE`) quand l'usage `steward` de l'IA est coupé, quand son plafond du mois est atteint, ou quand la maison a donné ses consignes du jour de jeu (`ai.stewardDailyQuotaPerHouse`, intendants renvoyés compris) ; une seule consigne attend par intendant (`INSTRUCTION_PENDING`).
  Toute consigne acceptée par la commande compte au quota du jour, même si le moteur lui répond ensuite par un refus, `AI_UNAVAILABLE` compris.
  Le moteur traduit chaque consigne en attente une fois, par la passerelle IA (8.4), le texte du joueur passé comme donnée ; la réponse doit tenir dans la grammaire, sur les biens de la configuration et les intrants du site, sans quoi elle est rejetée.
  Décision (#280) : le modèle ne décide d'aucun nombre (règle 6, dérogation de l'ADR 0005) ; il recopie chaque prix avec l'unité écrite à côté par le joueur (obole ou drachme, en français ou en anglais), et chaque quantité.
  Le code lit dans le texte les paires (nombre, unité) et les quantités, et rejette une réponse dont un prix n'est pas l'une de ces paires, valeur et unité, ou dont une quantité n'y figure pas ; une réserve que la consigne ne dit pas vaut 0.
  Un prix sans unité ne se distingue pas d'une quantité : aucune règle proposée ne peut le porter.
  Un nombre décimal ou un prix composé (« 1 drachme 3 oboles ») rend la consigne ambiguë : refus `AMBIGUOUS`, décidé par le code sans appel.
  Le code convertit les prix en oboles.
  Les règles proposées sont simulées à blanc sur l'état présent du site et des stocks de la maison : chacune est menée une fois, dans l'ordre, par le cœur de la commande (ADR 0009), dans une transaction toujours annulée, et la fiche dit ce qu'elle ferait maintenant (rien, l'ordre ou la récolte, ou le refus et sa raison).
  La proposition, ou un refus motivé (IA indisponible, réponse rejetée, consigne hors de la grammaire, consigne ambiguë), est gardée avec la consigne ; ni l'une ni l'autre ne change ensuite.
  La fiche du site montre la dernière consigne et sa réponse (vue `my_steward_instructions`), privées comme les règles : « Valider » donne les règles proposées, « Modifier » les met dans le formulaire.
  IA coupée, la fiche le dit et mène au formulaire, qui reste la voie complète du jeu.
  Une proposition ne vaut que pour la révision des règles lue à la consigne : des règles données depuis la rendent caduque.
  Le texte de la consigne n'entre ni au journal des commandes ni dans un événement ; il est effacé à la conservation de la discussion (ADR 0002).

## 4.5 L'immobilier urbain

Héritage direct des jeux de référence, relié au reste de l'économie.

- **Biens** : immeubles de rapport, maisons, boutiques, entrepôts, auberges, bains.
- **Loyer d'équilibre** : fonction de l'attractivité du quartier (temples, marché, sécurité, nuisances des ateliers) et de la population de la cité. Les travailleurs des joueurs doivent être logés : la pénurie de logements fait monter les salaires.
- **Cycle** : achat, rénovation, location, revente ; vétusté et entretien ; ventes aux enchères après saisie.
- **Urbanisme** : le zonage et les permis sont décidés par le magistrat élu (astynome).

Phase 2, première version (#256) :

- **Un seul bien, le logement, en deux tailles** : la maison de ville (`townhouse`) et l'immeuble de rapport (`tenement`).
  Boutiques, entrepôts, auberges, bains, zonage, permis et ventes aux enchères attendent la phase 3.
- **Configuration** (section `properties`, publique) : par taille, le prix d'achat à la cité, la capacité en logements, l'entretien quotidien, la vétusté perdue à chaque clôture, le seuil d'état sous lequel le bien ne loge plus personne, et le coût de la rénovation, en oboles (toujours positif) et en biens ;
  par cité, le nombre de biens de chaque taille (`countsByCity`).
  L'état d'un bien va de 0 à 10 000 (neuf).
  Configuration initiale (#668) : une maison de ville coûte 1 obole d'entretien par jour, un immeuble 3, moins que l'hébergement qu'ils évitent ; tous deux perdent 300 points d'état par jour et passent sous leur seuil en 24 jours, d'où une rénovation par mois environ ; une version publiée avant l'immobilier n'a aucun bien.
- **Parc** : chaque cité a un parc fini, d'abord détenu par elle, que le moteur crée au premier tick qui la connaît (comme sa population, 5.2) et complète jusqu'au nombre de la configuration ;
  baisser ce nombre ne retire aucun bien.
- **Achat** (`property.buy`, bien et prix vu) : une maison achète à la cité un bien qu'elle détient encore, dans n'importe quelle cité de son monde (investir ailleurs comme métèque, 6).
  Le prix de la taille est détruit (puits `sink_property_purchase`), comme l'acquisition d'un site, plutôt que versé au trésor de la cité ; un autre prix que celui vu est refusé (`PRICE_CHANGED`).
  Refus sans effet : bien déjà vendu (`PROPERTY_NOT_FOR_SALE`), taille retirée de la configuration, trésorerie qui ne couvre pas le prix.
  L'achat prend le verrou de l'agora du monde, puis la trésorerie, puis le bien : deux achats du même bien se suivent, et le second le trouve vendu.
- **Rénovation** (`property.renovate`, bien et coût vu en oboles et en biens) : la maison propriétaire rend le bien neuf (état 10 000), à tout moment, même entretien impayé.
  Le coût en oboles est détruit (puits `sink_property_works`) par une écriture `property.renovate` dont le débit est marqué `upkeep` ; les biens sortent du stock libre de la maison dans la cité du bien (hors réservations des ventes en attente) vers l'extrémité `consumption` du journal des stocks, rattachés à cette écriture, dans la même transaction.
  Refus sans effet : bien d'une autre maison ou de la cité (`PROPERTY_NOT_OWNED`), bien déjà neuf (`NOTHING_TO_RENOVATE`), taille retirée, coût changé (oboles ou biens, `PRICE_CHANGED`), stock ou trésorerie insuffisants.
- **Vétusté** : à chaque clôture, juste avant l'entretien (étape `propertyWear`), chaque bien, à la cité comme à une maison, perd la vétusté du jour de sa taille, sans passer sous zéro, une seule fois par jour de jeu (garde de la base, 12) ;
  sous le seuil de sa taille, il ne loge plus personne jusqu'à sa rénovation.
  Une clôture manquée n'use pas : comme pour l'entretien, seul le jour joué compte.
- **Entretien** : chaque clôture demande à chaque bien d'une maison, acheté avant l'instant de la clôture, l'entretien d'un jour de sa taille, dans l'écriture `upkeep.daily` de la maison, par une ligne marquée `upkeep` vers le puits `sink_property_upkeep`, après ses sites et ses navires et avec ce qui reste de la trésorerie, dans l'ordre des achats, chaque bien en entier ou pas du tout (5.5).
  Impayé, le bien ne loge personne jusqu'à la clôture qui le paie (`upkeep_unpaid_since`) ; il n'y a ni relance ni arriéré.
  Une taille retirée de la configuration ne doit rien ; un bien de la cité ne doit rien.
  L'événement `UpkeepSettled` en porte le détail (`properties` : payés, impayés, impayés constatés et levés par cette clôture).
- **Lecture** : les règles (`property_rules`) et le parc de chaque cité, par bien, sans propriétaire nommé et avec l'état des seuls biens à vendre (`city_properties`), sont publics pour tout joueur connecté ; une maison lit ses biens, leur état et leur impayé par `my_properties`.
  L'écran Immobilier (#259) montre les biens offerts, ceux de la maison et ses baux, et en porte les commandes au prix affiché.
- **Logements utiles** : un bien loge sa capacité si son état atteint le seuil de sa taille et que son entretien est payé, personne sinon (`usableHousingUnits`, `packages/sim`).
- **Logement des travailleurs** (#258, 4.4) : les logements utiles des biens qu'une maison possède sans les avoir loués, et de ceux qu'elle loue par un bail en cours, logent les travailleurs de ses sites de la cité du bien, les plus anciens sites d'abord (`allocateWorkforce`) ; un bien loué loge son locataire, pas son propriétaire, et un bien de la cité ne loge personne.
  La clôture lit ces logements une fois, après la fin des baux impayés et la vétusté du jour, avant l'entretien : un bien que cette clôture trouve impayé loge encore ce jour-là, et plus à partir de la clôture suivante ; un impayé qu'elle règle ne loge qu'à partir de la suivante, quel que soit l'ordre dans lequel elle examine les maisons.
  La relance d'un site les lit à l'instant de la commande.
  Chaque travailleur sans logement coûte une nuit d'hébergement chez les PNJ (4.4).

Phase 2, seconde version (#257) : les biens se louent et se revendent entre maisons.
Ces mouvements transfèrent de la monnaie d'une maison à une autre sans en créer ; seule la taxe de la revente en détruit une part.

- **Offres** : la maison propriétaire offre un bien à la location, au loyer quotidien qu'elle fixe (`property.offerLease`), ou à la vente, à prix affiché (`property.listForSale`), et retire son offre (`property.withdrawOffer`).
  Une seule offre est ouverte par bien, de vente ou de location (`PROPERTY_ALREADY_LISTED`) : pour en changer, on retire la première.
  Un bien loué ne s'offre ni à la vente ni à la location avant la fin du bail (`PROPERTY_LEASED`).
  Il n'y a ni enchère ni négociation : l'offre se prend à son prix, ou se retire.
- **Bail** (`property.lease`, bien et loyer vu) : une autre maison loue le bien au loyer de l'offre ; un autre loyer est refusé (`PRICE_CHANGED`), et une maison ne loue pas son propre bien (`OWN_PROPERTY`).
  Rien n'est payé à la signature : le premier loyer est celui de la première clôture qui suit.
  Le bail n'a pas de durée : il court jusqu'à ce que l'une ou l'autre partie en demande la fin (`property.endLease`), une fois et sans retour, ou jusqu'à un loyer impayé.
  La fin demandée prend effet à la clôture suivante, qui ne demande alors plus de loyer.
  Une fin demandée entre l'instant de jeu d'une clôture et son passage réel, quand la clôture est jouée en retard, termine le bail à cette clôture, sans loyer du jour.
- **Loyer** : chaque clôture, avant la vétusté et l'entretien (étape `leaseRent`), met d'abord fin aux baux dont la fin est demandée, puis demande à chaque autre bail signé avant l'instant de la clôture le loyer d'un jour, dans l'ordre des signatures, de la trésorerie du locataire à celle du propriétaire, par une écriture `lease.rent` par bail (`settleRents`, `packages/sim`).
  Le loyer est payé en entier si la trésorerie du locataire le couvre, sinon le bail prend fin, impayé ; la monnaie sous séquestre ne paie pas.
  Un loyer reçu est disponible aussitôt : il peut payer, plus loin dans l'ordre, un loyer dû par le propriétaire, puis l'entretien de ses sites, navires et biens.
  Les loyers passent les premiers de ce qui touche la monnaie pour cette raison, et parce que le logement des travailleurs (#258) lira les baux restés en cours.
  Une clôture manquée ne demande pas de loyer pour le jour manqué, comme l'entretien.
  Chaque bail terminé, demandé ou impayé, a son événement `LeaseEnded`.
- **Revente** (`property.buyListed`, bien et prix vu) : une autre maison achète le bien mis en vente, au prix affiché ; un autre prix est refusé (`PRICE_CHANGED`), une maison n'achète pas son propre bien (`OWN_PROPERTY`), et une trésorerie qui ne couvre pas le prix ne paie rien.
  Une seule écriture `property.sale` débite l'acheteur du prix, crédite le vendeur du net, et prélève la taxe de marché de la cité du bien comme à l'agora (5.3) : même calcul (`marketTax`), même répartition entre le puits `sink_market_tax` et le trésor de la cité.
  Le bien change de maison dans la même transaction et garde son état et son entretien impayé ; son instant d'achat devient celui de la revente.
  Un bien revendu entre l'instant de jeu d'une clôture et son passage réel a donc un instant d'achat postérieur à la clôture, qui ne prélève son entretien du jour ni sur l'ancien propriétaire ni sur le nouveau (seuls les biens achetés avant l'instant de la clôture le doivent).
  Événement `PropertySold`, avec le prix, le net et les deux parts de la taxe.
- **Concurrence** : toutes ces commandes prennent le verrou de l'agora du monde, puis le bien (la revente, ensuite, les deux trésoreries par identifiant) ; deux locations ou deux achats du même bien se suivent, et le second trouve l'offre fermée.
  Une offre retirée pendant qu'on l'achète ou qu'on la loue n'est ni vendue ni louée : l'un ou l'autre passe, jamais les deux.
  La base vérifie à la validation qu'une offre vendue a cédé le bien à l'acheteur et qu'un bail a fermé son offre louée (12).
- **Lecture** : les offres ouvertes de toutes les cités sont publiques pour tout joueur connecté (`property_offers` : le bien, sa cité, sa taille, son numéro, son état, la nature de l'offre et son prix ou loyer, sa date), sans la maison qui offre ; offrir un bien rend son état public.
  Offrir un bien rend aussi public son entretien impayé, que l'acheteur reprend avec le bien et qui l'empêche de loger, même loué (#403).
  `property_offers_upkeep` donne les mêmes offres avec, pour chacune, l'impayé du bien et le jour de jeu de la clôture qui l'a constaté, sans l'instant exact ; l'écran Immobilier l'annonce sur l'offre.
  Chaque partie lit les baux dont elle est partie, en cours et terminés, avec les deux maisons, le loyer, la demande de fin et la fin (`my_leases`).
  Le loyer d'équilibre viendra ensuite, et le logement des travailleurs (#258) est décrit plus haut.

## 4.6 La flotte et les caravanes

Les prix diffèrent d'une cité à l'autre ; le transport est le métier qui les rapproche.
Un trajet a une durée (2 à 20 heures réelles), un coût, une capacité et un risque (tempête, piraterie), réduit par la saison, l'escorte et la faveur de Poséidon.
Trois classes de navires au lancement : caboteur, navire rond de commerce, galère d'escorte.
La phase 2 n'en a que deux, le caboteur et le navire rond : la galère d'escorte et l'escorte attendent les conflits de la phase 3 (décision du ticket #251).
Le fret peut être vendu à d'autres joueurs.
Décision (#711) : un navire n'est pas un bien du catalogue (5.1).
Il reste acheté à la cité (`ship.acquire`, ci-dessous), jamais échangé à l'agora.

Navires, dans la phase 2 (#251) :

- Une classe de navire (`ships.classes`) a une capacité en unités de biens, tous biens confondus, une vitesse en points de base (10 000 tient la durée de référence d'une route), un prix d'achat et un entretien par jour de jeu, en oboles.
  Dans la configuration initiale (#668), l'entretien d'un jour est le salaire de l'équipage : trois marins pour un caboteur (18 oboles), huit pour un navire rond (48) ; la clôture le prélève (voyages, ci-dessous).
  Une version de configuration publiée avant le transport se lit sans aucune classe : aucun navire ne s'y achète.
- La commande `ship.acquire` (classe, prix vu) achète un navire neuf : il naît armé, à quai dans la cité de la maison, et son prix est détruit (puits `sink_ship_purchase`, 5.5) par une écriture `ship.acquire`, annoncée par un événement de domaine `ShipAcquired`.
  Elle est refusée sans rien payer si la classe n'est pas dans la configuration en vigueur, si la cité de la maison n'a pas de port (6.1), si la trésorerie ne couvre pas le prix, ou si le prix en vigueur n'est pas celui que le joueur a vu (« le prix a changé », comme pour `site.acquire`).
  La monnaie sous séquestre à l'agora ne paie pas un navire.
  Le prix vu est obligatoire, à la différence de `site.acquire` : aucun client antérieur ne l'omet.
  Il n'y a pas de limite de flotte : seul le prix borne le nombre de navires d'une maison.
- Un navire ne change jamais de maison ni de classe, et il n'y a pas de revente.
  À quai, il est dans une cité de son monde ; il n'en part qu'avec un voyage, et n'accoste qu'au terme de celui-ci, dans la cité d'arrivée.
- Les classes et leurs tarifs sont des règles publiques (vue `ship_rules`, la section `ships` de la configuration en vigueur, routes et droit de port compris).
  Chaque joueur lit ses propres navires, leur cité de mouillage et leur désarmement (vue `my_ships`).

Voyages, dans la phase 2 (#252) :

- Une route (`ships.routes`) relie deux cités à port, dans les deux sens, en 2 à 20 heures pour un navire de vitesse 10 000.
  Un trajet dure ⌈heures × 3 600 × 10 000 ÷ vitesse⌉ secondes : un navire plus lent met plus longtemps, jamais moins que la durée exacte.
  Un navire qui part pendant une tempête de sa route (7.4, #267) met ⌈durée × (10 000 + ampleur) ÷ 10 000⌉ secondes, avec la plus forte tempête en cours au départ (à égalité, celle du plus petit identifiant, soit la planification la plus ancienne) ; une tempête qui commence en cours de trajet ne le change pas.
  Décision (phase 2) : une tempête retarde, elle ne fait rien perdre ; le retard est expliqué dans `event_effects` et porté par `VoyageDeparted` (`storm`).
  Depuis #730, la même tempête majore aussi le risque de perte du voyage (pertes en mer, ci-dessous).
  Un vent favorable en attente de la maison (7.1, #266) raccourcit ensuite le trajet à ⌈durée × (10 000 − ampleur) ÷ 10 000⌉ secondes, sur la durée que la tempête a allongée, et se consomme ; il est porté par `VoyageDeparted` (`fairWind`).
  Chaque route porte les provisions d'un voyage par classe de navire, en oboles, détruites au départ (puits `sink_voyage_provisions`).
- Le droit de port de la cité d'arrivée (`ships.portDues`, 5.6) est un forfait par classe, multiplié par le coefficient de la cité (10 000 = ×1 ; une cité sans coefficient est à ×1), arrondi à l'obole supérieure, et payé au départ.
  Ce coefficient est celui du dernier décret appliqué de la cité, sinon celui de la configuration (#262) ; l'écran de départ le lit dans la vue `city_rates` et n'annonce aucun coût avant de l'avoir lu.
  Sa part détruite (`burnShareBps`, arrondie à l'obole supérieure) va au puits `sink_port_dues`, le reste au trésor de la cité d'arrivée, comme la taxe de marché.
  Configuration initiale (#668) : les provisions sont les vivres de l'équipage pendant le trajet de sa classe, à 8 oboles par marin et par jour (la dépense de référence d'un thète), arrondies à l'obole supérieure (un caboteur, une obole par heure de route) ; le droit de port est 1 % d'une soute pleine de blé à son prix de référence (18 oboles pour un caboteur, 54 pour un navire rond).
  Une version publiée avant les voyages se lit sans route ni droit de port : aucun départ n'y est possible.
- Réseau de l'archipel (#707) : avec douze cités, une route ne relie que deux voisines, et un trajet lointain passe par une escale, ce qui donne au négoce ses carrefours (6.7).
  La configuration initiale garde les six routes des quatre premières cités, telles quelles, et en ajoute dix-sept, de trois à cinq heures, entre voisines : chaque cité est reliée à au moins deux autres, et l'archipel est connexe.
  Leurs provisions suivent la règle de #668 (un caboteur, une obole par heure de route ; un navire rond, ⌈heures × 32 ÷ 9⌉).
  Décision (#707) : « voisines » se lit sur le dessin de la carte, où aucune route ne passe à moins d'un vingtième de sa largeur d'une autre cité ; la durée est réglée à la main dans la configuration, aucune distance n'est tirée du dessin.
  Décision (#707) : les six routes des quatre premières cités restent, même celles qu'une cité nouvelle borde, pour que le banc à quatre cités, qui ne joue qu'elles, garde ses mesures.
  Les tempêtes (7.4) se tirent parmi toutes les routes de la configuration entre cités du monde, nouvelles comprises.
- La commande `voyage.depart` (navire, cité de départ vue, cité d'arrivée, cargaison, coût vu) fait partir un navire armé de la maison, à quai dans la cité de départ, vers une cité reliée par une route.
  La cargaison est une liste de biens et de quantités prise dans le stock libre de la maison dans la cité de départ (quantité moins ce que réservent ses ventes en attente), dans la capacité de la classe, tous biens confondus.
  Décision : une cargaison vide est admise, le navire part sur lest (pour aller acheter ailleurs).
  Elle est refusée sans rien payer ni charger si le navire est en mer, à quai ailleurs, désarmé, d'une classe retirée de la configuration, sans route vers la destination, si un bien est inconnu, si la cargaison dépasse sa capacité ou le stock libre, si la trésorerie ne couvre pas le coût, ou si le coût en vigueur n'est pas celui que le joueur a vu (« le prix a changé »).
  Dans une seule transaction, le voyage part (arrivée prévue : le départ plus la durée du trajet), la cargaison sort du stock vers l'extrémité système `in_transit` du journal des stocks, rattachée au voyage, le navire quitte le quai, et provisions et droit de port sont payés par une écriture `voyage.departure` (nature `transport`, 4.1) ; un montant nul n'a pas de ligne, et un départ qui ne coûte rien n'a pas d'écriture.
  Un événement de domaine `VoyageDeparted` l'annonce.
  La commande prend le verrou d'agora du monde, puis la trésorerie, le navire et les stocks dans l'ordre des biens : elle ne s'intercale pas dans l'entretien d'une clôture, qui prend le même verrou d'abord.
- Le stock en mer n'est dans aucun stock de la maison : aucun ordre ne le réserve, aucun PNJ ne l'achète, et la demande des PNJ, qui ne lit pas les stocks, n'en dépend pas.
- L'arrivée est une étape du tick, jouée par le moteur après la demande des PNJ (#253, écart assumé avec l'évaluation paresseuse des trajets, 13).
  Chaque tick décharge les voyages de son monde dont l'arrivée prévue est atteinte à son instant de jeu (début de son intervalle), et seulement eux.
  Dans la transaction du tick, l'arrivée est datée de cet instant, la cargaison passe de l'extrémité `in_transit` au stock de la maison dans la cité d'arrivée (ouvert s'il n'existait pas), exactement ce qui a été chargé, et le navire y est à quai ; un événement de domaine `VoyageArrived` l'annonce.
  Un voyage échu pendant une panne du moteur est déchargé par le premier tick, rattrapé ou non, qui commence à son échéance ou après, et daté de ce tick : son arrivée peut donc être antérieure à l'écriture du déchargement.
  Un navire désarmé en mer accoste et reste désarmé ; un navire sur lest accoste sans rien décharger ; un bien retiré de la configuration se décharge comme les autres.
  Rejouer un tick, ou deux moteurs à la fois, ne décharge rien deux fois : le tick n'est joué qu'une fois, l'étape prend le verrou d'agora du monde puis les voyages échus (un voyage verrouillé ailleurs est laissé au tick suivant), et la base refuse un second déchargement.
  Tous les voyages échus d'un monde sont déchargés dans la seule transaction de son tick : une erreur sur l'un d'eux fait échouer tout le tick du monde, demande des PNJ comprise, repris au passage suivant.
  Limite connue : le tick peut s'interbloquer avec une récolte de la même maison dans la cité d'arrivée, qui verrouille ses stocks sans le verrou d'agora, quand la demande des PNJ a déjà verrouillé un de ses stocks vendus.
  PostgreSQL annule alors l'une des deux en entier, sans double effet : une récolte annulée est rejouée par l'API sous la même clé, un tick annulé est repris au passage suivant (#333, spécification 13).
  La Vigie compte les voyages en retard de déchargement de plus d'un tick (15).
  La cargaison déchargée est dans le stock libre de la maison : elle se vend aussitôt à l'agora de la cité d'arrivée ; les PNJ, qui n'achètent qu'aux ventes en attente, ne l'achètent qu'au premier tick qui suit sa mise en vente.
- L'entretien d'un navire est celui de sa classe, par jour de jeu, sans coefficient (décision : le coefficient d'entretien des sites, 5.5, ne s'y applique pas).
  La clôture examine les navires d'une maison après ses sites, avec ce qui reste de la trésorerie, par date de création puis identifiant, chacun payé en entier ou pas du tout, dans l'écriture `upkeep.daily` de la maison, par une ligne marquée `upkeep` vers le puits `sink_ship_upkeep`.
  Un navire impayé est désarmé jusqu'à une clôture qui le paie ; il n'a pas de commande de relance, et ne part pas tant qu'il est désarmé.
  Un navire désarmé en mer poursuit son voyage.
  Comme un site, un navire acquis à l'instant de jeu de la clôture ou après ne doit rien pour ce jour, et une classe retirée de la configuration ne doit rien (désarmé, son navire est réarmé sans payer).
  `UpkeepSettled` dit, pour une maison qui a des navires, leur entretien payé et impayé, et les navires désarmés et réarmés.
- Chaque joueur lit ses voyages et leur cargaison (vue `my_voyages`).

Pertes en mer, dans la phase 3 (#730) :

- Le risque en mer de la phase 2 n'est qu'un retard ; la perte vient avec la phase 3.
  Décision : un voyage peut perdre sa cargaison, jamais son navire, qui arrive à vide.
- Chaque route porte un risque de perte (`lossRiskBps`) et sa majoration pendant une tempête de la route (`stormLossRiskBps`, 7.4), en points de base, de 0 à 10 000.
  Ce sont des règles publiques (vue `ship_rules`) ; une version publiée avant les pertes se lit avec des risques nuls.
  Configuration initiale : risques nuls (paramètres neutres), aucun voyage ne perd rien.
- Le risque d'un voyage est celui de sa route, plus la majoration si une tempête de la route est en cours au départ, borné à 10 000 (`voyageLossRiskBps`, `packages/sim`).
  `voyage.depart` le fixe avec la tempête qui allonge le trajet, l'écrit avec le voyage (`loss_risk_bps`), où il ne change plus, et `VoyageDeparted` le porte (`lossRiskBps`, absent des départs antérieurs).
  Il n'est pas un coût : un risque changé entre la feuille de départ et l'envoi n'est pas refusé.
  La feuille de départ annonce dans son récapitulatif le risque de la route choisie, en pourcentage, majoré par la tempête en cours qu'elle lit déjà pour la durée (avec alors le risque par temps calme) ; un risque nul n'est pas annoncé, si bien que l'écran de la configuration initiale ne change pas.
- Le tirage se fait à l'arrivée (`voyageLoss`) : un entier uniforme de 0 à 9 999, tiré par un générateur dont la graine est celle du monde suivie de l'identifiant du voyage, perd la cargaison s'il est inférieur au risque.
  Il est rejouable, et caché jusqu'à l'arrivée : les joueurs ne lisent pas la graine du monde (7.3).
  Décision : la graine du monde s'ajoute à l'identifiant du voyage, que le joueur connaît dès le départ et qui seul lui ferait prévoir l'issue.
  Risque nul, jamais de perte ; risque plein, toujours ; la perte emporte toute la cargaison ou rien.
- À l'arrivée, dans la transaction du tick, une cargaison perdue passe en entier de `in_transit` au puits `lost_at_sea` du journal des stocks (mouvements `voyage.loss`), sans ouvrir de stock dans la cité d'arrivée, et le navire y accoste à vide.
  `VoyageArrived` ne porte alors rien de déchargé ; un événement de domaine `CargoLostAtSea` dit, après lui, le risque et la cargaison perdue.
  Un navire sur lest n'a rien à perdre : ni tirage utile, ni `CargoLostAtSea`.
  Rejouer l'arrivée ne perd rien deux fois : le tick n'est joué qu'une fois, et la base refuse qu'un bien sorte deux fois de `in_transit` (12).
  Le tirage ne dépend pas du tick : un voyage déchargé après une panne a la même issue qu'à son échéance.
  Le résumé de l'étape compte les voyages perdus et leurs unités (`lostVoyages`, `lostUnits`), seulement s'il y en a.
- La chronique de la cité d'arrivée (6.6) compte les cargaisons perdues de la journée par route, c'est-à-dire par cité de départ, sans nommer de maison : elle ne lit pas la maison de `CargoLostAtSea`.
  Décision : la perte est dite là où le navire accoste à vide, comme son arrivée, qu'elle compte aussi.
- Le joueur lit l'issue de ses voyages (`my_voyages.cargo_lost`, migration 9961) : nulle tant que le voyage est en mer, si bien que rien du tirage ne paraît avant l'arrivée, puis vraie si la cargaison a été perdue, fausse sinon.
  La carte et la fiche du navire annoncent alors un navire arrivé à vide, sa cargaison perdue en mer, et non déchargée dans le stock ; la liste des voyages garde la cargaison chargée, dite perdue.
  Le message de réussite d'un départ dit le risque fixé, que porte la réponse de `voyage.depart` (`lossRiskBps`) ; nul, il n'est pas dit.

## 4.7 Le savoir

La recherche est collective : chaque cité finance une école et choisit par vote les savoirs étudiés (irrigation, voile, comptabilité, alliages). Un savoir acquis profite à tous les citoyens, ce qui différencie les cités et nourrit les migrations.
