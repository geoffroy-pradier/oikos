-- Achats des PNJ : budget non dépensé reporté d'un tick au suivant (docs/specs/05-economie.md, 5.2 ; #675).
-- Les biens s'achètent par unités entières : un budget de 13 oboles ne paie qu'un sel à 7, et sans report les
-- 6 oboles restantes seraient perdues alors que la demande en veut deux un tick sur deux.
-- Le moteur borne le report (`market.npcBudgetCarryUnits` unités au prix de réserve du bien) ; la base, elle, refuse
-- un report négatif.
-- Colonne ajoutée avec une valeur par défaut : la version précédente du moteur, qui ne l'écrit pas, insère un
-- report de budget nul et laisse intact celui d'une ligne existante.
alter table game.npc_demand_carry
  add column if not exists budget_carry bigint not null default 0
    constraint npc_demand_carry_budget_carry_non_negative check (budget_carry >= 0);

comment on column game.npc_demand_carry.budget_carry is
  'Oboles du budget des PNJ non dépensées aux ticks précédents, bornées par la configuration (#675).';

-- Le moteur tient le report comme la fraction de demande ; aucun droit pour les clients (la table n'en a aucun).
grant update (budget_carry) on game.npc_demand_carry to oikos_service;
