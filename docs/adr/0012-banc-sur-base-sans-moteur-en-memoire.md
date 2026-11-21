# ADR 0012 — Le banc d'équilibrage reste sur base, sans moteur de jeu en mémoire

Date : 2026-11-21 · Statut : acceptée

## Contexte

Le banc d'équilibrage (#78, #281, #283, #712) joue le jeu entier sur une base Supabase, et le simulateur (#284) en joue deux parties, référence et candidate.
Le banc à quatre cités dure 11 minutes en local, celui à douze cités environ 15 minutes par partie en `ci` : ce dernier ne tourne que la nuit.
Le ticket #904 demandait un simulateur en mémoire, sans base, pour le jouer à chaque demande de fusion.
L'étude du ticket a écarté cette voie.

## Constat

- Seules les formules de `packages/sim` sont pures.
  La journée de jeu vit en SQL et en Kysely : clôture en 17 étapes (`apps/engine/src/steps`), demande des PNJ, ordres et séquestre (`placeOrder`), commandes de `@oikos/operations` et de l'API.
- Un moteur en mémoire demanderait environ 10 000 lignes qui refont ces étapes, plus les stratégies et les mesures du banc réécrites contre un autre état.
  Chaque règle du jeu existerait deux fois, et les deux copies divergeraient à chaque ticket suivant.
- Les gardes de la base manqueraient en mémoire : contraintes (`accounts_no_overdraft`, `inventories_reserved_within_quantity`), déclencheurs, verrous de monde, règles par ligne.
  Or ce sont elles qui rendent le banc crédible : un banc qui ne peut pas être refusé par la base ne prouve plus que le jeu tient.
- Le temps n'est pas dans le calcul : sur le banc à quatre cités, la base passe 118 s à exécuter 1,6 million de requêtes pour une partie de 11 minutes.
  Environ 90 % de la durée est donc dans les allers-retours entre Node et la base.
- Prouver l'accord avec le banc sur base, au chiffre près ou borné, demande que chaque étape de la journée soit déjà écrite en mémoire.
  On ne peut donc pas le prouver avant d'avoir payé presque tout le coût du moteur.

## Décision

- Le banc reste sur base : la base et le moteur sont l'unique source des règles du jeu.
  Aucun moteur de jeu en mémoire n'est écrit.
- Le simulateur gagne du temps sans dupliquer le moteur : il joue la référence et la candidate en parallèle, chacune dans son processus et son monde, sur deux bases si `SIMULATE_CANDIDATE_DATABASE_URL` est donnée.
  Le rapport est celui de deux parties jouées l'une après l'autre : elles ne partagent rien.
  Mesure en local, banc à quatre cités, même graine : 20 min 46 s en séquence, 10 min 2 s en parallèle sur une seule base (le cas par défaut), 9 min 21 s sur deux bases, rapports JSON identiques octet pour octet.
  Le banc `simulate.bench.ts` joue deux parties de même graine en parallèle sur une même base et vérifie qu'elles ont les mêmes ordres, échanges et indicateurs.
- Le banc à douze cités reste la nuit (`balance-nightly`).
- Les pistes suivantes sont des tickets à part, s'ils sont utiles : regrouper les insertions du grand livre, des échanges et du journal des stocks (travail sensible), et fragmenter le banc à douze cités.

## Conséquences

- Un simulateur en mémoire ne se rouvre que sur un ADR qui prouve l'accord avec le banc sur base et dit comment il évite la duplication.
- La durée d'une partie du banc ne baisse que par moins de requêtes, pas par un autre moteur.
