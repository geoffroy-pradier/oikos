-- Fortune d'une maison : marchandises en mer (docs/specs/04-systemes-gestion.md, 4.1 ; ticket 719).
-- Décision (#719) : la cargaison d'un voyage en mer compte dans la fortune, au prix de référence observé du bien dans
-- la cité d'arrivée, où elle entrera au stock de la maison. Sans elle, une maison mettrait son stock en mer juste
-- avant la désignation des liturgies, dont le dû est une part de la fortune, et le sortirait aussi du Gini.
-- Elle s'ajoute à la valeur des stocks (`stock_value`), et une cargaison sans prix observé au compte des stocks sans
-- prix (`unpriced_stocks`) : la fortune n'est plus le total du bilan dès qu'une cargaison est en mer.
-- Mêmes colonnes et mêmes droits que la migration 7180 : le code précédent lit la fonction sans changement, et le
-- remplacement est rejouable. Un voyage arrivé a tout déchargé (contrôle différé du voyage) : il ne compte plus.

create or replace function game.house_wealth(p_world uuid default null)
returns table (
  house_id uuid, world_id uuid, city_id uuid, npc boolean,
  treasury bigint, escrow bigint, stock_value bigint, unpriced_stocks integer, wealth bigint
)
language sql stable security definer
set search_path = ''
as $$
  select h.id, h.world_id, c.city_id, h.kind = 'npc',
         coalesce(t.balance, 0), coalesce(e.balance, 0), s.stock_value, s.unpriced_stocks,
         coalesce(t.balance, 0) + coalesce(e.balance, 0) + s.stock_value
  from game.houses h
  left join game.citizenships c on c.house_id = h.id
  left join game.accounts t on t.house_id = h.id and t.kind = 'house'
  left join game.accounts e on e.house_id = h.id and e.kind = 'escrow'
  cross join lateral (
    -- En numérique jusqu'au total : seul un total hors des entiers de 64 bits échoue, jamais un produit.
    select coalesce(sum(g.quantity::numeric * p.price), 0)::bigint as stock_value,
           (count(*) filter (where p.price is null))::integer as unpriced_stocks
    from (
      select i.city_id, i.good_id, i.quantity
      from game.inventories i
      where i.house_id = h.id and i.quantity > 0
      union all
      select v.to_city_id, k.good_id, k.quantity
      from game.voyages v
      join game.voyage_cargo k on k.voyage_id = v.id
      where v.house_id = h.id and v.arrived_at is null
    ) g
    left join game.observed_prices p on p.city_id = g.city_id and p.good_id = g.good_id
  ) s
  where p_world is null or h.world_id = p_world
  order by h.world_id, h.id;
$$;
revoke all on function game.house_wealth(uuid) from public, anon, authenticated;
grant execute on function game.house_wealth(uuid) to oikos_service;
