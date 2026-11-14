# État du projet

Point d'étape au 14 novembre 2026, après la fusion du ticket #69. Ce fichier décrit ce qui tourne
réellement sur `main` ; les spécifications (`docs/specs/`) décrivent la cible.

## Où en est la feuille de route

- **Phase 0 (fondations)** : terminée, sauf le ticket #33 (serveur de préproduction), marqué
  `needs-human` : il demande de commander un serveur, un nom de domaine et de saisir des secrets.
  Rien n'est donc déployé : le jeu ne tourne qu'en local et en intégration continue.
- **Phase 1 (prototype « une cité »)** : en cours. Fermés : #64 à #69. Ouverts : #70 à #78, #97, #98, #100.

## Ce qui est jouable aujourd'hui

En local (procédure dans le `README.md`), dans une seule cité, Kallistè :

- **Compte et maison.** Connexion par lien magique (courriel). Création d'une maison : nom, blason, cité.
  La maison reçoit 3 000 oboles et un champ de blé. La commande de renommage existe dans l'API, sans écran.
- **Sites.** Jusqu'à quatre sites par maison. Acquisition contre monnaie (de 600 à 1 200 oboles selon le
  type), changement de production d'un site. Quinze productions pour quinze biens : huit matières
  premières (blé, olives, raisin, bois, argile, laine, poisson, sel) et sept transformations en atelier
  (farine, huile, charbon de bois, tissu, pain, amphores, vin).
- **Production.** Elle s'accumule avec le temps, jusqu'à un plafond, et se récolte à la demande. Un atelier
  consomme ses intrants dans le stock libre de la maison ; à court d'intrants, il attend. La fiche d'un
  atelier affiche les intrants par cycle, le stock libre et ce qui est récoltable.
- **Agora.** Carnet d'ordres à cours limité par bien : ventes et achats attendent dans le carnet, une vente
  réserve son stock, un achat met son prix sous séquestre. Exécution à l'arrivée, au prix de l'ordre qui
  attendait ; annulation d'un ordre ouvert. Le carnet public montre les deux côtés par niveau de prix,
  sans identité.
- **Demande des PNJ.** Toutes les dix minutes, le moteur fait acheter les habitants de la cité aux ventes
  en attente, des moins chères aux plus chères, jusqu'à trois fois le prix de référence du bien. C'est la
  seule création de monnaie en jeu, avec la dotation de départ.
- **Client.** Application web installable (PWA), utilisable à 360 px de large et au clavier, en français
  et en anglais. Onglets Maison et Agora ; les onglets Cité et Messages sont des coquilles vides.
- **Back-office Olympe (v0).** Connexion avec second facteur, Vigie (compteurs de refus de l'API),
  Paramètres (versions de configuration : consulter, comparer, enregistrer, programmer à la prochaine
  clôture), journal d'audit. Le premier super-administrateur s'inscrit à la main en base.

Ce qui manque encore pour le critère de sortie de la phase 1 : taxe de marché (#70), historique des prix
(#71), entretien des sites à la clôture quotidienne (#72), comptes de la maison (#73), tableau de bord de
la maison (#74), population des PNJ (#75), tableau de bord économique et rôles d'Olympe (#76, #77),
équilibrage (#78). Sans entretien ni taxe, rien ne détruit de monnaie en dehors de l'acquisition de
sites : l'économie actuelle est inflationniste par construction.

## Décisions prises en cours de route

Les décisions structurantes sont dans `docs/adr/` ; celles-ci ont été prises ticket par ticket et sont
écrites dans les spécifications citées.

- **Le client lit par Supabase, écrit par l'API** (ADR 0001). Les règles du jeu qu'il affiche (recettes,
  coûts) viennent de la vue `site_rules`, pas d'une copie de la configuration.
- **Rôle de service non propriétaire** (`oikos_service`) pour l'API et le moteur : il ne peut ni modifier
  un solde ou un stock à la main, ni supprimer, ni créer de compte système. Les soldes ne bougent que par
  les journaux, par des déclencheurs du propriétaire.
- **Comptes système créés avec le monde**, à partir d'un catalogue de robinets et de puits (5.5).
- **Production paresseuse** : rien ne tourne en tâche de fond pour les sites, la récolte calcule ce qui
  est dû. Un atelier à court d'intrants ne rattrape pas le temps perdu au-delà du plafond (4.3).
- **Changer la production d'un site remet son cycle à zéro** ; s'il y a quelque chose à récolter, il faut
  récolter d'abord (4.2).
- **Sites** : limite par niveau du siège (quatre aujourd'hui, un seul niveau), coût d'acquisition détruit
  (puits « acquisition de sites »), tout en configuration.
- **Agora, achats** (5.3, ticket #69) :
  - le séquestre est un compte du grand livre par maison, pas une colonne ; la base contrôle à chaque
    validation qu'il retient exactement la somme des restes à payer ;
  - un achat ne dépense jamais plus que la trésorerie ; son reste n'attend que si elle peut en retenir le
    prix en entier, sinon il est annulé et signalé (pas d'attente partielle) ;
  - un échange se fait au prix de l'ordre qui attendait ;
  - une maison n'échange pas avec elle-même : ses ordres peuvent se croiser sans s'exécuter.
- **Appariements d'un monde exécutés l'un après l'autre** (verrou consultatif par monde) : au plus simple,
  à revoir si la charge le demande.
- **Demande des PNJ** : ils n'achètent qu'aux ventes en attente et ne déposent pas d'ordre.
- **Limitation de débit tenue en base**, partagée entre les répliques de l'API.
- **Demandes de fusion de plus de 400 lignes** : plusieurs ont dépassé la limite du `CLAUDE.md`, presque
  toujours par leurs tests d'intégration ; l'écart est annoncé dans chaque description.

## Points en suspens

À décider ou à faire par un humain :

- **#33, préproduction** : serveur, nom de domaine, secrets. Bloque tout déploiement.
- **Critère de sortie de la phase 1** (`docs/specs/17-feuille-de-route.md`) : à confirmer par un humain
  quand les tickets seront fermés ; il demande des joueurs réels.
- **Branches fusionnées** : les branches `claude/*` restent sur GitHub, la session n'a pas le droit de les
  supprimer. À nettoyer à la main.
- **Revue par une seconde personne** des changements de configuration (15.2) : pas encore imposée.

Défauts connus, déjà en tickets :

- **#97** : une recette retirée de la configuration alors qu'un site l'utilise fait échouer la récolte de
  ce site en erreur interne.
- **#98** : accessibilité de la carte des sites (focus, annonces), rejeu d'acquisition, stock par cité,
  heure du serveur ; un test de bout en bout de l'agora a échoué deux fois sans cause établie.
- **#100** : la base ne relie pas le montant d'une écriture à l'échange qu'elle règle, ni ne contrôle la
  destination d'un débit de séquestre ; seul le code des commandes le garantit aujourd'hui.

Limites assumées pour l'instant :

- Une seule cité, pas de transport : tout stock est dans la cité de la maison.
- Pas de temps réel : un écran ne se met à jour qu'après une action ou un rechargement.
- La fiche d'un site calcule « à récolter » avec l'horloge du navigateur ; l'API reste seule à décider.
- Aucun usage d'IA en jeu à ce stade.
