-- Identité des cités lue par les joueurs (docs/specs/06-cites-politique-communaute.md, 6.1 ; ticket 250).
-- Terroir, port, dieu protecteur et recette de départ de chaque cité sont des règles du jeu, dans la
-- configuration en vigueur. Même montage que les règles des sites (migration 18) : une fonction du schéma
-- `game`, exécutée au nom du propriétaire, ne rend que ces champs de la section `cities`, et une vue de
-- `public`, exécutée avec les droits de l'appelant, les rattache aux cités du monde qu'il peut lire.
-- Rejouable (`create or replace`) ; le code précédent ne lit ni cette fonction ni cette vue.
--
-- Une cité de la configuration se reconnaît à son identifiant court (`slug`), comme pour la demande des
-- PNJ. Une cité du monde absente de la configuration n'a pas de ligne : elle n'a pas d'identité connue.
-- Champs absents d'une version publiée avant les quatre cités : `terroir`, `has_port` et `patron_god_id`
-- sont nuls, et le client applique les valeurs par défaut du schéma partagé (`packages/config`), comme
-- l'API ; jamais une valeur inventée en base. `starting_recipe_id` est celle de la cité, sinon la
-- recette de départ commune (`starting.siteRecipeId`), que toute version porte.
-- Sans version en vigueur, la vue ne rend aucune ligne.
create or replace function game.city_identity()
returns table (slug text, terroir jsonb, has_port boolean, patron_god_id text, starting_recipe_id text)
language sql stable security definer
set search_path = ''
as $$
  select c ->> 'id', c -> 'terroir', (c -> 'hasPort')::boolean, c ->> 'patronGodId',
         coalesce(c ->> 'startingRecipeId', v.payload -> 'starting' ->> 'siteRecipeId')
  from config.versions v
  cross join lateral jsonb_array_elements(v.payload -> 'cities') c
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.city_identity() from public;
grant execute on function game.city_identity() to authenticated;

create or replace view public.city_identity with (security_invoker = true) as
  select c.id as city_id, c.world_id, c.slug, i.terroir, i.has_port, i.patron_god_id, i.starting_recipe_id
  from game.cities c
  join game.city_identity() i on i.slug = c.slug;

grant select on public.city_identity to authenticated;
