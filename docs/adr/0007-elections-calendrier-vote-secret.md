# ADR 0007 — Élections : calendrier enchaîné, dépouillement vérifié par la base, vote secret

Date : 2026-11-15 · Statut : acceptée

## Contexte

Le ticket 260 ouvre la première magistrature, l'archonte, élu pour une année de jeu par les citoyens de sa cité (6.2).
Une élection a des dates (dépôt, vote, mandat) que le moteur joue par ses clôtures, qui peuvent être manquées (moteur arrêté) ou jouées plusieurs fois.
Le vote doit être secret entre joueurs, et son résultat ne doit dépendre ni d'une course entre un bulletin et le dépouillement, ni du code du moteur seul.

## Décision

- **Calendrier fixé à l'ouverture, en instants de clôture.**
  La clôture ouvre l'élection du mandat suivant ; elle enregistre l'ouverture du dépôt, l'ouverture et la fin du vote, et la fin du mandat.
  Une version de configuration publiée ensuite ne vaut que pour les élections suivantes.
- **Mandats enchaînés, sans ancre fixe.**
  Le mandat suivant commence à la fin du précédent, pourvu ou vacant ; le premier d'une cité, `candidacyDays + votingDays` jours après la première clôture qui lit la section `politics`.
  Une ouverture manquée écourte le dépôt ; un début de vote manqué replanifie l'élection à partir de la clôture suivante, et la charge est vacante d'ici là.
  Une ancre commune (jour de référence, comme les saisons) aurait figé une élection impossible après une panne et rendu ambigu un changement de durée du mandat.
- **La base garantit l'élection, pas seulement le code.**
  Une élection ouverte par cité et par charge, un bulletin par maison et par élection, des périodes de dépôt et de vote lues à l'heure de la transaction.
  Un bulletin prend un verrou partagé sur son élection et sa candidature ; le dépouillement marque d'abord l'élection, ce qui la verrouille, puis compte : un bulletin en cours est attendu et compté, un bulletin plus tardif est refusé.
  La garde des charges recompte elle-même les bulletins et n'admet que l'élu (le plus de bulletins, la candidature la plus ancienne à égalité).
- **Vote secret entre joueurs.**
  Un joueur lit que sa maison a voté, jamais pour qui ; les résultats ne sortent qu'après le dépouillement, par une fonction exécutée au nom du propriétaire.
  Ni la réponse de `city.castVote` ni l'événement `BallotCast` ne nomment la candidature.

## Conséquences

- Le bulletin reste lié à sa maison en base : le back-office, le journal des commandes (entrée de `city.castVote`) et une sauvegarde le révèlent.
  Un secret aussi envers l'exploitant demanderait de séparer la participation du contenu du bulletin, au prix de la garantie « un bulletin par maison » en base.
- Une égalité à zéro bulletin élit la candidature la plus ancienne : un candidat seul est élu sans voix.
- Les vues de l'élection (migration 72) sont recréées sans condition : elles ne gagnent pas de colonne (ADR 0006).
