# ADR 0009 — Cœur des opérations partagé par l'API et le moteur

Date : 2026-11-18 · Statut : acceptée

## Contexte

Les intendants (4.4, #278) mènent des règles sans le joueur : récolter un site, vendre, racheter.
Le moteur (#279) doit les exécuter selon exactement les mêmes règles que les commandes du joueur `site.collect` et `market.placeOrder`.
Leur code vivait dans `apps/api/src/commands`, que le moteur n'importe pas : une application n'en importe pas une autre.
Le recopier dans le moteur ferait diverger les deux chemins à la première correction, sur la monnaie et les stocks.
Appeler l'API depuis le moteur par le réseau demanderait un jeton au nom de chaque joueur, et la commande ne saurait pas qu'un intendant agit.

## Décision

- Le cœur transactionnel des deux commandes vit dans un paquet de l'espace de travail, `packages/operations` (`@oikos/operations`), importé par l'API et le moteur.
- Un cœur est une opération (`defineOperation`) : un nom, celui de la commande, des erreurs déduites des contraintes de la base, et une fonction qui reçoit une transaction ouverte, la configuration, l'instant de la base et l'acteur.
- L'acteur désigne la maison pour laquelle l'opération agit : celle du compte authentifié pour l'API, celle de l'intendant pour le moteur.
  Le cœur ne voit ni compte, ni clé d'idempotence, ni journal.
- L'appelant garde tout le reste du contrat d'une commande (11.4) : la transaction, la clé d'idempotence, la ligne du journal des commandes, l'enregistrement des événements que le cœur déclare, et l'annulation des effets d'un refus.
  L'API le fait par son registre, inchangé ; le moteur par son propre exécuteur (#279).
- Le déplacement se fait sans changement de comportement : mêmes requêtes, mêmes verrous dans le même ordre, mêmes refus, mêmes événements.
  Les tests d'intégration des deux commandes restent inchangés.
- Le paquet ne fait aucune entrée-sortie hors de la transaction reçue, ne lit pas l'environnement et ne contient aucune constante d'équilibrage.

## Conséquences

- Une correction du cœur vaut pour le joueur comme pour l'intendant.
- Les verrous qu'un cœur prend s'ajoutent à ceux de l'appelant : le moteur doit prendre les siens avant, dans l'ordre de la clôture, et la relecture d'un cœur vérifie l'ordre des deux chemins.
- Les autres commandes restent dans l'API ; une commande n'entre dans le paquet que lorsqu'un second appelant en a besoin, avec un ADR ou un ticket qui le dit.
- La simulation à blanc des règles proposées (#280) pourra exécuter ces cœurs dans une transaction annulée.
