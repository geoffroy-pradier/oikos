# Tickets — phase 2, alpha fermée

À traiter dans l'ordre.
Contenu de la phase (`docs/specs/17-feuille-de-route.md`) : 4 cités, transport maritime, immobilier, personnel et intendants, archonte, taxes et décrets, discussion, Charis et grâces, Pythie et chronique, modération v1, simulateur.
S'y ajoutent de nouveaux puits de monnaie, un banc d'équilibrage à plusieurs cités et l'équilibrage des marges des ateliers.

**Critère de sortie** (le schéma de la feuille de route n'est pas exporté ; retenu par délégation du propriétaire le 15 novembre 2026, tiré de `docs/specs/17-feuille-de-route.md` et de `docs/specs/18-indicateurs-risques-conformite.md`) :

1. **Parcours de l'alpha, IA coupée.**
   Dans un monde de quatre cités, un joueur peut, sur téléphone (360 px) et au clavier, sans aucun appel à un modèle de langage, jouer tout le parcours de l'alpha.
   Il paie son personnel, transporte un bien par mer d'une cité à l'autre et l'y vend, achète, loue et rénove un logement, confie un site à un intendant par formulaire, se porte candidat et vote à l'élection de l'archonte, vote un décret, écrit dans le canal de sa cité et à une autre maison, signale un message, fait une offrande, invoque une grâce, consulte la Pythie et lit la chronique de sa cité.
   Chaque étape est couverte par un test de bout en bout de `apps/web`.
2. **Économie à quatre cités.**
   Le banc d'équilibrage joue 10 jours de mise en route puis 30 jours mesurés à quatre cités, avec la configuration initiale calibrée par P2-34.
   Il tient dans chaque cité les bornes de la phase 1 (coût du panier de 0 à 2 % entre les dix premiers et les dix derniers jours mesurés, besoins vitaux couverts à 98 % au moins, population qui ne baisse pas).
   La masse monétaire varie de −3 % à +3 % sur les 30 jours mesurés, au lieu de croître d'environ 60 000 oboles par jour (limite connue de 5.5).
   La marge nette quotidienne d'un site de chaque filière d'atelier se situe entre la moitié et le double de la médiane de celle des sites de matières premières.
   Toutes ces bornes sont écrites à la main dans le test.
3. **Pilotage.**
   Le tableau de bord économique d'Olympe suit chaque robinet et chaque puits ajoutés pendant la phase.
   Le simulateur compare sur 30 jours une configuration candidate à la configuration de référence (inflation, masse monétaire, robinets et puits, couverture des besoins, marges par filière).
4. **Communauté.**
   Un signalement se traite de bout en bout dans Olympe (sanction graduée, appel), et l'API bloque un joueur réduit au silence ou suspendu.
5. **IA.**
   Chaque usage d'IA de la phase (oracle, chronique, consigne d'intendant) a son repli sans IA, testé IA coupée.
   Le plafond mensuel de la passerelle se déduit de deux valeurs de configuration, le budget par joueur actif et par mois (moins de 0,10 €, 18) et le nombre de joueurs actifs attendu.
   Un usage qui atteint ce plafond est coupé proprement, ce qu'un test vérifie sur le fournisseur factice.

Les indicateurs de 18 qui demandent des joueurs réels (rétention, part des joueurs actifs qui ont voté ou écrit dans la semaine, sessions par jour) seront mesurés pendant l'alpha elle-même.
Ils ne sont pas une porte de sortie de la phase tant que le serveur est reporté (exception décidée par le propriétaire en 17).

