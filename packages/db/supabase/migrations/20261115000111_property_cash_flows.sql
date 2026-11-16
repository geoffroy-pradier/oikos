-- Comptes de la maison : natures de l'immobilier (docs/specs/04-systemes-gestion.md, 4.1 ; ticket 256).
-- L'achat d'un bien à la cité (`property.buy`) est une acquisition, hors exploitation, comme celle d'un site
-- ou d'un navire ; sa rénovation (`property.renovate`) est de l'entretien, charge d'exploitation. Rejouable
-- (`create or replace`, colonnes et droits inchangés) ; le code précédent lit les mêmes colonnes.

-- Flux de trésorerie : la migration 82, plus les deux natures de l'immobilier, que `other` rangeait. La
-- rénovation marque déjà son débit `upkeep` (la ligne marquée l'emporte) : sa nature d'écriture ne sert
-- qu'à une ligne sans marqueur. L'entretien quotidien des biens passe par l'écriture `upkeep.daily`, ligne
-- marquée `upkeep`. Le compte de résultat (migration 82) ne change pas : ses colonnes `upkeep` et
-- `acquisitions` reçoivent ces flux.
create or replace view public.my_cash_flows with (security_invoker = true) as
  select house_id, account, game_day, nature, sum(amount)::bigint as amount
  from (
    select a.house_id,
           case a.kind when 'house' then 'treasury' else a.kind end as account,
           ((e.created_at at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
             - date '1970-01-01' as game_day,
           f.nature, f.amount
    from game.accounts a
    join game.ledger_lines l on l.account_id = a.id
    join game.ledger_entries e on e.id = l.entry_id
    left join game.clock_rules() c on true
    left join lateral (
      select sum(t.price * t.quantity) as gross from game.trades t where t.ledger_entry_id = e.id
    ) sale on l.nature is null and l.amount > 0 and e.kind in ('market.trade', 'npc.purchase')
    cross join lateral (values
      (case
         when l.nature is not null then l.nature
         when e.kind in ('market.trade', 'npc.purchase') then case when l.amount > 0 then 'sales' else 'purchases' end
         when e.kind in ('market.escrow_hold', 'market.escrow_release') then 'escrow'
         when e.kind in ('upkeep.daily', 'upkeep.restart', 'property.renovate') then 'upkeep'
         when e.kind in ('site.acquire', 'ship.acquire', 'property.buy') then 'acquisitions'
         when e.kind = 'voyage.departure' then 'transport'
         when e.kind = 'house.starting_grant' then 'grant'
         else 'other'
       end, coalesce(sale.gross, l.amount)),
      ('taxes', l.amount - sale.gross)
    ) f (nature, amount)
    where a.kind in ('house', 'escrow') and f.amount <> 0
  ) flows
  group by house_id, account, game_day, nature
  having sum(amount) <> 0;
