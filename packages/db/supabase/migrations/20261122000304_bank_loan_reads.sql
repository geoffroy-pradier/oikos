-- Banques de joueurs : lectures des prêts gagés, natures et fortune (docs/specs/05-economie.md, 5.4 ;
-- 04-systemes-gestion.md, 4.1 ; 12-modele-donnees.md ; ticket 728).
-- Une maison lit les offres qu'elle a reçues (`my_loan_offers`) et celles que sa banque a faites (`my_bank_loan_offers`),
-- les prêts de sa banque (`my_bank_loans`, et leur reste dû total dans `my_bank`) et la banque de ses propres prêts
-- (`my_loans`). Aucune autre maison ne lit ni une offre ni un prêt. Ses comptes rangent un prêt de banque comme un prêt
-- du temple (natures `loans` et `interest`) ; sa fortune déduit ce qu'elle doit et compte ce que sa banque a prêté.
-- Rejouable (règles et droits recréés, vues et fonctions nouvelles créées une fois, extensions sous condition, ADR 0006,
-- `create or replace` à colonnes égales) ; compatible avec le code précédent, qui lit les mêmes colonnes.

-- Une offre se lit par son emprunteur et par la maison de sa banque, rien d'autre ; un visiteur anonyme ne lit rien.
drop policy if exists bank_loan_offers_read_borrower on game.bank_loan_offers;
create policy bank_loan_offers_read_borrower on game.bank_loan_offers for select to authenticated
  using (borrower_house_id in (select game.current_house_ids()));
drop policy if exists bank_loan_offers_read_bank on game.bank_loan_offers;
create policy bank_loan_offers_read_bank on game.bank_loan_offers for select to authenticated
  using (bank_id in (select b.id from game.banks b where b.house_id in (select game.current_house_ids())));
grant select (id, world_id, bank_id, borrower_house_id, principal, rate_bps, term_days, collateral_kind,
  collateral_city_id, collateral_good_id, collateral_quantity, collateral_property_id, status, created_at, closed_at)
  on game.bank_loan_offers to authenticated;
-- L'emprunteur lit la banque et l'offre de ses prêts ; la règle par ligne de la migration 9912 ne change pas.
grant select (bank_id, offer_id) on game.loans to authenticated;

create index if not exists loans_bank_idx on game.loans (bank_id, created_at) where bank_id is not null;
-- Prêts de la banque de la maison, au nom du propriétaire : la règle par ligne des prêts ne les montre qu'à leur
-- emprunteur. Conditions, remboursements, reste dû, état et garantie ; créée une fois (ADR 0006).
do $do$
begin
  if to_regprocedure('game.my_bank_loans()') is null then
    create function game.my_bank_loans()
    returns table (
      id uuid, world_id uuid, bank_id uuid, borrower_house_id uuid, principal bigint, rate_bps integer, term_days integer,
      interest bigint, borrowed_day integer, due_day integer, due_at timestamptz, principal_repaid bigint,
      interest_repaid bigint, outstanding bigint, status text, defaulted_day integer, offer_id uuid,
      collateral_kind text, collateral_city_id uuid, collateral_good_id text, collateral_quantity bigint,
      collateral_property_id uuid, created_at timestamptz
    )
    language sql stable security definer
    set search_path = ''
    as $body$
      select o.id, o.world_id, o.bank_id, o.borrower_house_id, o.principal, o.rate_bps, o.term_days, o.interest,
             o.borrowed_day, o.due_day, o.due_at, o.principal_repaid, o.interest_repaid, o.outstanding, o.status,
             o.defaulted_day, o.offer_id, f.collateral_kind, f.collateral_city_id, f.collateral_good_id,
             f.collateral_quantity, f.collateral_property_id, o.created_at
      from game.loans o
      join game.bank_loan_offers f on f.id = o.offer_id
      join game.banks b on b.id = o.bank_id
      where b.house_id in (select game.current_house_ids());
    $body$;
  end if;
end $do$;
revoke all on function game.my_bank_loans() from public, anon, oikos_service;
grant execute on function game.my_bank_loans() to authenticated;

