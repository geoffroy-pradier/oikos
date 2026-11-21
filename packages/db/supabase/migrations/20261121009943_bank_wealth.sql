-- Banques de joueurs : fortune et tableau de bord (docs/specs/05-economie.md, 5.5 ; 04-systemes-gestion.md, 4.1 ;
-- 12-modele-donnees.md ; ticket 726).
-- La fortune d'une maison compte le coffre de sa banque ; le tableau de bord lit les coffres de chaque monde
-- (`game.bank_vaults`), que le service ne voit pas dans la table, comme une nature à part de la masse monétaire.
-- Rejouable (fonction nouvelle créée une fois, `create or replace` à colonnes égales, ADR 0006, droits recréés) ;
-- compatible avec le code précédent, qui lit les mêmes colonnes et n'appelle pas `game.bank_vaults`.

-- Coffres de tous les mondes, pour le tableau de bord (5.5), que le service ne voit pas dans la table : lecture seule.
-- Créée une fois (ADR 0006) : une colonne ajoutée par #727 ou #728 ne casse pas le rejeu.
do $do$
begin
  if to_regprocedure('game.bank_vaults()') is null then
    create function game.bank_vaults()
    returns table (world_id uuid, bank_id uuid, account_id uuid, balance bigint)
    language sql stable security definer
    set search_path = ''
    as $body$
      select a.world_id, a.bank_id, a.id, a.balance from game.accounts a where a.bank_id is not null order by a.world_id, a.bank_id;
    $body$;
  end if;
end $do$;
revoke all on function game.bank_vaults() from public, anon, authenticated;
grant execute on function game.bank_vaults() to oikos_service;

-- Fortune d'une maison : la migration 9912, plus le coffre de sa banque, net de ses dépôts (#727 les déduira ; aucun
-- avant). Mêmes colonnes et mêmes droits (ADR 0006) : le coffre n'a pas de colonne à lui, la fortune le compte.
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
         coalesce(t.balance, 0) + coalesce(e.balance, 0) + s.stock_value - d.debt + coalesce(vt.balance, 0)
  from game.houses h
  left join game.citizenships c on c.house_id = h.id
  left join game.accounts t on t.house_id = h.id and t.kind = 'house'
  left join game.accounts e on e.house_id = h.id and e.kind = 'escrow'
  left join game.banks b on b.house_id = h.id
  left join game.accounts vt on vt.bank_id = b.id
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
  cross join lateral (
    select coalesce(sum(o.outstanding), 0)::bigint as debt
    from game.loans o
    where o.borrower_house_id = h.id and o.status <> 'repaid'
  ) d
  where p_world is null or h.world_id = p_world
  order by h.world_id, h.id;
$$;
revoke all on function game.house_wealth(uuid) from public, anon, authenticated;
grant execute on function game.house_wealth(uuid) to oikos_service;
