-- Dotation des maisons PNJ de secours (docs/specs/08-ia.md, 8.3 ; 05-economie.md, 5.5 ; ticket 715).
-- La clôture verse à chaque maison PNJ, une fois, à sa fondation, la dotation de sa filière depuis un robinet dédié,
-- comme la dotation de départ d'une maison de joueur : le tableau de bord suit les deux à part.
-- Rejouable (`on conflict do nothing`) ; le code précédent n'écrit pas ce robinet et reste compatible.

-- Le catalogue crée son compte dans chaque monde existant, et dans chaque monde à venir.
insert into game.system_account_kinds (key, allow_negative)
values ('faucet_npc_house_grant', true)
on conflict do nothing;
