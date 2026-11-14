-- Règles de marché lues par le client (docs/specs/05-economie.md, 5.3 ; ticket 70).

-- Avant de placer une vente, le client annonce le net attendu : il lui faut la taxe de marché en vigueur.
-- Même montage que `site_rules` (migration 18) : le schéma `config` reste fermé aux clients ; une fonction
-- du schéma `game`, exécutée au nom du propriétaire, ne rend que la section `marketTax` de la version
-- active, et une vue de `public` la présente. Cette section est une règle du jeu connue de tous les
-- joueurs : tout champ qu'on y ajoute leur devient visible. Rien d'autre de la configuration n'est rendu
-- (budgets et prix de réserve des PNJ restent cachés).
-- `market_tax` est nul pour une version publiée avant la taxe : le client applique alors la valeur par
-- défaut du schéma partagé (`packages/config`, taux nul), comme le font l'API et le moteur. Sans version
-- active, la vue ne rend aucune ligne.
create or replace function game.market_rules() returns table (market_tax jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'marketTax'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.market_rules() from public;
grant execute on function game.market_rules() to authenticated;

create or replace view public.market_rules with (security_invoker = true) as
  select market_tax from game.market_rules();

grant select on public.market_rules to authenticated;
