-- Index de la lecture du calendrier des événements dans Olympe (docs/specs/15-back-office-olympe.md, 15.1 ;
-- tickets 267 et 446) : `GET /api/admin/events` lit, tous mondes confondus, les événements qui finissent après
-- un instant (à venir, en cours ou finis depuis 30 jours). Les index existants commencent par la cité ou le monde
-- et ne servent pas cette lecture, qui parcourrait sinon toute la table.
-- Rejouable (`if not exists`) ; le code précédent n'en dépend pas : il lit la même chose, plus lentement.
create index if not exists world_events_ends_idx on game.world_events (ends_at);
