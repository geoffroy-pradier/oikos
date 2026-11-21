# 13. Moteur de simulation et anti-triche

Le serveur est seul maître de l'état du jeu : le client n'envoie que des intentions. Le cœur de simulation est une bibliothèque de fonctions pures, ce qui rend chaque tick rejouable et testable hors ligne.

## Modèle de calcul

- **Évaluation paresseuse** pour la production et les intérêts : l'état est recalculé à partir de l'horodatage lors d'une lecture ou d'une action. Le coût serveur dépend de l'activité, pas du nombre de comptes.
  Écart assumé pour les trajets (#253) : l'arrivée d'un voyage est une étape du tick, et non un calcul fait à la lecture.
  Elle déplace du stock d'une extrémité à une autre du journal des stocks et met un navire à quai ; une écriture faite à la lecture devrait l'être par chaque lecteur, dont le client qui ne lit que par Supabase et n'écrit rien.
  Le coût suit toujours l'activité : l'étape ne lit que les voyages échus, par un index partiel des voyages en mer (`voyages_due_idx`), et un tick sans arrivée ne fait qu'une recherche vide.
  Un voyage arrive au premier tick qui commence à son échéance ou après, rattrapé ou non, daté de l'instant de ce tick : jamais plus tard qu'un tick, sauf panne du moteur, que la Vigie montre (voyages en retard de déchargement).
- **Ticks globaux** pour ce qui dépend de tous : demande des PNJ, prix de référence, population, météo, Hybris, l'arrivée des voyages échus, et le parc de logements des cités (4.5), que le premier tick qui connaît une cité crée et que les suivants complètent jusqu'au nombre de la configuration.
  Décision (#734) : l'Hybris n'est pas une étape du tick mais de la clôture quotidienne, une fois par jour de jeu, avant tout ce qui touche la monnaie, car sa jauge ne varie qu'une fois par jour (7.2, 12).
  La vétusté des biens immobiliers n'est pas un calcul paresseux : c'est une étape de la clôture quotidienne, juste avant l'entretien, une fois par jour de jeu, car la base doit savoir qu'un bien ne s'use qu'une fois par jour (12).
  Le loyer des baux non plus (#257) : il se paie à une étape de la clôture, avant la vétusté, une écriture par bail et par jour de jeu, et un loyer impayé met fin au bail dans la transaction de la clôture (12).
- **Opérations des intendants** (4.4, #279) : après les ticks et la clôture d'un passage, le moteur fait agir les intendants pour le dernier tick joué de chaque monde, sous la version de configuration de ce tick, hors de la transaction du tick.
  Chaque opération a sa transaction et sa clé d'idempotence (intendant, tick, rang), comme une commande, par le cœur partagé avec l'API (ADR 0009) : le moteur n'a pas de chemin à lui vers la monnaie ou les stocks.
  Ordre des verrous d'une opération : la clé de l'opération, puis l'agora du monde, la trésorerie de la maison et l'intendant (en partage), puis ceux du cœur (site, stocks, ordres).
  C'est l'ordre de la clôture (agora, trésorerie, sites, navires, biens, intendants) et des ordres du joueur (agora, trésorerie) : une opération attend la clôture au lieu de s'interbloquer avec elle, et une récolte du joueur, qui ne prend que le site puis les stocks, ne croise jamais ses verrous dans l'autre sens.
  Ces verrous ne sont pris que si une règle a quelque chose à faire, vu d'abord sans verrou puis revu sous eux : un intendant sans rien à faire ne retient pas l'agora.
  Une opération perdue par un interblocage ou une panne n'a aucun effet et ne laisse qu'une trace sans clé (`failed`) au journal des commandes ; elle se rejoue au passage suivant, le nouvel essai automatique des commandes (#333) ne la concerne pas.
- **Appariement des ordres** à l'insertion, dans la transaction, avec un verrou par couple cité et bien.
- **Aléa déterministe** : chaque tick tire d'une graine enregistrée, ce qui permet de rejouer et d'auditer un résultat contesté.
  Les événements du monde (7.3, #267) tirent de la graine de leur jour, SHA-256 de la graine du monde (`worlds.seed`) et du numéro du jour de jeu, enregistrée avec chaque événement.
  La graine du monde est tirée par la base à sa création (générateur sûr), jamais modifiée, et illisible pour les joueurs : la connaître ferait prévoir tous les événements à venir.
  La dérivation est à sens unique : la graine d'un jour ne dit rien de celle du monde ni des autres jours.
  Même graine, mêmes règles, et mêmes cités et routes du monde connues de la configuration donnent les mêmes événements.
  Le banc fixe la graine de son monde, mais ne joue aucun événement (probabilités nulles, et clôtures de jours passés, voir 7.3 et 7.4).
- **Configuration figée par tick** : un tick lit une version de configuration et une seule.
  Une activation de configuration ne s'antidate pas : sa date de création est l'heure de la base, posée par une garde quel que soit l'appelant, et la base refuse une échéance antérieure (`activations_not_backdated`) ;
  une programmation ou une annulation validée après son échéance est refusée à la validation.
  La version vue par un tick ou une clôture déjà joués ne change donc pas, à une exception bornée près : une activation immédiate (configuration initiale) prend effet au début de sa transaction, que la base n'admet que validée dans les cinq secondes.
  Limite assumée (ticket 208, `docs/adr/0003-activations-controle-differe.md`) : le contrôle à la validation est un déclencheur différé, et la base ne rejoue pas à la validation un contrôle déjà joué.
  Un appelant qui force ses contrôles différés (`SET CONSTRAINTS … IMMEDIATE`, qui ne demande aucun droit) puis valide plus tard le contourne, pour une activation immédiate, une programmation comme une annulation.
  `PREPARE TRANSACTION` ferait de même (contrôles joués à la préparation, `COMMIT PREPARED` tardif) : c'est fermé tant que le serveur garde `max_prepared_transactions = 0`, réglage exigé en production.
  Seul un code qui écrit en base sous le rôle de service le pourrait.
  Aucun code du jeu n'émet `SET CONSTRAINTS` ; le lint le refuse dans le code TypeScript hors des tests, mais ne voit que les chaînes littérales, ni le SQL des migrations ni le corps des fonctions (`security definer` compris), que seule la relecture garde.
  L'effet est borné à l'audit : chaque tick, chaque clôture et chaque commande enregistre la version qu'il a lue (`config_version_id` de `game.ticks`, `game.daily_closes` et `game.command_log`), et c'est elle qui fait foi pour le rejouer ;
  une activation validée en retard ne change aucun résultat déjà joué, seulement la version que le journal des activations dit en vigueur à ces instants.
  Le rapprochement entre cette version enregistrée et `config.active_version_at` de l'instant révèle l'écart : `scheduled_at` d'un tick, `close_at` d'une clôture, `created_at` d'une commande.
  Deux réserves pour les commandes : l'API charge la version à l'horloge de son processus, avant d'ouvrir la transaction dont `created_at` est l'heure de début, si bien qu'une commande jouée près d'une échéance peut sortir du rapprochement sans aucune fraude (faux positif à écarter à la main) ;
  et le journal des commandes n'est gardé que 90 jours (ADR 0002), au-delà desquels seuls ticks et clôtures se rapprochent.
  Garantie côté lecture écartée : un verrou `SHARE` sur `config.activations` et ses annulations, pris par le tick et la clôture jusqu'à leur validation, ferait attendre toute programmation pendant chaque clôture (jusqu'à cinq minutes) et, par la file des verrous, les ticks de tous les mondes derrière une programmation en attente ;
  raisons détaillées dans l'ADR 0003.

## Verrous et nouvel essai

Chaque transaction prend ses verrous dans un ordre fixe, mais ces ordres ne forment pas un ordre global (#333).
Une récolte (`site.collect`) verrouille son site, puis les stocks qu'elle touche dans l'ordre des biens (classement "C"), puis les grâces en attente de la maison, sans prendre le verrou de l'agora.
Le tick verrouille l'agora du monde, puis, par la demande des PNJ, les stocks vendus aux PNJ dans l'ordre des prix, puis, à l'arrivée des voyages, les voyages, les stocks d'arrivée (par maison, cité et bien) et les navires.
Un tick qui achète du blé à la maison H dans la cité C et y décharge sa farine, et une récolte du moulin de H à C, qui verrouille la farine puis le blé, forment donc un cycle.
Changer l'ordre des étapes ne suffirait pas : le cycle reste possible avec d'autres biens.
PostgreSQL rompt un cycle en annulant l'une des transactions en entier (interblocage, `40P01`) : il n'en reste aucun effet.
L'API rejoue alors la commande entière, sous la même clé d'idempotence : configuration, horloge de la base et verrou de la clé sont repris, et la commande s'exécute à l'instant de l'essai validé.
L'essai annulé ne laisse ni ligne au journal des commandes, ni événement, ni réponse : seule l'issue du dernier essai est journalisée et rendue, et la durée journalisée compte tous les essais.
Si une requête de même clé a validé pendant l'attente, le nouvel essai rend sa réponse, en rejeu, comme tout rejeu.
Un échec de sérialisation (`40001`) est rejoué de même ; aucune autre erreur ne l'est, pas même un verrou non obtenu à temps ni une connexion perdue, dont l'issue peut être inconnue.
Le nombre d'essais et l'attente entre deux essais sont des réglages techniques de l'API, pas des valeurs d'équilibrage : `API_COMMAND_MAX_ATTEMPTS` (3 essais au plus, le premier compris) et `API_COMMAND_RETRY_DELAY_MS` (le n-ième nouvel essai attend n fois 50 ms, plus un tirage d'au plus 50 ms).
Au-delà, la commande rend `INTERNAL`, avec une seule trace sans clé au journal : la clé reste utilisable.
Limite assumée : PostgreSQL ne cherche un interblocage qu'après `deadlock_timeout` (1 s par défaut), si bien qu'une commande rejouée dépasse le budget de 150 ms ; c'est rare, et préférable à une erreur.
Le moteur ne rejoue pas : un tick annulé est repris au passage suivant, hors de son intervalle.

## Budgets de performance

| Mesure | Cible à 5 000 joueurs actifs par jour |
| --- | --- |
| Commande, 95e centile | 150 ms |
| Tick économique | Moins de 5 s |
| Clôture quotidienne | Moins de 5 min, sans interruption de service |
| Connexions simultanées en temps réel | 1 500 |

## Anti-triche et multi-comptes

Dans un jeu à économie ouverte, la triche principale est le transfert de richesse entre comptes d'un même joueur.

- Limitation de débit par commande et par compte, tenue en base pour que toutes les répliques de l'API comptent ensemble ; si la base ne répond pas, chaque réplique compte en mémoire, et la limite devient au pire la limite multipliée par le nombre de répliques ; délai de 7 jours avant les transferts importants pour un nouveau compte.
- Fourchette de prix sur les contrats de gré à gré : un écart de plus de 30 % au prix de référence est bloqué ou signalé.
- Détection par graphe : flux à sens unique, prêts jamais remboursés, ventes systématiquement à perte vers le même bénéficiaire.
- Rapprochement des comptes par appareil, réseau et horaires de connexion, visible dans la fiche joueur du back-office.
- Journal d'audit inaltérable de toutes les commandes, conservé 90 jours ; durées et mode de purge des journaux : `docs/adr/0002-conservation-journaux.md`.
- Sanctions graduées et annulation des transactions par écritures inverses tracées.
  Dans la phase 2 (ticket 275), la sanction en vigueur d'un compte est relue en base à chaque commande, dans sa transaction, à l'heure de cette lecture : un avertissement ne bloque rien, un silence refuse `chat.post` (`SILENCED`), une suspension et une exclusion refusent toute commande de jeu (`SUSPENDED`).
  Une exclusion n'agit qu'une fois validée par une seconde personne (15.4).
  Décision (#563) : une seule condition (`packages/db/src/sanctions.ts`) décide qu'un compte sanctionné n'agit pas, pour le registre de l'API, `market.placeOrder` et les intendants du moteur.
  Elle compare les sanctions à l'heure de l'instruction (`statement_timestamp()`), comme sous le verrou d'agora (#528) : une sanction qui commence pendant que la commande attendait le verrou de sa clé la refuse déjà.
  L'appel (`moderation.appeal`) et les commandes d'administration n'y sont pas soumis ; les lectures non plus : un compte suspendu lit encore ses écrans.
  Le refus est un refus métier, journalisé, qui consomme la clé d'idempotence comme `FORBIDDEN` ; une commande déjà validée se rejoue toujours.
  Une sanction validée pendant qu'une commande s'exécute ne la refuse pas : elle agit dès la commande suivante.
  Une sanction levée (appel accueilli, #276) finit à l'instant de sa levée, et cesse d'agir dès la commande suivante.
  Décision (relecture de #275) : `SUSPENDED` reste un refus métier en 409, comme `SILENCED` ; le statut 403 est réservé à `FORBIDDEN` (rôle ou second facteur absents).
