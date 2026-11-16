-- Immobilier entre maisons, lectures (docs/specs/04-systemes-gestion.md, 4.1 et 4.5 ;
-- docs/specs/12-modele-donnees.md ; ticket 257) : natures des comptes de la maison pour le loyer et la
-- revente, offres publiques sans propriétaire nommé, baux de chaque partie. Rejouable (`create or replace`
-- aux colonnes inchangées, vues nouvelles créées une fois, règles recréées) ; le code précédent lit les
-- mêmes colonnes et aucune des vues nouvelles.

-- Une maison lit ses propres offres (la vente d'une offre donne le brut au vendeur, comme un échange
-- de l'agora) et les baux dont elle est partie, propriétaire ou locataire.
drop policy if exists property_listings_read_own on game.property_listings;
create policy property_listings_read_own on game.property_listings for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, property_id, house_id, kind, price_oboles, created_at, closed_at, outcome, ledger_entry_id)
  on game.property_listings to authenticated;
drop policy if exists leases_read_party on game.leases;
create policy leases_read_party on game.leases for select to authenticated
  using (landlord_house_id in (select game.current_house_ids()) or tenant_house_id in (select game.current_house_ids()));
grant select (id, property_id, landlord_house_id, tenant_house_id, rent_oboles, started_at, end_requested_at,
  end_requested_by, ended_at, ended_day, end_reason) on game.leases to authenticated;

-- Flux de trésorerie : la migration 111, plus deux natures. Le loyer (`lease.rent`) est un loyer
-- (`rents`), débit du locataire, crédit du propriétaire. La revente (`property.sale`) est une acquisition,
-- au brut pour le vendeur (le prix de son offre vendue, qu'il lit), et l'écart entre ce brut et le net
-- crédité est sa taxe (`taxes`), comme une vente de l'agora ; l'acheteur paie le prix en acquisition.
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
    cross join lateral (values
      (case
         when l.nature is not null then l.nature
         when e.kind in ('market.trade', 'npc.purchase') then case when l.amount > 0 then 'sales' else 'purchases' end
         when e.kind in ('market.escrow_hold', 'market.escrow_release') then 'escrow'
         when e.kind in ('upkeep.daily', 'upkeep.restart', 'property.renovate') then 'upkeep'
         when e.kind in ('site.acquire', 'ship.acquire', 'property.buy', 'property.sale') then 'acquisitions'
         when e.kind = 'lease.rent' then 'rents'
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

-- Compte de résultat : la migration 82, loyers compris. Ses colonnes sont figées (ADR 0006), et le loyer
-- est une recette pour le propriétaire, une charge pour le locataire : le net des loyers d'un jour entre
-- dans les ventes (`sales`, produits d'exploitation) quand il est positif, dans les charges courantes
-- (`upkeep`) quand il est négatif ; `my_cash_flows` en donne le détail. La revente est une acquisition
-- (hors exploitation) et sa taxe une taxe, sans changement.
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
           coalesce(sum(f.amount) filter (where f.nature in ('upkeep', 'wages', 'transport')
             or (f.nature = 'rents' and f.amount < 0)), 0)::bigint as upkeep,
           coalesce(sum(f.amount) filter (where f.nature = 'acquisitions'), 0)::bigint as acquisitions,
           coalesce(sum(f.amount) filter (where f.nature = 'grant'), 0)::bigint as grants,
           coalesce(sum(f.amount) filter (where f.nature not in
             ('sales', 'purchases', 'taxes', 'upkeep', 'wages', 'transport', 'rents', 'acquisitions', 'grant')), 0)::bigint as other,
           sum(f.amount)::bigint as cash_change,
           coalesce(sum(f.amount) filter (where f.account = 'escrow'), 0)::bigint as escrow_change
    from public.my_cash_flows f
    left join game.clock_rules() c on true
    group by f.house_id, f.game_day, c.season_days
  ) d;

-- Offres ouvertes de toutes les cités, publiques comme le parc : le bien, sa cité, sa taille, son numéro et
-- son état, la nature de l'offre et son prix (ou loyer quotidien), sa date ; jamais la maison qui l'offre.
-- L'état d'un bien offert devient public : l'offrir, c'est le montrer. Au nom du propriétaire de la base,
-- la fonction ne rend que ces colonnes ; créée sans condition, elle garde ce type de retour (ADR 0006).
create or replace function game.property_offers()
returns table (property_id uuid, city_id uuid, size_id text, lot integer, condition integer, kind text,
  price_oboles bigint, listed_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.city_id, p.size_id, p.lot, p.condition, o.kind, o.price_oboles, o.created_at
  from game.property_listings o join game.properties p on p.id = o.property_id
  where o.closed_at is null;
$$;
revoke all on function game.property_offers() from public;
grant execute on function game.property_offers() to authenticated;

-- Vues créées une fois (ADR 0006). Un bail se lit avec son bien (cité, taille, numéro), pris dans le parc
-- public : le locataire ne lit pas le bien lui-même, qui n'est pas à lui.
do $$
begin
  if to_regclass('public.property_offers') is null then
    create view public.property_offers with (security_invoker = true) as
      select property_id, city_id, size_id, lot, condition, kind, price_oboles, listed_at from game.property_offers();
  end if;
  if to_regclass('public.my_leases') is null then
    create view public.my_leases with (security_invoker = true) as
      select l.id, l.property_id, p.city_id, p.size_id, p.lot, l.landlord_house_id, l.tenant_house_id, l.rent_oboles,
             l.started_at, l.end_requested_at, l.end_requested_by, l.ended_at, l.ended_day, l.end_reason
      from game.leases l join game.city_properties() p on p.id = l.property_id;
  end if;
end $$;
revoke all on public.property_offers, public.my_leases from public, anon;
grant select on public.property_offers, public.my_leases to authenticated;
