# 13. Moteur de simulation et anti-triche

Le serveur est seul maître de l'état du jeu : le client n'envoie que des intentions. Le cœur de simulation est une bibliothèque de fonctions pures, ce qui rend chaque tick rejouable et testable hors ligne.

## Modèle de calcul

- **Évaluation paresseuse** pour la production, les trajets et les intérêts : l'état est recalculé à partir de l'horodatage lors d'une lecture ou d'une action. Le coût serveur dépend de l'activité, pas du nombre de comptes.
- **Ticks globaux** pour ce qui dépend de tous : demande des PNJ, prix de référence, population, météo, Hybris.
- **Appariement des ordres** à l'insertion, dans la transaction, avec un verrou par couple cité et bien.
- **Aléa déterministe** : chaque tick tire d'une graine enregistrée, ce qui permet de rejouer et d'auditer un résultat contesté.
- **Configuration figée par tick** : un tick lit une version de configuration et une seule. Une activation de configuration ne s'antidate pas : sa date de création est l'heure de la base, posée par une garde quel que soit l'appelant, et la base refuse une échéance antérieure (`activations_not_backdated`) ; une programmation ou une annulation validée après son échéance est refusée à la validation. La version vue par un tick ou une clôture déjà joués ne change donc pas, à une exception bornée près : une activation immédiate (configuration initiale) prend effet au début de sa transaction, que la base n'admet que validée dans les cinq secondes. Limite : le contrôle à la validation est un déclencheur différé ; un appelant qui force ses contrôles différés (`SET CONSTRAINTS … IMMEDIATE`) puis valide plus tard le contourne, pour une activation immédiate, une programmation comme une annulation. L'API ne le fait jamais ; seul un code qui écrit en base sous le rôle de service le pourrait.

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
