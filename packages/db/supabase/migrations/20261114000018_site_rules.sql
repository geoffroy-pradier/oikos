-- Règles des sites lues par le client (docs/specs/04-systemes-gestion.md, 4.1 et 4.2 ; ticket 66).

-- Le client propose des recettes et annonce des prix : il lui faut la configuration en vigueur. Le schéma
-- `config` reste fermé aux clients. Comme pour le carnet d'ordres (migration 10), une fonction du schéma
-- `game`, exécutée au nom du propriétaire, ne rend que deux extraits de la version active, et une vue de
-- `public` la présente : le client lit une vue, comme partout ailleurs.
-- Ces deux extraits sont des règles du jeu connues de tous les joueurs : tout champ ajouté à une recette
-- ou à la section `sites` leur devient visible.
-- `sites` est nul pour une version publiée avant que la section n'existe : le client applique alors les
-- valeurs par défaut du schéma partagé (`packages/config`), comme le fait l'API. Sans version active, la
-- vue ne rend aucune ligne.
create or replace function game.site_rules() returns table (recipes jsonb, sites jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'recipes', v.payload -> 'sites'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.site_rules() from public;
grant execute on function game.site_rules() to authenticated;

create or replace view public.site_rules with (security_invoker = true) as
  select recipes, sites from game.site_rules();

grant select on public.site_rules to authenticated;
