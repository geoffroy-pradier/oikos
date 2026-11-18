# 18. Indicateurs, risques et conformité

## Indicateurs de réussite

| Indicateur | Cible au lancement |
| --- | --- |
| Rétention à 1, 7 et 30 jours | 40 %, 20 %, 10 % |
| Sessions par joueur actif et par jour | 3 ou plus |
| Joueurs actifs ayant voté ou écrit dans la semaine | 50 % |
| Joueurs actifs engagés dans un contrat avec un autre joueur | 30 % |
| Inflation mensuelle | 0 % à 3 % |
| Disponibilité | 99,5 % |
| Part des joueurs actifs qui paient | 3 % |
| Coût IA par joueur actif et par mois | Moins de 0,10 € |

Ces cibles sont des hypothèses de travail à recaler sur les mesures de l'alpha.

## Risques

| Risque | Parade |
| --- | --- |
| Périmètre trop large | Tranches verticales, liste « hors 1.0 » tenue, une cité jouable avant tout le reste |
| Économie qui dérive | Grand livre, tableau des robinets et puits, simulateur, trois leviers sans patch |
| Population insuffisante par cité | Un seul monde, peu de cités ouvertes au départ, maisons PNJ de complément |
| Domination des premiers arrivés | Hybris, liturgies, foncier fini mais concessions à durée limitée, classements des nouveaux |
| Multi-comptes | Détection par graphe, fourchettes de prix, délais pour les nouveaux comptes |
| Coût ou panne de l'IA | Quotas, cache, lots nocturnes, textes de repli, jeu jouable sans IA |
| Exploitation du serveur par une seule personne | Sauvegarde continue testée, supervision, procédures écrites, préproduction |
| Charge de modération | Pré-tri par IA, modérateurs bénévoles, outils de sanction graduée |
| Code produit par agents difficile à maintenir | Contrats typés, revues systématiques, petites fusions, décisions d'architecture écrites |

## Conformité

- **RGPD** : hébergement en France, registre des traitements, politique de confidentialité, export et suppression depuis le back-office, contrat de sous-traitance avec le fournisseur d'IA, aucune donnée personnelle dans les prompts au-delà du pseudonyme.
- **Mineurs** : inscription à partir de 15 ans, âge du consentement numérique en France ; achats réservés aux majeurs.
- **Contenus** : conditions d'utilisation, charte de conduite, procédure de signalement et d'appel, conservation limitée des messages.
  Dans la phase 2 (ticket 275), le joueur signale un message sous un motif de la configuration (6.6), et voit en tête de chaque écran ses sanctions pas encore finies, avec leur effet, leur motif, leur fin (« sans fin » pour une exclusion) et le moyen d'en faire appel (10).
  Décision (le ticket ne dit pas de quelle sanction on fait appel) : on fait appel d'une sanction pas encore finie, une seule fois, par un texte d'au plus `moderation.maxAppealLength` caractères (1 000) ; une sanction finie ne se conteste plus (`SANCTION_ENDED`).
  L'appel ne suspend pas la sanction ; il est tranché par `admin.decideAppeal` (15.1, #276), par un autre compte que l'auteur de la sanction et que le compte sanctionné, et accueilli, il la lève.
  La modération peut aussi lever une sanction sans appel, et retirer une exclusion proposée (15.1, #531).
  `game.my_sanctions()` a un type rendu figé (ADR 0006) ; une sanction levée y finit à l'instant de sa levée.
  Le joueur lit la décision sur ses appels par une fonction et une vue nouvelles (#529, `game.my_appeal_decisions()`, `public.my_appeal_decisions`) : une ligne par appel tranché, avec la sanction, la décision (accueilli ou rejeté) et son instant, jamais l'auteur de la décision ni de la levée.
  Comme pour ses sanctions, il ne lit que ses propres appels, et rien d'une exclusion encore à valider.
  L'annonce des sanctions dit la décision sous l'appel : accueilli (la sanction est levée) ou rejeté (elle est maintenue), avec sa date.
  Décision (ambiguïté du ticket) : une sanction finie dont l'appel est tranché, dont celle qu'un appel accueilli a levée, reste annoncée, sans son effet et avec sa fin, jusqu'à ce que le joueur masque cet avis.
  Ce choix est gardé dans le navigateur, pour ce compte et sur cet appareil seulement, sans écriture en base ni durée de la configuration ; un autre appareil montre de nouveau l'avis.
  Le texte de l'appel est gardé avec la sanction, pas dans le journal des commandes.
  La liste initiale des termes interdits est vide : elle relève de la charte de conduite, que le responsable communauté remplit par Olympe.
- **Commerce** : conditions de vente, droit de rétractation, TVA, mentions légales. Aucun mécanisme de hasard payant.
- **Propriété intellectuelle** : la mythologie grecque est libre ; les illustrations et textes générés sont revus pour écarter toute ressemblance avec une œuvre existante.

Une relecture par un juriste des conditions d'utilisation et de vente est à prévoir avant la bêta ouverte.
