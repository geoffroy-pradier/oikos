-- Comptes de la maison : nature `transport` (docs/specs/04-systemes-gestion.md, 4.1 ; ticket 252). Le départ
-- d'un voyage paie provisions et droit de port par une écriture `voyage.departure`, charge d'exploitation.
-- Rejouable (`create or replace`, colonnes et droits inchangés) ; le code précédent lit les mêmes colonnes.

-- Flux de trésorerie : la migration 60, plus la nature `transport` des écritures `voyage.departure`, que
-- `other` rangeait jusque-là. Chaque ligne reste comptée une fois et en entier.
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
         when e.kind in ('upkeep.daily', 'upkeep.restart') then 'upkeep'
         when e.kind in ('site.acquire', 'ship.acquire') then 'acquisitions'
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

-- Compte de résultat : la migration 60, transport compris. Ses colonnes sont figées (ADR 0006) : la
-- migration 33 le recrée tel quel au rejeu. Le transport y est donc une charge d'exploitation comptée
-- dans la colonne `upkeep`, qui devient celle des charges courantes (entretien des sites et des navires,
-- salaires, transport) ; `my_cash_flows` en donne le détail par nature. Le transport n'est plus dans
-- `other`, hors exploitation.
create or replace view public.my_income_statement with (security_invoker = true) as
  select d.house_id, d.game_day, d.season, d.sales, d.purchases, d.taxes, d.upkeep,
         d.sales + d.purchases + d.taxes + d.upkeep as operating_result,
         d.acquisitions, d.grants, d.other, d.acquisitions + d.grants + d.other as non_operating,
         d.cash_change, d.escrow_change
  from (
    select f.house_id, f.game_day,
           case when c.season_days > 0
             then floor((f.game_day - (date '1970-01-05' - date '1970-01-01'))::numeric / c.season_days)::integer
           end as season,
           coalesce(sum(f.amount) filter (where f.nature = 'sales'), 0)::bigint as sales,
           coalesce(sum(f.amount) filter (where f.nature = 'purchases'), 0)::bigint as purchases,
           coalesce(sum(f.amount) filter (where f.nature = 'taxes'), 0)::bigint as taxes,
           coalesce(sum(f.amount) filter (where f.nature in ('upkeep', 'wages', 'transport')), 0)::bigint as upkeep,
           coalesce(sum(f.amount) filter (where f.nature = 'acquisitions'), 0)::bigint as acquisitions,
           coalesce(sum(f.amount) filter (where f.nature = 'grant'), 0)::bigint as grants,
           coalesce(sum(f.amount) filter (where f.nature not in
             ('sales', 'purchases', 'taxes', 'upkeep', 'wages', 'transport', 'acquisitions', 'grant')), 0)::bigint as other,
           sum(f.amount)::bigint as cash_change,
           coalesce(sum(f.amount) filter (where f.account = 'escrow'), 0)::bigint as escrow_change
    from public.my_cash_flows f
    left join game.clock_rules() c on true
    group by f.house_id, f.game_day, c.season_days
  ) d;
