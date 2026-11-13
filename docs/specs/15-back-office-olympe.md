# 15. Back-office « Olympe »

Olympe est une application distincte, sur son propre sous-domaine, d'où l'équipe surveille, modère, règle et anime le jeu sans toucher au code ni à la base. Tout ce qui s'y fait est tracé, et les actions sensibles demandent une double validation.

## 15.1 Modules

| Module | Fonctions |
| --- | --- |
| Vigie | Joueurs connectés, actifs du jour, durée des ticks, erreurs, files de tâches, coût IA du jour, état des services |
| Économie | Masse monétaire, robinets et puits ligne par ligne, indice des prix, prix par bien et par cité, inégalité de fortune (Gini), volumes, alertes de dérive |
| Paramètres | Édition de toutes les tables d'équilibrage, validation par schéma, comparaison de versions, programmation, retour arrière en un clic |
| Simulateur | Rejoue N jours sur une copie du monde avec une configuration candidate et des agents automates, puis compare les indicateurs à la référence |
| Animation | Calendrier des événements, déclenchement manuel, création d'événements par modèle, annonces, validation des propositions du maître du jeu |
| Joueurs | Recherche, fiche complète (comptes, écritures, commandes, sessions, comptes liés), vue du jeu en lecture seule, compensation et correction par écritures tracées |
| Modération | File des signalements pré-triée par l'IA, contexte de la conversation, sanctions graduées (avertissement, silence, suspension, exclusion), appels, filtres de vocabulaire |
| Cités et politique | État des institutions, mandats, décrets en vigueur, intervention d'urgence sur une cité bloquée |
| IA | Prompts versionnés, journal des appels, coût par usage, taux de sorties rejetées, interrupteurs, jeux d'essai de non-régression |
| Support | Tickets, réponses types, historique par joueur |
| Boutique | Commandes, abonnements, remboursements, droits accordés |
| Conformité | Export et suppression des données d'un joueur, registre des demandes |
| Accès et audit | Rôles, double authentification, journal d'audit consultable et non modifiable |

## 15.2 Cycle de vie d'un changement d'équilibrage

1. **Brouillon** : un concepteur modifie des valeurs ; le schéma refuse les valeurs hors bornes.
2. **Simulation** : le simulateur compare 30 jours simulés avant et après (inflation, marges par filière, temps de progression).
3. **Revue** : une seconde personne approuve le différentiel.
4. **Programmation** : activation à la prochaine clôture quotidienne, annoncée aux joueurs dans la chronique.
5. **Suivi** : alerte automatique si un indicateur sort de sa plage dans les 72 heures ; retour arrière en un clic.

## 15.3 Rôles

| Rôle | Peut |
| --- | --- |
| Super-administrateur | Tout, dont la gestion des rôles |
| Concepteur de jeu | Paramètres, simulateur, animation |
| Responsable communauté | Annonces, animation, modération, cités |
| Modérateur | Modération et fiche joueur en lecture |
| Support | Tickets, fiche joueur, compensation sous plafond |
| Observateur | Lecture seule des tableaux de bord |

Un compte porte un seul rôle : pas de cumul en v0. Une personne qui tient deux fonctions reçoit le rôle le plus large des deux ; le cumul sera rouvert si les modérateurs bénévoles le demandent.

## 15.4 Exigences de sécurité

- Double authentification obligatoire, session courte, accès restreint par VPN ou liste d'adresses.
- Double validation pour tout crédit de monnaie au-dessus d'un seuil, toute exclusion définitive et toute mise en production de paramètres.
- Aucun accès direct aux tables : le back-office appelle des commandes d'administration, soumises aux mêmes règles de journalisation que les commandes de jeu.
- Les modérateurs peuvent être des joueurs bénévoles : leur rôle ne donne accès à aucune donnée économique privée.

Dans la première version, une commande d'administration (`admin.*`) n'est exécutée que si la session porte le second facteur (niveau `aal2` du jeton) et si le compte a, dans `admin.roles`, l'un des rôles que la commande autorise ; le rôle est relu à chaque commande. Tout refus (`FORBIDDEN`) est journalisé comme une commande rejetée. Deux commandes existent : `admin.publishConfig` enregistre une version de configuration sans l'activer, `admin.scheduleConfig` programme son activation à la prochaine clôture quotidienne (un retour arrière est la programmation d'une version antérieure ; si plusieurs versions sont programmées pour la même clôture, la dernière programmée l'emporte ; une version dont le contenu ne respecte plus le schéma est refusée). Le journal ne garde d'une commande d'administration refusée que la taille et l'empreinte de son entrée. Elles sont ouvertes au super-administrateur et au concepteur de jeu. La revue par une seconde personne (15.2, étape 3) n'est pas encore imposée. Le premier super-administrateur est inscrit en base par un humain. Les lectures du back-office passent par des routes `GET /api/admin/*` de l'API, soumises au même contrôle (second facteur et rôle relu à chaque requête) : Vigie et paramètres pour le super-administrateur, le concepteur de jeu et l'observateur ; journal d'audit pour le super-administrateur et l'observateur. Le journal d'audit rend le résultat de chaque commande d'administration, jamais son entrée. L'application `apps/admin` ne parle qu'à Supabase Auth (lien magique, puis second facteur TOTP : enrôlement d'une application d'authentification à la première connexion, code à chaque session) et à ces routes ; elle n'affiche aucun module avant que l'API ait confirmé le rôle du compte.

## 15.5 Indicateurs d'alerte par défaut

| Indicateur | Seuil d'alerte |
| --- | --- |
| Inflation sur 7 jours | Hors de la plage -1 % à +2 % |
| Part de marché d'une maison sur un bien vital | Plus de 50 % dans une cité |
| Tick économique | Plus de 10 s |
| Signalements en attente | Plus de 24 h |
| Coût IA du jour | Plus de 150 % de la moyenne sur 7 jours |
| Sauvegarde | Dernière archive de plus de 15 min |
