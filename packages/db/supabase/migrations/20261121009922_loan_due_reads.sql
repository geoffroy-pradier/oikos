-- Prêts : marque de déshonneur et lectures de l'échéance (docs/specs/05-economie.md, 5.4 ; 04-systemes-gestion.md,
-- 4.1 ; 12-modele-donnees.md ; ticket 725).
-- La marque de déshonneur d'une maison se lit avec sa Timè, publique (`house_honor`) : portée tant qu'un de ses prêts
-- est en défaut, puis jusqu'à la clôture `templeTreasury.dishonorDays` jours de jeu après le solde du dernier prêt qui
-- l'a été (`dishonorMark`). Une maison lit le jour du défaut de ses prêts (`my_loans`) ; ses comptes rangent un
-- prélèvement de la clôture comme un remboursement.
-- Rejouable (vues étendues sous condition, `create or replace` à colonnes égales, ADR 0006, droits recréés) ;
-- compatible avec le code précédent, qui lit les mêmes colonnes.

-- Marque de chaque maison marquée des mondes du compte connecté : en défaut, ou jusqu'au jour `dishonored_until_day`
-- exclu, le jour du solde (celui de son dernier remboursement) plus `dishonorDays`, zéro pour une version qui ne le donne
-- pas (#725). Au nom du propriétaire : un joueur ne lit pas les prêts d'une autre maison, mais sa marque est publique ;
-- rien d'autre d'un prêt n'en sort.
create or replace function game.house_dishonor()
returns table (house_id uuid, dishonored boolean, dishonored_until_day integer)
language sql stable security definer
set search_path = ''
as $$
  with marks as (
    select o.borrower_house_id as house_id, bool_or(o.status = 'defaulted') as open,
           max(r.game_day) filter (where o.status = 'repaid' and o.defaulted_day is not null) as repaid_day
    from game.loans o
    left join lateral (select max(p.game_day) as game_day from game.loan_repayments p where p.loan_id = o.id) r
      on o.status = 'repaid'
    where o.world_id in (select game.current_world_ids()) and (o.status = 'defaulted' or o.defaulted_day is not null)
    group by o.borrower_house_id
  ), ends as (
    select m.house_id, m.open,
           m.repaid_day + coalesce((select (v.payload -> 'templeTreasury' ->> 'dishonorDays')::integer
             from config.versions v where v.id = config.active_version_at(now())), 0) as until_day
    from marks m
  )
  select e.house_id, e.open or coalesce(game.game_day_at(now()) < e.until_day, false),
         case when not e.open and game.game_day_at(now()) < e.until_day then e.until_day end
  from ends e
  where e.open or game.game_day_at(now()) < e.until_day;
$$;
revoke all on function game.house_dishonor() from public, anon;
grant execute on function game.house_dishonor() to authenticated;

-- Timè publique : la migration 7040, plus la marque, en fin de colonnes ; prêts de la maison : la migration 9912, plus le
-- jour du défaut. Chaque vue n'est recréée que sans sa colonne nouvelle (ADR 0006) : une migration suivante pourra
-- encore l'étendre, et rejouée, celle-ci ne lui retire rien.
grant select (defaulted_day) on game.loans to authenticated;
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'house_honor' and column_name = 'dishonored') then
    create or replace view public.house_honor with (security_invoker = true) as
      select h.id as house_id, coalesce(t.honor, 0)::bigint as honor, coalesce(d.dishonored, false) as dishonored,
             d.dishonored_until_day
      from game.houses h
      left join game.honor t on t.house_id = h.id
      left join game.house_dishonor() d on d.house_id = h.id;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'my_loans' and column_name = 'defaulted_day') then
    create or replace view public.my_loans with (security_invoker = true) as
      select id, world_id, lender, borrower_house_id as house_id, principal, rate_bps, term_days, interest, borrowed_day,
             due_day, due_at, principal_repaid, interest_repaid, outstanding, status, created_at, defaulted_day
      from game.loans;
  end if;
end $$;

-- Flux de trésorerie : la migration 9912, plus le prélèvement de la clôture (`loan.collect`), partagé comme un
-- remboursement entre les natures `loans` et `interest`.
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
