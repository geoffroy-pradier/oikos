-- Règles de marché lues par le client : durée des chandeliers et fenêtre du prix observé (ticket 71).
-- Après un changement de durée, deux séries de chandeliers coexistent et se recouvrent dans le temps : le
-- client ne peut pas deviner laquelle est en cours, il lui faut la durée de la version en vigueur. Même
-- montage que la taxe (migration 21) : la fonction ne rend, en plus, que la section `priceHistory`, règle
-- publique dont tout champ ajouté devient visible des joueurs. `price_history` est nul pour une version
-- publiée avant l'historique : le client applique alors la valeur par défaut du schéma partagé.
-- Le type rendu change : la fonction et sa vue sont recréées, dans la transaction de la migration. Le
-- client précédent ne lit que `market_tax`, toujours rendue.
drop view if exists public.market_rules;
drop function if exists game.market_rules();
create function game.market_rules() returns table (market_tax jsonb, price_history jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'marketTax', v.payload -> 'priceHistory'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.market_rules() from public;
grant execute on function game.market_rules() to authenticated;

create view public.market_rules with (security_invoker = true) as
  select market_tax, price_history from game.market_rules();

grant select on public.market_rules to authenticated;
