-- Prêts : lectures, natures des comptes et fortune (docs/specs/05-economie.md, 5.4 ; 04-systemes-gestion.md, 4.1 ;
-- 12-modele-donnees.md ; ticket 724).
-- Une maison lit ses prêts et ses remboursements (`my_loans`), tout joueur connecté les règles du Trésor du temple
-- (`temple_treasury_rules`). Ses comptes rangent le principal emprunté et remboursé dans la nature `loans`, hors
-- exploitation, et les intérêts dans la nature `interest`, en charges courantes ; sa fortune déduit le reste dû.
-- Rejouable (règles et droits recréés, `create or replace` à colonnes égales, vues nouvelles créées une fois) ;
-- compatible avec le code précédent, qui lit les mêmes colonnes.

-- Lectures des joueurs connectés : une dette est une part de la fortune (4.1), qu'aucun joueur ne lit hors de sa maison.
-- Une maison lit ses prêts et ses remboursements, et rien d'une autre ; un visiteur anonyme ne lit rien.
drop policy if exists loans_read_own on game.loans;
create policy loans_read_own on game.loans for select to authenticated
  using (borrower_house_id in (select game.current_house_ids()));
drop policy if exists loan_repayments_read_own on game.loan_repayments;
create policy loan_repayments_read_own on game.loan_repayments for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day, due_day,
  due_at, principal_repaid, interest_repaid, outstanding, status, created_at) on game.loans to authenticated;
grant select (id, loan_id, house_id, interest, principal, game_day, ledger_entry_id, created_at)
  on game.loan_repayments to authenticated;

-- Règles du Trésor du temple en vigueur : taux directeur, durées admises et paliers de Timè (`jsonb`, tels que la
-- configuration les écrit). Règles du jeu connues de tous, comme `decree_rules` ; sans section, aucune ligne.
create or replace function game.temple_treasury_rules()
returns table (policy_rate_bps integer, term_days jsonb, principal_caps jsonb)
language sql stable security definer
set search_path = ''
as $$
  select (t ->> 'policyRateBps')::integer, t -> 'termDays', t -> 'principalCaps'
  from config.versions v
  cross join lateral (select v.payload -> 'templeTreasury' as t) section
  where v.id = config.active_version_at(now()) and jsonb_typeof(section.t) = 'object';
$$;
revoke all on function game.temple_treasury_rules() from public;
grant execute on function game.temple_treasury_rules() to authenticated;

-- Vues créées une fois (ADR 0006) : rejouée, la migration ne les recrée pas, et #725 ou #728 pourront les étendre.
do $$
begin
  if to_regclass('public.my_loans') is null then
    create view public.my_loans with (security_invoker = true) as
      select id, world_id, lender, borrower_house_id as house_id, principal, rate_bps, term_days, interest, borrowed_day,
             due_day, due_at, principal_repaid, interest_repaid, outstanding, status, created_at
      from game.loans;
  end if;
  if to_regclass('public.temple_treasury_rules') is null then
    create view public.temple_treasury_rules with (security_invoker = true) as
      select policy_rate_bps, term_days, principal_caps from game.temple_treasury_rules();
  end if;
end $$;
revoke all on public.my_loans, public.temple_treasury_rules from public, anon;
grant select on public.my_loans, public.temple_treasury_rules to authenticated;

-- Flux de trésorerie : la migration 9730, plus la nature `loans` (principal décaissé, positif, et remboursé, négatif)
-- et la nature `interest` (intérêts payés) d'une écriture `loan.repay`, dont le remboursement donne le partage.
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
      select case when e.kind = 'property.sale'
        then (select o.price_oboles from game.property_listings o where o.ledger_entry_id = e.id)
        else (select sum(t.price * t.quantity) from game.trades t where t.ledger_entry_id = e.id)
      end as gross
    ) sale on l.nature is null and l.amount > 0 and e.kind in ('market.trade', 'npc.purchase', 'property.sale')
    left join game.loan_repayments rep on rep.ledger_entry_id = e.id and e.kind = 'loan.repay' and a.kind = 'house'
    cross join lateral (values
      (case
         when l.nature is not null then l.nature
         when e.kind in ('market.trade', 'npc.purchase') then case when l.amount > 0 then 'sales' else 'purchases' end
         when e.kind in ('market.escrow_hold', 'market.escrow_release') then 'escrow'
         when e.kind in ('upkeep.daily', 'upkeep.restart', 'property.renovate') then 'upkeep'
         when e.kind in ('lodging.daily', 'lodging.restart') then 'lodging'
         when e.kind in ('site.acquire', 'ship.acquire', 'property.buy', 'property.sale') then 'acquisitions'
         when e.kind = 'lease.rent' then 'rents'
         when e.kind in ('temple.offering', 'temple.oracle') then 'offerings'
         when e.kind in ('liturgy.perform', 'liturgy.levy') then 'liturgies'
         when e.kind in ('loan.temple_disburse', 'loan.repay') then 'loans'
         when e.kind = 'voyage.departure' then 'transport'
         when e.kind = 'house.starting_grant' then 'grant'
         else 'other'
       end, coalesce(sale.gross, l.amount + coalesce(rep.interest, 0))),
      ('taxes', l.amount - sale.gross),
      ('interest', -rep.interest)
    ) f (nature, amount)
    where a.kind in ('house', 'escrow') and f.amount <> 0
  ) flows
  group by house_id, account, game_day, nature
  having sum(amount) <> 0;

-- Compte de résultat : la migration 160, les intérêts en charges courantes (`upkeep`), à colonnes égales (ADR 0006) ;
-- le principal tombe dans `other`, hors exploitation. La vue par saison (migration 33) en dérive sans changer.
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
           coalesce(sum(f.amount) filter (where f.nature = 'sales' or (f.nature = 'rents' and f.amount > 0)), 0)::bigint as sales,
           coalesce(sum(f.amount) filter (where f.nature = 'purchases'), 0)::bigint as purchases,
           coalesce(sum(f.amount) filter (where f.nature = 'taxes'), 0)::bigint as taxes,
           coalesce(sum(f.amount) filter (where f.nature in ('upkeep', 'wages', 'lodging', 'transport', 'interest')
             or (f.nature = 'rents' and f.amount < 0)), 0)::bigint as upkeep,
           coalesce(sum(f.amount) filter (where f.nature = 'acquisitions'), 0)::bigint as acquisitions,
           coalesce(sum(f.amount) filter (where f.nature = 'grant'), 0)::bigint as grants,
           coalesce(sum(f.amount) filter (where f.nature not in
             ('sales', 'purchases', 'taxes', 'upkeep', 'wages', 'lodging', 'transport', 'interest', 'rents', 'acquisitions',
              'grant')), 0)::bigint as other,
           sum(f.amount)::bigint as cash_change,
           coalesce(sum(f.amount) filter (where f.account = 'escrow'), 0)::bigint as escrow_change
    from public.my_cash_flows f
    left join game.clock_rules() c on true
    group by f.house_id, f.game_day, c.season_days
  ) d;


-- Fortune d'une maison : la migration 9719, moins le reste dû de ses prêts, principal et intérêts, en cours ou en
-- défaut (4.1). Mêmes colonnes et mêmes droits (ADR 0006) : la dette n'a pas de colonne à elle, elle se lit dans
-- `my_loans` et la fortune peut être négative, ce que le Gini compte pour zéro (5.5).
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
         coalesce(t.balance, 0) + coalesce(e.balance, 0) + s.stock_value - d.debt
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
