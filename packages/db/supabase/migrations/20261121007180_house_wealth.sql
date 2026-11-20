-- Fortune d'une maison (docs/specs/04-systemes-gestion.md, 4.1 ; 05-economie.md, 5.5 ; ticket 718).
-- Une seule définition sert au Gini du tableau de bord, puis aux liturgies et à l'Hybris : trésorerie, séquestre,
-- et stocks non vides valorisés au prix de référence observé de leur cité, le dernier calculé, comme au bilan
-- (`public.my_balance_sheet`). Un stock sans prix observé n'a pas de valeur ; leur nombre est rendu à côté.
-- Sites, navires et biens immobiliers n'y entrent pas. `packages/sim` calcule la même valeur (`houseWealth`).
--
-- Nature d'une maison : joueur (`player`) ou maison PNJ de secours (`npc`, 8.3, #715), que les classements de
-- fortune écartent. Décision (#718) : la colonne naît ici, avec sa seule valeur `player` pour toute maison
-- existante et pour toute maison fondée par le code précédent, qui ne la nomme pas ; #715 y crée ses maisons.
-- Le service l'écrit à l'insertion (droit de table) et ne la change jamais (aucun droit de mise à jour) ;
-- un joueur connecté ne la lit pas (droits de colonne de la migration 2).
--
-- La fonction est au nom du propriétaire et accordée au seul service : elle lit la monnaie et les stocks de toutes
-- les maisons, qu'aucun joueur ne lit hors de sa maison, et aucune vue exposée ne rend la fortune.
-- `p_world` : un monde, ou tous (`null`). Rejouable ; aucune vue ni colonne existante ne change.

alter table game.houses
  add column if not exists kind text not null default 'player' constraint houses_kind_check check (kind in ('player', 'npc'));

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
    select coalesce(sum(i.quantity::numeric * p.price), 0)::bigint as stock_value,
           (count(*) filter (where p.price is null))::integer as unpriced_stocks
    from game.inventories i
    left join game.observed_prices p on p.city_id = i.city_id and p.good_id = i.good_id
    where i.house_id = h.id and i.quantity > 0
  ) s
  where p_world is null or h.world_id = p_world
  order by h.world_id, h.id;
$$;
revoke all on function game.house_wealth(uuid) from public, anon, authenticated;
grant execute on function game.house_wealth(uuid) to oikos_service;
