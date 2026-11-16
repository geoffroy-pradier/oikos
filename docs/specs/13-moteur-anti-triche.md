# 13. Moteur de simulation et anti-triche

Le serveur est seul maître de l'état du jeu : le client n'envoie que des intentions. Le cœur de simulation est une bibliothèque de fonctions pures, ce qui rend chaque tick rejouable et testable hors ligne.

## Modèle de calcul

- **Évaluation paresseuse** pour la production et les intérêts : l'état est recalculé à partir de l'horodatage lors d'une lecture ou d'une action. Le coût serveur dépend de l'activité, pas du nombre de comptes.
  Écart assumé pour les trajets (#253) : l'arrivée d'un voyage est une étape du tick, et non un calcul fait à la lecture.
  Elle déplace du stock d'une extrémité à une autre du journal des stocks et met un navire à quai ; une écriture faite à la lecture devrait l'être par chaque lecteur, dont le client qui ne lit que par Supabase et n'écrit rien.
  Le coût suit toujours l'activité : l'étape ne lit que les voyages échus, par un index partiel des voyages en mer (`voyages_due_idx`), et un tick sans arrivée ne fait qu'une recherche vide.
  Un voyage arrive au premier tick qui commence à son échéance ou après, rattrapé ou non, daté de l'instant de ce tick : jamais plus tard qu'un tick, sauf panne du moteur, que la Vigie montre (voyages en retard de déchargement).
- **Ticks globaux** pour ce qui dépend de tous : demande des PNJ, prix de référence, population, météo, Hybris, l'arrivée des voyages échus, et le parc de logements des cités (4.5), que le premier tick qui connaît une cité crée et que les suivants complètent jusqu'au nombre de la configuration.
  La vétusté des biens immobiliers n'est pas un calcul paresseux : c'est une étape de la clôture quotidienne, juste avant l'entretien, une fois par jour de jeu, car la base doit savoir qu'un bien ne s'use qu'une fois par jour (12).
  Le loyer des baux non plus (#257) : il se paie à une étape de la clôture, avant la vétusté, une écriture par bail et par jour de jeu, et un loyer impayé met fin au bail dans la transaction de la clôture (12).
- **Appariement des ordres** à l'insertion, dans la transaction, avec un verrou par couple cité et bien.
- **Aléa déterministe** : chaque tick tire d'une graine enregistrée, ce qui permet de rejouer et d'auditer un résultat contesté.
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
