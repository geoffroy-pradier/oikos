# ADR 0002 — Conservation des journaux et des clés d'idempotence

Date : 2026-11-14 · Statut : acceptée

## Contexte

Le jeu tient plusieurs journaux : commandes (`game.command_log`), événements de domaine, grand livre,
journal des stocks, ticks, lectures du back-office, refus avant exécution. La plupart sont en ajout
seul : la base y interdit toute modification et toute suppression de ligne, y compris au propriétaire
des tables, et c'est ce qui en fait des preuves. Deux exceptions : les exécutions de tick
(`telemetry.tick_runs`) ne sont protégées par aucun déclencheur, et les refus avant exécution
(`telemetry.api_refusals`) sont des compteurs, qui se mettent à jour mais ne peuvent que croître.
Rien ne fixait combien de temps on garde ces journaux, ni comment on s'en sépare. Or le journal des
commandes porte des identifiants de comptes et sert de mémoire d'idempotence : il ne peut ni grossir sans
fin, ni être purgé au hasard.

## Décision

| Journal | Conservation | Raison |
| --- | --- | --- |
| Grand livre, journal des stocks, échanges | Durée de vie du monde | Ce sont les comptes du jeu : un solde se recalcule depuis ses lignes |
| Journal des commandes | 90 jours | Audit et litiges ; au-delà, seuls les agrégats de la Vigie comptent |
| Événements de domaine | 90 jours | Liés aux commandes ; la chronique en garde ce qui doit durer |
| Clés d'idempotence | Celle de leur ligne de commande : 90 jours | Une clé rejouée après ce délai est traitée comme neuve |
| Exécutions de tick | 90 jours | Diagnostic |
| Lectures du back-office | 1 an | Trace d'accès aux outils d'administration |
| Refus avant exécution | 1 an | Compteurs horaires, sans identité |
| Fenêtres de limite de débit | 1 heure | Données éphémères, sans valeur d'audit ; purge par l'API |

- **Idempotence.** Un client ne renvoie une clé que tant qu'il attend une réponse (quelques minutes au
  plus) ; 90 jours couvrent très largement ce besoin. Aujourd'hui la clé vit dans sa ligne du journal
  des commandes, et la base garantit son unicité par compte (`unique (user_id, idempotency_key)`).
  **Cette garantie ne survit pas au partitionnement** : Postgres refuse une contrainte d'unicité qui ne
  contient pas la clé de partition, et l'élargir à la date laisserait la même clé entrer dans deux
  partitions. Au partitionnement du journal, les clés passeront donc dans une table dédiée, non
  partitionnée (compte, clé, commande, date), qui porte seule la contrainte d'unicité ; le registre y
  inscrit la clé dans la transaction de la commande. Cette table est purgée à 90 jours par la même
  tâche que les partitions. Le verrou consultatif du registre ne suffit pas seul : il ordonne deux
  requêtes simultanées, il ne remplace pas la contrainte.
- **Purge par partitions, jamais par suppression de lignes.** Les journaux à durée limitée seront
  partitionnés par mois (spécification 12) ; purger, c'est détacher puis supprimer une partition entière
  échue, par une migration ou une tâche du moteur exécutée au nom du propriétaire. Les déclencheurs qui
  interdisent `delete` et `truncate` restent en place : aucune ligne isolée ne peut disparaître.
- **D'ici le partitionnement, rien n'est purgé.** Les volumes du prototype ne le justifient pas, et une
  purge improvisée affaiblirait les garanties d'immuabilité. Le partitionnement et la tâche de purge sont
  à livrer avant l'ouverture à des joueurs réels (alpha fermée).
- **Données personnelles.** Les journaux ne contiennent que des identifiants de comptes, jamais d'adresse
  ni de contenu saisi hors des entrées de commande. Ces durées sont à porter au registre des traitements
  (spécification 18) ; l'effacement d'un compte se traite par dissociation de l'identifiant dans le
  service d'authentification, pas par réécriture des journaux.

## Conséquences

- Les durées ci-dessus sont des décisions d'exploitation, pas des paramètres d'équilibrage : elles vivent
  dans la tâche de purge, pas dans `packages/config`.
- Une clé d'idempotence rejouée plus de 90 jours après sa commande exécute la commande à nouveau. Aucun
  client ne garde une clé aussi longtemps.
- Tant que le partitionnement n'est pas fait, les tables grossissent : la Vigie doit rester lisible grâce
  aux index sur la date et sur les commandes d'administration (migration 16).
- La purge exige un rôle propriétaire : le rôle de service ne peut supprimer aucune ligne de journal.
- Le partitionnement du journal des commandes emporte une migration de l'idempotence (table dédiée) et
  de la clé primaire, qui devra inclure la date. La liste des tables à partitionner de la spécification 12
  est à aligner sur ce tableau dans le même ticket.
- `telemetry.tick_runs` devra recevoir les mêmes déclencheurs d'immuabilité que les autres journaux
  avant que sa conservation n'ait valeur de preuve.
