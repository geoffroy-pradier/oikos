-- Nature d'une ligne du grand livre (docs/specs/04-systemes-gestion.md, 4.1 ; ticket 255). Une écriture
-- `upkeep.daily` ou `upkeep.restart` porte désormais une ligne de débit de la trésorerie par nature
-- (entretien, salaires, puis hébergement avec #258) : les comptes de la maison les distinguent par ce
-- marqueur, lu quand il est présent, sinon par la nature de l'écriture comme avant.

-- Marqueur facultatif, pris dans une liste fermée tenue par la base. Les lignes existantes restent sans
-- marqueur (nul), et le code précédent, qui n'en écrit pas, reste servi. Le grand livre est en ajout seul
-- (migration 4) : le marqueur s'écrit à l'insertion et ne change plus. Un ticket qui ajoute une nature
-- recrée la contrainte avec la liste étendue (et `LEDGER_LINE_NATURES`, packages/sim).
alter table game.ledger_lines add column if not exists nature text;
alter table game.ledger_lines drop constraint if exists ledger_lines_nature_known;
alter table game.ledger_lines add constraint ledger_lines_nature_known check (nature in ('upkeep', 'wages'));
-- Un joueur lit la nature de ses propres lignes, sous la règle par ligne de la migration 32.
grant select (nature) on game.ledger_lines to authenticated;

-- Flux de trésorerie : la migration 32, avec l'achat d'un navire en acquisition comme la migration 51
-- (ticket 251), à une différence près. Une ligne marquée prend la nature de son marqueur ; elle n'est
-- alors ni une vente ni un achat de l'agora, et n'a pas de taxe à part. Une ligne sans marqueur est
-- classée comme avant. Chaque ligne reste comptée une fois et en entier.
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
         when e.kind = 'house.starting_grant' then 'grant'
         else 'other'
       end, coalesce(sale.gross, l.amount)),
      ('taxes', l.amount - sale.gross)
    ) f (nature, amount)
    where a.kind in ('house', 'escrow') and f.amount <> 0
  ) flows
  group by house_id, account, game_day, nature
  having sum(amount) <> 0;

-- Compte de résultat : la migration 33, salaires compris. Ses colonnes ne changent pas : la migration
-- 33 la recrée telle quelle (`create or replace view`) quand la suite est rejouée, ce qu'une colonne de
-- plus rendrait impossible. Les salaires y sont donc une charge d'exploitation comptée avec l'entretien,
-- dans `upkeep`, qui devient le dû quotidien des sites (entretien et salaires) ; le détail par nature
-- reste dans `my_cash_flows`. `my_income_statement_by_season`, qui en somme les colonnes, suit.
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
           coalesce(sum(f.amount) filter (where f.nature in ('upkeep', 'wages')), 0)::bigint as upkeep,
           coalesce(sum(f.amount) filter (where f.nature = 'acquisitions'), 0)::bigint as acquisitions,
           coalesce(sum(f.amount) filter (where f.nature = 'grant'), 0)::bigint as grants,
           coalesce(sum(f.amount) filter (where f.nature not in
             ('sales', 'purchases', 'taxes', 'upkeep', 'wages', 'acquisitions', 'grant')), 0)::bigint as other,
           sum(f.amount)::bigint as cash_change,
           coalesce(sum(f.amount) filter (where f.account = 'escrow'), 0)::bigint as escrow_change
    from public.my_cash_flows f
    left join game.clock_rules() c on true
    group by f.house_id, f.game_day, c.season_days
  ) d;
