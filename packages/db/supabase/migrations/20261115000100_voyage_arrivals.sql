-- Arrivée des voyages par le moteur (docs/specs/04-systemes-gestion.md, 4.6 ; docs/specs/13-moteur-anti-triche.md ;
-- ticket 253). Chaque tick décharge les voyages échus de son monde, dans sa transaction : arrivée datée du tick,
-- navire à quai, cargaison de l'extrémité `in_transit` vers le stock de la maison dans la cité d'arrivée. Les
-- gardes des migrations 80 et 81 suffisent à la base ; il lui manque un accès qui ne parcoure que les voyages
-- en mer, par échéance, pour que l'étape et la Vigie coûtent selon l'activité et non selon l'historique.
-- Rejouable (`if not exists`) ; le code précédent ne dépend pas de cet index.
create index if not exists voyages_due_idx on game.voyages (world_id, arrives_at) where arrived_at is null;