-- Banque de la maison (migration 9993), plus le reste dû de ses prêts non remboursés, intérêts compris : la fonction et
-- la vue, créées une fois, gagnent une colonne une fois.
do $do$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'my_bank' and column_name = 'loans') then
    drop view if exists public.my_bank;
    drop function if exists game.my_bank();
    create function game.my_bank()
    returns table (
      id uuid, world_id uuid, city_id uuid, house_id uuid, name text, deposit_rate_bps integer, loan_rate_bps integer,
      founded_at timestamptz, vault bigint, required_reserve bigint, deposits bigint, depositors integer, loans bigint
    )
    language sql stable security definer
    set search_path = ''
    as $body$
      select b.id, b.world_id, b.city_id, b.house_id, b.name, b.deposit_rate_bps, b.loan_rate_bps, b.founded_at, a.balance,
             case when r.min_capital_oboles is not null then
               greatest(r.min_capital_oboles, ceil(k.total::numeric * r.reserve_ratio_bps / 10000)::bigint) end,
             k.total, k.depositors,
             (select coalesce(sum(o.outstanding), 0)::bigint from game.loans o where o.bank_id = b.id and o.status <> 'repaid')
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
             deposits, depositors, loans
      from game.my_bank();
  end if;
  -- Prêts de la maison (migration 9922), plus leur banque, en fin de colonnes.
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'my_loans' and column_name = 'bank_id') then
    create or replace view public.my_loans with (security_invoker = true) as
      select id, world_id, lender, borrower_house_id as house_id, principal, rate_bps, term_days, interest, borrowed_day,
             due_day, due_at, principal_repaid, interest_repaid, outstanding, status, created_at, defaulted_day, bank_id
      from game.loans;
  end if;
  -- Offres reçues par la maison, avec leur banque ; offres faites par sa banque. Vues créées une fois (ADR 0006).
  if to_regclass('public.my_loan_offers') is null then
    create view public.my_loan_offers with (security_invoker = true) as
      select o.id, o.world_id, o.bank_id, b.name as bank_name, b.city_id as bank_city_id, o.borrower_house_id as house_id,
             o.principal, o.rate_bps, o.term_days, ceil(o.principal::numeric * o.rate_bps * o.term_days / 3650000)::bigint
               as interest, o.collateral_kind, o.collateral_city_id, o.collateral_good_id, o.collateral_quantity,
             o.collateral_property_id, o.status, o.created_at, o.closed_at
      from game.bank_loan_offers o
      join game.banks b on b.id = o.bank_id
      where o.borrower_house_id in (select game.current_house_ids());
  end if;
  if to_regclass('public.my_bank_loan_offers') is null then
    create view public.my_bank_loan_offers with (security_invoker = true) as
      select o.id, o.world_id, o.bank_id, o.borrower_house_id, o.principal, o.rate_bps, o.term_days,
             ceil(o.principal::numeric * o.rate_bps * o.term_days / 3650000)::bigint as interest, o.collateral_kind,
             o.collateral_city_id, o.collateral_good_id, o.collateral_quantity, o.collateral_property_id, o.status,
             o.created_at, o.closed_at
      from game.bank_loan_offers o
      join game.banks b on b.id = o.bank_id
      where b.house_id in (select game.current_house_ids());
  end if;
  if to_regclass('public.my_bank_loans') is null then
    create view public.my_bank_loans with (security_invoker = true) as select * from game.my_bank_loans();
  end if;
end $do$;
revoke all on function game.my_bank() from public, anon, oikos_service;
grant execute on function game.my_bank() to authenticated;
revoke all on public.my_bank, public.my_loans, public.my_loan_offers, public.my_bank_loan_offers, public.my_bank_loans
  from public, anon;
grant select on public.my_bank, public.my_loans, public.my_loan_offers, public.my_bank_loan_offers, public.my_bank_loans
  to authenticated;

-- Flux de trésorerie : la migration 9993, plus les prêts de banque, décaissement et remboursements, partagés comme ceux
-- du temple entre les natures `loans` et `interest`.
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
      on rep.ledger_entry_id = e.id and a.kind = 'house'
         and e.kind in ('loan.repay', 'loan.collect', 'bank.loan_repay', 'bank.loan_collect')
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
         when e.kind in ('loan.temple_disburse', 'loan.repay', 'loan.collect', 'bank.loan_disburse', 'bank.loan_repay',
                         'bank.loan_collect') then 'loans'
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

-- Fortune d'une maison : la migration 9993, moins ce qu'elle doit à tout prêteur (déjà déduit), plus ce que sa banque a
-- prêté et qu'on lui doit encore, intérêts compris : un prêt de banque compte une fois de chaque côté. Mêmes colonnes
-- et mêmes droits (ADR 0006).
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
           + d.lent
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
    -- Prêts : ce que la maison doit, de tout prêteur ; ce que sa banque a prêté et qu'on lui doit encore.
    select coalesce(sum(o.outstanding) filter (where o.borrower_house_id = h.id), 0)::bigint as debt,
           coalesce(sum(o.outstanding) filter (where o.bank_id = b.id), 0)::bigint as lent
    from game.loans o
    where (o.borrower_house_id = h.id or o.bank_id = b.id) and o.status <> 'repaid'
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
