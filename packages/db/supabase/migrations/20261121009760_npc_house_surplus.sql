-- Surplus des maisons PNJ de secours (docs/specs/08-ia.md, 8.3 ; 05-economie.md, 5.5 ; ticket 716).
-- Chaque clôture verse au puits la trésorerie d'une maison PNJ au-delà du plafond de sa cité (`npcHouses`), avant
-- l'entretien : une maison PNJ ne thésaurise pas et ne gonfle pas la masse.
-- Rejouable (`on conflict do nothing`) ; le code précédent n'écrit pas ce puits et reste compatible.

-- Le catalogue crée son compte dans chaque monde existant, et dans chaque monde à venir.
insert into game.system_account_kinds (key, allow_negative)
values ('sink_npc_house_surplus', false)
on conflict do nothing;
