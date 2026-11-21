# ADR 0013 — Une maison PNJ est une maison sans compte

Date : 2026-11-21 · Statut : acceptée

## Contexte

La spécification 8.3 veut des maisons PNJ, « clairement identifiées comme telles », qui tiennent les filières vitales qu'aucun joueur n'occupe (#715).
Jusqu'ici, toute maison appartenait à un compte : `houses.user_id` était obligatoire, et les règles par ligne, les commandes et l'intendant partaient de ce compte.
Deux voies existaient : un acteur à part, avec ses propres tables, ou une maison ordinaire sans compte.

## Décision

- Une maison PNJ est une ligne de `game.houses` comme les autres, de nature `npc` (`houses.kind`, ajoutée par #718), sans compte : `houses.user_id` devient facultatif.
- La base garantit la cohérence : la contrainte `houses_account_by_kind` impose qu'une maison soit `npc` si et seulement si elle n'a pas de compte.
- Elle tient ses comptes, ses stocks et ses sites par les mêmes tables, journaux et gardes que les joueurs : grand livre en partie double, entretien, salaires, hébergement.
- Seul le moteur la crée et la fait agir ; aucune commande de l'API de jeu n'agit pour elle, puisque toute commande désigne la maison du compte qui l'envoie (`current_house_ids()`, `accountHouseId`).
- Elle n'est jamais citoyenne ; les classements de fortune, les liturgies, l'Hybris et les Jeux l'écartent.

## Conséquences

- Une seule définition de la maison : la fortune, le Gini, le marché et la clôture la traitent sans cas à part, et ses écritures se contrôlent comme celles d'un joueur.
- Toute règle par ligne nouvelle sur `houses.user_id` doit rester une égalité stricte avec `auth.uid()` : un `user_id` nul ne doit jamais rien ouvrir.
- Une commande qui viserait une autre maison que la sienne doit refuser une maison `npc`.
- La vue publique `public.npc_houses` dit qu'une maison est PNJ ; `public.houses` ne change pas (ADR 0006).
