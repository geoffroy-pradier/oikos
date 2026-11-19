-- Revenu public des PNJ : une fois par cité et par jour de jeu (docs/specs/05-economie.md, 5.5 ; ticket 632).
-- La clôture et le tick de demande versent tous deux le revenu public du jour de jeu, le premier qui passe, pour qu'une
-- bourse n'attende jamais la clôture (déploiement, monde neuf, cité ajoutée après la clôture du jour). Leur clé commune,
-- la cité et le jour de jeu de l'écriture (`meta`), est tenue par cet index : jamais deux versements, même en
-- concurrence. Rejouable (`if not exists`) ; compatible avec le code précédent, qui ne verse qu'à la clôture, une
-- fois par jour de jeu. Aucune donnée existante ne le viole : le revenu public n'a encore rien versé en service.
create unique index if not exists ledger_entries_npc_public_income_once
  on game.ledger_entries ((meta ->> 'cityId'), (meta ->> 'gameDay'))
  where kind = 'npc.public_income';
