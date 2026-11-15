# 13. Moteur de simulation et anti-triche

Le serveur est seul maître de l'état du jeu : le client n'envoie que des intentions. Le cœur de simulation est une bibliothèque de fonctions pures, ce qui rend chaque tick rejouable et testable hors ligne.

## Modèle de calcul

- **Évaluation paresseuse** pour la production, les trajets et les intérêts : l'état est recalculé à partir de l'horodatage lors d'une lecture ou d'une action. Le coût serveur dépend de l'activité, pas du nombre de comptes.
- **Ticks globaux** pour ce qui dépend de tous : demande des PNJ, prix de référence, population, météo, Hybris.
- **Appariement des ordres** à l'insertion, dans la transaction, avec un verrou par couple cité et bien.
- **Aléa déterministe** : chaque tick tire d'une graine enregistrée, ce qui permet de rejouer et d'auditer un résultat contesté.
- **Configuration figée par tick** : un tick lit une version de configuration et une seule. Une activation de configuration ne s'antidate pas : sa date de création est l'heure de la base, posée par une garde quel que soit l'appelant, et la base refuse une échéance antérieure (`activations_not_backdated`) ; une programmation ou une annulation validée après son échéance est refusée à la validation. La version vue par un tick ou une clôture déjà joués ne change donc pas, à une exception bornée près : une activation immédiate (configuration initiale) prend effet au début de sa transaction, que la base n'admet que validée dans les cinq secondes. Limite assumée (décision du ticket 208) : le contrôle à la validation est un déclencheur différé, et la base ne rejoue pas à la validation un contrôle déjà joué ; un appelant qui force ses contrôles différés (`SET CONSTRAINTS … IMMEDIATE`, qui ne demande aucun droit) puis valide plus tard le contourne, pour une activation immédiate, une programmation comme une annulation. Seul un code qui écrit en base sous le rôle de service le pourrait ; aucun code du jeu n'émet cette instruction, et le lint le refuse hors des tests. L'effet est borné à l'audit : chaque tick et chaque clôture enregistre la version qu'il a lue, et c'est elle qui fait foi pour le rejouer ; une activation validée en retard ne change aucun résultat déjà joué, seulement la version que le journal des activations dit en vigueur à ces instants, écart que révèle le rapprochement entre la version enregistrée par chaque tick ou clôture et `config.active_version_at` de son instant. Garantie côté lecture écartée : le tick et la clôture prendraient `config.activations` et ses annulations en mode `SHARE` jusqu'à leur validation. Toute programmation attendrait la fin de chaque tick et de chaque clôture (jusqu'à cinq minutes), et une programmation en attente ferait à son tour attendre, derrière elle dans la file des verrous, les ticks et clôtures de tous les mondes ; la configuration devrait être lue dans la transaction du tick, ce que le moteur évite pour ne pas épuiser le pool de connexions ; et l'exception des cinq secondes de l'activation immédiate resterait. Le service fautif ou compromis que suppose le contournement peut déjà écrire des mouvements que la base ne refuse pas (débits hors échange, 12).

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