**État de la phase 1.**
La phase 1 se ferme avec son dernier suivi, #234 ; aucun ticket ci-dessous n'en dépend.
Le serveur de préproduction (#33, `needs-human`) reste reporté : aucun ticket ci-dessous ne demande de serveur, de domaine, de secret ni de compte tiers, sauf P2-20, marqué `needs-human`.

**Numérotation.**
Les numéros P2-1 à P2-37 sont provisoires et seront remplacés par ceux des tickets GitHub, dépendances comprises.

**Décisions prises en rédigeant ces tickets.**
Chaque décision est rappelée dans le ticket qu'elle concerne, et la demande de fusion met la spécification à jour.

- **Paramètres neutres.** Le banc de #78 tourne en `ci` sur la configuration initiale (`INITIAL_CONFIG`), avec des bornes écrites à la main.
  Tout nouveau paramètre économique de la phase entre donc neutre dans la configuration initiale : montant nul (salaires, hébergement, provisions, droit de port, entretien des navires et des logements, vétusté, salaire des intendants), probabilité nulle (événements), taux de la cité égal à celui du monde, offre de travail sans limite, usage d'IA désactivé.
  P2-34 les active, par une version de configuration éprouvée par le banc à quatre cités.
  Un montant nul ne prélève rien et n'écrit aucune ligne.
- **Puits nommés.** Chaque flux de monnaie détruite a son puits, ajouté au catalogue des comptes système (migration), à `SYSTEM_ACCOUNT_KEYS` (`packages/sim/src/ledger.ts`), à la liste figée du test pgTAP 013 et aux libellés `fr` et `en` d'Olympe que vérifie `apps/admin/src/i18n.test.ts`.
- **Natures des flux de la maison.** `my_cash_flows` (migration 32) classe une ligne selon la nature de son écriture.
  P2-6 ajoute un marqueur de nature par ligne du grand livre, que lisent `my_cash_flows` et `my_income_statement` quand il est présent : une écriture `upkeep.daily` ou `upkeep.restart` porte une ligne de débit par nature (entretien, salaires, hébergement), si bien que 4.1 les distingue.
  Chaque ticket qui ajoute une écriture de maison lui donne sa nature 4.1 et met 4.1 à jour.
- **Ordre de la clôture.** L'entretien reste la dernière étape (5.5).
  Avant lui, dans cet ordre : loyers (et fin des baux impayés), vétusté des logements, application des décrets, déclin de la Charis, planification des événements, salaire du jour et prix de l'hébergement ; la capacité de logement se lit après la fin des baux impayés.
- Les liturgies restent en phase 3, où 17 les place ; 06 ne leur donne pas de phase.
- Un site reste dans la cité de sa maison (4.2, inchangé) ; les autres cités s'atteignent par le transport, l'agora et l'immobilier.
- Kallistè, cité fondatrice, garde toutes ses matières premières de la phase 1 ; seul P2-34 resserre son terroir.
- Les quatre cités ont un port ; les caravanes terrestres (4.6) attendent une carte.
- Le risque en mer de la phase 2 est un retard (tempête, événement planifié), jamais une perte de cargaison ; la perte viendra avec le prêt maritime (phase 3).
- Le droit de port est un forfait par arrivée et par classe de navire, modulé par la cité, et non un pourcentage de la valeur de la cargaison (5.6) : celle-ci n'a pas de valeur publique sûre.
- Les travailleurs sont attachés à leur site : la recette dit combien il en faut, et la maison les paie à la clôture avec l'entretien ; il n'y a pas de commande d'embauche.
- Les logements sont le seul bien immobilier de la phase 2 ; boutiques, entrepôts, auberges, bains, zonage et enchères attendent la phase 3.
- L'archonte est le seul magistrat de la phase 2 ; les décrets se choisissent dans un petit catalogue fermé, par formulaire, sans conversion d'une intention par l'IA.
- La citoyenneté vient d'elle-même après un nombre de jours de jeu comme métèque.
- La Charis ne se gagne que par offrandes ; paliers passifs, présages, rang sacerdotal et temples attendent la phase 3.
- Un petit système d'événements planifiés est ajouté (7.3, 7.4) : la Pythie en a besoin, bien que 17 ne le cite pas.
- Le pré-tri des signalements par l'IA attend une phase suivante : la file est triée par âge et par nombre de signalements.
- Le simulateur rejoue le banc d'équilibrage en local, sur un monde neuf ; son module dans Olympe, sur une copie du monde réel, attend le serveur.

---

# P2-1. Quatre cités : terroir, port et dieu protecteur

## Contexte

Le monde n'a qu'une cité, Kallistè.
La spécification 6.1 donne à chaque cité un terroir (ressources abondantes et absentes), un port ou non et un dieu protecteur, et veut qu'aucune ne soit autosuffisante, pour que la carte des ressources impose le commerce.
Ce ticket ouvre trois cités de plus, sans transport : chacune vit d'abord de sa propre agora.

Décision (ambiguïté de 6.1) : les quatre cités ont un port, puisque le seul transport de la phase est maritime.
Décision : un site reste dans la cité de sa maison (4.2) ; le terroir ne fait que restreindre les recettes qu'on peut y lancer.
Décision : Kallistè, cité fondatrice, garde au départ toutes les matières premières de la phase 1 ; son terroir se resserre par configuration une fois le banc à quatre cités en place (P2-34).
Décision : la configuration reçoit ici une liste de dieux, réduite à leurs identifiants, que P2-16 complète.
Décision : chaque cité peut avoir sa propre recette de départ, puisque Ampelos et Halos n'ont pas de blé.
Label : `sensible` (règles par ligne de `city_identity` ; `site.acquire`, `site.setRecipe` et `house.create` touchés).

## Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.1), `docs/specs/04-systemes-gestion.md` (4.2), `docs/specs/05-economie.md` (5.2), `docs/specs/03-boucles-progression.md` (progression), `docs/specs/02-univers.md`

## Critères d'acceptation

- [ ] Configuration : liste `gods` (identifiants seuls : Déméter, Athéna, Dionysos, Poséidon, Apollon) ; chaque cité porte son terroir (identifiants des recettes de matière première admises ; les ateliers sont admis partout), son port, son dieu protecteur et, si elle veut, sa recette de départ ; le schéma refuse un dieu, une recette ou une population inconnus.
- [ ] Le schéma refuse une cité dont la recette de départ (la sienne, sinon `starting.siteRecipeId`) n'est pas dans son terroir.
- [ ] Valeurs de départ, à ajuster par P2-34 : Kallistè (Déméter) garde toutes les matières premières de la phase 1, pour que la cité prototype, ses tests de bout en bout et le banc de #78 restent tels quels ; Elaia (Athéna : olives, blé, sel, bois ; départ : blé), Ampelos (Dionysos : raisin, poisson, laine, argile ; départ : raisin), Halos (Poséidon : poisson, sel, argile, bois, laine ; départ : poisson) ; aucune des trois nouvelles cités n'a toutes les matières premières du panier de ses PNJ.
- [ ] Restreindre le terroir de Kallistè, pour qu'aucune cité ne soit autosuffisante (6.1), revient à P2-34 : c'est une version de configuration, éprouvée par le banc à quatre cités.
- [ ] Population de chaque cité en configuration, à l'échelle de la cité prototype (5.5), et demande des PNJ jouée pour les quatre.
- [ ] `seed.sql` crée les trois cités dans le monde de développement ; leurs noms sont dans les fichiers de traduction `fr` et `en`, par identifiant court.
- [ ] `house.create` lance la recette de départ de la cité choisie.
- [ ] `site.acquire` et `site.setRecipe` refusent une recette absente du terroir de la cité du site (`RECIPE_NOT_IN_TERROIR`), sans rien prélever ; un site existant hors terroir continue de tourner.
- [ ] Vue publique `city_identity` (terroir, port, dieu protecteur, recette de départ) pour les joueurs connectés, règles par ligne testées en pgTAP.
- [ ] Écrans : la création de maison présente les quatre cités avec leur terroir et leur dieu ; l'onglet Cité montre ceux de la cité du joueur ; 360 px, clavier, fr et en.
- [ ] Tests d'intégration : création d'une maison dans chacune des quatre cités, acquisition refusée hors terroir, demande des PNJ dans chaque cité, indice des prix calculé sur les quatre.
- [ ] Spécifications 6.1, 4.2 et 3 mises à jour.

## Hors périmètre

Transport, citoyenneté, offrandes, carte des parcelles, cités sans port, création d'une cité depuis Olympe.

## Dépendances

aucune

---

# P2-2. Transport (1/4) : navires

## Contexte

« Les prix diffèrent d'une cité à l'autre ; le transport est le métier qui les rapproche » (4.6).
Ce ticket donne aux maisons des navires, à quai dans leur cité ; le départ et l'entretien viennent avec P2-3.

Décision (ambiguïté de 4.6) : deux classes de navires en phase 2, le caboteur et le navire rond ; la galère d'escorte et l'escorte attendent les conflits (phase 3).
Décision (paramètres neutres) : l'entretien des navires entre à zéro dans la configuration initiale.
Label : `sensible` (monnaie, règles par ligne).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1, 4.6), `docs/specs/05-economie.md` (5.5), `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] Configuration : classes de navires (capacité en unités, vitesse en points de base, prix d'achat, entretien quotidien, nul au départ) ; une version publiée avant le transport se lit sans navire.
- [ ] Migration : table `ships` (maison, classe, cité où il est à quai, désarmé depuis) ; puits `sink_ship_purchase` ajouté au catalogue, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013 et aux libellés `fr` et `en` d'Olympe.
- [ ] Commande `ship.acquire` (classe, prix vu) : navire à quai dans la cité de la maison, prix détruit dans une écriture `ship.acquire`, `PRICE_CHANGED` comme `site.acquire` ; événement `ShipAcquired`.
- [ ] Nature 4.1 de `ship.acquire` : `acquisitions` (hors exploitation) ; `my_cash_flows` et 4.1 mis à jour.
- [ ] La base garantit qu'un navire naît à quai, dans une cité de son monde, et ne change pas de propriétaire (tests pgTAP sous `oikos_service`).
- [ ] Vue privée `my_ships` et vue publique `ship_rules` (classes et tarifs), règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : idempotence, prix changé, trésorerie insuffisante.
- [ ] Spécifications 4.6, 4.1, 5.5 et 12 mises à jour ; glossaire (caboteur, navire rond).

## Hors périmètre

Routes, départ, entretien (P2-3), galère d'escorte, revente d'un navire.

## Dépendances

P2-1

---

# P2-3. Transport (2/4) : départ d'un voyage et entretien des navires

## Contexte

Un navire part chargé d'une cité vers une autre ; l'arrivée est jouée par le moteur (P2-4).
Le droit de port, les provisions et l'entretien des navires sont des puits de monnaie.

Décision (ambiguïté de 5.6) : le droit de port de la cité d'arrivée est un forfait par classe de navire, payé au départ, dont la cité module le montant (P2-13) ; une part est détruite, le reste va au trésor de la cité d'arrivée, comme la taxe de marché.
5.6, qui fixe le droit de port à 2 % par défaut, est mis à jour en conséquence.
Décision : un navire dont l'entretien n'est pas payé est désarmé jusqu'à une clôture qui le paie ; il n'a pas de commande de relance.
Décision (paramètres neutres) : provisions et droit de port entrent à zéro dans la configuration initiale, comme l'entretien des navires (P2-2).
Label : `sensible` (monnaie, stocks, règles par ligne).

Tranches prévues : (1) routes, voyages, cargaison et garde du journal des stocks, avec leurs tests pgTAP ; (2) `voyage.depart` ; (3) entretien des navires à la clôture et vues.

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1, 4.6), `docs/specs/05-economie.md` (5.5, 5.6), `docs/specs/12-modele-donnees.md`, `docs/specs/13-moteur-anti-triche.md`

## Critères d'acceptation

- [ ] Configuration : routes entre cités (durée en heures, de 2 à 20), provisions par route et par classe, droit de port par classe et part détruite, coefficient de droit de port de chaque cité (10 000 au départ).
- [ ] Migration : tables `voyages` (navire, cités de départ et d'arrivée, départ, arrivée prévue, arrivé le) et `voyage_cargo` (voyage, bien, quantité) ; puits `sink_voyage_provisions`, `sink_port_dues` et `sink_ship_upkeep` ajoutés au catalogue, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013 et aux libellés `fr` et `en` d'Olympe.
- [ ] Journal des stocks : extrémité système `in_transit`, rattachée au voyage ; la base garantit qu'un voyage ne décharge que ce qu'il a chargé, une seule fois, et vers la cité d'arrivée de sa maison (tests pgTAP sous `oikos_service`).
- [ ] Commande `voyage.depart` (navire, cité d'arrivée, cargaison, coût vu) : refus si le navire est en mer, désarmé, hors de la cité de départ, sans route, ou si la cargaison dépasse sa capacité ou le stock libre ; provisions et droit de port payés dans une écriture `voyage.departure`, cargaison sortie vers `in_transit` dans la même transaction ; événement `VoyageDeparted`.
- [ ] Le stock en mer n'est ni réservable par un ordre ni acheté par les PNJ, et la demande des PNJ n'est pas modifiée.
- [ ] Nature 4.1 de `voyage.departure` : `transport` (exploitation) ; `my_cash_flows`, `my_income_statement` et 4.1 mis à jour.
- [ ] Clôture : l'entretien des navires entre dans l'écriture `upkeep.daily` de la maison (une seule par maison et par jour, 12), examiné après celui des sites, par une ligne marquée `upkeep` vers `sink_ship_upkeep` ; un navire impayé est désarmé, ce que dit `UpkeepSettled`.
- [ ] L'étape d'entretien parcourt les maisons qui ont des navires, et pas seulement celles qui ont des sites.
- [ ] Calcul pur dans `packages/sim` (durée d'un trajet, coût du départ, droit de port et sa répartition), testé par propriétés (arrondis jamais en faveur de la monnaie en circulation).
- [ ] Vue privée `my_voyages` ; routes et tarifs ajoutés à `ship_rules` ; règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : deux départs concurrents du même navire, départ avec un stock réservé par une vente, navire désarmé, solde jamais négatif.
- [ ] Spécifications 4.6, 4.1, 5.5, 5.6 et 12 mises à jour ; glossaire (droit de port).

## Hors périmètre

Arrivée et déchargement (P2-4), tempêtes (P2-18), marché du fret, prêt maritime, perte de cargaison.

## Dépendances

P2-2, P2-6

---

# P2-4. Transport (3/4) : arrivée des voyages par le moteur

## Contexte

Un voyage parti (P2-3) doit arriver à son heure : sa cargaison entre dans le stock de la maison dans la cité d'arrivée, et le navire y est à quai.

Décision (écart avec l'évaluation paresseuse des trajets en 13) : l'arrivée est une étape du tick, qui ne traite que les voyages échus ; son coût suit donc l'activité, comme le veut 13, et le déchargement reste une écriture du journal des stocks dans une transaction du moteur.
Label : `sensible` (stocks).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.6), `docs/specs/13-moteur-anti-triche.md`, `docs/specs/03-boucles-progression.md` (temps et horloges)

## Critères d'acceptation

- [ ] Étape du tick, après la demande des PNJ : chaque voyage dont l'arrivée prévue est passée est déchargé (`in_transit` vers le stock libre de la maison dans la cité d'arrivée), le navire passe à quai dans cette cité ; événement `VoyageArrived`.
- [ ] Rejouer un tick, ou deux moteurs concurrents, ne décharge rien deux fois.
- [ ] Un voyage arrivé pendant une panne est déchargé au premier tick qui suit, daté de ce tick.
- [ ] Une maison peut vendre la cargaison à l'agora de la cité d'arrivée dès le déchargement (test d'intégration de bout en bout : départ, arrivée, vente).
- [ ] Vigie : nombre de voyages en retard de déchargement de plus d'un tick.
- [ ] Spécifications 4.6 et 13 mises à jour (étape d'arrivée, écart assumé avec l'évaluation paresseuse).

## Hors périmètre

Tempêtes et autres retards (P2-18), écran (P2-5).

## Dépendances

P2-3

---

# P2-5. Transport (4/4) : écran Carte, flotte et voyages

## Contexte

L'onglet Carte est une coquille vide.
Il doit montrer l'archipel, ses routes et les navires en mer, et permettre d'acheter un navire et de le faire partir (10).
Label : aucun.

## Spécification liée

`docs/specs/10-ux-ui.md` (navigation, accessibilité), `docs/specs/04-systemes-gestion.md` (4.6)

## Critères d'acceptation

- [ ] Carte de l'archipel en vectoriel : les quatre cités, les routes et leur durée, les navires de la maison en mer et à quai ; doublée d'une liste accessible au clavier qui porte les mêmes informations.
- [ ] Achat d'un navire au prix affiché ; départ d'un voyage en trois touches au plus depuis la fiche du navire (destination, cargaison prise dans le stock libre de la cité, coût annoncé avant l'envoi).
- [ ] Fiche d'un voyage : départ, arrivée prévue, cargaison ; un voyage arrivé est annoncé à la relecture.
- [ ] L'entrepôt de l'onglet Maison montre le stock par cité, celui en mer compris.
- [ ] Écran Comptes : nature `transport` libellée.
- [ ] Clés d'idempotence gardées comme pour l'acquisition d'un site (4.2) ; « le prix a changé » repart d'une demande neuve.
- [ ] Montants en drachmes et oboles, 360 px et 1 440 px, clavier, fr et en ; tests de bout en bout.

## Hors périmètre

Parcelles, temps réel, notifications push.

## Dépendances

P2-4

---

# P2-6. Personnel (1/2) : salaires des travailleurs à la clôture

## Contexte

Chaque recette porte déjà un nombre de travailleurs (`workers`), que rien ne paie.
Les salaires versés aux travailleurs PNJ sont un puits prévu en 5.5 (`sink_npc_wages`, déjà au catalogue), et le premier levier pour ralentir la croissance de la masse monétaire.

Décision (ambiguïté de 4.4) : les travailleurs sont attachés à leur site ; la recette dit combien il en faut, et la maison les paie à la clôture avec l'entretien du site, sans commande d'embauche.
Un site est payé en entier (entretien et salaires) ou pas du tout, et un site impayé est à l'arrêt comme aujourd'hui (5.5).
Décision (natures des flux) : une écriture `upkeep.daily` ou `upkeep.restart` porte une ligne de débit de la trésorerie par nature, chacune marquée (entretien, salaires, puis hébergement avec P2-9) ; `my_cash_flows` et `my_income_statement` lisent ce marqueur quand il est présent, sinon la nature de l'écriture comme aujourd'hui.
Décision (paramètres neutres) : le salaire entre à zéro dans la configuration initiale.
Label : `sensible` (monnaie, règles par ligne des vues de comptes).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1, 4.4), `docs/specs/05-economie.md` (5.5), `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] Configuration : salaire quotidien de base d'un travailleur par cité (`staff.dailyWageOboles`), nul dans la configuration initiale ; une version publiée avant le personnel se lit sans salaire.
- [ ] Migration : marqueur de nature facultatif sur `ledger_lines`, pris dans une liste fermée contrôlée par la base, écrit à l'insertion seulement ; les lignes existantes restent sans marqueur.
- [ ] Clôture : chaque site doit son entretien plus ses salaires (travailleurs de sa recette × salaire du jour), dans la même écriture `upkeep.daily` : une ligne de débit marquée `upkeep` vers `sink_upkeep`, une marquée `wages` vers `sink_npc_wages` ; même ordre d'examen, mêmes règles qu'en 5.5 (ni paiement partiel, ni solde négatif, séquestre non compté).
- [ ] `site.restart` paie l'entretien et les salaires d'un jour, au prix vu (`PRICE_CHANGED` sinon), avec le même découpage.
- [ ] `my_cash_flows` et `my_income_statement` comptent la nature `wages` (exploitation) ; la somme des flux d'une période reste la variation du solde (test).
- [ ] `UpkeepSettled` et `SiteRestarted` distinguent entretien et salaires.
- [ ] Calcul pur du dû d'un site dans `packages/sim` (`dailyUpkeep` étendu), testé par propriétés.
- [ ] Vue publique `site_rules` : salaire du jour de la cité.
- [ ] Tests d'intégration : maison qui ne peut payer que certains sites, relance au prix vu, salaire nul (aucune ligne), version sans personnel.
- [ ] Spécifications 4.4, 5.5, 4.1 et 12 mises à jour.

