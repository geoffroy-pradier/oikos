-- L'arrêt d'un site lisible par son joueur (docs/specs/05-economie.md, 5.5 ; ticket 72).
-- Un site impayé à la clôture s'arrête : son joueur doit le voir, savoir depuis quand, et pouvoir le
-- relancer. La colonne est accordée comme les autres colonnes de ses sites, sous la même règle par
-- ligne (`sites_read_own`), et ajoutée en fin de vue : le client précédent, qui ne la demande pas,
-- lit la vue comme avant.
grant select (halted_at) on game.sites to authenticated;
create or replace view public.my_sites with (security_invoker = true) as
  select id, house_id, city_id, recipe_id, cycle_started_at, halted_at from game.sites;
