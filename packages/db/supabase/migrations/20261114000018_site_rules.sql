-- Règles des sites lues par le client (docs/specs/04-systemes-gestion.md, 4.1 et 4.2 ; ticket 66).

-- Le client propose des recettes et annonce des prix : il lui faut la configuration en vigueur. Le schéma
-- `config` reste fermé aux clients ; cette fonction n'en rend que deux extraits de la version active, qui
-- sont des règles du jeu connues de tous les joueurs. `sites` est nul pour une version publiée avant que
-- la section n'existe : le client applique alors les valeurs par défaut du schéma partagé
-- (`packages/config`), comme le fait l'API.
create or replace function public.site_rules() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'configVersionId', v.id,
    'recipes', v.payload -> 'recipes',
    'sites', v.payload -> 'sites')
  from config.versions v
  where v.id = config.active_version_at(now());
$$;

revoke all on function public.site_rules() from public, anon;
grant execute on function public.site_rules() to authenticated;
