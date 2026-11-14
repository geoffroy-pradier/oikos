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

La liste des rôles admis dans chaque module est écrite une seule fois, dans les contrats partagés (`ADMIN_MODULE_ROLES`) : l'API ouvre ses routes de lecture d'après elle, l'application compose sa navigation d'après elle. Un compte connecté sans rôle n'a accès à rien ; il voit son identifiant, à transmettre à un super-administrateur. Le module Accès, réservé au super-administrateur, liste les comptes qui portent un rôle par `GET /api/admin/roles` : identifiant du compte, rôle, compte qui l'a accordé et date, du plus ancien au plus récent (la date et l'ordre sont ceux du dernier changement de rôle du compte : un rôle remplacé repart de l'instant du remplacement) ; ni adresse ni autre donnée du compte. Il y accorde un rôle à un compte désigné par son identifiant (un rôle déjà porté est remplacé, et l'écran le dit) et retire un rôle après confirmation : la confirmation nomme le compte et le rôle, pose le foyer sur « Annuler », et la répétition d'une touche Entrée tenue n'ouvre, ne valide ni n'annule rien, de sorte qu'un retrait demande toujours un second geste voulu ; chaque refus de l'API y est expliqué.

## 15.4 Exigences de sécurité

- Double authentification obligatoire, session courte, accès restreint par VPN ou liste d'adresses.
- Double validation pour tout crédit de monnaie au-dessus d'un seuil, toute exclusion définitive et toute mise en production de paramètres.
- Aucun accès direct aux tables : le back-office appelle des commandes d'administration, soumises aux mêmes règles de journalisation que les commandes de jeu.
- Les modérateurs peuvent être des joueurs bénévoles : leur rôle ne donne accès à aucune donnée économique privée.

Dans la première version, une commande d'administration (`admin.*`) n'est exécutée que si la session porte le second facteur (niveau `aal2` du jeton) et si le compte a, dans `admin.roles`, l'un des rôles que la commande autorise ; le rôle est relu à chaque commande. Tout refus (`FORBIDDEN`) est journalisé comme une commande rejetée. Chaque ligne du journal des commandes porte le niveau d'assurance de la session, le rôle d'administration relu à cet instant et la version de configuration en vigueur. Ce qui est refusé avant d'atteindre ce journal (jeton absent ou invalide, corps trop volumineux, débit dépassé, lecture d'administration refusée) est compté par heure, sans contenu de requête ni identité ; chaque lecture du back-office par un compte admis est tracée (compte, rôle, route sans ses paramètres, issue). La Vigie affiche ces compteurs sur 24 heures. Pour la configuration, deux commandes : `admin.publishConfig` enregistre une version de configuration sans l'activer, `admin.scheduleConfig` programme son activation à la prochaine clôture quotidienne (un retour arrière est la programmation d'une version antérieure ; si plusieurs versions sont programmées pour la même clôture, la dernière programmée l'emporte ; une version dont le contenu ne respecte plus le schéma est refusée). Une troisième, `admin.cancelActivation`, annule une programmation à venir, désignée par l'identifiant d'une activation : elle annule toutes les programmations encore en attente pour la même clôture, si bien que la version en vigueur le reste à cette clôture (annuler la seule dernière programmée aurait remis en jeu, sans le dire, une programmation antérieure). Le journal des activations reste en ajout seul : chaque annulation est une ligne de plus, que la lecture de la version en vigueur prend en compte ; les versions restent enregistrées et se reprogramment. Une programmation ne s'annule plus à moins d'une minute de son échéance, ni après (`CONFIG_ACTIVATION_PAST`) : cette marge, tenue par la base, couvre le délai entre le contrôle et la validation ; en protection supplémentaire, chaque instruction de la commande est bornée à dix secondes (trois à partir du contrôle, soit trente secondes ; une instruction plus longue fait échouer la commande, sans rien annuler), ce qui n'est pas une garantie, ni le temps entre les instructions ni la validation finale n'étant comptés ; passé ce point, on programme un retour arrière. Une programmation déjà annulée ne s'annule pas une seconde fois (`CONFIG_ACTIVATION_CANCELLED`). La lecture des paramètres rend les programmations annulées, marquées comme telles ; l'écran ne signale comme programmée qu'une version dont une programmation tient toujours. Tout éditeur de configuration peut annuler, l'auteur de la version compris : retirer une programmation ne demande pas de seconde personne. Une version programmée par un autre compte que son auteur reste tenue pour revue même si cette programmation a été annulée : la revue porte sur le contenu, l'annulation sur le moment. Le journal ne garde d'une commande d'administration refusée que la taille et l'empreinte de son entrée. Elles sont ouvertes au super-administrateur et au concepteur de jeu. La revue par une seconde personne (15.2, étape 3) est imposée à la programmation : l'auteur d'une version ne peut pas la programmer lui-même (`CONFIG_REVIEW_REQUIRED`), un autre compte autorisé doit le faire. Une version déjà programmée une fois par un autre compte que son auteur est tenue pour revue : son auteur peut alors la reprogrammer, pour un retour arrière en un clic. Une version sans auteur (la configuration initiale) se programme sans revue. Pour un monde de test tenu par une seule personne, la variable d'environnement de l'API `OLYMPE_ALLOW_SELF_REVIEW=true` lève cette règle ; elle est désactivée par défaut, l'API le signale à son démarrage, et une programmation faite sous ce réglage ne vaut pas revue ; la Vigie dit si la double validation est exigée ou levée, pour que le réglage ne reste pas actif par oubli ; si l'API ne l'indique pas (version antérieure à ce champ), elle affiche un état inconnu plutôt que « Exigée ». Cette règle est tenue par l'API, pas par la base : le compte de service de l'API peut écrire une activation, comme toute écriture du jeu. Le premier super-administrateur est inscrit en base par un humain. Les rôles suivants s'accordent et se retirent par `admin.grantRole` et `admin.revokeRole`, ouvertes au seul super-administrateur : le compte est désigné par son identifiant, accorder un rôle à un compte qui en porte déjà un le remplace, nul ne s'accorde un autre rôle que le sien (un super-administrateur peut en revanche se retirer lui-même s'il en reste un autre), et il reste toujours au moins un super-administrateur (le dernier ne peut ni être retiré ni se retirer ; quand deux retraits se croisent, la base n'en laisse passer qu'un). Un rôle retiré cesse d'agir dès la requête suivante. Accorder à un compte le rôle qu'il porte déjà est refusé (`ROLE_UNCHANGED`), retirer le rôle d'un compte qui n'en a pas aussi (`ROLE_NOT_FOUND`) : le journal ne garde que des changements réels. L'API n'écrit pas la table des rôles elle-même : elle passe par une fonction de la base qui porte ces règles et vérifie que l'auteur désigné est super-administrateur. Cette fonction ne sait pas qui l'appelle : c'est l'API qui établit l'identité de l'auteur (jeton vérifié, second facteur, rôle relu) avant de la lui transmettre ; le compte de service de l'API est donc de confiance pour cette identité, comme pour toutes les écritures du jeu. Les lectures du back-office passent par des routes `GET /api/admin/*` de l'API, soumises au même contrôle (second facteur et rôle relu à chaque requête) : Vigie et paramètres pour le super-administrateur, le concepteur de jeu et l'observateur ; journal d'audit pour le super-administrateur et l'observateur. Le journal d'audit rend le résultat de chaque commande d'administration, jamais son entrée. Il est trié par ordre d'inscription ; l'heure affichée est celle du début de la commande, si bien que deux commandes simultanées peuvent y apparaître dans l'ordre inverse de leurs heures. L'application `apps/admin` ne parle qu'à Supabase Auth (lien magique, puis second facteur TOTP : enrôlement d'une application d'authentification à la première connexion, code à chaque session) et à ces routes ; elle n'affiche aucun module avant que l'API ait confirmé le rôle du compte. Le module Paramètres liste les versions de configuration, signale celle en vigueur et les programmations à venir, ouvre une version sous forme de texte JSON, affiche ses différences avec la version en vigueur (listes comparées par identifiant), enregistre le texte modifié comme nouvelle version, programme une version à la prochaine clôture et annule, après confirmation, une programmation à venir (l'écran prévient que toutes celles de la même clôture le seront) ; l'observateur consulte et compare sans pouvoir modifier. Une action renvoyée après une panne réutilise sa clé d'idempotence : elle n'est pas exécutée deux fois.

## 15.5 Indicateurs d'alerte par défaut

| Indicateur | Seuil d'alerte |
| --- | --- |
| Inflation sur 7 jours | Hors de la plage -1 % à +2 % |
| Part de marché d'une maison sur un bien vital | Plus de 50 % dans une cité |
| Tick économique | Plus de 10 s |
| Signalements en attente | Plus de 24 h |
| Coût IA du jour | Plus de 150 % de la moyenne sur 7 jours |
| Sauvegarde | Dernière archive de plus de 15 min |

## 15.6 Procédures d'exploitation

- [Accès à Olympe](../exploitation/acces-olympe.md) : premier super-administrateur et enrôlement du second facteur, accès accordé à une autre personne, appareil perdu, retrait d'accès.
