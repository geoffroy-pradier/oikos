-- Banques de joueurs : lectures et natures des comptes (docs/specs/05-economie.md, 5.4 ; 04-systemes-gestion.md, 4.1 ;
-- 12-modele-donnees.md ; ticket 726).
-- Tout joueur connecté lit les banques de son monde (`banks`) et les règles des banques (`bank_rules`) ; une maison lit
-- le coffre de sa banque et sa réserve exigée (`my_bank`), et aucune autre. Ses comptes rangent le droit de fondation
-- (`bank_charter`) et le capital versé ou retiré (`bank_capital`) hors exploitation.
-- Rejouable (règles et droits recréés, `create or replace` à colonnes égales, vues nouvelles créées une fois) ;
-- compatible avec le code précédent, qui lit les mêmes colonnes.

-- Lectures des joueurs connectés : une banque est publique dans son monde, comme une maison (#857) ; un visiteur
-- anonyme ne lit rien. Ni le droit payé, ni le coffre : il se lit par `my_bank`, pour sa seule maison.
drop policy if exists banks_read_same_world on game.banks;
create policy banks_read_same_world on game.banks for select to authenticated
  using (world_id in (select game.current_world_ids()));
grant select (id, world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, founded_at) on game.banks
  to authenticated;

-- Fonctions créées une fois, comme les vues qui les lisent (ADR 0006) : rejouée, la migration ne les recrée pas, et une
-- migration de #727 ou #728 qui leur ajoute une colonne ne casse pas le rejeu.
-- Règles des banques en vigueur, telles que la configuration les écrit ; sans section, aucune ligne : aucune banque ne
-- se fonde. Règles du jeu connues de tous, comme `temple_treasury_rules`.
do $do$
begin
  if to_regprocedure('game.bank_rules()') is null then
    create function game.bank_rules()
    returns table (
      charter_fee_oboles bigint, min_capital_oboles bigint, reserve_ratio_bps integer,
      deposit_rate_min_bps integer, deposit_rate_max_bps integer, loan_rate_min_bps integer, loan_rate_max_bps integer
    )
    language sql stable security definer
    set search_path = ''
    as $body$
      select (b ->> 'charterFeeOboles')::bigint, (b ->> 'minCapitalOboles')::bigint, (b ->> 'reserveRatioBps')::integer,
             (b -> 'depositRateBps' ->> 'min')::integer, (b -> 'depositRateBps' ->> 'max')::integer,
             (b -> 'loanRateBps' ->> 'min')::integer, (b -> 'loanRateBps' ->> 'max')::integer
      from config.versions v
      cross join lateral (select v.payload -> 'banks' as b) section
      where v.id = config.active_version_at(now()) and jsonb_typeof(section.b) = 'object';
    $body$;
  end if;
end $do$;
-- Banque de la maison : son coffre et sa réserve exigée, le plus grand du capital minimal et de la part
-- `reserveRatioBps` des dépôts arrondie à l'obole supérieure (`bankRequiredReserve`) : sans dépôt avant #727, qui y
-- ajoutera la part des dépôts, le capital minimal. Inconnue (nulle) sans règles des banques en vigueur.
do $do$
begin
  if to_regprocedure('game.my_bank()') is null then
    create function game.my_bank()
    returns table (
      id uuid, world_id uuid, city_id uuid, house_id uuid, name text, deposit_rate_bps integer, loan_rate_bps integer,
      founded_at timestamptz, vault bigint, required_reserve bigint
    )
    language sql stable security definer
    set search_path = ''
    as $body$
      select b.id, b.world_id, b.city_id, b.house_id, b.name, b.deposit_rate_bps, b.loan_rate_bps, b.founded_at, a.balance,
             r.min_capital_oboles
      from game.banks b
      join game.accounts a on a.bank_id = b.id
      left join game.bank_rules() r on true
      where b.house_id in (select game.current_house_ids());
    $body$;
  end if;
end $do$;
revoke all on function game.bank_rules(), game.my_bank() from public, anon, oikos_service;
grant execute on function game.bank_rules(), game.my_bank() to authenticated;

-- Vues créées une fois (ADR 0006) : rejouée, la migration ne les recrée pas, et #727 ou #728 pourront les étendre.
do $$
begin
  if to_regclass('public.banks') is null then
    create view public.banks with (security_invoker = true) as
      select id, world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, founded_at from game.banks;
  end if;
  if to_regclass('public.bank_rules') is null then
    create view public.bank_rules with (security_invoker = true) as
      select charter_fee_oboles, min_capital_oboles, reserve_ratio_bps, deposit_rate_min_bps, deposit_rate_max_bps,
             loan_rate_min_bps, loan_rate_max_bps
      from game.bank_rules();
  end if;
  if to_regclass('public.my_bank') is null then
    create view public.my_bank with (security_invoker = true) as
      select id, world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, founded_at, vault, required_reserve
      from game.my_bank();
  end if;
end $$;
revoke all on public.banks, public.bank_rules, public.my_bank from public, anon;
grant select on public.banks, public.bank_rules, public.my_bank to authenticated;

-- Flux de trésorerie : la migration 9912, plus le droit de fondation (`bank_charter`) et le capital versé, négatif, ou
-- retiré, positif (`bank_capital`), et le prélèvement d'un prêt échu de #725 (`loan.collect`, partagé comme un
-- remboursement entre `loans` et `interest`). Le compte de résultat les range dans `other`, hors exploitation, sans
-- changer sa définition (ADR 0006).
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
