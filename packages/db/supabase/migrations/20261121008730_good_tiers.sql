-- Niveau des biens lu par le client (docs/specs/05-economie.md, 5.1 ; docs/specs/10-ux-ui.md ; ticket 873).
-- Un bien sans pictogramme propre prend celui de son niveau (#708) : le client doit connaître ce niveau, y compris
-- pour un bien ajouté par Olympe. Même montage que `site_rules` (migration 18) : le schéma `config` reste fermé ;
-- `game.good_tiers()`, exécutée au nom du propriétaire, ne rend que l'identifiant et le niveau de chaque bien de la
-- version en vigueur, et `public.good_tiers` les présente, une ligne par bien. Ni le prix de référence ni
-- l'élasticité ne sortent. Sans version en vigueur, aucune ligne.
-- Décision (ambiguïté du ticket, « configuration en vigueur du monde du joueur ») : la configuration est globale
-- (3, « Temps et horloges »), sa version en vigueur est celle de tous les mondes. La vue ne filtre donc pas par
-- monde : tout joueur connecté la lit, comme les autres règles publiques (`site_rules`, dont les recettes nomment
-- déjà ces biens). Un compte sans maison la lit aussi : elle ne dit rien d'un monde ni d'une maison.
-- Un élément du catalogue sans identifiant ou sans niveau textuels est écarté : le client garde alors la caisse.
-- Rejouable : fonction et vue créées sous condition (ADR 0006), droits redonnés ; le code précédent ne les lit pas.
do $do$
begin
  if to_regprocedure('game.good_tiers()') is null then
    create function game.good_tiers() returns table (good_id text, tier text)
    language sql stable security definer
    set search_path = ''
    as $$
      select g ->> 'id', g ->> 'tier'
      from config.versions v
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(v.payload -> 'goods') = 'array' then v.payload -> 'goods' else '[]'::jsonb end) g
      where v.id = config.active_version_at(now())
        and jsonb_typeof(g -> 'id') = 'string' and jsonb_typeof(g -> 'tier') = 'string';
    $$;
  end if;
  if to_regclass('public.good_tiers') is null then
    create view public.good_tiers with (security_invoker = true) as
      select good_id, tier from game.good_tiers();
  end if;
end $do$;
revoke all on function game.good_tiers() from public, anon, authenticated, oikos_service, service_role;
grant execute on function game.good_tiers() to authenticated;
-- Les droits par défaut de Supabase donnent tout à `service_role` sur une vue de `public` : l'API ne lit pas celle-ci.
revoke all on public.good_tiers from public, anon, authenticated, oikos_service, service_role;
grant select on public.good_tiers to authenticated;
