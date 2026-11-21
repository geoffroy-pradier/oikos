-- Banques de joueurs : lectures des dépôts, natures et fortune (docs/specs/05-economie.md, 5.4 ; 04-systemes-gestion.md,
-- 4.1 ; 12-modele-donnees.md ; ticket 727).
-- Un déposant lit ses dépôts (`my_deposits`) et aucun autre ; le banquier lit le total et le nombre des dépôts de sa
-- banque (`my_bank`), sans le nom d'aucun déposant, et sa réserve exigée en compte la part. Les comptes d'une maison
-- rangent ses dépôts et retraits hors exploitation (`bank_deposits`) ; sa fortune compte ses dépôts et déduit du coffre
-- de sa banque ce qu'elle doit à ses déposants.
-- Rejouable (règle et droits recréés, vue nouvelle et extension de `my_bank` sous condition, ADR 0006, `create or
-- replace` à colonnes égales) ; compatible avec le code précédent, qui lit les mêmes colonnes.

-- Un dépôt ne se lit que par son déposant.
drop policy if exists bank_deposits_read_own on game.bank_deposits;
create policy bank_deposits_read_own on game.bank_deposits for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, world_id, bank_id, house_id, balance, created_at) on game.bank_deposits to authenticated;

-- Banque de la maison (migration 9942), plus le total et le nombre des dépôts non vides, et la réserve exigée qui en
-- compte la part (`bankRequiredReserve`) : la fonction et la vue, créées une fois, gagnent deux colonnes une fois.
do $do$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'my_bank' and column_name = 'deposits') then
    drop view if exists public.my_bank;
    drop function if exists game.my_bank();
    create function game.my_bank()
    returns table (
      id uuid, world_id uuid, city_id uuid, house_id uuid, name text, deposit_rate_bps integer, loan_rate_bps integer,
      founded_at timestamptz, vault bigint, required_reserve bigint, deposits bigint, depositors integer
    )
    language sql stable security definer
    set search_path = ''
    as $body$
      select b.id, b.world_id, b.city_id, b.house_id, b.name, b.deposit_rate_bps, b.loan_rate_bps, b.founded_at, a.balance,
             case when r.min_capital_oboles is not null then
               greatest(r.min_capital_oboles, ceil(k.total::numeric * r.reserve_ratio_bps / 10000)::bigint) end,
             k.total, k.depositors
      from game.banks b
      join game.accounts a on a.bank_id = b.id
      left join game.bank_rules() r on true
      cross join lateral (
        select coalesce(sum(x.balance), 0)::bigint as total, (count(*) filter (where x.balance > 0))::integer as depositors
        from game.bank_deposits x where x.bank_id = b.id
      ) k
      where b.house_id in (select game.current_house_ids());
    $body$;
    create view public.my_bank with (security_invoker = true) as
      select id, world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, founded_at, vault, required_reserve,
             deposits, depositors
      from game.my_bank();
  end if;
  -- Dépôts de la maison, avec leur banque et son taux affiché : vue créée une fois (ADR 0006).
  if to_regclass('public.my_deposits') is null then
    create view public.my_deposits with (security_invoker = true) as
      select d.id, d.world_id, d.bank_id, b.name as bank_name, b.city_id, b.deposit_rate_bps, d.house_id, d.balance,
             d.created_at
      from game.bank_deposits d
      join game.banks b on b.id = d.bank_id;
  end if;
end $do$;
revoke all on function game.my_bank() from public, anon, oikos_service;
grant execute on function game.my_bank() to authenticated;
revoke all on public.my_bank, public.my_deposits from public, anon;
grant select on public.my_bank, public.my_deposits to authenticated;

-- Flux de trésorerie : la migration 9942, plus les dépôts et les retraits (`bank_deposits`), négatifs et positifs,
-- que le compte de résultat range dans `other`, hors exploitation, sans changer sa définition (ADR 0006).
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
    left join game.loan_repayments rep
      on rep.ledger_entry_id = e.id and e.kind in ('loan.repay', 'loan.collect') and a.kind = 'house'
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
         when e.kind in ('loan.temple_disburse', 'loan.repay', 'loan.collect') then 'loans'
         when e.kind = 'bank.charter' then 'bank_charter'
         when e.kind in ('bank.capital_in', 'bank.capital_out') then 'bank_capital'
         when e.kind in ('bank.deposit', 'bank.withdraw') then 'bank_deposits'
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

-- Fortune d'une maison : la migration 9943, plus ses dépôts, et moins ce que sa banque doit à ses déposants. Un dépôt
-- compte une fois ; l'intérêt passe du banquier au déposant. Mêmes colonnes et mêmes droits (ADR 0006).
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
         coalesce(t.balance, 0) + coalesce(e.balance, 0) + s.stock_value - d.debt + coalesce(vt.balance, 0) - k.owed + k.held
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
  cross join lateral (
    -- Dépôts : ceux de la maison, une créance ; ceux que sa banque doit, déduits de son coffre.
    select coalesce(sum(x.balance) filter (where x.house_id = h.id), 0)::bigint as held,
           coalesce(sum(x.balance) filter (where x.bank_id = b.id), 0)::bigint as owed
    from game.bank_deposits x
    where x.house_id = h.id or x.bank_id = b.id
  ) k
  where p_world is null or h.world_id = p_world
  order by h.world_id, h.id;
$$;
revoke all on function game.house_wealth(uuid) from public, anon, authenticated;
grant execute on function game.house_wealth(uuid) to oikos_service;
