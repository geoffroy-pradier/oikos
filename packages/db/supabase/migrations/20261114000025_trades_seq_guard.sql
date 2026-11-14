-- Rang d'exécution des échanges : unique, et jamais choisi par le service (ticket 71).
-- Même protection que l'ancienneté des ordres (migration 19). Le rang décide de l'ouverture et de la
-- clôture d'un chandelier, donc du dernier prix affiché : un échange inséré avec un rang choisi
-- (OVERRIDING SYSTEM VALUE) les fausserait. Le service ne date pas non plus un échange : `created_at`
-- le range dans une période, et le code du jeu laisse la base le remplir.
create unique index if not exists trades_seq_unique on game.trades (seq);
revoke insert on game.trades from oikos_service;
grant insert (id, world_id, sell_order_id, buy_order_id, price, quantity, ledger_entry_id)
  on game.trades to oikos_service;
