-- Lecture des échanges par l'étape du tick qui remplit les chandeliers (docs/specs/05-economie.md, 5.3 ; ticket 71).

-- Rang d'exécution d'un échange. `created_at` est l'heure de début de la transaction, la même pour tous
-- les échanges d'un appariement, et les identifiants ne sont ordonnés qu'à la milliseconde : sans ce
-- rang, l'ouverture et la clôture d'un chandelier seraient tirées au sort entre échanges simultanés.
-- Colonne remplie par la base : le code qui insère un échange sans la nommer continue de fonctionner.
alter table game.trades add column if not exists seq bigint generated always as identity;

-- Le tick relit les échanges d'un monde depuis un instant, et cherche le dernier chandelier d'une série.
create index if not exists trades_world_created_at_idx on game.trades (world_id, created_at);
create index if not exists price_candles_world_series_idx
  on game.price_candles (world_id, period_seconds, period_start);