## Hors périmètre

Salaire d'équilibre et logement (P2-9), artisans, moral, cadence, intendants (P2-29).

## Dépendances

P2-1

---

# P2-7. Immobilier (1/2) : parc de la cité, achat, entretien et rénovation

## Contexte

L'immobilier urbain (4.5) est le premier puits de monnaie nouveau prévu par 5.5 pour la phase 2.
Chaque cité a un parc fini de logements, d'abord à vendre par la cité ; leur prix d'achat, leur entretien et leur rénovation détruisent de la monnaie, et la rénovation consomme des biens.

Décision (ambiguïté de 4.5) : le logement est le seul bien immobilier de la phase 2, en deux tailles (maison et immeuble de rapport) ; boutiques, entrepôts, auberges, bains, zonage, permis et ventes aux enchères attendent la phase 3.
Décision : le prix d'achat à la cité est détruit (puits), comme l'acquisition d'un site, plutôt que versé au trésor.
Décision : une maison peut acheter un logement dans n'importe quelle cité du monde (investir ailleurs comme métèque, 6).
Décision (paramètres neutres) : entretien et vétusté quotidienne entrent à zéro dans la configuration initiale.
Label : `sensible` (monnaie, stocks, règles par ligne).

Tranches prévues : (1) configuration, table, création du parc et gardes de la base ; (2) `property.buy` et `property.renovate` ; (3) vétusté et entretien à la clôture, vues.

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1, 4.5), `docs/specs/05-economie.md` (5.5), `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] Configuration : par cité, nombre de biens de chaque taille ; par taille, prix d'achat, capacité en logements, entretien quotidien, vétusté perdue par jour, seuil de vétusté sous lequel le bien ne loge plus personne, coût de rénovation en oboles et en biens.
- [ ] Migration : table `properties` (cité, taille, propriétaire nul tant que la cité le détient, état de 0 à 10 000, entretien impayé depuis) ; le moteur crée le parc d'une cité au premier tick qui la connaît, comme la population (5.2) ; puits `sink_property_purchase`, `sink_property_upkeep` et `sink_property_works` ajoutés au catalogue, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013 et aux libellés `fr` et `en` d'Olympe.
- [ ] Commande `property.buy` (bien, prix vu) : achat d'un bien que la cité détient, prix détruit dans une écriture `property.buy` ; refus si la trésorerie ne couvre pas ; événement `PropertyBought`.
- [ ] Commande `property.renovate` (bien, coût vu) : coût détruit dans une écriture `property.renovate` et biens consommés dans le stock libre de la maison dans la cité du bien (extrémité `consumption`), dans une transaction ; l'état revient au maximum ; événement `PropertyRenovated`.
- [ ] Natures 4.1 : `property.buy` en `acquisitions` (hors exploitation), `property.renovate` et l'entretien des biens en `upkeep` ; `my_cash_flows`, `my_income_statement` et 4.1 mis à jour.
- [ ] Clôture, avant l'entretien : chaque bien perd sa vétusté du jour, une seule fois par jour de jeu.
- [ ] Clôture, à l'étape d'entretien : l'entretien d'un bien entre dans l'écriture `upkeep.daily` de son propriétaire, ligne marquée `upkeep` vers `sink_property_upkeep`, après les sites et les navires ; impayé, il ne loge personne jusqu'à la clôture qui le paie ; l'étape parcourt aussi les maisons qui n'ont que des biens.
- [ ] La base garantit qu'un bien change de propriétaire seulement par une écriture d'achat de la même transaction et que son état ne remonte que par une rénovation (tests pgTAP sous `oikos_service`).
- [ ] Vues : publique `property_rules` (tailles, prix, capacité, entretien, vétusté, coût de rénovation), publique `city_properties` (parc par cité et par taille, biens à vendre par la cité, sans propriétaire nommé), privée `my_properties` ; règles par ligne testées en pgTAP.
- [ ] Calculs purs de la vétusté et de la capacité utile dans `packages/sim`, testés par propriétés.
- [ ] Tests d'intégration : deux achats concurrents du dernier bien, rénovation sans les biens requis, entretien impayé, vétusté rejouée.
- [ ] Spécifications 4.5, 5.5, 4.1 et 12 mises à jour ; glossaire.

## Hors périmètre

Baux et revente (P2-8), logement des travailleurs (P2-9), écran (P2-10), saisie et enchères.

## Dépendances

P2-6

---

# P2-8. Immobilier (2/2) : baux et revente entre maisons

## Contexte

« Cycle : achat, rénovation, location, revente » (4.5).
Après l'achat à la cité (P2-7), les biens doivent se louer et se revendre entre maisons.
Ces mouvements transfèrent de la monnaie sans en créer ; la revente paie la taxe de marché de la cité.

Décision : le loyer est fixé par le propriétaire et payé chaque jour au début de la clôture par le locataire ; un loyer impayé met fin au bail.
Décision : un bien loué ne se met pas en vente (`PROPERTY_LEASED`) ; la revente se fait à prix affiché, sans enchère.
Label : `sensible` (monnaie, règles par ligne).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1, 4.5), `docs/specs/05-economie.md` (5.3 taxe de marché, 5.5), `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] Migration : tables `property_listings` (bien, prix de vente ou loyer quotidien proposé) et `leases` (bien, locataire, loyer, début, fin).
- [ ] Commandes `property.offerLease`, `property.withdrawOffer`, `property.lease` (loyer vu), `property.endLease` (par l'une ou l'autre partie, effet à la clôture suivante) ; événements `LeaseStarted` et `LeaseEnded`.
- [ ] Commandes `property.listForSale`, `property.buyListed` (prix vu) : écriture `property.sale`, prix payé au vendeur, taxe de marché de la cité du bien prélevée comme à l'agora (même calcul, même répartition) ; événement `PropertySold`.
- [ ] Clôture, avant l'entretien et en premier : chaque bail paie son loyer dans une écriture `lease.rent` (trésorerie du locataire vers celle du propriétaire) ; un loyer impayé met fin au bail, ce que dit un événement.
- [ ] Index unique : une seule écriture `lease.rent` par bail et par jour de jeu.
- [ ] Natures 4.1 : `lease.rent` en `rents` (exploitation, négatif pour le locataire, positif pour le propriétaire), `property.sale` en `acquisitions` (achat ou cession, hors exploitation) et sa taxe en `taxes` ; `my_cash_flows`, `my_income_statement` et 4.1 mis à jour.
- [ ] Une maison ne loue ni n'achète son propre bien.
- [ ] Vues : offres publiques (bien, cité, taille, prix ou loyer, sans nom du propriétaire) et baux privés de chaque partie, règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : deux locations concurrentes du même bien, revente concurrente d'une offre retirée, loyer impayé, clôture rejouée, somme des soldes inchangée hors taxe détruite.
- [ ] Spécifications 4.5, 4.1 et 5.5 mises à jour.

## Hors périmètre

Loyer d'équilibre et logement des travailleurs (P2-9), enchères, saisie, baux à durée fixe.

## Dépendances

P2-7

---

# P2-9. Personnel (2/2) : marché du travail, salaire d'équilibre et logement

## Contexte

« Le salaire d'équilibre dépend de l'offre et de la demande locales » (4.4) et « les travailleurs des joueurs doivent être logés : la pénurie de logements fait monter les salaires » (4.5).
Ce ticket relie personnel et immobilier, et fait du logement un poste de dépense.

Décision (ambiguïté de 4.4 et 4.5) : l'offre de travail d'une cité est une part de la population des classes que la configuration désigne comme travailleuses ; le salaire du jour suit le taux d'emploi de la cité, calculé à la clôture.
Décision : une maison loge ses travailleurs dans les logements qu'elle possède ou loue dans la cité de ses sites ; chaque travailleur sans logement lui coûte chaque jour un hébergement chez les PNJ, détruit (`sink_npc_lodging`), dont le prix monte avec la pénurie de logements de la cité.
La pénurie fait donc monter le coût du travail, ce qui donne un sens économique aux baux.
Décision : si la population tombe sous l'emploi, aucun site ne s'arrête pour autant ; le salaire est à sa borne haute et aucun nouveau site ne peut s'ouvrir.
Décision (paramètres neutres) : la configuration initiale ne fixe pas de part travailleuse (offre sans limite) et met l'hébergement à zéro.
Label : `sensible` (monnaie, règles par ligne).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1, 4.4, 4.5), `docs/specs/05-economie.md` (5.2, 5.5)

## Critères d'acceptation

