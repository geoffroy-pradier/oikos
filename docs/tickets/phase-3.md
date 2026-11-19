# Tickets — phase 3, bêta ouverte

À traiter dans l'ordre, après la refonte graphique (`docs/tickets/refonte.md`, #687 à #700).
Contenu de la phase (`docs/specs/17-feuille-de-route.md`) : 12 cités, 60 biens, banques et prêts, ligues et conflits, liturgies, ostracisme, Hybris, marchands PNJ négociateurs, Jeux, boutique, anglais, notifications push.
S'y ajoutent ce que la phase 2 a reporté : la borne de la masse monétaire de −5 % à +25 % sur 30 jours, qui attendait les liturgies ; le resserrement des terroirs, avec les armateurs du banc qui ravitaillent les cités ; la phrase de 5.2 sur le report du budget des PNJ pendant une pénurie ; le module du simulateur dans Olympe ; le pré-tri des signalements par l'IA.
Il faut aussi la Timè, la fortune d'une maison et une fiche publique de maison, dont liturgies, prêts, Hybris, Jeux et boutique ont besoin.
Les maisons PNJ de secours (8.3) entrent aussi en phase 3 : douze cités pour une bêta aux joueurs encore peu nombreux les demandent (18, risque « population insuffisante par cité »).

**Critère de sortie** (le schéma de la feuille de route n'est pas exporté ; proposé par délégation du propriétaire, tiré de `docs/specs/17-feuille-de-route.md` et de `docs/specs/18-indicateurs-risques-conformite.md`, mesurable par le code tant que le serveur est reporté) :

1. **Parcours de la bêta, IA coupée, en anglais.**
   Dans un monde de douze cités, un joueur peut, sur téléphone (360 px) et au clavier, l'interface en anglais, sans aucun appel à un modèle de langage, jouer tout le parcours de la bêta.
   Il emprunte au Trésor du temple et rembourse, dépose dans la banque d'une autre maison et en obtient un prêt gagé, part en mer avec un prêt maritime, accomplit une liturgie, vote un ostracisme et l'entrée de sa cité dans une ligue, contribue à un conflit, lit le palier de son Hybris et un présage, conclut un marché avec un marchand PNJ par formulaire, lit le palmarès des Jeux et la fiche publique d'une maison, achète un cosmétique au fournisseur de paiement factice et reçoit une notification push d'ordre exécuté.
   Chaque étape est couverte par un test de bout en bout de `apps/web` ; le français reste vérifié écran par écran par les autres tests de bout en bout.
2. **Économie à douze cités.**
   Le banc d'équilibrage joue 10 jours de mise en route puis 30 jours mesurés à douze cités, avec la configuration initiale calibrée en fin de phase : soixante biens, terroirs resserrés, liturgies, prêts, banques, risques en mer, Hybris, marchands et Jeux en jeu.
   Il tient dans chaque cité les bornes de la phase 1 (coût du panier de 0 à 2 % entre les dix premiers et les dix derniers jours mesurés, besoins vitaux couverts à 98 % au moins, population qui ne baisse pas).
   La masse monétaire du monde varie de −5 % à +25 % sur les 30 jours mesurés.
   Le banc joue les maisons PNJ de secours : elles tiennent une filière vitale qu'aucune maison scriptée ne tient, et se retirent de celle que les maisons scriptées couvrent.
   La marge nette quotidienne d'un site de chaque filière d'atelier reste entre la moitié et le double de la médiane de celle des sites de matières premières.
   Aucune cité ne produit tous les biens vitaux du panier de ses PNJ, et chaque bien du catalogue a un usage (tests sur la configuration initiale).
   Toutes ces bornes sont écrites à la main dans les tests.
3. **Pilotage.**
   Le tableau de bord économique d'Olympe suit chaque robinet et chaque puits ajoutés pendant la phase, et l'inégalité de fortune (Gini) par monde et par cité.
   Le module Simulateur d'Olympe lance le simulateur sur une base de simulation distincte de celle du jeu et montre son rapport.
4. **Monnaie réelle sans avantage de puissance.**
   Avec le fournisseur de paiement factice, un achat n'accorde son droit qu'une fois, même si l'avis de paiement est rejoué ; un remboursement le retire ; un compte mineur ne peut rien acheter, et l'inscription est refusée avant 15 ans.
   Aucun droit vendu n'écrit au grand livre ni au journal des stocks, et le schéma refuse une offre qui toucherait une valeur du jeu.
5. **IA.**
   Chaque nouvel usage d'IA de la phase (dialogue des marchands, pré-tri des signalements) a son repli sans IA, testé IA coupée.
   Le quota par maison et par jour du dialogue des marchands est tenu, relevé pour un abonné Mécène, et le plafond mensuel coupe l'usage proprement.
6. **Langues et notifications.**
   Chaque clé de traduction du jeu, d'Olympe, du site et des gabarits du moteur existe en français et en anglais (test).
   Une notification de chaque type (ordre exécuté, navire arrivé, vote ouvert) part vers le service push factice dans la langue du compte, et aucune d'un type que le joueur a coupé.

Les indicateurs de 18 qui demandent des joueurs réels (rétention, sessions, part des joueurs qui paient, coût IA réel) seront mesurés pendant la bêta elle-même.
Ils ne sont pas une porte de sortie de la phase tant que le serveur est reporté (exception décidée par le propriétaire en 17).

**État de la phase 2.**
Le critère de sortie de la phase 2 est vérifié par le code, écrit dans `docs/specs/17-feuille-de-route.md` le 19 novembre 2026 (#286).
Ses derniers tickets d'équilibrage, #668 et #669, sont fermés ; #286 se ferme avec la demande de fusion qui porte cette vérification et ce fichier.
Le serveur de préproduction (#33) et le fournisseur d'IA réel (#269) restent `needs-human`, hors de ces tickets.
La refonte graphique (#687 à #700) passe avant la phase 3 : chaque écran ci-dessous suit l'ADR 0011 et dépend du ticket de refonte de son onglet.

**Numérotation.**
Les numéros sont ceux des tickets GitHub, de #703 à #769, dépendances comprises.
Un ticket dont la demande de fusion dépasserait 400 lignes se découpe en demandes ordonnées (n/m), comme #668.

**Tickets `needs-human`.**
Aucun ticket ci-dessous ne demande de serveur, de domaine, de secret ni de compte tiers, sauf les trois derniers, marqués `needs-human`, qui disent chacun ce qu'il faut de l'humain.
Ce sont le fournisseur de paiement réel (#767), la relecture par un juriste des conditions d'utilisation et de vente avant la bêta ouverte (#768, 18) et les clés de production des notifications push, avec le serveur (#769, #33).

**Décisions prises en rédigeant ces tickets.**
Chaque décision est rappelée dans le ticket qu'elle concerne, et la demande de fusion met la spécification à jour.
Elles sont retenues par délégation du propriétaire, le 19 novembre 2026.

- **Paramètres neutres.** Comme en phase 2, tout nouveau paramètre économique entre neutre dans la configuration initiale : montant, probabilité ou plafond nuls, modèle de décret fermé, usage d'IA coupé.
  Les tickets d'activation et de calibrage (#717, #721, #764, #765) les activent par une version de configuration éprouvée par le banc.
- **Puits et robinets nommés.** Chaque flux de monnaie créée ou détruite a son compte système, ajouté au catalogue (migration), à `SYSTEM_ACCOUNT_KEYS`, à la liste figée du test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670.
  Chaque sortie ou entrée de biens hors des échanges a son extrémité système au journal des stocks.
- **Natures des flux de la maison.** Chaque écriture nouvelle d'une maison reçoit sa nature 4.1, lue par `my_cash_flows` et `my_income_statement`.
- **Ordre de la clôture.** L'entretien reste la dernière étape (5.5) ; chaque étape nouvelle passe avant lui, et son ticket écrit sa place dans 3 et 5.5.
- **Timè.** Elle est tenue comme la Charis, par un journal en ajout seul (code `honor`), en entiers ; elle n'est pas de la monnaie, ne s'achète pas et ne se transfère pas.
  Elle est publique, comme le dit « réputation publique » (2).
  Les « sanctions » qui la font baisser (4.1) sont celles du jeu (défaut, dérobade, Némésis), jamais celles de la modération.
- **Fortune d'une maison.** Une seule définition sert aux liturgies, à l'Hybris et au Gini : trésorerie, séquestre et stocks valorisés au prix observé (4.1), plus les créances et moins les dettes ; sites, navires et logements n'y entrent pas, comme au bilan.
- **Douze cités.** Elles ont toutes un port, et chacune un des douze dieux de 2 pour protecteur ; les caravanes terrestres attendent toujours une carte des routes de terre.
  Les routes relient des cités voisines, pas toutes les paires.
- **Soixante biens.** Ce sont 54 biens stockables au catalogue (18 matières, 16 intermédiaires, 20 finis) et les six services de 5.1 (fret, logement, spectacle, banquet, crédit, escorte), qui sont des mécaniques et non des lignes du catalogue.
  Les navires restent achetés à la cité (4.6) ; les voiles prennent leur place parmi les biens finis.
  Les mines sont des sites de type carrière, sans enchère de concession.
- **Banc à douze cités.** Le banc à quatre cités devient le banc à douze cités, dans le job `balance` de `ci`.
  S'il dépasse la durée du job, son scénario réduit la population ou le nombre de maisons scriptées, ce que le simulateur dit, plutôt que les jours mesurés.
- **Maisons PNJ de secours.** Ce sont des maisons sans compte, marquées comme telles, que le moteur crée pour une filière vitale de la configuration, avec une dotation tirée d'un robinet.
  Elles suivent des règles d'intendant de la grammaire fermée, vendent au plus au prix de référence et versent à un puits ce qui dépasse leur plafond de trésorerie.
  Elles ferment leurs sites quand les maisons de joueurs couvrent le marché de leur filière au-delà d'un seuil, les rouvrent sous un seuil plus bas, et se dissolvent sans site.
  Elles ne sont jamais citoyennes, et les classements de la phase (Gini, liturgies, Hybris, Jeux) les écartent.
- **Liturgies.** Elles se désignent à la bascule de saison, parmi les maisons les plus riches de chaque cité, pour une part bornée de leur fortune versée à un puits.
  Une liturgie non accomplie à son échéance est prélevée d'office, sans gain et avec une perte de Timè : c'est ce qui en fait un puits sûr pour la borne de masse.
- **Prêts.** Le Trésor du temple prête sans garantie, plafonné par la Timè ; une dette ne s'efface jamais, elle se prélève à chaque clôture et marque la maison de déshonneur.
  Les banques prêtent sur garantie d'un stock ou d'un logement ; sans enchères, la garantie saisie passe à la banque et solde le prêt ; le site de départ est le bien insaisissable.
  Les navires ne sont pas encore une garantie, parce que la base ne les laisse pas changer de propriétaire (12).
- **Risque en mer.** Un voyage peut perdre sa cargaison, jamais son navire ; c'est ce qui donne au prêt maritime son sens.
  Les conflits, eux, ne détruisent aucun bien de joueur (6.5) : ils retardent, ferment des routes et majorent des droits.
- **Ligues et conflits.** Tout passe par des décrets de l'assemblée, proposés par l'archonte ; le stratège et les autres magistrats attendent.
  L'hégémon d'une ligue est une cité membre, comme dans l'histoire grecque, élue par les archontes des cités membres.
- **Ostracisme.** C'est un modèle de décret qui ouvre un vote secret sur un nom ; l'ostracisé garde ses biens et son vote, perd ses charges et ne se présente plus pendant une saison.
- **Hybris.** Le joueur ne lit que le palier de sa jauge ; les ententes sur les prix attendent une détection, et le mécénat de 7.2 est la liturgie accomplie.
  Némésis frappe dans un catalogue fermé, annoncée par un présage écrit à la main, toujours évitable si la jauge redescend avant l'échéance.
- **Marchands PNJ.** Ce sont des marchands étrangers en escale : leurs achats créent de la monnaie et sortent des biens de l'Archipel, leurs ventes en détruisent et y font entrer des biens.
  Prix de réserve et marge de concession sont calculés par le moteur ; le formulaire et la contre-offre sont la voie complète du jeu, et l'IA n'est que la voix du marchand.
  Leur mémoire est faite de faits structurés en base, sans recherche vectorielle.
- **Jeux.** La durée de l'Olympiade est un paramètre de configuration ; les épreuves de la phase sont calculées à la clôture qui la termine, avec des titres permanents.
- **Boutique.** Le paiement passe par une interface de fournisseur dont la seule mise en œuvre de la phase est un fournisseur factice ; aucune offre ne touche une valeur du jeu.
  Le Laurier d'Olympiade, les statistiques avancées et les modèles d'ordres attendent une phase suivante.
- **Notifications.** Push web standard (clés VAPID par variables d'environnement documentées dans `.env.example`, générées en local et en test).
- **Simulateur dans Olympe.** Il lance le simulateur de #284 sur des mondes neufs d'une base de simulation distincte de celle du jeu ; la copie du monde réel attend le serveur.
- **Pré-tri des signalements.** L'IA range un message signalé dans une catégorie d'une liste fermée et le résume ; la file reste triée par âge et par nombre de signalements dans chaque catégorie, et la sanction reste humaine.
- **Hors de la phase 3.** Boutiques, entrepôts, auberges, bains, zonage et enchères (4.5), temples, paliers passifs, rang sacerdotal et miracles collectifs (7.1), conseil et autres magistrats (6.2) : 17 ne les place pas en phase 3, et les spécifications le diront.

## #703 — Report du budget des PNJ pendant une pénurie de la bourse

### Contexte

La spécification 5.2 dit que le report du budget non dépensé « ne devient pas une épargne qui grossit pendant une pénurie ».
C'est inexact pour une pénurie de la bourse : ce que la bourse n'a pas laissé offrir reste dû, et le report grossit jusqu'à sa borne (`market.npcBudgetCarryUnits`), comme l'a relevé #675.
Ce ticket précise la phrase et fixe le comportement par des tests, sans changer le calcul.
Label : aucun (texte et tests ; aucune écriture de monnaie nouvelle).

### Spécification liée

`docs/specs/05-economie.md` (5.2)

### Critères d'acceptation

- [ ] La phrase de 5.2 dit ce que fait le calcul : pendant une pénurie de la bourse comme de l'offre, le report grossit jusqu'à sa borne et pas au-delà, et un tick sans aucune vente le laisse tel quel.
- [ ] Test de propriétés dans `packages/sim` : sur toute suite de ticks à bourse courte, le report ne dépasse jamais sa borne, et la dépense cumulée ne dépasse jamais le revenu cumulé.
- [ ] Test d'intégration du tick : une bourse vide pendant plusieurs ticks puis regarnie ne paie, au tick qui suit, pas plus que le budget du tick plus la borne du report.
- [ ] Si un test révèle un écart entre le calcul et la spécification, la demande de fusion le dit et corrige l'un ou l'autre.

### Hors périmètre

Changement de la borne ou du calcul du report, calibrage.

### Dépendances

Aucune.

## #704 — Timè : journal de l'honneur d'une maison

### Contexte

La Timè (4.1) est l'honneur public d'une maison : elle monte avec les liturgies et les mandats bien tenus, baisse avec les défauts de paiement, et conditionne le crédit.
Liturgies, Trésor du temple, banques et conflits de la phase en ont besoin ; elle n'existe pas encore.
Décision : elle est tenue comme la Charis, par un journal en ajout seul, en entiers (code `honor`) ; elle n'est pas de la monnaie, ne s'achète pas et ne se transfère pas.
Décision (« réputation publique », 2) : la Timè d'une maison est publique, comme son nom et sa cité.
Décision (ambiguïté de 4.1) : les « sanctions » qui la font baisser sont celles du jeu (défaut, dérobade, Némésis), jamais celles de la modération.
Décision (paramètres neutres) : gains et pertes de la configuration sont nuls au départ ; chaque ticket suivant ajoute ses motifs.
Label : `sensible` (règles par ligne).

### Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1)
`docs/specs/02-univers.md`
`docs/specs/03-boucles-progression.md` (rang et classements)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration `honor` : bornes de la Timè et gain d'un mandat d'archonte mené à son terme, nul au départ ; une version publiée avant elle se lit sans Timè.
- [ ] Migration : journal `honor_ledger` (maison, variation, motif pris dans une liste fermée, référence, jour de jeu), en ajout seul pour le service de jeu, une ligne au plus par motif et par référence (index unique).
- [ ] Fonction pure `honorChange` dans `packages/sim` (variation selon le motif et la configuration, solde tenu dans ses bornes), testée par propriétés.
- [ ] La clôture qui ouvre un mandat crédite la maison du mandat qui finit, une seule fois même rejouée ; événement de domaine `HonorChanged` (maison, variation, motif, solde).
- [ ] Vue publique `house_honor` (maison, Timè) pour les joueurs connectés et vue privée `my_honor_entries`, règles par ligne testées en pgTAP ; un visiteur anonyme ne lit rien.
- [ ] Spécifications 4.1 et 12 et glossaire mis à jour (code `honor`).

### Hors périmètre

Motifs des liturgies, des prêts et des conflits (tickets suivants), écran, rang composite et classements.

### Dépendances

Aucune.

## #705 — Fiche publique d'une maison

### Contexte

Le profil public de maison (6.6) montre son blason, son palmarès et ses mandats ; la Timè, les titres des Jeux et les cosmétiques de la boutique s'y montreront.
Aucun écran ne montre aujourd'hui une autre maison que la sienne.
Décision : la fiche ne lit que des vues publiques existantes ; la devise et les avis des partenaires attendent.
Label : aucun.

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.6)
`docs/specs/10-ux-ui.md`
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Écran de la fiche publique d'une maison : blason, nom, cité, statut de métèque ou de citoyenne, Timè, mandats passés et en cours.
- [ ] On y arrive depuis l'auteur d'un message, un candidat et un magistrat.
- [ ] Une maison inconnue ou d'un autre monde mène à l'écran introuvable, sans rien révéler.
- [ ] Aucune donnée privée n'est lue : un test vérifie que l'écran n'interroge que des vues publiques.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Devise, titres des Jeux (#748) et cosmétiques (#753), avis des partenaires de contrat.

### Dépendances

#704, #690

## #706 — Douze cités (1/2) : huit cités et huit dieux protecteurs

### Contexte

« La cité est l'unité sociale du jeu : 12 cités au lancement » (6) ; le monde en a quatre.
Les douze patronages (2) donnent un protecteur à chaque cité : Zeus, Héra, Apollon, Artémis, Arès, Aphrodite, Héphaïstos et Hermès rejoignent la liste `gods`.
Noms de départ, à ajuster dans la demande de fusion : Dikaia (Zeus), Gamelia (Héra), Delphis (Apollon), Agrotera (Artémis), Phrourion (Arès), Myrrhinè (Aphrodite), Chalkeia (Héphaïstos) et Emporion (Hermès).
Décision : les douze cités ont un port ; les caravanes terrestres attendent toujours une carte des routes de terre.
Décision : le banc à quatre cités retire les huit nouvelles de son scénario jusqu'au banc à douze cités (#712), comme le banc à une cité rend sa laine à Kallistè (#669).
Les terroirs se tirent ici des huit matières premières existantes ; #708 y ajoute les nouvelles.
Label : aucun (configuration, graine et traductions ; vues et commandes de #250 inchangées).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.1)
`docs/specs/02-univers.md`
`docs/specs/07-dieux-faveur-evenements.md` (7.1)
`docs/specs/05-economie.md` (5.2, 5.5)

### Critères d'acceptation

- [ ] Configuration initiale : huit cités de plus, chacune avec son terroir, son port, son dieu protecteur, sa recette de départ si besoin, la population de la cité prototype, son multiplicateur de revenu public, le salaire de son personnel et son parc de logements.
- [ ] Huit dieux de plus dans `gods`, avec leur Charis par obole et les biens existants de leur domaine (2) ; le schéma refuse toujours un dieu inconnu.
- [ ] Aucune des huit cités ne produit tous les biens vitaux du panier de ses PNJ (test sur la configuration initiale).
- [ ] `seed.sql` crée les huit cités dans le monde de développement ; noms des cités et des dieux en `fr` et `en` dans le jeu, Olympe et les gabarits du moteur.
- [ ] Le banc à quatre cités garde ses mesures et ses bornes, en retirant les huit cités dans son scénario, ce que le simulateur dit.
- [ ] Tests d'intégration : maison fondée dans une nouvelle cité, demande des PNJ et revenu public dans chacune des douze, parc de logements créé au premier tick.
- [ ] Spécifications 6.1, 2 et 7.1 mises à jour.

### Hors périmètre

Routes et carte (ticket suivant), matières premières nouvelles (#708), cités sans port, caravanes terrestres.

### Dépendances

Aucune.

## #707 — Douze cités (2/2) : routes de l'archipel, carte et fondation

### Contexte

Les quatre cités de la phase 2 sont reliées deux à deux par six routes ; douze le seraient par soixante-six.
Décision : l'archipel a un réseau de routes entre voisines ; un trajet lointain passe par une escale, ce qui donne au négoce ses carrefours (6.7).
La position de chaque cité sur la carte vient du champ d'affichage facultatif de la configuration (#696).
Label : aucun.

### Spécification liée

`docs/specs/04-systemes-gestion.md` (4.6)
`docs/specs/06-cites-politique-communaute.md` (6.1)
`docs/specs/10-ux-ui.md`
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Configuration initiale : routes entre cités voisines (durée, provisions par classe), chaque cité reliée à au moins deux autres, l'archipel connexe (test sur la configuration).
- [ ] Position de chaque nouvelle cité sur la carte, et ses îles dessinées en SVG dans le dépôt.
- [ ] La carte et sa liste accessible montrent les douze cités et leurs routes ; la feuille de départ ne propose que les routes de la cité du navire.
- [ ] L'écran de fondation présente les douze cités (dieu, port, terroir) en liste filtrable par dieu ou par matière première.
- [ ] Les tempêtes se tirent parmi les routes de la configuration, nouvelles comprises (test).
- [ ] Tests de bout en bout : fondation dans une nouvelle cité, départ vers une cité voisine.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.
- [ ] Spécifications 4.6 et 6.1 mises à jour.

### Hors périmètre

Trajets à escales enchaînés en une commande, caravanes terrestres, parcelles et quartiers.

### Dépendances

#706, #692, #696

## #708 — Soixante biens (1/4) : matières premières

### Contexte

« Le lancement compte 60 biens en quatre niveaux » (5.1) ; le monde en a quinze, dont huit matières premières.
Décision (ambiguïté de 5.1) : les soixante biens sont 54 biens stockables du catalogue (18 matières, 16 intermédiaires, 20 finis) et les six services de 5.1, fret, logement, spectacle, banquet, crédit et escorte, qui sont des mécaniques et non des lignes du catalogue.
Liste de départ, à ajuster : orge, lin et figues (champ et verger), peaux (pâture), miel (forêt), marbre, cuivre, étain, fer et argent (carrière).
Décision : les mines sont des sites de type carrière (4.2), acquis comme les autres, sans enchère de concession.
Décision (paramètres neutres) : aucun bien nouveau n'entre dans un panier des PNJ ni dans l'indice des prix ; #713 règle les paniers.
Label : aucun (configuration et traductions).

### Spécification liée

`docs/specs/05-economie.md` (5.1)
`docs/specs/04-systemes-gestion.md` (4.2)
`docs/specs/06-cites-politique-communaute.md` (6.1)

### Critères d'acceptation

- [ ] Configuration initiale : dix matières premières de plus (prix de référence, élasticité), chacune avec sa recette (type de site, durée, travailleurs, plafond), soit dix-huit.
- [ ] Chaque recette nouvelle est dans le terroir d'au moins une cité et d'au plus quatre (test sur la configuration).
- [ ] Marge nette quotidienne de chaque recette nouvelle, au prix de référence, salaires et entretien déduits, entre la moitié et le double de la médiane des matières premières de la phase 2 (test, bornes écrites à la main).
- [ ] Noms des biens et des recettes en `fr` et `en` dans le jeu, Olympe et les gabarits du moteur ; un bien sans illustration propre prend celle de son niveau.
- [ ] Le banc à une cité et le banc à quatre cités gardent leurs bornes.
- [ ] Spécifications 5.1, 4.2 et 6.1 (terroirs) mises à jour.

### Hors périmètre

Intermédiaires et biens finis (tickets suivants), paniers des PNJ, qualité, fertilité, parcelles, enchères de concessions.

### Dépendances

#706

## #709 — Soixante biens (2/4) : intermédiaires

### Contexte

5.1 nomme farine, huile, moût, planches, bronze, fer forgé, fil, tissu, cuir, charbon et pigments ; le monde en a quatre (farine, huile, charbon, tissu).
Liste de départ, à ajuster : les sept qui manquent de 5.1, plus farine d'orge, toile de lin, cire, lingots d'argent et blocs de marbre, soit seize.
Décision : les recettes de la phase 2 ne changent pas (le vin reste fait de raisin, le tissu de laine), pour garder les marges de #285 et les mesures des bancs.
Label : aucun (configuration et traductions).

### Spécification liée

`docs/specs/05-economie.md` (5.1)
`docs/specs/04-systemes-gestion.md` (4.3)

### Critères d'acceptation

- [ ] Configuration initiale : douze intermédiaires de plus, chacun avec sa recette d'atelier, soit seize.
- [ ] Chaque intermédiaire est l'intrant d'au moins une recette, de ce ticket ou d'un bien fini à venir (#710, #711), ce que le test vérifie à la fin de #711.
- [ ] Marge nette quotidienne de chaque atelier nouveau, intrants au prix de référence, entre la moitié et le double de la médiane des matières premières (test, bornes écrites à la main).
- [ ] Noms en `fr` et `en` dans le jeu, Olympe et les gabarits du moteur.
- [ ] Les bancs gardent leurs bornes.
- [ ] Spécifications 5.1 et 4.3 mises à jour.

### Hors périmètre

Biens finis (tickets suivants), paniers des PNJ, qualité, cadence, marques.

### Dépendances

#708

## #710 — Soixante biens (3/4) : biens finis du quotidien

### Contexte

Le monde a trois biens finis : pain, vin et amphores.
Liste de départ, à ajuster : galettes d'orge, poisson salé, garum, lampes à huile, sandales, outils et vêtements.
Label : aucun (configuration et traductions).

### Spécification liée

`docs/specs/05-economie.md` (5.1)
`docs/specs/04-systemes-gestion.md` (4.3)

### Critères d'acceptation

- [ ] Configuration initiale : sept biens finis de plus, chacun avec sa recette d'atelier, soit dix.
- [ ] Marge nette quotidienne de chaque atelier nouveau entre la moitié et le double de la médiane des matières premières (test, bornes écrites à la main).
- [ ] Noms en `fr` et `en` dans le jeu, Olympe et les gabarits du moteur.
- [ ] Les bancs gardent leurs bornes.
- [ ] Spécification 5.1 mise à jour.

### Hors périmètre

Biens de luxe (ticket suivant), paniers des PNJ (#713), qualité.

### Dépendances

#709

## #711 — Soixante biens (4/4) : biens finis de luxe et d'ouvrage

### Contexte

5.1 nomme aussi céramique peinte, parfums, bijoux, meubles, statues et navires parmi les biens finis.
Décision : les navires restent achetés à la cité (4.6, #251) et n'entrent pas au catalogue ; les voiles prennent leur place.
Liste de départ, à ajuster : céramique peinte, parfums, bijoux, meubles, statues, armes, voiles, cordages, bougies et mosaïques.
Label : aucun (configuration et traductions).

### Spécification liée

`docs/specs/05-economie.md` (5.1)
`docs/specs/04-systemes-gestion.md` (4.3, 4.6)

### Critères d'acceptation

- [ ] Configuration initiale : dix biens finis de plus, chacun avec sa recette d'atelier ; le catalogue compte 18 matières, 16 intermédiaires et 20 biens finis (test).
- [ ] Chaque matière première et chaque intermédiaire est l'intrant d'au moins une recette (test sur la configuration initiale, qui nomme un bien sans débouché).
- [ ] Marge nette quotidienne de chaque atelier nouveau entre la moitié et le double de la médiane des matières premières (test, bornes écrites à la main).
- [ ] Noms en `fr` et `en` dans le jeu, Olympe et les gabarits du moteur.
- [ ] Les bancs gardent leurs bornes.
- [ ] Spécifications 5.1 et 4.6 (navires hors catalogue) mises à jour.

### Hors périmètre

Paniers des PNJ (#713), qualité et marques, chantier naval de joueur.

### Dépendances

#710

## #712 — Banc d'équilibrage à douze cités

### Contexte

Le banc à quatre cités (`apps/api/src/balance-world.bench.ts`, #281 à #283) retire depuis #706 les huit nouvelles cités de son scénario.
Ce ticket les approvisionne et y tient les bornes de la phase 2.
Décision : le même banc devient le banc à douze cités, dans le job `balance` de `ci` ; s'il dépasse la durée du job, son scénario réduit la population ou le nombre de maisons scriptées, ce que le simulateur dit, plutôt que les jours mesurés.
Label : aucun (test ; aucune écriture de monnaie nouvelle).

### Spécification liée

`docs/specs/05-economie.md` (5.5)
`docs/specs/15-back-office-olympe.md` (15.2)
`docs/specs/17-feuille-de-route.md`

### Critères d'acceptation

- [ ] Le scénario joue les douze cités de la configuration initiale : maisons scriptées dans chaque cité, armateurs scriptés sur les routes de #707, intendants comme à quatre cités.
- [ ] Bornes de la phase 2, écrites à la main, dans chaque cité : coût du panier de 0 à 2 %, besoins vitaux couverts à 98 % au moins, population qui ne baisse pas ; borne de masse contre l'emballement de #283.
- [ ] Marges de chaque filière d'atelier, nouvelles comprises, entre la moitié et le double de la médiane des matières premières (#285).
- [ ] Le banc tient dans la durée du job `balance`, et la demande de fusion dit sa durée.
- [ ] Le simulateur (#284) joue le même scénario ; même graine, même rapport.
- [ ] Spécification 5.5 : calibrage à douze cités, mesures et durée.

### Hors périmètre

Paniers des PNJ (#713), terroirs resserrés (#714), borne de masse de −5 % à +25 % (#721).

### Dépendances

#707, #711

## #713 — Paniers des PNJ et usage de chaque bien

### Contexte

Les biens finis nouveaux n'ont aucun acheteur final : les classes de PNJ n'achètent que les six biens de la phase 1.
Le peuple achète le prix et les riches la qualité (4.3) : les classes aisées prennent le confort et le luxe, sans toucher aux besoins vitaux.
Les dieux prennent en offrande les biens de leur domaine (2), et les fêtes de la cité peuvent porter sur les biens finis nouveaux.
Le revenu des classes suit leur panier (5.2) ; le revenu public créé chaque jour et la couverture des besoins vitaux sont tenus par le banc, et la demande de fusion dit le réglage retenu.
Label : aucun (configuration et test).

### Spécification liée

`docs/specs/05-economie.md` (5.1, 5.2, 5.5)
`docs/specs/07-dieux-faveur-evenements.md` (7.1, 7.5)
`docs/specs/02-univers.md`

### Critères d'acceptation

- [ ] Paniers des zeugites, des hippeis et des pentacosiomédimnes : biens finis nouveaux en confort et en luxe ; besoins vitaux et panier de l'indice des prix inchangés.
- [ ] Chaque bien du catalogue a un usage : intrant d'une recette, panier d'une classe, offrande acceptée par un dieu, bien d'une fête ou d'une rénovation (test sur la configuration initiale, qui nomme un bien sans usage).
- [ ] Charis par unité des biens de leur domaine pour chacun des douze dieux, et biens des fêtes (`decrees.models.festival.goodIds`) élargis.
- [ ] Le banc à douze cités tient ses bornes, et la demande de fusion joint le rapport du simulateur.
- [ ] Spécifications 5.1, 5.2, 5.5 et 7.1 mises à jour.

### Hors périmètre

Qualité et marques, besoins vitaux nouveaux, indice des prix élargi.

### Dépendances

#712

## #714 — Terroirs resserrés et armateurs du banc

### Contexte

Depuis #669, aucune cité n'a toutes les matières premières de son panier, mais Kallistè n'a perdu que la laine.
Un resserrement plus fort demandait des armateurs qui ravitaillent les cités dans le banc (6.1) ; le banc à douze cités en a depuis #712.
Ce ticket resserre les terroirs pour que chaque cité importe au moins un bien vital, ou l'intrant d'un bien vital.
Label : aucun (configuration et test).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.1)
`docs/specs/05-economie.md` (5.5)

### Critères d'acceptation

- [ ] Configuration initiale : chaque cité manque d'au moins un bien vital du panier de ses PNJ ou de l'intrant d'un bien vital ; Kallistè perd au moins le poisson ou le sel.
- [ ] Test sur la configuration initiale : aucune cité ne produit tous ses biens vitaux, et le message d'échec nomme la cité.
- [ ] Le banc à douze cités a les armateurs scriptés qui ravitaillent chaque cité de ce qui lui manque, et tient ses bornes.
- [ ] Le banc à une cité de #78 garde son scénario (Kallistè avec toutes ses matières premières) et ses bornes.
- [ ] Spécifications 6.1 et 5.5 mises à jour.

### Hors périmètre

Maisons PNJ de secours (tickets suivants), caravanes terrestres.

### Dépendances

#713

## #715 — Maisons PNJ de secours (1/3) : maisons sans compte, sites et dotation

### Contexte

« Des maisons PNJ, clairement identifiées comme telles, tiennent les filières vitales qu'aucun joueur n'occupe et se retirent quand des joueurs prennent la place » (8.3).
Douze cités pour une bêta aux joueurs encore peu nombreux : sans elles, une cité où personne ne fait de blé ou de pain émigre (5.2), et 18 en fait la parade contre une population insuffisante.
Décision : une maison PNJ est une maison du monde sans compte, marquée comme telle, que le moteur crée dans une cité pour une filière vitale de la configuration (recettes et nombre de sites).
Décision : sa trésorerie de départ vient du robinet `faucet_npc_house_grant`, comme une dotation de départ, et elle paie entretien, salaires et hébergement comme toute maison.
Décision : elle n'est jamais citoyenne, ne vote pas, n'écrit pas, et les classements de la phase (fortune et Gini, liturgies, Hybris, Jeux) l'écartent.
Décision (paramètres neutres) : aucune filière de secours dans la configuration initiale ; #717 les active.
Label : `sensible` (monnaie, stocks, règles par ligne).

### Spécification liée

`docs/specs/08-ia.md` (8.3)
`docs/specs/18-indicateurs-risques-conformite.md` (Risques)
`docs/specs/05-economie.md` (5.5)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration `npcHouses` : par cité, filières de secours (recettes, nombre de sites, dotation) et plafond de trésorerie ; vide au départ.
- [ ] Migration : une maison porte sa nature (joueur ou PNJ) ; la base garantit qu'une maison PNJ n'a pas de compte et qu'aucune commande de l'API de jeu n'agit pour elle (pgTAP).
- [ ] Robinet `faucet_npc_house_grant` ajouté au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670.
- [ ] Étape de la clôture, avant l'entretien : la maison PNJ d'une filière configurée qui n'en a pas est créée avec ses sites et sa dotation, une seule fois même rejouée ; événement `NpcHouseFounded`.
- [ ] La vue publique des maisons dit qu'une maison est PNJ, et la fiche publique (#705) l'annonce comme telle (règles par ligne testées en pgTAP).
- [ ] Une maison PNJ n'est jamais citoyenne et ne vote à aucune élection ni à aucun décret (test).
- [ ] Spécifications 8.3, 5.5 et 12 mises à jour, avec la règle qui écarte les maisons PNJ des classements.

### Hors périmètre

Stratégie de vente (ticket suivant), retrait devant les joueurs et activation (#717), maisons PNJ hors des filières vitales.

### Dépendances

#705, #714

## #716 — Maisons PNJ de secours (2/3) : stratégie à règles

### Contexte

Une maison PNJ suit « des stratégies à règles, pas un modèle de langage, pour rester prévisible et peu coûteuse » (8.3).
Décision : ses sites portent des règles d'intendant de la grammaire fermée (#278), écrites dans la configuration de sa filière, que le moteur exécute comme celles d'un intendant (#279), sans salaire d'intendant.
Décision : elle vend au plus au prix de référence de la configuration, pour ancrer l'offre sans capter la demande.
Décision : la trésorerie au-delà du plafond de la configuration va à chaque clôture au puits `sink_npc_house_surplus`, si bien qu'une maison PNJ ne thésaurise pas et ne gonfle pas la masse.
Label : `sensible` (monnaie, stocks).

### Spécification liée

`docs/specs/08-ia.md` (8.3)
`docs/specs/04-systemes-gestion.md` (4.4)
`docs/specs/05-economie.md` (5.5)

### Critères d'acceptation

- [ ] Configuration d'une filière de secours : règles de récolte, de vente et d'achat d'intrants de chaque site, dans la grammaire de #278 ; le schéma refuse une vente au-dessus du prix de référence.
- [ ] Le moteur exécute les règles des maisons PNJ au même pas que celles des intendants (#279).
- [ ] Puits `sink_npc_house_surplus` ajouté au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670 ; étape de la clôture, avant l'entretien, une seule fois même rejouée (écriture `npc_house.surplus`).
- [ ] Une maison PNJ qui ne peut payer son entretien s'arrête comme une autre ; aucun robinet ne la renfloue après sa dotation.
- [ ] Tests d'intégration : récolte et vente d'un champ, achat d'intrants et vente d'un moulin, surplus versé au puits, arrêt faute d'entretien.
- [ ] Spécifications 8.3, 4.4 et 5.5 mises à jour.

### Hors périmètre

Retrait devant les joueurs et activation (ticket suivant), règles écrites par un modèle de langage.

### Dépendances

#715

## #717 — Maisons PNJ de secours (3/3) : retrait devant les joueurs et banc à douze cités

### Contexte

Les maisons PNJ « se retirent quand des joueurs prennent la place » (8.3).
Décision : à chaque clôture, pour chaque filière de secours d'une cité, la part des maisons de joueurs dans les ventes du bien de la filière sur une fenêtre se compare à deux seuils.
Au-dessus du seuil haut pendant un nombre de jours de la configuration, la maison PNJ ferme un site ; sous le seuil bas, elle en rouvre un, dans la limite de sa filière ; l'écart entre les deux seuils évite les allers-retours.
Décision : sans site, elle met son stock en vente au prix de référence, verse sa trésorerie au puits du surplus une fois le stock vendu, puis se dissout.
Ce ticket active les maisons PNJ dans la configuration initiale, et le banc à douze cités les joue.
Label : `sensible` (monnaie, stocks).

### Spécification liée

`docs/specs/08-ia.md` (8.3)
`docs/specs/05-economie.md` (5.5)
`docs/specs/17-feuille-de-route.md`

### Critères d'acceptation

- [ ] Configuration : seuils haut et bas, fenêtre et nombre de jours du retrait.
- [ ] Fonction pure `npcHouseRetreat` dans `packages/sim`, testée par propriétés : jamais de retrait sous le seuil haut, jamais de retour au-dessus du seuil bas, au plus un site fermé ou rouvert par clôture.
- [ ] Étape de la clôture, avant l'entretien, une seule fois même rejouée : fermeture, réouverture, dissolution ; événements `NpcHouseRetreated`, `NpcHouseReturned` et `NpcHouseDissolved`.
- [ ] Test d'intégration : des maisons de joueurs qui couvrent le marché d'une filière font se retirer la maison PNJ, qui revient quand elles cessent de vendre.
- [ ] Configuration initiale : filières de secours activées pour les biens vitaux de chaque cité, justifiées par le rapport du simulateur.
- [ ] Banc à douze cités : dans une cité où aucune maison scriptée ne tient une filière vitale, la maison PNJ la tient et les bornes de la cité restent vertes ; dans une cité couverte, elle s'est retirée avant la fin de la mise en route (bornes écrites à la main).
- [ ] Spécifications 8.3 et 5.5 mises à jour.

### Hors périmètre

Maisons PNJ hors des filières vitales, maisons PNJ qui transportent.

### Dépendances

#716

## #718 — Fortune d'une maison et inégalité (Gini)

### Contexte

Liturgies et Hybris se règlent sur la fortune d'une maison, et le module Économie d'Olympe doit suivre l'inégalité de fortune (Gini, 15.1).
Décision : une seule définition, calculée à l'identique par `packages/sim` et par la base : trésorerie, séquestre, et stocks valorisés au prix observé de leur cité (4.1).
Sites, navires et logements n'y entrent pas, comme au bilan ; chaque ticket qui ajoute une créance ou une dette (prêts, dépôts) l'ajoute à la fortune.
Label : `sensible` (base d'un puits proportionnel à la richesse ; lecture de la monnaie et des stocks de toutes les maisons).

### Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1)
`docs/specs/05-economie.md` (5.5)
`docs/specs/15-back-office-olympe.md` (15.1)

### Critères d'acceptation

- [ ] Fonction pure `houseWealth` dans `packages/sim` et fonction de la base `game.house_wealth`, accordée au seul service, qui rendent la même valeur sur les mêmes données (test d'intégration).
- [ ] Un stock sans prix observé ne compte pas, et le nombre de ces stocks est rendu à côté, comme au bilan.
- [ ] Coefficient de Gini des fortunes de chaque monde et de chaque cité, en points de base, calculé en entiers (`giniBps`, testé par propriétés : nul pour des fortunes égales, croissant quand une fortune passe d'une maison pauvre à une riche).
- [ ] `GET /api/admin/economy` rend le Gini par monde et par cité, et le module Économie l'affiche en `fr` et en `en`.
- [ ] Le banc à douze cités et le simulateur rapportent le Gini au premier et au dernier jour mesuré, sans borne.
- [ ] Aucune vue exposée au client ne rend la fortune d'une maison (pgTAP).
- [ ] Les maisons PNJ de secours n'entrent pas dans le Gini (test).
- [ ] Spécifications 4.1, 5.5 et 15.1 mises à jour.

### Hors périmètre

Valeur des sites, navires et logements, borne sur le Gini.

### Dépendances

#712, #699

## #719 — Liturgies (1/2) : désignation des maisons les plus riches

### Contexte

« Chaque saison, les maisons les plus riches se voient confier une dépense publique (fête, navire d'escorte, chœur) » ; c'est « le principal frein à l'effet boule de neige » (6.4).
C'est aussi le puits proportionnel à la richesse qu'attend la borne de masse de −5 % à +25 % depuis #283 (5.5).
Décision : à la clôture de la bascule de saison, chaque cité désigne, parmi les maisons qui y ont leur foyer, les plus riches au-dessus d'un plancher de fortune (#718).
Décision : le dû est une part bornée de la fortune ; le genre (fête, triérarchie, chorégie) est tiré dans la configuration et ne change que le libellé.
Décision (paramètres neutres) : aucune maison n'est désignée dans la configuration initiale ; #721 les active.
Label : `sensible` (règles par ligne ; fortune lue).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.4)
`docs/specs/05-economie.md` (5.5)
`docs/specs/03-boucles-progression.md` (bascule de saison)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration `liturgies` : maisons par cité, plancher de fortune, part de la fortune, dû minimal et maximal, délai en jours de jeu, genres, gains de Timè et de Charis, perte de Timè d'une dérobade ; une version publiée avant elle n'en désigne aucune.
- [ ] Migration : table `liturgies` (maison, cité, saison, genre, dû, échéance, état : désignée, accomplie, prélevée d'office), une au plus par maison et par saison (index unique).
- [ ] Dû calculé par `liturgyDue` dans `packages/sim`, testé par propriétés : croissant avec la fortune, dans ses bornes, en oboles entières arrondies vers le haut.
- [ ] Étape de la clôture de bascule de saison, avant l'entretien : classement par fortune, à égalité par ancienneté puis identifiant ; rejouée, elle ne désigne pas deux fois, et ni une maison exclue ni une maison PNJ de secours n'est désignée (test).
- [ ] Événement `LiturgyAssigned` ; vue privée `my_liturgies` et vue publique `city_liturgies` (maison, genre, état, sans le dû ni la fortune), règles par ligne testées en pgTAP.
- [ ] Spécifications 6.4, 3 et 12 mises à jour.

### Hors périmètre

Accomplissement et dérobade (ticket suivant), écran, effet d'une liturgie de fête sur la demande des PNJ, navire d'escorte réel.

### Dépendances

#704, #718

## #720 — Liturgies (2/2) : accomplissement, faste et dérobade

### Contexte

« L'assumer avec faste rapporte Timè et Charis ; s'y dérober coûte cher en réputation » (6.4).
Le faste est ce qu'une maison paie au-delà de son dû, dans une borne : il rapporte plus de Timè et de Charis envers le dieu protecteur de la cité.
Décision (ambiguïté de 6.4, et pour que le puits tienne la masse) : une liturgie non accomplie à son échéance est prélevée d'office sur la trésorerie, sans gain et avec la perte de Timè d'une dérobade ; ce que la trésorerie ne couvre pas est abandonné, sans dette, avec la même perte.
Décision : un puits à part, `sink_liturgies`, et non `sink_offerings`, pour que le tableau de bord distingue les deux.
Label : `sensible` (monnaie).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.4)
`docs/specs/05-economie.md` (5.5)
`docs/specs/04-systemes-gestion.md` (4.1)
`docs/specs/07-dieux-faveur-evenements.md` (7.1)

### Critères d'acceptation

- [ ] Commande `liturgy.perform` (liturgie, dû vu, faste) : dû et faste en une écriture `liturgy.perform` ; Timè et Charis créditées ; refusée pour une liturgie d'une autre maison, déjà accomplie ou échue, un faste hors borne ou un dû changé (`PRICE_CHANGED`).
- [ ] Puits `sink_liturgies` ajouté au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670.
- [ ] Nature 4.1 `liturgies`, hors exploitation, lue par `my_cash_flows` et `my_income_statement`.
- [ ] Étape de la clôture, avant l'entretien : chaque liturgie échue non accomplie est prélevée d'office, en entier ou pour ce que couvre la trésorerie hors séquestre (écriture `liturgy.levy`), avec la perte de Timè ; rejouée, elle ne prélève pas deux fois.
- [ ] Événements `LiturgyPerformed` et `LiturgyLevied`.
- [ ] Tests d'intégration : idempotence, faste borné, trésorerie insuffisante, prélèvement d'office entier et partiel, Timè et Charis créditées une seule fois.
- [ ] Spécifications 6.4, 5.5, 4.1 et 7.1 mises à jour.

### Hors périmètre

Écran (#723), calibrage (#721), effet sur l'Hybris (#734).

### Dépendances

#719

## #721 — Calibrage des liturgies : masse monétaire de −5 % à +25 %

### Contexte

La borne de −5 % à +25 % de la masse monétaire sur les 30 jours mesurés attend depuis #283 un puits proportionnel à la richesse (5.5, 17).
Ce ticket active les liturgies dans la configuration initiale et écrit cette borne dans le banc à douze cités, dont les maisons scriptées accomplissent leurs liturgies ou s'y dérobent selon leur stratégie.
Le revenu public peut baisser en même temps, si les bourses des PNJ restent assez garnies par les salaires et l'hébergement (5.5) ; la demande de fusion dit le réglage retenu et joint le rapport du simulateur.
Label : aucun (configuration et test).

### Spécification liée

`docs/specs/05-economie.md` (5.5)
`docs/specs/17-feuille-de-route.md`

### Critères d'acceptation

- [ ] Configuration initiale : liturgies activées (maisons par cité, plancher, part, bornes, délai, gains), justifiées par le rapport du simulateur.
- [ ] Banc à douze cités : la masse du monde varie de −5 % à +25 % sur les 30 jours mesurés, borne écrite à la main ; les bornes de la phase 2 (panier, besoins vitaux, population, marges) restent vertes.
- [ ] Le banc rapporte la part de `sink_liturgies` dans la monnaie détruite et le Gini au début et à la fin.
- [ ] Aucun site ne s'arrête dans le banc faute de trésorerie à cause d'une liturgie.
- [ ] Spécification 5.5 : limite connue levée, calibrage décrit.

### Hors périmètre

Autres paramètres de la phase (#764, #765).

### Dépendances

#717, #720

## #722 — Ostracisme

### Contexte

« Une fois par année de jeu, l'assemblée peut écarter un citoyen des charges publiques pour une saison », sans toucher à ses biens (6.4).
Décision : l'ostracisme est un modèle de décret (`ostracism`) que l'archonte propose ; adopté, il ouvre un vote où chaque citoyen inscrit un nom, secret comme les autres votes (ADR 0007).
Décision : le citoyen le plus nommé est ostracisé si les bulletins atteignent le quorum du modèle ; à égalité, personne ne l'est.
Décision : l'ostracisé garde ses biens, sa Timè et son vote ; pendant une saison, il ne se présente à aucune élection et ne propose aucun décret, et s'il est archonte sa charge devient vacante jusqu'au mandat suivant.
Label : `sensible` (règles par ligne, vote secret).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.2, 6.3, 6.4)
`docs/adr/0007-elections-calendrier-vote-secret.md`
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration `decrees.models.ostracism` (quorum, durée du vote) fermée au départ ; au plus un ostracisme par cité et par année de jeu, refusé sinon (`OSTRACISM_TOO_SOON`).
- [ ] Commande `city.castOstracon` (nom d'un citoyen de la même cité), une fois par maison et par vote, refusée hors vote ou à un non-citoyen.
- [ ] Dépouillement à la clôture, avant l'entretien, une seule fois même rejoué : ostracisé, égalité ou quorum manqué ; événement `HouseOstracized`.
- [ ] `city.standForElection` et `city.proposeDecree` refusent un ostracisé (`OSTRACIZED`) ; un archonte ostracisé quitte sa charge à cette clôture.
- [ ] Vues : ostracismes de chaque cité, décompte public après le dépouillement seulement, vote de sa maison sans son choix ; règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : fréquence annuelle, égalité, quorum manqué, archonte ostracisé, fin de l'ostracisme après une saison.
- [ ] Spécifications 6.2, 6.3, 6.4 et 12 mises à jour.

### Hors périmètre

Écran (ticket suivant), conseil et autres magistrats, perte de Timè de l'ostracisé.

### Dépendances

Aucune.

## #723 — Écran Cité : liturgies et ostracisme

### Contexte

Les liturgies (#719, #720) et l'ostracisme (#722) n'ont pas d'écran.
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/specs/06-cites-politique-communaute.md` (6.4)
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Tableau de bord de la maison : alerte d'une liturgie désignée, avec son genre, son dû, son échéance et un lien vers l'accomplissement.
- [ ] Feuille d'accomplissement par étapes : dû, faste avec boutons ± et raccourcis, récapitulatif de la Timè et de la Charis gagnées, confirmation au dû vu.
- [ ] Une liturgie prélevée d'office le dit, avec la Timè perdue.
- [ ] Onglet Cité : liturgies de la saison (maison, genre, état), sans montant.
- [ ] Onglet Cité : ostracisme au vote, avec le choix d'un citoyen dans une liste filtrable, le vote de sa maison sans son choix, puis le décompte et l'ostracisé.
- [ ] Montants en drachmes et oboles.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Fiche de l'ostracisé hors de la cité, historique des liturgies passées au-delà de la saison.

### Dépendances

#720, #722, #693, #697

## #724 — Trésor du temple (1/2) : emprunt et remboursement

### Contexte

« Trésor du temple : prêteur PNJ au taux directeur, plafonné par la Timè. Levier de politique monétaire des administrateurs. » (5.4)
Ses prêts sont un robinet et ses intérêts un puits (5.5) ; le taux directeur est l'un des trois leviers de l'inflation.
Décision : le principal est créé par le robinet `faucet_temple_loans`, et son remboursement recrédite ce robinet, qui ne compte en net que ce qui reste dû ; les intérêts vont au puits `sink_temple_interest`.
Décision : intérêt simple fixé à l'emprunt pour toute la durée, principal × taux × jours ÷ (10 000 × 365), arrondi à l'obole supérieure.
Décision : un prêt du temple à la fois par maison, plafonné par paliers de Timè ; plafonds nuls au départ (paramètres neutres).
Label : `sensible` (monnaie, règles par ligne).

### Spécification liée

`docs/specs/05-economie.md` (5.4, 5.5)
`docs/specs/04-systemes-gestion.md` (4.1)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration `templeTreasury` : taux directeur annuel en points de base, durées admises en jours de jeu, plafond du principal par palier de Timè ; nul au départ.
- [ ] Migration : table `loans` (prêteur, emprunteur, principal, intérêt, échéance, reste dû, état), prête pour les prêts de banque ; la base garantit que le reste dû est la somme des décaissements et des intérêts moins les remboursements, jamais négative (pgTAP).
- [ ] Robinet `faucet_temple_loans` et puits `sink_temple_interest` ajoutés au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670.
- [ ] Commande `loan.borrowFromTemple` (montant, durée, taux vu) : écriture `loan.temple_disburse` ; refusée au-delà du plafond, avec un prêt en cours, sous une marque de déshonneur ou à un taux changé (`RATE_CHANGED`).
- [ ] Commande `loan.repay` (prêt, montant) : intérêts d'abord, en une écriture `loan.repay` ; refusée au-delà du reste dû ou de la trésorerie.
- [ ] Natures 4.1 : emprunt et remboursement du principal hors exploitation, intérêts en charges.
- [ ] La fortune (#718) déduit le reste dû.
- [ ] Vue privée `my_loans` et vue publique `temple_treasury_rules` (taux, durées, plafonds), règles par ligne testées en pgTAP ; événements `LoanDisbursed` et `LoanRepaid`.
- [ ] Spécifications 5.4, 5.5, 4.1 et 12 mises à jour.

### Hors périmètre

Échéance et défaut (ticket suivant), banques, écran.

### Dépendances

#704, #718

## #725 — Trésor du temple (2/2) : échéance, défaut et déshonneur

### Contexte

Un défaut entraîne la saisie de la garantie et une marque de déshonneur temporaire, sans faillite définitive (5.4) ; un prêt du temple n'a pas de garantie.
Décision : à l'échéance, la clôture prélève le reste dû sur la trésorerie ; ce qu'elle ne couvre pas reste dû, sans intérêt de plus, et se prélève à chaque clôture suivante.
Décision : une dette ne s'efface jamais, puisqu'elle effacerait la monnaie créée ; la maison en défaut perd de la Timè et porte une marque de déshonneur jusqu'à `dishonorDays` jours après le solde.
Label : `sensible` (monnaie).

### Spécification liée

`docs/specs/05-economie.md` (5.4, 5.5)
`docs/specs/03-boucles-progression.md` (clôture)

### Critères d'acceptation

- [ ] Étape de la clôture, avant l'entretien : chaque prêt échu prélève ce que couvre la trésorerie hors séquestre (écriture `loan.collect`, intérêts d'abord), une seule fois par prêt et par jour même rejouée.
- [ ] Un prêt non soldé à son échéance passe en défaut : événement `LoanDefaulted`, perte de Timè, marque de déshonneur de la maison.
- [ ] La marque refuse tout nouvel emprunt (`DISHONORED`) et se lit dans la vue publique de la Timè.
- [ ] Tests d'intégration : échéance payée, payée en partie puis soldée aux clôtures suivantes, défaut, marque levée, clôture rejouée, sites arrêtés faute d'entretien après le prélèvement.
- [ ] Spécifications 5.4, 3 (ordre de la clôture) et 5.5 mises à jour.

### Hors périmètre

Garanties et saisie (banques), enchères.

### Dépendances

#724

## #726 — Banques (1/4) : fonder une banque

### Contexte

Une banque de joueur (trapeza) collecte des dépôts rémunérés et prête à taux libre avec garantie, sous un ratio de réserve minimal, et une ruée sur ses dépôts est possible (5.4).
Décision : une banque appartient à une maison, dans sa cité ; sa monnaie est un compte du grand livre à part, le coffre, que la masse monétaire compte comme une trésorerie.
Décision : la fondation coûte un droit détruit (`sink_bank_charter`) et un capital versé au coffre ; la maison retire du coffre ce qui excède la réserve exigée.
Décision (paramètres neutres) : la configuration initiale ne porte pas de section `banks`, et aucune banque ne se fonde (`BANKS_CLOSED`).
Label : `sensible` (monnaie, règles par ligne).

### Spécification liée

`docs/specs/05-economie.md` (5.4, 5.5)
`docs/specs/12-modele-donnees.md`
`docs/specs/04-systemes-gestion.md` (4.1)

### Critères d'acceptation

- [ ] Configuration `banks` : droit de fondation, capital minimal, ratio de réserve en points de base, bornes des taux de dépôt et de prêt, une banque par maison.
- [ ] Migration : table `banks` (maison, cité, nom, fondée le) et compte de coffre ouvert par la base à la fondation ; la base garantit qu'un coffre n'est jamais débiteur et ne reçoit ou ne verse que par les natures d'écriture des banques (pgTAP).
- [ ] Puits `sink_bank_charter` ajouté au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670.
- [ ] Commandes `bank.found` (nom, capital, droit vu) et `bank.moveCapital` (versement au coffre, ou retrait borné par la réserve exigée).
- [ ] Natures 4.1 : droit en charges hors exploitation, capital versé et retiré hors exploitation.
- [ ] Le tableau de bord compte les coffres comme une nature à part de la masse (`bankVaults`), et la fortune du banquier compte son coffre net de ses dépôts.
- [ ] Vue publique `banks` (cité, nom, maison, taux affichés) et vue privée `my_bank` (coffre, réserve exigée), règles par ligne testées en pgTAP.
- [ ] Spécifications 5.4, 5.5 et 12 mises à jour ; glossaire (trapeza, coffre).

### Hors périmètre

Dépôts, prêts et défauts (tickets suivants), écran, faillite d'une banque.

### Dépendances

#718

## #727 — Banques (2/4) : dépôts, retraits et intérêts

### Contexte

Un dépôt passe de la trésorerie du déposant au coffre ; sa créance est tenue en table, en oboles, et n'est pas de la monnaie de plus.
Décision : les intérêts d'un dépôt s'ajoutent chaque jour à la créance, sans écriture au grand livre : la dette de la banque grossit, pas la masse monétaire.
Décision : la réserve exigée borne les prêts et les retraits de capital du banquier, jamais les retraits des déposants ; un retrait que le coffre ne couvre pas est refusé (`VAULT_SHORT`), ce qui rend la ruée possible (5.4).
Label : `sensible` (monnaie, règles par ligne).

### Spécification liée

`docs/specs/05-economie.md` (5.4)
`docs/specs/04-systemes-gestion.md` (4.1)

### Critères d'acceptation

- [ ] Migration : table `bank_deposits` (banque, déposant, solde) ; la base garantit que le solde d'un dépôt ne bouge que par un dépôt, un retrait ou l'intérêt de la clôture, et n'est jamais négatif (pgTAP).
- [ ] Commandes `bank.deposit` (banque, montant, taux vu) et `bank.withdraw` (banque, montant), refusées au-delà de la trésorerie, du solde ou du coffre.
- [ ] Commande `bank.setRates` : taux de dépôt et de prêt affichés, dans les bornes du monde.
- [ ] Étape de la clôture, avant l'entretien : intérêt du jour de chaque dépôt, au taux affiché, arrondi à l'obole inférieure, une seule fois même rejouée.
- [ ] Natures 4.1 : dépôts et retraits hors exploitation ; la fortune compte le dépôt pour le déposant et le déduit du coffre pour la banque.
- [ ] Vues : `my_deposits` pour le déposant, total et nombre des dépôts de sa banque pour le banquier, sans nom de déposant ; règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : ruée jusqu'au coffre vide, intérêts composés jour après jour, retrait de capital refusé sous la réserve.
- [ ] Spécifications 5.4 et 4.1 mises à jour.

### Hors périmètre

Prêts (ticket suivant), garantie des dépôts, faillite d'une banque.

### Dépendances

#726

## #728 — Banques (3/4) : prêts gagés

### Contexte

Une banque prête à taux libre, sur garantie (5.4), dans la limite de sa réserve exigée.
Décision : le banquier offre un prêt à une maison (montant, taux, durée, garantie), qui l'accepte ; le principal passe du coffre à la trésorerie de l'emprunteur.
Décision (ambiguïté de 5.4) : les garanties de la phase sont un stock, bloqué dans sa cité comme une réservation, ou un logement ; les parcelles n'existent pas, et les navires, que la base ne laisse pas changer de propriétaire (12), attendent.
Le prêt est une ligne de la table `loans` de #724, au prêteur de banque.
Label : `sensible` (monnaie, stocks, règles par ligne).

### Spécification liée

`docs/specs/05-economie.md` (5.4)
`docs/specs/04-systemes-gestion.md` (4.5)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Commandes `bank.offerLoan` (emprunteur, montant, taux, durée, garantie), `bank.withdrawOffer` et `loan.acceptOffer` (offre, conditions vues).
- [ ] L'acceptation est refusée si la réserve exigée ne le permet plus (`RESERVE_SHORT`), si la garantie n'est plus libre ou si les conditions ont changé.
- [ ] Une garantie bloquée ne sort par aucun chemin : un stock gagé ne se vend, ne s'embarque, ne s'offre ni ne se consomme, un logement gagé ne se revend ni ne se loue de nouveau (un test par chemin de sortie).
- [ ] `loan.repay` sert aussi les prêts de banque : le remboursement va au coffre, et la garantie se libère au solde.
- [ ] L'étape d'échéance de #725 prélève les prêts de banque pour le coffre.
- [ ] La fortune compte le prêt pour la banque et le déduit pour l'emprunteur.
- [ ] Vues : offres reçues et faites, prêts de sa banque ; règles par ligne testées en pgTAP.
- [ ] Spécifications 5.4, 4.5 et 12 mises à jour.

### Hors périmètre

Défaut et saisie (ticket suivant), navires en garantie, enchères.

### Dépendances

#725, #727

## #729 — Banques (4/4) : défaut, saisie et bien insaisissable

### Contexte

Un défaut entraîne la saisie de la garantie, sa vente aux enchères et une marque de déshonneur temporaire, et une maison ruinée repart avec un bien insaisissable (5.4).
Décision : sans enchères dans la phase, la garantie saisie passe à la banque et solde le prêt, quelle que soit sa valeur : la banque a pris le risque de sa garantie.
Décision : le bien insaisissable est le site de départ de la maison, qui n'est jamais une garantie ; aucune saisie ne prend la trésorerie au-delà du prélèvement d'échéance (#725).
Label : `sensible` (monnaie, stocks, règles par ligne).

### Spécification liée

`docs/specs/05-economie.md` (5.4)
`docs/specs/04-systemes-gestion.md` (4.5)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] À l'échéance d'un prêt gagé non soldé par le prélèvement, la clôture saisit la garantie et solde le prêt : stock transféré par le journal des stocks, logement remis à la maison de la banque avec son bail en cours.
- [ ] Perte de Timè et marque de déshonneur de #725 ; événement `CollateralSeized`.
- [ ] La base garantit qu'un stock ou un logement ne change de maison que par un échange, une revente ou une saisie de prêt (pgTAP).
- [ ] Tests d'intégration : saisie d'un stock, d'un logement loué, prêt soldé par la saisie, clôture rejouée.
- [ ] Spécifications 5.4, 4.5 et 12 mises à jour.

### Hors périmètre

Enchères, navires en garantie, garantie des dépôts.

### Dépendances

#728

## #730 — Pertes en mer

### Contexte

Le risque en mer de la phase 2 est un retard, jamais une perte : la perte devait venir avec le prêt maritime (décision de la phase 2, 4.6).
Décision : un voyage peut perdre sa cargaison, jamais son navire, qui arrive à vide.
Décision : le risque est celui de la route, majoré pendant une tempête, fixé au départ et gardé avec le voyage ; le tirage se fait à l'arrivée, par un générateur à graine tirée de l'identifiant du voyage, donc rejouable et caché d'ici là.
Décision (paramètres neutres) : risque nul dans la configuration initiale.
Label : `sensible` (stocks).

### Spécification liée

`docs/specs/04-systemes-gestion.md` (4.6)
`docs/specs/07-dieux-faveur-evenements.md` (7.4)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration : risque de perte par route et majoration pendant une tempête, en points de base, nuls au départ ; les règles publiques des routes les rendent.
- [ ] Fonction pure `voyageLoss` dans `packages/sim`, déterministe pour une graine, testée par propriétés (risque nul : jamais de perte ; risque plein : toujours).
- [ ] À l'arrivée, une cargaison perdue passe du transit à l'extrémité système `lost_at_sea` du journal des stocks, et le navire accoste à vide ; arrivée rejouée : une seule perte.
- [ ] Événement `CargoLostAtSea` ; la chronique compte les cargaisons perdues par route, sans nommer de maison.
- [ ] La feuille de départ annonce le risque de la route.
- [ ] Spécifications 4.6, 7.4 et 12 mises à jour.

### Hors périmètre

Prêt maritime (#731), escorte (#740), perte d'un navire, guerre de course.

### Dépendances

Aucune.

## #731 — Prêt maritime

### Contexte

Le prêt maritime est un prêt à taux élevé, remboursé seulement si le navire arrive : c'est l'assurance du jeu (5.4).
Décision : c'est un prêt de banque (#728) dont la garantie est un voyage : il se verse au départ, se rembourse à l'arrivée, principal et prime, et s'éteint si la cargaison est perdue (#730).
Label : `sensible` (monnaie).

### Spécification liée

`docs/specs/05-economie.md` (5.4)
`docs/specs/04-systemes-gestion.md` (4.6)

### Critères d'acceptation

- [ ] Garantie `voyage` d'une offre de prêt : un navire de l'emprunteur et une route ; `voyage.depart` accepte une offre acceptée de ce navire et de cette route, et le principal est versé dans la même transaction.
- [ ] À l'arrivée, le moteur prélève principal et prime pour le coffre ; ce qui manque suit l'échéance et le défaut de #725, sans garantie à saisir.
- [ ] Cargaison perdue : le prêt s'éteint sans paiement, et la banque perd son principal ; événement `BottomryLoanCancelled`.
- [ ] Tests d'intégration : arrivée payée, arrivée impayée, perte, départ refusé sans offre acceptée ou pour un autre navire.
- [ ] Spécifications 5.4 et 4.6 mises à jour ; glossaire (prêt maritime).

### Hors périmètre

Prêt maritime du Trésor du temple, assurance d'une cargaison sans prêt.

### Dépendances

#729, #730

## #732 — Écran Finances (1/2) : dettes et Trésor du temple

### Contexte

Les prêts du Trésor du temple (#724, #725) n'ont pas d'écran.
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/specs/05-economie.md` (5.4)
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Écran Finances, dans l'onglet Maison : dettes en cours (prêteur, reste dû, échéance, intérêts), marque de déshonneur, remboursement en feuille au montant vu.
- [ ] Emprunt au Trésor du temple en feuille par étapes : plafond selon la Timè, durée, intérêts calculés, récapitulatif, confirmation au taux vu.
- [ ] Le tableau de bord alerte d'une échéance dans les trois jours de jeu et d'un défaut.
- [ ] Montants en drachmes et oboles.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Banques (ticket suivant), historique des prêts soldés.

### Dépendances

#725, #694

## #733 — Écran Finances (2/2) : banques et prêt maritime

### Contexte

Banques (#726 à #729) et prêt maritime (#731) n'ont pas d'écran.
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/specs/05-economie.md` (5.4)
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Agora, section Banques : banques de chaque cité avec leurs taux affichés ; dépôt et retrait en feuille ; un retrait refusé faute de coffre le dit.
- [ ] Offres de prêt reçues avec leur garantie, acceptation au montant vu.
- [ ] Pour le banquier : fondation en feuille par étapes, coffre, réserve exigée, total des dépôts, taux affichés, offre d'un prêt avec une garantie choisie parmi les stocks et logements libres de l'emprunteur.
- [ ] La feuille de départ d'un navire propose un prêt maritime accepté pour ce navire et cette route.
- [ ] Montants en drachmes et oboles.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Comparateur de banques, historique des prêts soldés.

### Dépendances

#731, #732, #695

## #734 — Hybris (1/2) : jauge cachée

### Contexte

Chaque maison a une jauge d'Hybris cachée, dont seul le niveau approximatif est visible (7.2).
Elle monte avec une part de marché au-delà de 35 % d'un bien dans une cité, l'écart de fortune avec la médiane, le refus des liturgies et les ententes sur les prix, et baisse avec le mécénat et les offrandes (7.2).
Décision : la jauge se recalcule à chaque clôture, en entiers, par une fonction pure (`hubrisDelta`) : part des ventes de la maison au-delà du seuil dans les échanges d'un bien et d'une cité sur une fenêtre, rapport de sa fortune à la médiane du monde au-delà d'un multiple, liturgie prélevée d'office ; elle baisse par les offrandes, les liturgies accomplies et un déclin quotidien.
Décision : les ententes sur les prix attendent une détection, et le mécénat de 7.2 est la liturgie accomplie et son faste.
Décision : le joueur ne lit que le palier de sa jauge, jamais sa valeur ni celle des autres ; poids nuls au départ (paramètres neutres).
Label : `sensible` (règles par ligne).

### Spécification liée

`docs/specs/07-dieux-faveur-evenements.md` (7.2)
`docs/specs/12-modele-donnees.md`
`docs/specs/13-moteur-anti-triche.md` (ticks globaux)

### Critères d'acceptation

- [ ] Configuration `hubris` : seuil de part de marché (3 500 points), fenêtre en jours, multiple de la médiane, poids de chaque cause, baisse par obole offerte et par liturgie, déclin, bornes des paliers ; poids nuls au départ.
- [ ] Migration : journal `hubris_ledger` (maison, variation, cause, jour de jeu), une ligne au plus par maison, cause et jour (index unique), lu par aucun client.
- [ ] Fonction pure `hubrisDelta` testée par propriétés : croissante avec la part de marché et la fortune, décroissante avec les offrandes, nulle sous les seuils.
- [ ] Étape de la clôture, avant l'entretien, une seule fois même rejouée.
- [ ] Une maison PNJ de secours n'a pas de jauge (test).
- [ ] Vue privée `my_hubris_tier` (palier seulement), règles par ligne testées en pgTAP ; aucun client ne lit une valeur de la jauge.
- [ ] Spécifications 7.2 et 12 mises à jour ; glossaire (palier d'Hybris).

### Hors périmètre

Présages et Némésis (ticket suivant), ententes sur les prix, écran.

### Dépendances

#718, #720

## #735 — Hybris (2/2) : présages et Némésis

### Contexte

Au-delà d'un seuil, Némésis frappe (incendie d'entrepôt, procès, artisan qui déserte, navire perdu), toujours annoncée par des présages, proportionnée et évitable (7.2).
Décision : quand la jauge dépasse le seuil, la clôture planifie une sanction à quelques jours et adresse un présage à la maison ; si la jauge est redescendue sous le seuil à l'échéance, rien n'arrive.
Décision : catalogue fermé de la phase, incendie d'entrepôt (part bornée d'un stock détruite), procès (amende, part bornée de la trésorerie), artisan qui déserte (un atelier arrêté jusqu'à la clôture suivante, sans dette), navire perdu (perte de la cargaison d'un voyage en cours, comme en #730).
Décision : l'ampleur croît avec l'excès de la jauge, dans les bornes du modèle, et la jauge redescend d'autant après la sanction.
Le présage est un texte de repli écrit à la main par modèle, en `fr` et en `en`, sans IA.
Label : `sensible` (monnaie, stocks).

### Spécification liée

`docs/specs/07-dieux-faveur-evenements.md` (7.2, 7.3)
`docs/specs/05-economie.md` (5.5)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration `hubris.nemesis` : seuil, délai du présage, modèles et bornes de leur ampleur ; seuil inaccessible au départ.
- [ ] Puits `sink_nemesis` ajouté au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670 ; extrémité `nemesis` du journal des stocks.
- [ ] Étape de la clôture, avant l'entretien : planification et présage (`OmenReceived`), puis à l'échéance sanction ou rien (`NemesisStruck`, `NemesisAverted`), une seule fois même rejouée.
- [ ] Ampleur calculée par une fonction pure de `packages/sim`, testée par propriétés : jamais au-delà de la borne du modèle, croissante avec l'excès.
- [ ] Vue privée `my_omens`, règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : sanction évitée, chaque modèle de sanction, trésorerie ou stock vides.
- [ ] Spécifications 7.2 et 5.5 mises à jour.

### Hors périmètre

Présage réécrit par la Pythie et l'IA, procès devant un tribunal de joueurs, écran.

### Dépendances

#730, #734

## #736 — Écran de l'Hybris et des présages

### Contexte

Le palier d'Hybris et les présages (#734, #735) n'ont pas d'écran.
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/specs/07-dieux-faveur-evenements.md` (7.2)
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Onglet Temple : palier d'Hybris de la maison, en mots et non en chiffres, avec ce qui le fait monter et descendre.
- [ ] Présage reçu, son échéance et le moyen de l'éviter ; sanction passée, avec son effet.
- [ ] Le tableau de bord alerte d'un présage en cours.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Valeur chiffrée de la jauge, palier des autres maisons.

### Dépendances

#735, #698

## #737 — Ligues (1/3) : fonder, rejoindre et quitter une ligue par décret

### Contexte

Une ligue est une alliance de 2 à 5 cités, avec trésor commun, tarifs préférentiels et défense mutuelle, qui élit un hégémon (6.5).
Décision : tout passe par des décrets de l'assemblée proposés par l'archonte ; le stratège attend.
Décision : l'hégémon est une cité membre, comme dans l'histoire grecque ; la cité fondatrice l'est jusqu'à la première élection (#739).
Décision : une cité fonde une ligue par décret ; une autre demande à y entrer par décret, et la ligue l'admet par un décret de sa cité hégémon ; une cité la quitte par décret, et une ligue d'une seule cité se dissout.
Décision (paramètres neutres) : les modèles de décret des ligues sont fermés au départ.
Label : `sensible` (règles par ligne).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.3, 6.5)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration : cités par ligue (5 au plus) et modèles `league_found`, `league_join`, `league_admit` et `league_leave`, fermés au départ.
- [ ] Migration : tables `leagues` (nom, hégémon, fondée le) et `league_members` (cité, entrée, sortie) ; une cité est dans une ligue au plus (index unique).
- [ ] Application de ces décrets à la clôture, avant l'entretien, une seule fois même rejouée ; une admission au-delà de cinq cités est caduque.
- [ ] Événements `LeagueFounded`, `LeagueJoined` et `LeagueLeft`, que la chronique annonce.
- [ ] Vues publiques des ligues et de leurs membres, règles par ligne testées en pgTAP.
- [ ] Spécifications 6.5, 6.3 et 12 mises à jour ; glossaire (ligue, hégémon).

### Hors périmètre

Trésor commun et tarifs (ticket suivant), élection de l'hégémon (#739), écran.

### Dépendances

Aucune.

## #738 — Ligues (2/3) : trésor commun et tarifs préférentiels

### Contexte

Une ligue a un trésor commun et des tarifs préférentiels (6.5).
Décision : le trésor de la ligue est un compte du grand livre, alimenté par les décrets de contribution de ses cités (depuis leur trésor, dans la part `spendingCapShareBps`), et ne paie que des contributions aux conflits de la ligue (#742).
Décision : le tarif préférentiel est une remise sur le droit de port d'un navire d'une maison d'une cité membre arrivant dans un port membre.
Label : `sensible` (monnaie, règles par ligne).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.5)
`docs/specs/05-economie.md` (5.6)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Migration : compte de trésor de ligue, ouvert par la base à la fondation, jamais débiteur, crédité seulement par les contributions des cités membres (pgTAP).
- [ ] Modèle de décret `league_contribution` (montant borné), réglé à la clôture comme une dépense de la cité (#263), caduc si le trésor de la cité ne le couvre pas.
- [ ] Remise du droit de port entre membres en points de base (`leagues.portDuesDiscountBps`, nulle au départ), calculée par `game.city_rates` sous le verrou de l'agora, comme les taux par cité.
- [ ] Une cité qui quitte la ligue ne reprend rien ; une ligue dissoute verse son trésor à parts égales aux trésors de ses dernières cités, à l'obole inférieure, le reste à la cité hégémon.
- [ ] Vue publique du solde et des flux du trésor de chaque ligue, règles par ligne testées en pgTAP.
- [ ] Spécifications 6.5, 5.6 et 12 mises à jour.

### Hors périmètre

Dépenses du trésor de ligue hors des conflits, tarifs sur la taxe de marché.

### Dépendances

#737

## #739 — Ligues (3/3) : élection de la cité hégémon

### Contexte

« Une ligue élit un hégémon. » (6.5)
Décision : chaque `leagues.hegemonTermDays` jours de jeu, les archontes des cités membres votent pour une cité membre ; la plus votée devient hégémon, et une égalité garde la cité hégémon sortante.
Décision : une cité sans archonte ne vote pas ; le vote est secret comme les autres (ADR 0007).
Label : `sensible` (règles par ligne, vote secret).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.2, 6.5)
`docs/adr/0007-elections-calendrier-vote-secret.md`

### Critères d'acceptation

- [ ] Configuration : durée du mandat d'hégémon et du vote.
- [ ] Commande `league.voteHegemon` (cité membre), réservée à l'archonte en charge d'une cité membre, une fois par cité et par vote.
- [ ] Dépouillement à la clôture, avant l'entretien, une seule fois même rejoué ; événement `HegemonElected`.
- [ ] Vues : calendrier, vote de sa cité sans son choix, résultat après le dépouillement ; règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : égalité, cité sans archonte, cité qui quitte la ligue pendant le vote.
- [ ] Spécifications 6.2 et 6.5 mises à jour.

### Hors périmètre

Hégémon personne physique, magistrats de ligue.

### Dépendances

#738

## #740 — Galère d'escorte et escorte

### Contexte

« Trois classes de navires au lancement : caboteur, navire rond de commerce, galère d'escorte » ; la galère et l'escorte attendaient les conflits (4.6, #251).
Décision : une galère ne porte pas de cargaison ; elle part avec des navires de commerce de sa maison, de la même cité sur la même route au même départ, et réduit leur risque de perte (#730).
Décision (paramètres neutres) : la classe n'est pas dans la configuration initiale ; #764 l'y ajoute.
Label : `sensible` (stocks : le risque de perte change).

### Spécification liée

`docs/specs/04-systemes-gestion.md` (4.6)
`docs/specs/05-economie.md` (5.5)

### Critères d'acceptation

- [ ] Configuration : une classe de navire peut avoir une capacité nulle et une réduction du risque de perte en points de base ; le schéma refuse une cargaison sur un navire de capacité nulle.
- [ ] `voyage.depart` accepte des galères de la maison à quai dans la même cité : elles partent et arrivent avec le convoi, à la vitesse du plus lent.
- [ ] `voyageLoss` applique la réduction de la meilleure galère du convoi (test de propriétés).
- [ ] Une galère s'achète par `ship.acquire` et s'entretient comme les autres navires.
- [ ] Tests d'intégration : convoi, galère seule, réduction du risque.
- [ ] Spécification 4.6 mise à jour ; glossaire (galère d'escorte).

### Hors périmètre

Escorte vendue à une autre maison (fret d'escorte), combat.

### Dépendances

#730

## #741 — Conflits (1/2) : déclaration et effets

### Contexte

Un conflit est un embargo, un blocus ou une guerre de course, aux effets temporaires (droits de port majorés, routes fermées, tribut), qui ne détruit aucun bien de joueur (6.5).
Décision : un conflit se déclare par un décret de l'assemblée (`conflict_declare` : cité ou ligue visée, genre) ; les ligues des deux camps y entrent avec leurs cités, c'est la défense mutuelle.
Décision : embargo, droit de port majoré pour les navires des maisons du camp adverse dans les ports du camp déclarant ; blocus, départs refusés entre les deux camps (`ROUTE_BLOCKADED`) ; guerre de course, trajets entre les deux camps allongés comme par une tempête, sans perte.
Décision : un conflit dure un nombre de jours fixé à la déclaration et finit par sa résolution (#742) ou par un décret de paix adopté dans chaque camp.
Label : `sensible` (monnaie : droits de port ; règles par ligne).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.3, 6.5)
`docs/specs/04-systemes-gestion.md` (4.6)
`docs/specs/05-economie.md` (5.6)

### Critères d'acceptation

- [ ] Configuration : modèles `conflict_declare` et `conflict_peace`, genres, durée, majoration de l'embargo, allongement de la guerre de course ; fermés au départ.
- [ ] Migration : tables `conflicts` (camps, genre, début, fin, issue) ; une cité dans un conflit au plus avec le même adversaire.
- [ ] Effets appliqués par `voyage.depart` et `game.city_rates`, sous le verrou de l'agora, pendant les jours du conflit seulement.
- [ ] Aucun effet ne retire un bien ni une obole à une maison au-delà du droit de port majoré (test).
- [ ] Événements `ConflictDeclared` et `ConflictEnded`, que la chronique annonce.
- [ ] Vues publiques des conflits, règles par ligne testées en pgTAP.
- [ ] Spécifications 6.5, 4.6 et 5.6 mises à jour.

### Hors périmètre

Contributions et résolution (ticket suivant), écran, combat.

### Dépendances

#737

## #742 — Conflits (2/2) : contributions, résolution et tribut

### Contexte

« Un conflit se résout sur plusieurs jours par les contributions des citoyens (navires, mercenaires, vivres). » (6.5)
Décision : un citoyen d'une cité d'un camp contribue en monnaie (mercenaires, au puits `sink_conflict_contributions`), en vivres (biens détruits vers l'extrémité `conflict_supplies`) ou en galères d'escorte (immobilisées à quai jusqu'à la fin) ; la cité hégémon peut faire contribuer le trésor de sa ligue par décret.
Décision : le score d'un camp est la somme des oboles, des vivres au prix de référence de la configuration et des galères à la valeur de leur classe ; chaque contribution rapporte de la Timè.
Décision : à la fin, le camp au plus fort score gagne un tribut, versé du trésor des cités vaincues à ceux des cités victorieuses, au plus une part bornée de chaque trésor, sans création de monnaie ; à égalité, pas de tribut.
Label : `sensible` (monnaie, stocks).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.5)
`docs/specs/05-economie.md` (5.5)
`docs/specs/04-systemes-gestion.md` (4.1)

### Critères d'acceptation

- [ ] Commande `conflict.contribute` (conflit, monnaie, vivres, galères), réservée à une maison citoyenne d'une cité d'un camp ; écriture `conflict.contribution`, nature 4.1 hors exploitation.
- [ ] Puits `sink_conflict_contributions` ajouté au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670 ; extrémité `conflict_supplies` du journal des stocks.
- [ ] Une galère engagée ne part pas avant la fin du conflit (`SHIP_ENGAGED`).
- [ ] Résolution à la clôture du dernier jour, avant l'entretien, une seule fois même rejouée : vainqueur, tribut par écritures `conflict.tribute` entre trésors de cités, Timè des contributeurs.
- [ ] Score et tribut calculés par des fonctions pures de `packages/sim`, testées par propriétés.
- [ ] Tests d'intégration : contributions des deux camps, égalité, trésor vaincu vide, paix avant la fin.
- [ ] Spécifications 6.5, 5.5 et 4.1 mises à jour.

### Hors périmètre

Mercenaires comme unités, routes fermées au-delà du conflit, écran.

### Dépendances

#704, #738, #740, #741

## #743 — Écran Cité : ligues et conflits

### Contexte

Ligues (#737 à #739) et conflits (#741, #742) n'ont pas d'écran.
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/specs/06-cites-politique-communaute.md` (6.5)
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Onglet Cité : ligue de la cité, ses membres, sa cité hégémon, son trésor et ses tarifs ; vote de l'hégémon pour l'archonte.
- [ ] Le formulaire de décret de l'archonte propose les modèles des ligues et des conflits, bornes annoncées d'après `decree_rules`.
- [ ] Conflits en cours : camps, genre, effets, jours restants, scores ; contribution en feuille par étapes (monnaie, vivres, galères) avec récapitulatif.
- [ ] La carte montre les routes fermées et les ports sous embargo, doublés de la liste accessible.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Historique des conflits au-delà de la saison, diplomatie entre ligues.

### Dépendances

#739, #742, #696, #697

## #744 — Marchands PNJ (1/3) : escales et marché au prix affiché

### Contexte

Le marchand PNJ négocie en dialogue un contrat avec le joueur, et son prix de réserve et sa marge de concession sont calculés hors modèle (8.1).
Règle 6 : le marché au prix affiché, puis la contre-offre (#745), sont la voie complète du jeu IA coupée ; le dialogue (#746) n'en est que la voix.
Décision : un marchand étranger fait escale dans une cité pour quelques jours, planifié par la clôture comme un événement du monde (7.4), avec une liste d'offres : acheter ou vendre jusqu'à une quantité d'un bien, à un prix affiché tiré autour du prix de référence.
Décision : ses achats créent de la monnaie (robinet `faucet_merchant_purchases`) et sortent les biens de l'Archipel (extrémité `merchant_export`) ; ses ventes en détruisent (puits `sink_merchant_sales`) et en font entrer (extrémité `merchant_import`).
Décision (paramètres neutres) : probabilité d'escale nulle au départ.
Label : `sensible` (monnaie, stocks, règles par ligne).

### Spécification liée

`docs/specs/08-ia.md` (8.1, 8.2)
`docs/specs/07-dieux-faveur-evenements.md` (7.4)
`docs/specs/05-economie.md` (5.5)

### Critères d'acceptation

- [ ] Configuration `merchants` : modèles d'escale (biens, sens, quantités, écart du prix affiché, durée, probabilité par jour), fermés au départ.
- [ ] Étape de planification de la clôture, avant l'entretien, sur le générateur des événements du monde : tables `merchant_visits` et `merchant_offers`.
- [ ] Commande `merchant.trade` (offre, quantité, prix vu) : vente depuis le stock libre de la maison dans la cité, ou achat vers ce stock, en une écriture et un mouvement de stock ; refusée hors escale, au-delà du reste de l'offre ou à un prix changé.
- [ ] Robinet `faucet_merchant_purchases` et puits `sink_merchant_sales` ajoutés au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670 ; extrémités `merchant_export` et `merchant_import` du journal des stocks.
- [ ] Natures 4.1 : ventes et achats d'exploitation.
- [ ] Vue publique des escales et des offres en cours, règles par ligne testées en pgTAP ; événement `MerchantTrade`.
- [ ] Spécifications 8.1, 7.4 et 5.5 mises à jour.

### Hors périmètre

Contre-offre (ticket suivant), dialogue par l'IA (#746), écran.

### Dépendances

#704

## #745 — Marchands PNJ (2/3) : contre-offre et mémoire

### Contexte

Le marchand négocie : le prix de réserve et la marge de concession sont calculés hors modèle (8.1), et il se souvient de qui l'a fait attendre (8.2).
Décision : `merchantTerms` (`packages/sim`) calcule réserve et concession depuis le prix affiché, la Timè de la maison et sa mémoire avec ce marchand ; une contre-offre dans la concession est acceptée, sinon le marchand répond par son prix suivant, en un nombre borné de tours par maison et par jour.
Décision : la mémoire est faite de faits structurés en base (marchés conclus, négociations abandonnées), sans recherche vectorielle ; une maison qui abandonne souvent voit la concession se réduire.
Label : `sensible` (monnaie, règles par ligne).

### Spécification liée

`docs/specs/08-ia.md` (8.1, 8.2)
`docs/specs/05-economie.md` (5.5)

### Critères d'acceptation

- [ ] Fonction pure `merchantTerms` testée par propriétés : la réserve ne franchit jamais le prix affiché dans le mauvais sens, la concession est bornée, croissante avec la Timè et décroissante avec les abandons.
- [ ] Commande `merchant.counterOffer` (offre, quantité, prix) : acceptée, elle conclut le marché comme `merchant.trade` dans la même transaction ; refusée, elle rend le prix suivant du marchand ; au-delà des tours permis, `NEGOTIATION_CLOSED`.
- [ ] Table de mémoire par maison et par marchand, mise à jour dans la transaction de la commande ou à la fin de l'escale.
- [ ] Vue privée des négociations de sa maison, règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : accord au premier tour, accord après concession, fermeture, mémoire qui durcit les conditions.
- [ ] Spécifications 8.1 et 8.2 mises à jour.

### Hors périmètre

Dialogue par l'IA (ticket suivant), mémoire vectorielle, contrats à terme.

### Dépendances

#744

## #746 — Marchands PNJ (3/3) : dialogue par l'IA

### Contexte

Le marchand négocie « en dialogue » (8.1) ; c'est le seul usage d'IA nouveau du côté du joueur dans cette phase.
Décision : l'usage `merchant` de la passerelle écrit la réplique du marchand et traduit le texte du joueur en contre-offre structurée ; tout prix et toute quantité doivent figurer dans le texte du joueur avec leur unité, comme pour la consigne d'intendant (#280).
Décision : le moteur seul décide, par `merchant.counterOffer` (#745) ; le modèle ne connaît ni la réserve ni la concession.
Le texte du joueur est une donnée, jamais une instruction (8.4) ; l'usage est coupé dans la configuration initiale, et le repli est le formulaire de contre-offre.
Label : aucun (le modèle n'écrit rien en base ; la commande de #745 reste seule à conclure).

### Spécification liée

`docs/specs/08-ia.md` (8.1, 8.4)
`docs/adr/0005-passerelle-ia.md`

### Critères d'acceptation

- [ ] Usage `merchant` en configuration (modèle, délai, jetons, part du plafond), coupé au départ, et quota par maison et par jour de jeu (`ai.merchantDailyQuotaPerHouse`).
- [ ] Schéma de sortie propre à l'offre : réplique bornée en longueur, contre-offre dont le prix et la quantité sont écrits dans le texte du joueur ; toute autre sortie est rejetée au profit du repli.
- [ ] Repli testé IA coupée et au plafond : le joueur négocie par le formulaire, et le marchand répond par un texte écrit à la main.
- [ ] Ni la réserve, ni la concession, ni la mémoire chiffrée ne partent au modèle (test sur la consigne envoyée au fournisseur factice).
- [ ] Journal des appels sans texte, comme les autres usages.
- [ ] Spécifications 8.1 et 8.4 mises à jour.

### Hors périmètre

Fournisseur d'IA réel (#269), mémoire vectorielle, quota relevé des abonnés (#752).

### Dépendances

#745

## #747 — Écran des marchands

### Contexte

Les escales des marchands (#744 à #746) n'ont pas d'écran.
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/specs/08-ia.md` (8.1)
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Agora, section Marchands : escales en cours de la cité, offres, quantités restantes et prix affichés.
- [ ] Marché au prix affiché en feuille, avec le stock libre de la maison et un récapitulatif chiffré.
- [ ] Négociation : formulaire de contre-offre, réponse du marchand, tours restants ; si l'usage est ouvert, un champ de dialogue en plus, qui dit que l'IA ne décide d'aucun prix.
- [ ] IA coupée ou quota atteint, l'écran le dit et garde le formulaire.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Historique des marchés conclus au-delà de l'escale.

### Dépendances

#746, #695

## #748 — Jeux de l'Olympiade : épreuves, palmarès et titres

### Contexte

« Jeux panhelléniques : à chaque fin d'Olympiade, épreuves économiques par cité et par maison (meilleure marge, plus belle fête, plus longue route), avec titres permanents. » (6.6) ; une Olympiade dure 16 semaines (3).
Décision : la durée de l'Olympiade est un paramètre (`games.olympiadDays`, 112), comptée comme les saisons depuis le lundi 5 janvier 1970.
Décision : épreuves de la phase, meilleur résultat d'exploitation d'une maison sur l'Olympiade (4.1), plus grand nombre d'heures de mer arrivées, plus grande dépense de liturgies, et pour les cités la plus grande dépense de fêtes.
Décision : les récompenses en monnaie viennent du robinet `faucet_games_rewards` (5.5), nulles au départ ; un titre ne s'achète pas et ne se perd pas.
Label : `sensible` (monnaie, règles par ligne).

### Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.6)
`docs/specs/03-boucles-progression.md` (rythmes)
`docs/specs/05-economie.md` (5.5)

### Critères d'acceptation

- [ ] Configuration `games` : durée de l'Olympiade, épreuves ouvertes, récompense et titre par rang ; récompenses nulles au départ.
- [ ] Classements calculés par des fonctions pures de `packages/sim`, à égalité par ancienneté puis identifiant, testés par propriétés ; ni une maison exclue ni une maison PNJ de secours n'est classée.
- [ ] Étape de la clôture qui termine une Olympiade, avant l'entretien, une seule fois même rejouée : palmarès, titres, récompenses par écritures `games.reward`.
- [ ] Robinet `faucet_games_rewards` ajouté au catalogue des comptes système, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013, aux libellés `fr` et `en` d'Olympe et au test du tableau de bord de #670 ; nature 4.1 hors exploitation.
- [ ] Migration : tables `games_results` et `titles` ; vues publiques du palmarès et des titres de chaque maison, règles par ligne testées en pgTAP.
- [ ] Événement `GamesConcluded`, que la chronique annonce.
- [ ] Spécifications 6.6, 3 et 5.5 mises à jour ; glossaire (titre).

### Hors périmètre

Plus belle fête jugée par les joueurs, concours des fêtes de saison, écran.

### Dépendances

#705, #720

## #749 — Écran des Jeux et titres

### Contexte

Le palmarès et les titres (#748) n'ont pas d'écran.
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/specs/06-cites-politique-communaute.md` (6.6)
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Onglet Cité : Olympiade en cours (jours restants, épreuves) et palmarès des Olympiades passées, par épreuve.
- [ ] Classement provisoire de la maison dans chaque épreuve, calculé à la lecture et annoncé comme tel.
- [ ] La fiche publique d'une maison (#705) montre ses titres.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Classements par voie, par ligue et des nouveaux joueurs (3).

### Dépendances

#748, #697

## #750 — Âge déclaré : inscription dès 15 ans, achats réservés aux majeurs

### Contexte

« Inscription à partir de 15 ans, âge du consentement numérique en France ; achats réservés aux majeurs. » (18, 9)
Décision : le joueur déclare son mois et son année de naissance à la création de sa première maison, et rien de plus.
Décision : une déclaration se corrige vers un âge plus jeune par le joueur, vers un âge plus grand seulement par l'équipe, par une commande d'Olympe tracée.
Label : `sensible` (authentification, donnée personnelle, règles par ligne).

### Spécification liée

`docs/specs/18-indicateurs-risques-conformite.md` (Conformité)
`docs/specs/09-monetisation.md`
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Migration : mois et année de naissance du compte, lisibles par lui seul, règles par ligne testées en pgTAP.
- [ ] `house.create` refuse un compte qui n'a pas 15 ans révolus au jour de la commande (`TOO_YOUNG`), sans rien enregistrer de plus.
- [ ] Fonction `isAdult` dans `packages/sim`, testée aux bornes (jour de l'anniversaire compris).
- [ ] Commande `account.correctBirth` vers un âge plus jeune ; commande d'Olympe `admin.correctBirth`, tracée, dans l'autre sens.
- [ ] Écran de création de maison : champ mois et année, raison donnée en `fr` et en `en`.
- [ ] Registre des traitements et politique de confidentialité : la donnée y est ajoutée (`docs/`).
- [ ] Spécifications 18, 9 et 12 mises à jour.

### Hors périmètre

Vérification d'identité, contrôle parental.

### Dépendances

#692

## #751 — Boutique (1/4) : offres, commandes et fournisseur de paiement factice

### Contexte

Le jeu ne vend aucun avantage de puissance : les revenus viennent du confort, de l'apparence et du mécénat (9).
Décision : le paiement passe par une interface de fournisseur (`packages/payments`), dont la seule mise en œuvre de la phase est un fournisseur factice ; le fournisseur réel demande un compte et des clés, donc un humain (ticket `needs-human` à part).
Décision : les offres sont en configuration (`shop.offers`), en centimes d'euro, chacune accordant des droits d'une liste fermée qui ne touchent ni le grand livre, ni le journal des stocks, ni une valeur d'équilibrage.
Le fournisseur factice sert une page de paiement locale et envoie un avis signé, dont le secret vient d'une variable d'environnement documentée dans `.env.example` et générée par les tests.
Label : `sensible` (paiement, authentification de l'avis, règles par ligne).

### Spécification liée

`docs/specs/09-monetisation.md`
`docs/specs/11-architecture.md`
`docs/specs/15-back-office-olympe.md` (15.1, Boutique)
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Configuration `shop` : offres (prix en centimes, droits accordés, durée d'un abonnement) ; le schéma refuse un droit hors de la liste fermée et tout tirage au hasard.
- [ ] Migration : commandes, droits (compte, droit, début, fin, origine) et avis reçus (identifiant de l'avis unique), écrits par le seul service.
- [ ] Commande `shop.checkout` (offre, prix vu) : commande ouverte et adresse de paiement ; refusée à un compte mineur (`ADULTS_ONLY`) ou à un prix changé.
- [ ] Route d'avis du fournisseur : signature vérifiée, droit accordé une seule fois même si l'avis est rejoué, avis mal signé refusé et compté par la Vigie.
- [ ] Aucun droit n'écrit au grand livre ni au journal des stocks (pgTAP sur les tables du jeu après un achat).
- [ ] Vues privées `my_orders` et `my_entitlements`, règles par ligne testées en pgTAP.
- [ ] ADR nouvelle sur l'interface de paiement et le fournisseur factice ; `.env.example` mis à jour.
- [ ] Spécifications 9, 11 et 12 mises à jour.

### Hors périmètre

Fournisseur réel, abonnement (#752), cosmétiques et don (#753), remboursements (#754), écran (#755), TVA et factures.

### Dépendances

#750

## #752 — Boutique (2/4) : abonnement Mécène

### Contexte

« Abonnement Mécène : statistiques avancées, export des comptes, modèles d'ordres, quotas d'IA relevés, blason animé » (9).
Décision : la phase en livre l'export des comptes, les quotas d'IA relevés et le blason animé ; statistiques avancées et modèles d'ordres attendent.
L'abonnement se renouvelle par l'avis mensuel du fournisseur, et finit à la fin de la période payée quand le joueur le résilie ou qu'un renouvellement échoue.
Label : `sensible` (paiement, droits).

### Spécification liée

`docs/specs/09-monetisation.md`
`docs/specs/08-ia.md` (8.4, quotas)

### Critères d'acceptation

- [ ] Droit `patron` daté : prolongé d'une période par chaque avis de renouvellement, une seule fois par avis ; résiliation par `shop.cancelSubscription`, effective en fin de période.
- [ ] Quotas d'IA par maison et par jour multipliés par `shop.patronAiQuotaBps` pour un compte Mécène (intendant, marchand), sans changer le plafond mensuel de l'usage.
- [ ] Export des comptes de la maison en CSV (écritures, flux par nature, compte de résultat), réservé au Mécène, sans donnée d'une autre maison.
- [ ] Blason animé : variante animée du blason, coupée sous `prefers-reduced-motion`.
- [ ] Tests : renouvellement, échec, résiliation, quota relevé puis rendu à la fin.
- [ ] Spécifications 9 et 8.4 mises à jour.

### Hors périmètre

Statistiques avancées, modèles d'ordres, Laurier d'Olympiade.

### Dépendances

#746, #751

## #753 — Boutique (3/4) : cosmétiques et don à la cité

### Contexte

Cosmétiques (apparences, blasons, cadres de profil) et don à la cité, « financement d'un ornement visible par tous, signé du donateur » (9).
Décision : la phase vend des blasons et des cadres de profil, dessinés en SVG dans le dépôt (ADR 0011) ; les apparences de villa, de navire et de temple attendent leurs écrans.
Décision : le don n'a aucun effet de jeu, ni Timè, ni Charis, ni Hybris ; l'ornement est un dessin de plus sur l'onglet Cité, signé du nom de la maison ou anonyme au choix.
Label : `sensible` (paiement, règles par ligne de vues publiques).

### Spécification liée

`docs/specs/09-monetisation.md`
`docs/specs/10-ux-ui.md`
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Droits de cosmétique ; commande `profile.setCosmetic`, refusée sans le droit ; le cosmétique choisi se voit sur la fiche publique (#705) et dans l'en-tête.
- [ ] Offre de don à montant libre dans des bornes en centimes ; à l'avis du fournisseur, un ornement est ajouté à la cité du donateur.
- [ ] Vues publiques des cosmétiques choisis et des ornements de chaque cité, sans montant, règles par ligne testées en pgTAP.
- [ ] Aucun cosmétique ni don ne change une valeur du jeu (test sur la Timè, la Charis, l'Hybris et le grand livre après un achat).
- [ ] Spécification 9 mise à jour.

### Hors périmètre

Apparences de villa, de navire et de temple, Laurier d'Olympiade.

### Dépendances

#705, #751

## #754 — Boutique (4/4) : remboursements et module Boutique d'Olympe

### Contexte

Le module Boutique d'Olympe suit « commandes, abonnements, remboursements, droits accordés » (15.1).
Décision : un remboursement passe par l'interface du fournisseur ; son avis retire le droit qu'avait accordé la commande, et un ornement remboursé disparaît.
Label : `sensible` (paiement, rôles d'Olympe).

### Spécification liée

`docs/specs/15-back-office-olympe.md` (15.1, 15.3, 15.4)
`docs/specs/09-monetisation.md`
`docs/specs/18-indicateurs-risques-conformite.md` (Commerce)

### Critères d'acceptation

- [ ] Commande d'Olympe `admin.refundOrder` (commande, motif), réservée au super-administrateur et au support, tracée au journal d'audit.
- [ ] L'avis de remboursement retire le droit une seule fois, même rejoué ; un abonnement remboursé finit aussitôt.
- [ ] Module Boutique : commandes, abonnements, remboursements et droits accordés, filtrables par compte, lus par l'API, refusés aux autres rôles (test).
- [ ] Mentions de vente et de rétractation dans les écrans d'achat, en `fr` et en `en`, en attente de la relecture d'un juriste.
- [ ] Spécifications 15 et 9 mises à jour.

### Hors périmètre

Fournisseur réel, TVA et factures, relecture juridique.

### Dépendances

#752, #753, #699

## #755 — Écran Boutique

### Contexte

La boutique (#751 à #754) n'a pas d'écran de joueur.
Label : aucun.

### Spécification liée

`docs/specs/09-monetisation.md`
`docs/specs/10-ux-ui.md`
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Écran Boutique, ouvert depuis Réglages : offres avec leur prix en euros et ce qu'elles donnent, et la mention qu'aucune ne donne d'avantage de jeu.
- [ ] Achat en feuille : récapitulatif, mentions de vente, passage à la page du fournisseur, retour qui relit les droits.
- [ ] Un compte mineur voit les offres sans bouton d'achat, et l'écran dit pourquoi.
- [ ] Mes achats : droits en cours, abonnement Mécène avec sa fin et sa résiliation, export des comptes, choix du cosmétique.
- [ ] Onglet Cité : ornements de la cité et leurs donateurs.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Laurier d'Olympiade, cartes cadeaux.

### Dépendances

#754, #690

## #756 — Anglais (1/2) : parité des traductions et langue du compte

### Contexte

La bêta ouverte s'adresse au public anglophone après le francophone (1) ; le jeu a ses fichiers `fr` et `en`, mais rien ne vérifie la parité partout, et la langue n'est gardée que dans le navigateur.
Le moteur a besoin de la langue du compte pour les notifications (#758) et les courriels.
Décision : la langue du compte est choisie à la première visite d'après le navigateur, puis changée dans Réglages, et suit le compte d'un appareil à l'autre.
Label : `sensible` (règles par ligne).

### Spécification liée

`docs/specs/10-ux-ui.md` (Exigences)
`docs/specs/01-vision.md` (Cible)

### Critères d'acceptation

- [ ] Test de parité des clés `fr` et `en` du jeu, d'Olympe, du site, de `packages/ui` et des gabarits du moteur (chronique, oracles de repli, présages, répliques des marchands), qui nomme chaque clé manquante.
- [ ] Migration : langue du compte (`fr` ou `en`), lisible et modifiable par lui seul par une commande, règles par ligne testées en pgTAP.
- [ ] Commande `account.setLocale` ; le client l'envoie au premier choix et à chaque changement.
- [ ] Le site public (`apps/site`) a sa version anglaise.
- [ ] Spécification 10 mise à jour.

### Hors périmètre

Autres langues, traduction des messages des joueurs.

### Dépendances

Aucune.

## #757 — Anglais (2/2) : parcours, formats et courriels en anglais

### Contexte

Une interface traduite ne suffit pas : formats, courriels de connexion et parcours doivent l'être aussi.
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md` (Exigences)
`docs/specs/14-infrastructure.md`

### Critères d'acceptation

- [ ] Les tests de bout en bout de la tranche de départ et de l'Agora passent aussi l'interface en anglais.
- [ ] Nombres, dates et montants suivent la langue du compte partout où ils s'affichent (test sur un écran de chaque onglet).
- [ ] Gabarits du courriel de connexion en `fr` et en `en` dans la configuration locale de Supabase Auth, choisis par la langue du compte.
- [ ] Aucun texte français dans l'interface anglaise des écrans testés (test de bout en bout qui cherche les mots les plus courants).
- [ ] Spécifications 10 et 14 mises à jour.

### Hors périmètre

Configuration du serveur de courriel de production (#33).

### Dépendances

#756

## #758 — Notifications (1/3) : abonnements push et préférences

### Contexte

« Notifications push web paramétrables par type (ordre exécuté, navire arrivé, vote ouvert). » (10)
Décision : push web standard, clés VAPID par variables d'environnement documentées dans `.env.example`, générées par un script en local et en test ; les clés de production attendent le serveur (#33).
Décision : types de la phase, les trois de 10 plus liturgie désignée, échéance d'un prêt et présage ; chacun s'active ou se coupe, et aucun ne part sans abonnement explicite.
Label : `sensible` (règles par ligne, données de l'appareil).

### Spécification liée

`docs/specs/10-ux-ui.md` (Exigences)
`docs/specs/11-architecture.md`
`docs/specs/12-modele-donnees.md`

### Critères d'acceptation

- [ ] Migration : abonnements (compte, point d'envoi, clés, appareil) et préférences (compte, type, actif), règles par ligne testées en pgTAP.
- [ ] Commandes `notifications.subscribe`, `notifications.unsubscribe` et `notifications.setPreferences` ; un type inconnu est refusé.
- [ ] Clé publique VAPID lue par le client dans sa configuration ; script de génération des clés locales, `.env.example` mis à jour.
- [ ] Spécifications 10, 11 et 12 mises à jour ; registre des traitements complété.

### Hors périmètre

Envoi (ticket suivant), écran (#760), notifications par courriel.

### Dépendances

#756

## #759 — Notifications (2/3) : envoi par le moteur

### Contexte

Une notification naît d'un événement de domaine ; le moteur l'envoie hors de toute transaction de jeu.
Décision : une file de notifications est remplie depuis les événements de domaine par une tâche du moteur, qui garde son curseur, puis envoyée en push dans la langue du compte, sans autre donnée personnelle que le pseudonyme.
Label : `sensible` (règles par ligne de la vue des notifications).

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/specs/11-architecture.md`
`docs/specs/13-moteur-anti-triche.md`

### Critères d'acceptation

- [ ] Tâche du moteur : chaque type de #758 naît de son événement de domaine (ordre d'un joueur exécuté, voyage arrivé, vote d'élection, de décret ou d'ostracisme ouvert, liturgie désignée, échéance à trois jours, présage), une fois par événement même rejouée.
- [ ] Envoi vers le point d'abonnement ; un abonnement expiré (404 ou 410) est retiré ; nouvel essai borné ; au plus `notifications.maxPerHour` envois par compte et par heure, le reste regroupé.
- [ ] Rien ne part pour un type coupé ni pour un compte sans abonnement.
- [ ] Vue privée `my_notifications` (les dernières, lues ou non), règles par ligne testées en pgTAP.
- [ ] Tests d'intégration contre un service push factice local : chaque type, langue du compte, préférence coupée, abonnement expiré.
- [ ] Spécification 10 mise à jour.

### Hors périmètre

Écran (ticket suivant), courriels, notifications des modérateurs.

### Dépendances

#758

## #760 — Notifications (3/3) : réglages, service worker et non lus

### Contexte

« Hors de l'onglet Messages, rien n'est encore signalé : le nombre de non lus sur l'onglet viendra avec les notifications. » (10)
Label : aucun.

### Spécification liée

`docs/specs/10-ux-ui.md`
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Réglages, section Notifications : autorisation demandée sur un geste du joueur, interrupteur par type, état de l'abonnement de l'appareil.
- [ ] Le service worker affiche la notification et ouvre l'écran concerné ; refusée par le navigateur, l'écran le dit.
- [ ] Onglet Messages : liste des notifications, et nombre de non lus (messages et notifications) sur l'onglet.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Notifications dans l'application native, courriels.

### Dépendances

#759, #698

## #761 — Simulateur dans Olympe (1/2) : simulations lancées par l'API

### Contexte

Le simulateur de #284 est une commande locale ; son module dans Olympe, sur une copie du monde réel, attendait le serveur (15.2).
Décision : le module lance le simulateur existant sur des mondes neufs d'une base de simulation distincte de celle du jeu (`SIMULATOR_DATABASE_URL`, documentée dans `.env.example`), et refuse de tourner si les deux désignent la même base ; la copie du monde réel attend toujours le serveur.
Le moteur exécute une simulation à la fois, en tâche de fond, et garde son rapport.
Label : aucun (aucune écriture dans les tables du jeu ; rôles d'Olympe existants).

### Spécification liée

`docs/specs/15-back-office-olympe.md` (15.1, 15.2)
`docs/specs/14-infrastructure.md`

### Critères d'acceptation

- [ ] `POST /api/admin/simulations` (version candidate, jours au plus 30, graine), réservé au super-administrateur et au concepteur de jeu, tracé ; `GET` de la liste et d'un rapport.
- [ ] Table des simulations (état, demandeur, paramètres, rapport, erreur), écrite par le seul service.
- [ ] Une candidate refusée par le schéma l'est avant toute simulation, champ désigné.
- [ ] Tests d'intégration sur une base de simulation locale : simulation menée à son terme, refus de la base du jeu, une seule à la fois, échec noté.
- [ ] `.env.example` et spécification 15.2 mis à jour.

### Hors périmètre

Copie du monde réel, agents pilotés par IA, écran (ticket suivant).

### Dépendances

Aucune.

## #762 — Simulateur dans Olympe (2/2) : module

### Contexte

Le module Simulateur (15.1) montre les simulations lancées par #761.
Label : aucun.

### Spécification liée

`docs/specs/15-back-office-olympe.md` (15.1, 15.2)
`docs/adr/0011-refonte-graphique.md`

### Critères d'acceptation

- [ ] Module Simulateur : lancement en feuille (version candidate, jours, graine), liste des simulations et de leur état.
- [ ] Rapport : inflation, masse, robinets et puits, couverture, population, marges par filière et Gini, avec l'écart entre candidate et référence ; chaque graphique doublé de son tableau.
- [ ] Sous chaque version de configuration, un lien vers ses simulations.
- [ ] Suit l'ADR 0011 (feuilles, étapes, icônes), thèmes clair et sombre, 360 px et 1 440 px, clavier, textes `fr` et `en` ; tests de bout en bout.

### Hors périmètre

Copie du monde réel.

### Dépendances

#761, #699

## #763 — Pré-tri des signalements par l'IA

### Contexte

« File des signalements pré-triée par l'IA » (15.1) ; l'IA « classe les messages signalés, résume les dossiers ; la sanction reste une décision humaine » (8.1) ; reporté en phase 2 (15.4).
Décision : l'usage `moderation_triage` range chaque message signalé dans une catégorie d'une liste fermée (violation probable, douteux, probablement infondé) et le résume en une phrase bornée ; la file montre d'abord les violations probables, puis garde dans chaque catégorie l'ordre de la phase 2.
Repli : IA coupée ou sortie rejetée, le message n'a pas de catégorie et la file garde l'ordre de la phase 2.
Le texte signalé est une donnée, jamais une instruction (8.4) ; seuls le pseudonyme et le texte partent au modèle.
Label : aucun (le modèle n'écrit rien en base ; la sanction reste humaine).

### Spécification liée

`docs/specs/15-back-office-olympe.md` (15.1, 15.4)
`docs/specs/08-ia.md` (8.1, 8.4)
`docs/adr/0005-passerelle-ia.md`

### Critères d'acceptation

- [ ] Usage `moderation_triage` en configuration, coupé au départ ; tâche du moteur, hors de toute transaction, un essai par message signalé.
- [ ] Schéma de sortie : une catégorie de la liste et un résumé borné, sans nombre ni nom de maison absent du message ; toute autre sortie est rejetée.
- [ ] La file d'Olympe montre la catégorie et le résumé, dit qu'ils viennent de l'IA, et aucune commande de sanction ne lit la catégorie (test).
- [ ] Repli testé IA coupée : file dans l'ordre de la phase 2.
- [ ] Spécifications 15.1, 15.4 et 8.1 mises à jour.

### Hors périmètre

Sanction proposée par l'IA, résumé de dossiers d'appel.

### Dépendances

#699

## #764 — Calibrage de la phase 3 (1/2) : prêts, banques et risques en mer

### Contexte

Prêts du temple, banques, risques en mer et galère d'escorte sont entrés neutres (#724 à #731, #740).
Ce ticket les active par une version de configuration éprouvée par le banc à douze cités, dont des maisons scriptées empruntent, déposent, prêtent et partent en mer.
Le taux directeur est un des trois leviers de l'inflation (5.5) : la demande de fusion dit sa valeur et son effet mesuré.
Label : aucun (configuration et test ; aucune écriture de monnaie nouvelle).

### Spécification liée

`docs/specs/05-economie.md` (5.4, 5.5)
`docs/specs/04-systemes-gestion.md` (4.6)

### Critères d'acceptation

- [ ] Configuration initiale : taux directeur, durées et plafonds du temple, section `banks`, risques des routes et classe de galère d'escorte, justifiés par le rapport du simulateur.
- [ ] Le banc à douze cités joue des emprunts au temple, une banque, des dépôts, un prêt gagé, un prêt maritime et des pertes en mer, et tient toutes ses bornes, masse de −5 % à +25 % comprise.
- [ ] Le banc rapporte le net de `faucet_temple_loans` et de `sink_temple_interest` sur les jours mesurés.
- [ ] Spécification 5.5 mise à jour.

### Hors périmètre

Hybris, marchands, Jeux et politique (ticket suivant).

### Dépendances

#721, #731, #740

## #765 — Calibrage de la phase 3 (2/2) : Timè, Hybris, marchands, Jeux et politique

### Contexte

Timè, Hybris et Némésis, marchands, récompenses des Jeux et modèles de décret de la phase (ostracisme, ligues, conflits) sont entrés neutres.
Ce ticket les active par une version de configuration éprouvée par le banc à douze cités.
Label : aucun (configuration et test).

### Spécification liée

`docs/specs/05-economie.md` (5.5)
`docs/specs/07-dieux-faveur-evenements.md` (7.2)
`docs/specs/06-cites-politique-communaute.md` (6.3 à 6.6)

### Critères d'acceptation

- [ ] Configuration initiale : gains et pertes de Timè, poids et seuils de l'Hybris, Némésis, escales des marchands, récompenses des Jeux, modèles de décret de l'ostracisme, des ligues et des conflits ouverts, justifiés par le rapport du simulateur.
- [ ] Dans le banc, une maison scriptée qui domine un marché atteint un palier d'Hybris et reçoit un présage, et les marchands font escale.
- [ ] Le banc à douze cités tient toutes ses bornes, masse de −5 % à +25 % comprise, avec les robinets et puits des marchands.
- [ ] Spécifications 5.5 et 7.2 mises à jour.

### Hors périmètre

Mesures avec des joueurs réels.

### Dépendances

#722, #735, #739, #742, #744, #748, #764

## #766 — Parcours de la bêta et vérification du critère de sortie

### Contexte

Le critère de sortie de la phase 3, en tête de ce fichier, se vérifie par le code tant que le serveur est reporté, comme ceux des phases 1 et 2.
Label : aucun.

### Spécification liée

`docs/specs/17-feuille-de-route.md`
`docs/specs/18-indicateurs-risques-conformite.md`
`docs/specs/10-ux-ui.md`

### Critères d'acceptation

- [ ] Test de bout en bout `beta-journey` à 360 px, interface en anglais, IA coupée et aucun appel journalisé, avec la configuration initiale calibrée, qui enchaîne le parcours du point 1 avec plusieurs joueurs dans un monde de douze cités.
- [ ] Vérification de chaque point du critère écrite dans `docs/specs/17-feuille-de-route.md`, avec les tickets qui le couvrent.
- [ ] Le test du tableau de bord (#670) nomme chaque robinet et chaque puits de la phase 3.
- [ ] `docs/etat.md` mis à jour.
- [ ] Tickets de la phase 4 rédigés dans `docs/tickets/phase-4.md`, au même format.

### Hors périmètre

Mesures avec des joueurs réels (attendent le serveur, #33).

### Dépendances

#707, #723, #733, #736, #743, #747, #749, #755, #757, #760, #762, #763, #765

## #767 — Fournisseur de paiement réel

### Contexte

La boutique (#751 à #755) passe par un fournisseur de paiement factice ; le vrai, Stripe Checkout et ses avis de paiement (11), demande un compte et des clés.
Ce que l'humain fournit : l'ouverture et la vérification du compte du fournisseur au nom de l'exploitant (identité, compte bancaire), le réglage de la TVA et des factures, la clé d'API et le secret des avis de paiement, saisis comme secrets du serveur et jamais dans le dépôt.
Ce que fait ensuite un agent : la mise en œuvre de l'interface de paiement pour ce fournisseur, essayée sur son mode de test.
Label : `needs-human` (compte tiers, clés d'API, moyen de paiement).

### Spécification liée

`docs/specs/09-monetisation.md`
`docs/specs/11-architecture.md`
`docs/specs/14-infrastructure.md`

### Critères d'acceptation

- [ ] Compte du fournisseur ouvert et vérifié, TVA et factures réglées, par l'humain.
- [ ] Clé d'API et secret des avis de paiement saisis sur le serveur par l'humain, leurs noms documentés dans `.env.example`.
- [ ] Mise en œuvre de l'interface de paiement pour ce fournisseur, choisie par configuration, le fournisseur factice restant celui des tests et de `ci`.
- [ ] Achat, renouvellement, résiliation et remboursement essayés sur le mode de test du fournisseur, avis rejoué compris.
- [ ] Spécifications 9, 11 et 14 mises à jour.

### Hors périmètre

Magasins d'applications, autres moyens de paiement.

### Dépendances

#754, #33

## #768 — Relecture juridique des conditions d'utilisation et de vente

### Contexte

« Une relecture par un juriste des conditions d'utilisation et de vente est à prévoir avant la bêta ouverte. » (18)
Ce que l'humain fournit : le choix et le mandat d'un juriste, sa relecture des textes, et la validation des corrections par l'exploitant.
Ce que font les agents avant : les projets de conditions d'utilisation, de conditions de vente (rétractation, TVA), de charte de conduite, de politique de confidentialité et de mentions légales, en `fr` et en `en`, dans `docs/`.
Label : `needs-human` (décision et engagement juridiques de l'exploitant).

### Spécification liée

`docs/specs/18-indicateurs-risques-conformite.md` (Conformité)
`docs/specs/09-monetisation.md`

### Critères d'acceptation

- [ ] Projets des cinq textes en `fr` et en `en`, rédigés par les agents d'après 18, 9 et ce que le jeu fait réellement (âge, données gardées, durée de conservation des messages, IA).
- [ ] Relecture par un juriste mandaté par l'humain, et corrections validées par l'exploitant.
- [ ] Textes définitifs liés depuis la connexion, la création de maison et la boutique, la version acceptée gardée avec le compte.
- [ ] Registre des traitements à jour.

### Hors périmètre

Contrat de sous-traitance avec le fournisseur d'IA (#269).

### Dépendances

#750, #755

## #769 — Clés de production des notifications push

### Contexte

Les notifications push (#758 à #760) signent leurs envois par une paire de clés VAPID, générées en local et en test.
Ce que l'humain fournit, avec le serveur (#33) : la paire de clés de production, générée sur le serveur et saisie comme secret, et l'adresse de contact que les services push exigent.
Une clé publique ne change plus une fois des appareils abonnés : la changer les désabonne tous.
Label : `needs-human` (secret de production, serveur).

### Spécification liée

`docs/specs/10-ux-ui.md` (Exigences)
`docs/specs/14-infrastructure.md`

### Critères d'acceptation

- [ ] Paire de clés de production générée et saisie sur le serveur par l'humain, jamais dans le dépôt.
- [ ] Adresse de contact choisie par l'humain et configurée.
- [ ] Une notification de chaque type reçue sur un téléphone et un ordinateur réels, vérifiée par l'humain.
- [ ] Procédure de remplacement des clés écrite dans `docs/exploitation/`.

### Hors périmètre

Notifications dans une application native.

### Dépendances

#759, #33