- [ ] Configuration : classes travailleuses et part de leur population qui travaille, bornes et pente du salaire d'équilibre, prix de base de l'hébergement chez les PNJ, bornes et pente de sa hausse avec la pénurie.
- [ ] Migration : puits `sink_npc_lodging` ajouté au catalogue, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013 et aux libellés `fr` et `en` d'Olympe ; table du marché du travail du jour par cité.
- [ ] Calculs purs dans `packages/sim` (`equilibriumWage`, `lodgingPrice`), monotones et bornés, testés par propriétés.
- [ ] `site.acquire`, `site.setRecipe` (vers une recette qui demande plus de travailleurs) et `house.create` (site de départ) refusent quand la cité n'offre plus assez de travailleurs (`NO_WORKERS_AVAILABLE`), sans rien prélever ; l'écran de création propose alors une autre cité.
- [ ] Clôture, avant l'entretien et après les loyers : salaire du jour et prix de l'hébergement de chaque cité calculés et enregistrés, une seule fois par jour de jeu ; capacité de logement de chaque maison lue après la fin des baux impayés.
- [ ] Les logements d'une maison dans une cité logent d'abord les travailleurs de ses sites les plus anciens ; le dû d'un site comprend l'hébergement de ses travailleurs non logés, payé avec son entretien et ses salaires, dans l'écriture `upkeep.daily`, par une ligne marquée `lodging` vers `sink_npc_lodging`, selon l'examen de 5.5 (payé en entier ou site à l'arrêt).
- [ ] `site.restart` paie aussi l'hébergement d'un jour, au prix vu.
- [ ] Nature 4.1 `lodging` (exploitation) ; `my_cash_flows`, `my_income_statement` et 4.1 mis à jour.
- [ ] Vues : publique `labor_market` (offre, emploi, salaire et prix de l'hébergement du jour, par cité) ; privée `my_workforce` (travailleurs par cité et par site, logés ou non) ; règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : cité au plein emploi, population tombée sous l'emploi, maison logée par un bail, maison sans logement, configuration neutre.
- [ ] Spécifications 4.4, 4.5, 4.1 et 5.5 mises à jour.

## Hors périmètre

Moral, artisans, débauchage, migration de travailleurs entre cités.

## Dépendances

P2-6, P2-8

---

# P2-10. Écrans Personnel et Immobilier

## Contexte

L'onglet Maison doit montrer le personnel et l'immobilier (10), et l'onglet Cité le marché du travail et le parc de logements.
Les vues existent (P2-6 à P2-9) ; ce ticket n'ajoute que des écrans.
Label : aucun.

## Spécification liée

`docs/specs/10-ux-ui.md`, `docs/specs/04-systemes-gestion.md` (4.4, 4.5)

## Critères d'acceptation

- [ ] Fiche de site : travailleurs requis, logés ou non, salaire du jour, coût quotidien total (entretien, salaires, hébergement) ; la relance en dit le prix.
- [ ] Personnel de la maison : travailleurs par cité, logés ou non, coût de l'hébergement chez les PNJ.
- [ ] Immobilier : biens à vendre par la cité et par les maisons, offres de location, mes biens (état, entretien, loyer), achat, rénovation, mise en vente, mise en location, location et fin de bail, chacun au prix vu.
- [ ] Onglet Cité : salaire du jour, taux d'emploi, prix de l'hébergement, parc de logements.
- [ ] Écran Comptes : natures `wages`, `lodging` et `rents` libellées.
- [ ] Tableau de bord : alertes « travailleurs non logés », « bien à rénover », « bail résilié ».
- [ ] Montants en drachmes et oboles, 360 px et 1 440 px, clavier, fr et en ; tests de bout en bout.

## Hors périmètre

Carte des quartiers, temps réel.

## Dépendances

P2-9

---

# P2-11. Citoyenneté et élection de l'archonte

## Contexte

La cité est gouvernée par des joueurs élus (6.2).
La phase 2 n'a qu'un magistrat, l'archonte, élu pour une année de jeu (4 semaines) par les citoyens de sa cité.
Une maison est aujourd'hui métèque pour toujours (`citizenships.status`).

Décision (ambiguïté de 3 et 6) : une maison devient citoyenne d'elle-même, à la clôture, après un nombre de jours de jeu comme métèque fixé en configuration.
Décision : le vote est secret ; une égalité est départagée par l'ancienneté de la candidature.
Label : `sensible` (règles par ligne).

## Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.2), `docs/specs/03-boucles-progression.md` (progression), `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] Configuration : jours de jeu avant la citoyenneté, durée du mandat (28 jours de jeu), calendrier de l'élection (dépôt des candidatures, vote), nombre de mandats consécutifs (2).
- [ ] Étape de clôture, avant l'entretien : promotion des métèques éligibles, événement `CitizenshipGranted`.
- [ ] Migration : tables `elections`, `candidacies`, `ballots`, `offices` (cité, maison, charge `archon`, début, fin).
- [ ] Commandes `city.standForElection`, `city.withdrawCandidacy`, `city.castVote` : citoyens de la cité seulement, un vote par maison et par élection, candidature refusée après deux mandats consécutifs.
- [ ] Étape de clôture, avant l'entretien : ouverture et dépouillement des élections au calendrier, une seule fois même rejouée ; événement `ArchonElected` ; une élection sans candidat laisse la charge vacante jusqu'à la suivante.
- [ ] La base garantit un seul bulletin par maison et par élection et refuse un bulletin hors de la période de vote.
- [ ] Vues : calendrier électoral de chaque cité (dates de dépôt et de vote, durée du mandat), statut de citoyenneté, candidats, résultats publics après dépouillement, magistrats en charge, « j'ai voté » pour sa maison seulement ; aucun joueur ne lit le bulletin d'un autre (tests pgTAP).
- [ ] Tests d'intégration : vote concurrent, candidature au troisième mandat, égalité, clôture rejouée.
- [ ] Spécification 6.2 mise à jour ; glossaire (métèque, citoyen, archonte).

## Hors périmètre

Autres magistrats, conseil, destitution, ostracisme, campagne électorale, écran (P2-15).

## Dépendances

P2-1

---

# P2-12. Décrets (1/3) : catalogue fermé, proposition et vote

## Contexte

« Un décret est un type de loi pris dans un catalogue de modèles paramétrés » ; « le moteur n'applique que des paramètres bornés » (6.3).
L'archonte propose, l'assemblée des citoyens vote.

Décision (ambiguïté de 6.2 et 6.3) : en phase 2, l'archonte propose seul, sans conseil ; quatre modèles seulement (taux de la taxe de marché, droit de port, grands travaux, fête), saisis par formulaire ; la conversion d'une intention en langage naturel par l'IA attend une phase suivante.
Label : `sensible` (règles par ligne).

## Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.2, 6.3), `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] Configuration : catalogue des modèles, bornes de chaque paramètre (taux de la taxe de marché et coefficient du droit de port bornés par le monde, montant d'une dépense, durée d'une fête en jours de jeu, biens d'une fête), durée du vote, quorum en points de base des citoyens, plafond de dépense par décret en part du trésor, nombre de décrets ouverts par cité.
- [ ] Schémas Zod des paramètres de chaque modèle dans `packages/contracts`, bornés par la configuration en vigueur.
- [ ] Migration : tables `decrees` (cité, modèle, paramètres, auteur, état : proposé, adopté, rejeté, appliqué) et `decree_votes`.
- [ ] Commandes `city.proposeDecree` (archonte en charge seulement) et `city.voteDecree` (citoyens, un vote par maison) ; événements `DecreeProposed`, `DecreeAdopted`, `DecreeRejected`.
- [ ] Étape de clôture, avant l'entretien : dépouillement des décrets dont le vote est clos (majorité des votes exprimés, quorum atteint), une seule fois même rejouée.
- [ ] Vues publiques : `decree_rules` (modèles et bornes de leurs paramètres en vigueur), décrets de la cité et décompte après clôture du vote ; « j'ai voté » pour sa maison seulement (tests pgTAP).
- [ ] Tests d'intégration : proposition par un non-archonte, paramètre hors bornes, quorum manqué, vote concurrent.
- [ ] Spécification 6.3 mise à jour.

## Hors périmètre

Effets des décrets (P2-13, P2-14), conversion par l'IA, subventions, embargos, pactes, écran (P2-15).

## Dépendances

P2-11

---

# P2-13. Décrets (2/3) : taux de la taxe de marché et droit de port par cité

## Contexte

« Chaque cité vote ses taux dans des bornes fixées par le monde » (5.6).
Ce ticket applique les décrets adoptés de taux : taxe de marché et droit de port de la cité.

Décision (paramètres neutres) : tant qu'aucun décret n'est appliqué, le taux d'une cité est celui du monde et son coefficient de droit de port celui de la configuration.
Label : `sensible` (monnaie, règles par ligne).

## Spécification liée

`docs/specs/05-economie.md` (5.3, 5.6), `docs/specs/06-cites-politique-communaute.md` (6.3)

## Critères d'acceptation

- [ ] Étape de clôture, avant l'entretien : un décret de taux adopté est appliqué une seule fois (index unique par décret) ; événement `DecreeApplied`.
- [ ] Taxe de marché par cité : taux du dernier décret appliqué, sinon celui de la configuration, borné par le monde ; utilisé par `market.placeOrder`, par les achats des PNJ et par `property.buyListed`.
- [ ] La vue `market_rules` donne le taux par cité ; le client calcule le net de vente avec le taux de la cité du marché.
- [ ] Droit de port par cité : coefficient du dernier décret appliqué, utilisé par `voyage.depart`.
- [ ] Tests d'intégration : changement de taux entre deux échanges, achat des PNJ après un décret, départ vers une cité qui a changé son droit de port, clôture rejouée.
- [ ] Spécifications 5.3 et 5.6 mises à jour.

## Hors périmètre

Dépenses du trésor (P2-14), impôt sur la fortune, taxe de résidence des métèques.

## Dépendances

P2-3, P2-8, P2-12

---

# P2-14. Décrets (3/3) : grands travaux, fêtes et comptes publics du trésor

## Contexte

Le trésor de la cité, alimenté par la taxe de marché et le droit de port, n'est dépensé par rien : il grossit la masse monétaire.
Ce ticket applique les décrets de dépense, grands travaux et fêtes, qui deviennent des puits, et ouvre les comptes publics du trésor (6.2 : « comptes publics visibles de tous »).

Décision (ambiguïté de 7.5) : une fête paie au trésor un montant détruit et fait monter, pendant sa durée (paramètre borné du décret), la demande des PNJ de la cité pour ses biens ; son effet sur la Charis de cité attend la phase 3.
Label : `sensible` (monnaie, règles par ligne).

## Spécification liée

`docs/specs/05-economie.md` (5.2, 5.5, 5.6), `docs/specs/06-cites-politique-communaute.md` (6.2, 6.3), `docs/specs/07-dieux-faveur-evenements.md` (7.5)

## Critères d'acceptation

- [ ] Migration : puits `sink_festivals` ajouté au catalogue, à `SYSTEM_ACCOUNT_KEYS`, au test pgTAP 013 et aux libellés `fr` et `en` d'Olympe (`sink_public_works` existe déjà).
- [ ] Étape de clôture, avant l'entretien : un décret de dépense adopté est appliqué une seule fois (index unique par décret) ; événement `DecreeApplied`.
- [ ] Grands travaux : écriture `city.public_works` du trésor vers `sink_public_works`, montant borné par le trésor et par le plafond du décret.
- [ ] Fête : écriture `city.festival` du trésor vers `sink_festivals`, et hausse bornée de la demande des PNJ de la cité pour les biens du décret, pendant le nombre de jours de jeu du décret ; calcul pur dans `packages/sim`.
- [ ] Un décret de dépense que le trésor ne couvre plus à la clôture n'est pas appliqué et le dit ; le trésor n'est jamais débiteur.
- [ ] Vues publiques `city_treasury` (solde) et `city_treasury_flows` (par jour de jeu et par nature : taxe de marché, droit de port, grands travaux, fêtes), règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : décret de dépense non couvert, fête sur deux jours, clôture rejouée.
- [ ] Spécifications 5.5, 5.6 (le trésor devient lisible) et 7.5 mises à jour.

## Hors périmètre

Subventions, liturgies (phase 3), Charis de cité.

## Dépendances

P2-13

---

# P2-15. Écran Cité : assemblée, archonte, décrets et trésor public

## Contexte

« Séance de l'assemblée : décrets en cours, vote, débats » est un écran clé (10).
Les vues existent (P2-11 à P2-14) ; ce ticket n'ajoute que des écrans.
Label : aucun.

## Spécification liée

`docs/specs/10-ux-ui.md`, `docs/specs/06-cites-politique-communaute.md` (6.2, 6.3)

## Critères d'acceptation

- [ ] Onglet Cité : statut de la maison (métèque ou citoyenne, et depuis quand), archonte en charge, élection en cours (calendrier, candidats, se porter candidat, voter), résultats passés.
- [ ] Assemblée : décrets en cours, vote en trois touches au plus, décrets adoptés et en vigueur ; formulaire de proposition pour l'archonte, bornes de chaque paramètre annoncées d'après `decree_rules`.
- [ ] Trésor public : solde, flux par jour, taxes en vigueur.
- [ ] Un métèque voit tout, sans bouton de vote, et l'écran dit pourquoi.
- [ ] Montants en drachmes et oboles, 360 px et 1 440 px, clavier, fr et en ; tests de bout en bout.

## Hors périmètre

Débats (la discussion de la cité vient avec P2-25), temps réel.

## Dépendances

P2-14

---

# P2-16. Charis : dieux, offrandes et déclin

## Contexte

« La Charis se gagne par dieu […] elle décroît lentement, ne s'achète pas en argent réel et ne se transfère pas » (7.1).
Les offrandes sont un puits de monnaie (5.5, `sink_offerings`, déjà au catalogue) et un puits de biens.

Décision (ambiguïté de 7.1) : en phase 2, la Charis ne se gagne que par offrandes de biens ou de monnaie ; temples, fêtes privées, actes, paliers passifs, présages et rang sacerdotal attendent la phase 3.
Le catalogue de départ est la liste `gods` de P2-1 : les dieux protecteurs des quatre cités et Apollon (la Pythie).
Label : `sensible` (monnaie, stocks, règles par ligne).

## Spécification liée

`docs/specs/07-dieux-faveur-evenements.md` (7.1), `docs/specs/05-economie.md` (5.5), `docs/specs/04-systemes-gestion.md` (4.1), `docs/specs/02-univers.md` (patronages)

## Critères d'acceptation

- [ ] Configuration : chaque dieu de `gods` reçoit Charis par unité offerte de chaque bien et par obole, déclin quotidien en points de base, poids de la Charis de cité ; ajouter un dieu ne demande aucun code.
- [ ] Migration : table `favor` (maison, dieu, Charis entière), modifiée seulement par une offrande, une grâce (P2-17), une consultation de la Pythie (P2-21) ou la clôture.
- [ ] Commande `temple.makeOffering` (dieu, biens du stock libre de la cité de la maison, oboles) : biens vers l'extrémité système `offering`, monnaie vers `sink_offerings` dans une écriture `temple.offering`, dans une transaction ; événement `OfferingMade`.
- [ ] Nature 4.1 `offerings` (hors exploitation) ; `my_cash_flows`, `my_income_statement` et 4.1 mis à jour.
- [ ] Étape de clôture, avant l'entretien : déclin arrondi vers zéro, une seule fois par monde et par jour de jeu (index unique).
- [ ] Calcul pur du gain et du déclin dans `packages/sim`, testé par propriétés.
- [ ] Vues : publique `temple_rules` (Charis par bien et par obole de chaque dieu, déclin), privée de sa propre Charis par dieu, publique de la Charis de cité envers son dieu protecteur ; règles par ligne testées en pgTAP.
- [ ] Aucune commande ne transfère de Charis entre maisons.
- [ ] Tests d'intégration : offrande d'un stock réservé refusée, idempotence, déclin rejoué.
- [ ] Spécifications 7.1, 4.1 et 5.5 mises à jour ; glossaire.

## Hors périmètre

Grâces (P2-17), Hybris et Némésis, miracles collectifs, temples, écran (P2-23).

## Dépendances

P2-1

---

# P2-17. Grâces : catalogue fermé, recharge et effets bornés

## Contexte

« Grâces (3 par dieu) : pouvoirs actifs à temps de recharge : vent favorable, récolte bénie, inspiration d'un artisan » (7.1).

Décision (ambiguïté de 7.1) : trois effets en phase 2, chacun appliqué à la prochaine action admise : récolte bénie (une récolte d'un site de matière première rend un pourcentage de plus, arrondi vers le bas), vent favorable (le prochain départ d'un navire raccourcit le trajet), atelier inspiré (une récolte d'atelier rend un pourcentage de plus sans intrant supplémentaire).
Chaque grâce de la configuration choisit l'un de ces effets ; un effet nouveau demande du code, une grâce nouvelle non.
Label : `sensible` (stocks, règles par ligne).

## Spécification liée

`docs/specs/07-dieux-faveur-evenements.md` (7.1), `docs/specs/04-systemes-gestion.md` (4.2, 4.3, 4.6)

## Critères d'acceptation

- [ ] Configuration : grâces (dieu, effet, ampleur bornée, Charis requise, Charis dépensée, recharge en jours de jeu).
- [ ] Migration : table `graces_used` (maison, grâce, invoquée le, consommée par).
- [ ] Commande `temple.invokeGrace` : refus si la Charis ne suffit pas ou si la grâce se recharge ; Charis dépensée dans la même transaction ; événement `GraceInvoked`.
- [ ] `site.collect` et `voyage.depart` consomment une grâce en attente qui s'applique, une seule fois ; le surplus d'une récolte bénie vient de l'extrémité `production`, tracé comme tel.
- [ ] Calcul pur des effets dans `packages/sim`, testé par propriétés (un effet ne retire jamais rien, une grâce ne se consomme qu'une fois).
- [ ] Vues : grâces ajoutées à `temple_rules` (publique) ; `my_graces` (privée : grâces en attente, en recharge et jusqu'à quand) ; règles par ligne testées en pgTAP.
- [ ] Tests d'intégration : récolte concurrente de deux sites avec une seule grâce en attente, recharge, Charis insuffisante.
- [ ] Spécification 7.1 mise à jour.

## Hors périmètre

Paliers passifs, présages, miracles collectifs, grâces qui visent une autre maison.

## Dépendances

P2-3, P2-16

---

# P2-18. Événements du monde planifiés

## Contexte

« Les événements du monde sont planifiés par le moteur plusieurs jours à l'avance » (7.3).
La Pythie (P2-21) et la chronique (P2-22) en ont besoin, et le risque en mer (4.6) en vient.

Décision (ambiguïté de 17, qui ne cite pas les événements en phase 2) : un petit catalogue fermé de modèles, planifiés par le moteur avec un aléa déterministe (13) : sécheresse (rendement des champs d'une cité réduit), bonne année (rendement des vergers accru), tempête (trajets d'une route allongés), caravane étrangère (demande des PNJ d'une cité accrue pour un bien).
Décision : une tempête retarde, elle ne fait rien perdre.
Décision : la graine des événements d'un jour se dérive de la graine du monde, enregistrée à sa création, et du jour de jeu ; le banc fixe la graine de son monde.
Décision (paramètres neutres) : la probabilité de chaque modèle est nulle dans la configuration initiale, si bien que le banc de #78 ne joue aucun événement.
Label : `sensible` (stocks : les rendements changent la production).

## Spécification liée

`docs/specs/07-dieux-faveur-evenements.md` (7.3, 7.4), `docs/specs/13-moteur-anti-triche.md` (aléa déterministe), `docs/specs/04-systemes-gestion.md` (4.6)

## Critères d'acceptation

- [ ] Configuration : modèles d'événements (portée, ampleur bornée, durée, probabilité par jour, nulle au départ), délai de planification en jours de jeu.
- [ ] Migration : graine du monde (`worlds.seed`, posée à la création, jamais modifiée), tables `world_events` (modèle, portée, début, fin, ampleur, graine) et `event_effects`.
- [ ] Étape de clôture, avant l'entretien : planification des événements du jour situé à ce délai, tirée de la graine du jour ; rejouer la clôture ne planifie rien deux fois.
- [ ] Effets : `site.collect` applique le rendement aux cycles terminés pendant l'événement, `voyage.depart` allonge un trajet qui part pendant une tempête de sa route, la demande des PNJ applique la caravane ; calculs purs dans `packages/sim`, testés par propriétés.
- [ ] Vue publique des événements commencés ; les événements à venir ne sont pas lisibles par les joueurs (tests pgTAP).
- [ ] Route `GET /api/admin/events` et calendrier en lecture dans Olympe (concepteur de jeu, responsable communauté, observateur).
- [ ] Tests d'intégration : récolte à cheval sur le début d'une sécheresse, tempête sur une route, rejeu d'une planification, même graine donnant les mêmes événements.
- [ ] Spécifications 7.3, 7.4 et 13 mises à jour.

## Hors périmètre

Déclenchement manuel et création d'événements depuis Olympe, maître du jeu par IA, événements mythiques, divins et personnels.

## Dépendances

P2-1, P2-3

---

# P2-19. Passerelle IA : journal, interrupteurs, plafonds et repli

## Contexte

Trois usages d'IA arrivent en phase 2 : oracles, chronique, consignes d'intendant.
La règle 6 et la section 8 imposent une passerelle unique côté serveur, des sorties structurées validées, un texte ou un formulaire de repli, des quotas, un plafond mensuel et un interrupteur par usage.
Le paquet `packages/ai` est vide.

Décision : la passerelle est développée et testée avec un fournisseur factice déterministe ; l'appel à un vrai fournisseur est P2-20 (`needs-human`).
Décision : le plafond mensuel se déduit du budget par joueur actif et par mois et du nombre de joueurs actifs attendu, deux valeurs de configuration, réparti entre les usages.
Décision (paramètres neutres) : tous les usages sont désactivés dans la configuration initiale.
Seul le moteur appelle la passerelle (11).
Label : aucun.

## Spécification liée

`docs/specs/08-ia.md` (8.4, 8.5), `docs/specs/11-architecture.md`, `docs/specs/18-indicateurs-risques-conformite.md` (RGPD, coût IA)

## Critères d'acceptation

- [ ] `packages/ai` : interface de fournisseur, fournisseur factice pour les tests, passerelle qui valide chaque sortie par un schéma Zod et rend le repli sur tout échec (usage coupé, plafond atteint, délai dépassé, sortie invalide, erreur du fournisseur).
- [ ] Configuration : budget par joueur actif et par mois (moins de 0,10 €), nombre de joueurs actifs attendu, part du plafond de chaque usage, interrupteur, modèle, délai et prix par millier de jetons de chaque usage, quota par maison et par jour pour les consignes d'intendant.
- [ ] Un usage qui atteint son plafond du mois est coupé jusqu'au mois suivant ; test sur le fournisseur factice.
- [ ] Journal `telemetry.ai_calls` (usage, modèle, jetons, coût estimé, issue, durée), sans texte de joueur ni donnée personnelle au-delà du pseudonyme, purgé selon l'ADR 0002.
- [ ] Le texte d'un joueur est passé comme donnée délimitée, jamais comme instruction ; un test vérifie qu'une injection dans ce texte ne change pas le schéma de sortie accepté.
- [ ] Vigie : coût estimé du jour et du mois par usage, plafond, taux de sorties rejetées, usages coupés.
- [ ] ADR : passerelle IA (fournisseur interchangeable, repli, journal, plafonds).
- [ ] `.env.example` documente les variables du futur fournisseur, sans valeur.

## Hors périmètre

Appel réel à un fournisseur (P2-20), mémoire vectorielle des PNJ, mentor, prompts éditables dans Olympe.

## Dépendances

aucune

---

# P2-20. Fournisseur d'IA réel

## Contexte

La passerelle (P2-19) ne connaît qu'un fournisseur factice.
Brancher un vrai fournisseur demande de créer un compte, une clé d'API et un plafond de dépense chez lui, et de signer un contrat de sous-traitance (18, RGPD) : un humain doit le faire.
Le jeu reste entièrement jouable sans ce ticket.
Label : `needs-human` (compte tiers, clé d'API, contrat).

## Spécification liée

`docs/specs/08-ia.md` (8.4, 8.5), `docs/specs/18-indicateurs-risques-conformite.md` (conformité)

## Critères d'acceptation

- [ ] Un humain choisit le fournisseur, crée le compte et la clé, fixe le plafond de dépense chez lui et signe le contrat de sous-traitance.
- [ ] Adaptateur de ce fournisseur dans `packages/ai`, derrière l'interface de P2-19, testé sur des réponses enregistrées, sans clé dans le dépôt.
- [ ] La clé est lue d'une variable d'environnement du moteur, documentée dans `.env.example`.
- [ ] Un essai manuel en local, clé saisie par l'humain, génère un oracle et une chronique, dont le coût est relevé dans la Vigie.

## Hors périmètre

Déploiement, choix de modèles par usage au-delà de la configuration.

## Dépendances

P2-19

---

# P2-21. Pythie : oracles des événements et consultation

## Contexte

La Pythie « tire des oracles volontairement ambigus, rédigés par l'IA à partir de l'événement réel » (7.3).
Les consulter « coûte des offrandes ».

Décision (règle 6) : chaque modèle d'événement a des oracles écrits à la main, en `fr` et en `en`, plusieurs par modèle ; l'oracle de repli est choisi et enregistré dès la planification de l'événement, et l'IA ne fait ensuite que le réécrire ; le jeu s'en contente IA coupée.
Décision : consulter la Pythie est une offrande de monnaie à Apollon, au prix de la configuration, qui rend les oracles des événements à venir de sa cité.
Label : `sensible` (monnaie, règles par ligne).

## Spécification liée

`docs/specs/07-dieux-faveur-evenements.md` (7.3), `docs/specs/08-ia.md` (8.1, 8.4), `docs/specs/04-systemes-gestion.md` (4.1)

## Critères d'acceptation

- [ ] Oracles de repli par modèle d'événement dans les fichiers de contenu `fr` et `en`, choisis par la graine de l'événement.
- [ ] Migration : tables `oracles` (événement, textes, source : repli ou IA) et `oracle_consultations` ; la planification d'un événement (P2-18) écrit son oracle de repli dans la même transaction.
- [ ] Tâche nocturne du moteur : chaque oracle encore de repli est réécrit par la passerelle (usage `oracle`) dans les deux langues ; la sortie ne contient aucun chiffre ni nom de cité en clair, sinon elle est rejetée et le repli reste.
- [ ] Configuration : prix de la consultation, ajouté à `temple_rules`.
- [ ] Commande `temple.consultOracle` (prix vu) : écriture `temple.oracle` vers `sink_offerings`, nature 4.1 `offerings`, Charis d'Apollon accrue, oracles des événements à venir de la cité rendus ; événement `OracleConsulted`.
- [ ] Un joueur ne lit que les oracles qu'il a consultés (tests pgTAP).
- [ ] Tests : jeu entièrement IA coupée, sortie de l'IA rejetée qui laisse le repli, consultation idempotente.
- [ ] Spécifications 7.3 et 4.1 mises à jour.

## Hors périmètre

Marché des oracles, présages de Némésis, écran (P2-23).

## Dépendances

P2-16, P2-18, P2-19

---

# P2-22. Chronique quotidienne des cités

## Contexte

« Chronique : journal quotidien de chaque cité rédigé par l'IA à partir des faits du jour » (6.6) ; « les faits viennent du journal d'événements, sans invention de chiffres » (8.1).
La programmation d'une version de configuration doit aussi y être annoncée (15.2).

Décision (règle 6) : la chronique de repli est composée par des gabarits `fr` et `en` à partir des faits ; l'IA ne fait que la réécrire, et une réécriture dont un chiffre n'est pas dans les faits est rejetée.
Label : `sensible` pour la tranche schéma (règles par ligne d'une vue publique).

## Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.6), `docs/specs/08-ia.md` (8.1, 8.4), `docs/specs/15-back-office-olympe.md` (15.2)

## Critères d'acceptation

- [ ] Calcul pur des faits du jour d'une cité dans `packages/sim` à partir des événements de domaine : volumes et prix des biens, population, voyages arrivés, élections, décrets, événements commencés, configuration programmée.
- [ ] Gabarits de repli `fr` et `en`, sans texte en dur dans le code.
- [ ] Tâche du moteur après chaque clôture : une chronique par cité et par jour de jeu, composée par le repli puis réécrite par la passerelle (usage `chronicle`) ; rejouer la tâche ne double rien.
- [ ] Migration : table `chronicle_articles` (cité, jour de jeu, faits, textes, source), vue publique pour les joueurs connectés, règles par ligne testées en pgTAP.
- [ ] Onglet Cité : chronique du jour et des jours précédents, 360 px, clavier, fr et en.
- [ ] Tests : réécriture qui invente un chiffre rejetée, chronique IA coupée.
- [ ] Spécification 6.6 mise à jour.

## Hors périmètre

Tribunes libres des joueurs, chronique de ligue, illustrations.

## Dépendances

P2-14, P2-18, P2-19

---

# P2-23. Écran Temple : Charis, offrandes, grâces et oracle

## Contexte

« Temple : Charis, grâces, offrandes, oracle » est un écran clé (10).
Les vues existent (P2-16, P2-17, P2-21) ; ce ticket n'ajoute que des écrans.
Label : aucun.

## Spécification liée

`docs/specs/10-ux-ui.md`, `docs/specs/07-dieux-faveur-evenements.md` (7.1, 7.3)

## Critères d'acceptation

- [ ] Charis par dieu, avec le déclin du jour ; Charis de cité envers son dieu protecteur.
- [ ] Offrande de biens du stock libre ou de monnaie, Charis gagnée annoncée avant l'envoi, d'après `temple_rules`.
- [ ] Grâces : disponibles, en recharge (jusqu'à quand), en attente d'application, d'après `my_graces` ; invocation en trois touches au plus.
- [ ] Pythie : prix de la consultation, oracles consultés, avec la date de l'événement annoncée comme imprécise.
- [ ] Écran Comptes : nature `offerings` libellée.
- [ ] 360 px et 1 440 px, clavier, fr et en ; tests de bout en bout, IA coupée.

## Hors périmètre

Temples construits, calendrier sacré.

## Dépendances

P2-17, P2-21

---

# P2-24. Discussion (1/2) : canaux de cité et messages privés

## Contexte

« Messagerie privée, canaux par cité » (6.6) ; l'onglet Messages est une coquille vide.
Écrire passe par l'API (règle 3), lire par des vues sous règles par ligne.

Décision (ambiguïté de 6.6) : en phase 2, un canal par cité, ouvert aux maisons de la cité (citoyennes ou métèques), et des conversations privées entre deux maisons ; canaux de ligue, de confrérie, de marché et forum attendent les phases suivantes.
Décision (18, conservation limitée) : les messages sont purgés après un nombre de jours fixé en configuration.
Label : `sensible` (règles par ligne).

## Spécification liée

`docs/specs/06-cites-politique-communaute.md` (6.6), `docs/specs/12-modele-donnees.md`, `docs/specs/18-indicateurs-risques-conformite.md` (contenus), `docs/adr/0002-conservation-journaux.md`

## Critères d'acceptation

- [ ] Configuration : longueur maximale d'un message, durée de conservation, limite de débit propre à la discussion.
- [ ] Migration : tables `channels` (cité ou conversation privée), `channel_members` (conversations privées) et `messages` (canal, maison, texte, date, masqué le).
- [ ] Commandes `chat.post` et `chat.openDirect` ; une maison écrit dans le canal de sa cité et dans ses conversations, nulle part ailleurs ; événement `MessagePosted`.
- [ ] Vues : un joueur lit le canal de sa cité et ses conversations, rien d'autre ; un message masqué ne rend plus son texte (tests pgTAP avec une maison métèque, une maison citoyenne et une maison d'une autre cité).
- [ ] Purge par le moteur au-delà de la conservation, par une fonction du propriétaire ; ADR 0002 complété.
- [ ] Tests d'intégration : écriture dans le canal d'une autre cité refusée, conversation avec soi-même refusée, débit dépassé.
- [ ] Spécification 6.6 mise à jour.

## Hors périmètre

Temps réel et écran (P2-25), signalement (P2-26), pièces jointes, réactions.

## Dépendances

P2-1

---

# P2-25. Discussion (2/2) : temps réel et onglet Messages

## Contexte

Les messages doivent arriver sans recharger la page, par Supabase Realtime en diffusion par canal (11.2).
Realtime est désactivé dans la pile locale (`packages/db/supabase/config.toml`).

Décision : seule la base diffuse ; un message validé est diffusé sur le sujet de son canal, l'abonnement d'un joueur est autorisé par des règles par ligne sur les messages de Realtime, aucun client ne peut diffuser lui-même, et l'écran relit les messages à intervalle régulier quand Realtime ne répond pas.
Label : `sensible` pour la tranche d'autorisation de Realtime (règles par ligne).

## Spécification liée

`docs/specs/10-ux-ui.md` (Messages, accessibilité), `docs/specs/11-architecture.md` (temps réel), `docs/specs/06-cites-politique-communaute.md` (6.6), `docs/specs/14-infrastructure.md`

## Critères d'acceptation

- [ ] Realtime activé dans la pile locale et en `ci` ; `README.md` et `infra/README.md` à jour.
- [ ] Diffusion d'un message validé sur le sujet de son canal ; un joueur ne s'abonne qu'aux canaux qu'il peut lire.
- [ ] Les rôles `anon` et `authenticated` ne peuvent rien insérer dans `realtime.messages` : aucun client ne diffuse.
- [ ] Tests pgTAP de l'autorisation d'abonnement et du refus d'insertion.
- [ ] Onglet Messages : canal de la cité, conversations privées, nouvelle conversation avec une maison nommée, saisie et envoi, nombre de messages non lus.
- [ ] Un message reçu est annoncé poliment aux lecteurs d'écran, sans voler le foyer de la saisie ; une saisie en cours n'est jamais perdue.
- [ ] Relecture périodique quand Realtime est indisponible, et l'écran le dit.
- [ ] 360 px et 1 440 px, clavier, fr et en ; tests de bout en bout à deux joueurs.
- [ ] ADR : diffusion des messages par Realtime et autorisation des abonnements.

## Hors périmètre

Notifications push, recherche dans les messages, statut en ligne.

## Dépendances

P2-24

---

# P2-26. Modération v1 (1/3) : signalement, sanctions du joueur et blocage

## Contexte

« Procédure de signalement et d'appel » (18) ; « sanctions graduées (avertissement, silence, suspension, exclusion) » (15.1).
Ce ticket fait le côté du joueur : signaler, voir ses sanctions, faire appel, et être bloqué par l'API ; les commandes d'administration viennent avec P2-27.

Décision : un filtre de vocabulaire, liste de configuration, refuse un message qui contient un terme interdit, avant tout enregistrement.
Label : `sensible` (authentification : une suspension coupe l'accès aux commandes ; règles par ligne).

## Spécification liée

`docs/specs/15-back-office-olympe.md` (15.1), `docs/specs/18-indicateurs-risques-conformite.md` (contenus), `docs/specs/13-moteur-anti-triche.md` (sanctions graduées)

## Critères d'acceptation

- [ ] Configuration : motifs de signalement, termes interdits (comparaison sans casse ni accent).
- [ ] Migration : tables `reports` (message, maison qui signale, motif, état) et `admin.sanctions` (compte, type, début, fin, motif, auteur, validé par, appel).
- [ ] Commandes `chat.report` (un signalement par maison et par message) et `moderation.appeal` (un appel par sanction, texte borné) ; événements `MessageReported` et `SanctionAppealed`.
- [ ] L'API refuse `chat.post` à un compte réduit au silence (`SILENCED`) et toute commande de jeu à un compte suspendu ou exclu (`SUSPENDED`), sanction relue à chaque commande.
- [ ] `chat.post` refuse un message qui contient un terme interdit (`MESSAGE_REJECTED`).
- [ ] Vue privée `my_sanctions` (type, fin, motif, appel), règles par ligne testées en pgTAP.
- [ ] Côté joueur : une sanction est annoncée avec sa fin et le moyen de faire appel ; un message masqué est dit tel ; « Signaler » sur chaque message ; fr et en, 360 px, clavier.
- [ ] Tests d'intégration : sanction écrite par le test qui bloque puis expire, appel unique, terme interdit.

## Hors périmètre

Commandes d'administration (P2-27), module Olympe (P2-28), pré-tri par l'IA.

## Dépendances

P2-24

---

# P2-27. Modération v1 (2/3) : commandes d'administration

## Contexte

Les sanctions sont prononcées par l'équipe dans Olympe, par des commandes d'administration journalisées (15.4).
« Double validation pour toute exclusion définitive » (15.4).
« Les modérateurs peuvent être des joueurs bénévoles : leur rôle ne donne accès à aucune donnée économique privée » (15.4).

Décision (ambiguïté de 15.1) : le pré-tri des signalements par l'IA attend une phase suivante ; la file est triée par âge puis par nombre de signalements.
Label : `sensible` (authentification, règles par ligne).

## Spécification liée

`docs/specs/15-back-office-olympe.md` (15.1, 15.3, 15.4)

## Critères d'acceptation

- [ ] Configuration : durées de silence et de suspension proposées.
- [ ] Commandes `admin.hideMessage`, `admin.sanction`, `admin.resolveReport`, `admin.decideAppeal` (modérateur, responsable communauté, super-administrateur), journalisées.
- [ ] Une exclusion définitive se propose par `admin.sanction` et ne prend effet qu'après `admin.confirmExclusion` par un autre compte.
- [ ] Route `GET /api/admin/reports` : file triée, contexte de la conversation (messages qui précèdent et qui suivent), appels en attente.
- [ ] Un modérateur ne lit que les signalements, les messages signalés et leur contexte, jamais une donnée économique privée (tests des routes et pgTAP).
- [ ] `ADMIN_MODULE_ROLES` reçoit le module Modération.
- [ ] Tests d'intégration : double validation de l'exclusion, auteur qui confirme sa propre proposition refusé, appel décidé.
- [ ] Spécification 15 mise à jour (rôles et commandes de la modération).

## Hors périmètre

Écran (P2-28), modérateurs bénévoles recrutés, export des données d'un joueur.

## Dépendances

P2-26

---

# P2-28. Modération v1 (3/3) : module Modération d'Olympe

## Contexte

Le module Modération d'Olympe doit permettre de traiter la file des signalements de bout en bout (15.1).
Label : aucun.

## Spécification liée

`docs/specs/15-back-office-olympe.md` (15.1, 15.5)

## Critères d'acceptation

- [ ] File des signalements, triée par âge puis par nombre, avec le contexte de la conversation.
- [ ] Actions : masquer, avertir, réduire au silence, suspendre, proposer et confirmer une exclusion, classer sans suite ; chaque action après confirmation, foyer et répétition de touche gardés comme dans le module Accès (15.3).
- [ ] Appels : liste, décision motivée.
- [ ] Vigie : alerte « signalements en attente depuis plus de 24 h » (15.5).
- [ ] Navigation composée d'après `ADMIN_MODULE_ROLES` ; 360 px, clavier, fr et en ; tests de bout en bout.

## Hors périmètre

Fiche joueur complète, support.

## Dépendances

P2-27

---

# P2-29. Intendants (1/3) : règles à grammaire fermée, embauche et formulaire

## Contexte

Les intendants sont des « PNJ animés par IA qui gèrent un site selon des consignes en langage naturel, traduites en règles vérifiables » (4.4).
Chacun est « une file d'opérations parallèle ».
Les règles appartiennent à une grammaire fermée (8.1) ; le formulaire qui les saisit est le repli de la consigne en langage naturel (P2-31), et suffit pour jouer.
Les règles d'intendant d'une maison ne quittent jamais le serveur pour un concurrent (12).

Décision (paramètres neutres) : le salaire des intendants entre à zéro dans la configuration initiale.
Label : `sensible` (monnaie : salaire ; règles par ligne).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.1, 4.4), `docs/specs/08-ia.md` (8.1), `docs/specs/12-modele-donnees.md`

## Critères d'acceptation

- [ ] Grammaire fermée dans `packages/contracts` : récolter dès que possible, vendre un bien au-dessus d'un prix en gardant une réserve, racheter un intrant sous un prix jusqu'à un stock cible ; chaque nombre borné.
- [ ] Configuration : nombre d'intendants par niveau de siège, salaire quotidien (nul au départ), nombre de règles par intendant.
- [ ] Migration : tables `stewards` (maison, site, nom tiré d'une liste de contenu, depuis) et `steward_rules`.
- [ ] Commandes `steward.hire` (un intendant par site), `steward.setRules`, `steward.dismiss` ; événements `StewardHired`, `StewardRulesSet`.
- [ ] Clôture : le salaire de l'intendant entre dans l'écriture `upkeep.daily`, avec son site, par une ligne marquée `wages` vers `sink_npc_wages` ; un intendant impayé est inactif jusqu'à la clôture qui le paie.
- [ ] Vues privées des intendants et de leurs règles, règles par ligne testées en pgTAP.
- [ ] Écran : fiche de site, section Intendant (embaucher, règles par formulaire, renvoyer), 360 px, clavier, fr et en.
- [ ] Spécification 4.4 mise à jour ; glossaire (intendant).

## Hors périmètre

Exécution des règles (P2-30), consigne en langage naturel (P2-31), traits et mémoire des intendants.

## Dépendances

P2-6

---

# P2-30. Intendants (2/3) : exécution des règles par le moteur

## Contexte

Les règles d'un intendant (P2-29) doivent agir sans le joueur : récolter, vendre, racheter.
Ces actions doivent suivre exactement les mêmes règles que les commandes du joueur, qui vivent aujourd'hui dans `apps/api/src/commands`.

Décision : le cœur transactionnel de `site.collect` et de `market.placeOrder` est déplacé dans un paquet de l'espace de travail partagé par l'API et le moteur, sans changement de comportement, avant toute exécution par le moteur.
Décision : le nombre d'opérations d'un intendant par tick est un paramètre de configuration (une au départ), menées dans l'ordre de ses règles (une file parallèle, 4.4).
Label : `sensible` (monnaie, stocks).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.4), `docs/specs/11-architecture.md` (11.4), `docs/specs/13-moteur-anti-triche.md`

## Critères d'acceptation

- [ ] Cœur des deux commandes partagé, leurs tests d'intégration inchangés et verts ; ADR sur ce partage.
- [ ] Configuration : opérations par intendant et par tick (`stewards.operationsPerTick`, 1 au départ).
- [ ] Étape du tick : chaque intendant actif mène au plus ce nombre d'opérations, chacune dans sa transaction, sous une clé d'idempotence tirée de l'intendant, du tick et du rang de l'opération ; rejouer un tick ne double rien.
- [ ] Chaque opération est inscrite au journal des commandes au nom de la maison, avec l'intendant pour acteur, et produit les mêmes événements que la commande du joueur.
- [ ] Une opération refusée (stock, trésorerie, prix) est notée par un événement `StewardActionFailed` et ne bloque pas les autres intendants.
- [ ] La fiche de site montre les dernières opérations et le dernier refus de son intendant.
- [ ] Tests d'intégration : intendant qui récolte et vend, refus faute de trésorerie, deux moteurs concurrents, maison qui agit pendant que son intendant agit.
- [ ] Spécifications 4.4 et 13 mises à jour.

## Hors périmètre

Contrats, transport par intendant.

## Dépendances

P2-29

---

# P2-31. Intendants (3/3) : consigne en langage naturel

## Contexte

Le joueur peut écrire sa consigne en langage naturel (« vends l'huile au-dessus de 12 drachmes, sinon stocke », 4.4) ; l'IA la traduit en règles de la grammaire fermée, simulées avant validation (8.1).
Le formulaire de P2-29 en est le repli et reste toujours offert.
L'IA ne fait que proposer des règles, que le joueur valide par `steward.setRules`.
Label : `sensible` pour la tranche schéma (consignes et propositions privées, règles par ligne).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.4), `docs/specs/08-ia.md` (8.1, 8.4)

## Critères d'acceptation

- [ ] Migration : tables `steward_instructions` (texte, état) et `steward_proposals` (règles proposées, simulation, refus motivé), lisibles par la seule maison, règles par ligne testées en pgTAP ; texte purgé selon l'ADR 0002.
- [ ] Commande `steward.submitInstruction` (texte borné) : refusée IA coupée ou quota atteint (`AI_UNAVAILABLE`), sinon mise en file pour le moteur.
- [ ] Tâche du moteur : traduction par la passerelle (usage `steward`), sortie validée par le schéma de la grammaire, texte du joueur passé comme donnée ; proposition enregistrée, ou refus motivé.
- [ ] Simulation à blanc des règles proposées sur l'état présent du site : ce qu'elles feraient maintenant, sans rien écrire, avec le cœur partagé de P2-30.
- [ ] Écran : consigne, règles proposées affichées dans le formulaire, simulation, « Valider » ou « Modifier » ; IA coupée, l'écran le dit et ouvre le formulaire.
- [ ] Tests : consigne qui tente de sortir de la grammaire, proposition rejetée par le schéma, parcours IA coupée.
- [ ] Spécification 4.4 mise à jour.

## Hors périmètre

Dialogue avec l'intendant, mémoire.

## Dépendances

P2-19, P2-29, P2-30

---

# P2-32. Banc d'équilibrage (1/3) : quatre cités, négociants et mesures

## Contexte

Le banc de #78 (`apps/api/src/balance/`, `apps/api/src/balance.integration.test.ts`) ne joue qu'une cité, sur la configuration initiale, avec un délai de 600 secondes.
Ce ticket l'étend à quatre cités reliées par la mer, et publie les mesures dont le calibrage (P2-34) aura besoin.

Décision : le banc à quatre cités tourne dans un job à part du flux `ci`, dont l'échec rend `ci` rouge, hors du test d'intégration ordinaire ; sa durée est mesurée et bornée.
Décision : le banc joue les événements avec une graine de monde fixe, écrite dans le test ; tant que leur probabilité est nulle (configuration initiale), il n'y en a aucun.
Label : aucun (test ; aucune écriture de monnaie nouvelle).

## Spécification liée

`docs/specs/05-economie.md` (5.2, 5.5), `docs/specs/18-indicateurs-risques-conformite.md`, `.github/workflows/ci.yml`

## Critères d'acceptation

- [ ] Le banc fonde des maisons scriptées dans les quatre cités, selon leur terroir, plus des négociants qui achètent dans une cité, transportent par mer et vendent dans une autre.
- [ ] Les maisons scriptées paient leurs salaires et leurs intendants, et leurs intendants exécutent leurs règles.
- [ ] Mesures publiées par le test, par cité et pour le monde : masse monétaire par jour, net de chaque robinet et de chaque puits, coût du panier, couverture par classe, population, marge nette quotidienne par recette.
- [ ] Le banc à une cité de #78 garde ses bornes et sa place dans le test d'intégration.
- [ ] Job `ci` dédié (`pnpm test:balance`), documenté dans `README.md`.
- [ ] Robinets, puits et trésors des cités rapprochés des flux comptés, comme aujourd'hui.

## Hors périmètre

Stratégies de logement et d'archonte (P2-33), calibrage et borne sur la masse monétaire (P2-34).

## Dépendances

P2-4, P2-9, P2-13, P2-18, P2-30

---

# P2-33. Banc d'équilibrage (2/3) : stratégies de logement et d'archonte

## Contexte

Les puits immobiliers et publics ne jouent dans le banc que si des maisons scriptées s'en servent.
Label : aucun (test).

## Spécification liée

`docs/specs/04-systemes-gestion.md` (4.5), `docs/specs/06-cites-politique-communaute.md` (6.2, 6.3), `docs/specs/05-economie.md` (5.5)

## Critères d'acceptation

- [ ] Stratégie de logement : une maison scriptée achète ou loue des logements quand l'hébergement chez les PNJ lui coûte plus cher, et rénove ses biens sous le seuil de vétusté ; des propriétaires scriptés mettent leurs biens en location.
- [ ] Stratégie d'archonte : dans chaque cité, une maison scriptée se porte candidate, les citoyens scriptés votent, et l'archonte élu fait voter des grands travaux et une fête bornés par le trésor de sa cité.
- [ ] Les mesures du banc montrent la part de chaque puits immobilier et public.
- [ ] Stratégies dans `apps/api/src/balance/strategy.ts` ou à côté, sans constante d'équilibrage : leurs seuils viennent de la configuration, ou sont des choix de stratégie nommés et commentés.

## Hors périmètre

Calibrage (P2-34).

## Dépendances

P2-14, P2-32

---

# P2-34. Banc d'équilibrage (3/3) : calibrage et borne sur la masse monétaire

## Contexte

Le banc de #78 a laissé une limite connue en 5.5 : la masse monétaire croît d'environ 60 000 oboles par jour, parce que les achats des PNJ créent plus de monnaie que l'entretien, la taxe et l'acquisition de sites n'en détruisent.
Les paramètres économiques de la phase sont entrés neutres dans la configuration initiale ; ce ticket les active et les calibre ensemble, à quatre cités.

Décision : la borne sur la masse monétaire est une variation de −3 % à +3 % sur les 30 jours mesurés, comme la cible d'inflation mensuelle (5.5), écrite à la main dans le test.
Décision : le terroir de Kallistè se resserre ici, par la même version de configuration, pour qu'aucune cité ne soit autosuffisante (6.1, P2-1).
Label : aucun (configuration et test ; aucune écriture de monnaie nouvelle).

## Spécification liée

`docs/specs/05-economie.md` (5.2, 5.5), `docs/specs/06-cites-politique-communaute.md` (6.1), `docs/specs/18-indicateurs-risques-conformite.md`, `docs/specs/17-feuille-de-route.md`

## Critères d'acceptation

- [ ] Configuration initiale ajustée : salaires, offre de travail, hébergement, entretien des navires et des logements, vétusté, salaire des intendants, droits de port, provisions et probabilité des événements activés ; chaque valeur justifiée dans la demande de fusion ; aucune constante d'équilibrage dans le code.
- [ ] Terroir de Kallistè resserré ; les tests de bout en bout de la cité prototype et le banc à une cité de #78 suivent, leurs bornes inchangées ou leur changement justifié.
- [ ] Bornes écrites à la main dans le banc à quatre cités, pas recalculées par le code testé : dans chaque cité, celles de la phase 1 (coût du panier de 0 à 2 % entre les dix premiers et les dix derniers jours mesurés, besoins vitaux couverts à 98 % au moins, population qui ne baisse pas) ; pour le monde, variation de la masse monétaire de −3 % à +3 % sur les 30 jours mesurés.
- [ ] Le banc joue les événements, avec sa graine fixe.
- [ ] Spécification 5.5 : calibrage à quatre cités, part de chaque puits, limite connue levée ou redite avec sa nouvelle valeur.

## Hors périmètre

Marges des ateliers (P2-36), banques et prêts, qualité.

## Dépendances

P2-33

---

# P2-35. Simulateur d'équilibrage

## Contexte

« Simulateur : rejoue N jours sur une copie du monde avec une configuration candidate et des agents automates, puis compare les indicateurs à la référence » (15.1) ; c'est l'étape 2 de tout changement d'équilibrage (15.2).
Le banc de P2-32 à P2-34 sait déjà jouer un monde neuf avec des agents automates et les vrais ticks, clôtures et commandes.

Décision (ambiguïté de 15.1, sans serveur) : le simulateur de la phase 2 est ce banc, rendu réutilisable et lancé en local par une commande, sur un monde neuf de la base locale, avec une configuration candidate et la configuration de référence ; son module dans Olympe, sur une copie du monde réel, attend le serveur.
Label : aucun.

## Spécification liée

`docs/specs/15-back-office-olympe.md` (15.1, 15.2), `docs/specs/05-economie.md` (5.5), `docs/specs/01-vision.md` (équilibrage testé en simulation)

## Critères d'acceptation

- [ ] Commande locale (`pnpm --filter @oikos/api simulate`) : configuration candidate (fichier ou version enregistrée), nombre de jours, graine ; elle joue la référence et la candidate sur deux mondes neufs.
- [ ] Rapport en JSON et en tableau Markdown : inflation, masse monétaire, net de chaque robinet et de chaque puits, couverture par classe et par cité, population, marge nette quotidienne par filière, et l'écart de chacun entre candidate et référence.
- [ ] Même graine et même configuration donnent le même rapport (test).
- [ ] Une configuration candidate refusée par le schéma est refusée avant toute simulation, champ désigné.
- [ ] Le banc à quatre cités utilise le même module, sans perdre ses bornes.
- [ ] Spécification 15.2 : en phase 2, une demande de fusion ou une note de version qui change l'équilibrage joint le rapport du simulateur.

## Hors périmètre

Module Simulateur dans Olympe, copie du monde réel, agents pilotés par IA.

## Dépendances

P2-34

---

# P2-36. Équilibrage des marges des ateliers

## Contexte

« Plusieurs manières de gagner : aucune voie n'écrase les autres » (01, pilier 2), et le simulateur doit comparer les « marges par filière » (15.2).
Aux prix de référence de la configuration actuelle, un champ de blé rapporte 1 440 oboles brutes par jour, une pêcherie 1 296, alors qu'un pressoir à huile rapporte 144 oboles et un chai 108 de marge sur ses intrants, pour un entretien de 50 oboles et une acquisition de 1 000 : la voie de l'atelier (Technitès) est écrasée par celle de la terre.
Les salaires et le logement (P2-6, P2-9), calibrés par P2-34, changent encore ce rapport, puisqu'ils pèsent par travailleur.
Label : aucun (configuration et test).

## Spécification liée

`docs/specs/01-vision.md` (pilier 2), `docs/specs/04-systemes-gestion.md` (4.1, 4.3), `docs/specs/15-back-office-olympe.md` (15.2), `docs/specs/03-boucles-progression.md` (six voies)

## Critères d'acceptation

- [ ] Le banc mesure, par recette, la marge nette quotidienne d'un site : ventes, moins intrants achetés au prix payé, entretien, salaires et part d'hébergement.
- [ ] Configuration ajustée par une nouvelle version (rendements, durées, travailleurs, entretien ou prix de référence des biens transformés), chaque changement justifié par le rapport du simulateur joint à la demande de fusion.
- [ ] Borne écrite à la main dans le banc : la marge nette quotidienne d'un site de chaque filière d'atelier se situe entre la moitié et le double de la médiane de celle des sites de matières premières.
- [ ] Les bornes de P2-34 tiennent toujours.
- [ ] Spécifications 4.3 et 5.5 : marges retenues par filière et raison des choix.

## Hors périmètre

Qualité, marque, cadence, marge par site affichée au joueur.

## Dépendances

P2-35

---

# P2-37. Parcours de l'alpha et vérification du critère de sortie

## Contexte

Le critère de sortie de la phase 2, en tête de ce fichier, se vérifie par le code tant que le serveur est reporté, comme celui de la phase 1.
Label : aucun.

## Spécification liée

`docs/specs/17-feuille-de-route.md`, `docs/specs/18-indicateurs-risques-conformite.md`, `docs/specs/10-ux-ui.md`

## Critères d'acceptation

- [ ] Test de bout en bout à 360 px, IA coupée, avec la configuration initiale calibrée, qui enchaîne le parcours du critère (point 1) avec deux joueurs dans deux cités.
- [ ] Vérification de chaque point du critère écrite dans `docs/specs/17-feuille-de-route.md`, avec les tickets qui le couvrent, comme pour la phase 1.
- [ ] Le tableau de bord économique d'Olympe montre chaque robinet et chaque puits de la phase ; un test le vérifie sur le catalogue des comptes système.
- [ ] `docs/etat.md` mis à jour.
- [ ] Tickets de la phase 3 rédigés dans `docs/tickets/phase-3.md`, au même format.

## Hors périmètre

Mesures avec des joueurs réels (attendent le serveur, #33).

## Dépendances

P2-5, P2-10, P2-15, P2-22, P2-23, P2-25, P2-28, P2-30, P2-31, P2-36
