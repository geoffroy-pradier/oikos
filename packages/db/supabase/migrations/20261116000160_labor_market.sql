-- Marché du travail et logement des travailleurs (docs/specs/04-systemes-gestion.md, 4.1, 4.4 et 4.5 ;
-- docs/specs/05-economie.md, 5.5 ; ticket 258) : puits de l'hébergement chez les PNJ, écritures de
-- l'hébergement, marché du travail du jour par cité. Rejouable (`if not exists`, `create or replace` aux
-- colonnes inchangées, contraintes et déclencheurs recréés, `on conflict do nothing`) ; le code précédent
-- n'écrit ni ne lit cette table, ce puits ni ces écritures.

-- Puits de l'hébergement : chaque travailleur sans logement coûte chaque jour une nuit chez les PNJ, dont
-- la monnaie est détruite. Le catalogue crée le compte dans chaque monde.
insert into game.system_account_kinds (key, allow_negative) values ('sink_npc_lodging', false)
on conflict do nothing;

-- Écritures de l'hébergement : `lodging.daily` à la clôture, `lodging.restart` à la relance d'un site,
-- chacune dans la transaction de l'écriture d'entretien qu'elle accompagne. Elles ont leur propre nature
-- d'écriture plutôt qu'une ligne marquée `lodging` dans l'écriture d'entretien : la migration 60 recrée
-- sans condition la contrainte `ledger_lines_nature_known` avec la seule liste (`upkeep`, `wages`), et
-- cette contrainte se vérifie sur les lignes existantes ; une ligne marquée `lodging` ferait échouer son
-- rejeu sur une base remplie (règle 9, ADR 0006). Une écriture de la clôture désigne sa maison et son jour
-- de jeu, typés comme ceux de l'entretien (migration 27) ; elle n'a lieu qu'une fois par maison et par
-- jour. Une écriture de relance désigne sa maison et son site.
alter table game.ledger_entries drop constraint if exists ledger_entries_lodging_meta;
alter table game.ledger_entries add constraint ledger_entries_lodging_meta check (
  kind not in ('lodging.daily', 'lodging.restart')
  or (jsonb_typeof(meta -> 'houseId') = 'string'
      and meta ->> 'houseId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      and case kind
        when 'lodging.daily' then jsonb_typeof(meta -> 'gameDay') = 'number'
          and meta ->> 'gameDay' ~ '^(0|[1-9][0-9]{0,8})$'
        else jsonb_typeof(meta -> 'siteId') = 'string'
          and meta ->> 'siteId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      end) is true
);
create unique index if not exists ledger_entries_lodging_once
  on game.ledger_entries (world_id, ((meta ->> 'houseId')::uuid), ((meta ->> 'gameDay')::integer))
  where kind = 'lodging.daily';

-- Marché du travail d'une cité pour un jour de jeu, fixé par la clôture qui ouvre ce jour : offre de
-- travail (nulle : sans limite), travailleurs employés par les sites de la cité et ceux d'entre eux que
-- leur maison ne loge pas, salaire du jour d'un travailleur et prix d'une nuit d'hébergement chez les PNJ.
create table if not exists game.labor_market (
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  game_day integer not null check (game_day >= 0),
  supply bigint check (supply >= 0),
  employed bigint not null check (employed >= 0),
  unhoused bigint not null check (unhoused >= 0),
  wage_oboles bigint not null check (wage_oboles >= 0),
  lodging_oboles bigint not null check (lodging_oboles >= 0),
  created_at timestamptz not null default now(),
  primary key (city_id, game_day),
  constraint labor_market_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint labor_market_unhoused_employed check (unhoused <= employed),
  -- Le jour est celui d'une clôture enregistrée, vérifié à la validation (comme `npc_population`).
  constraint labor_market_played_close foreign key (world_id, game_day)
    references game.daily_closes (world_id, game_day) deferrable initially deferred
);
create index if not exists labor_market_world_day_idx on game.labor_market (world_id, game_day);

-- Une ligne naît maintenant, une fois par cité et par jour (clé primaire), dans la transaction qui
-- enregistre la clôture de son jour : à son insertion, aucune clôture de ce jour ou d'un jour postérieur
-- n'est encore enregistrée pour le monde (même montage et même verrou que `guard_npc_population`,
-- migration 34). Elle ne change plus ensuite.
create or replace function game.guard_labor_market() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a labor market is set now' using errcode = 'restrict_violation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
    raise exception 'a labor market is set before its close is recorded' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_labor_market() from public, anon, authenticated, oikos_service;
drop trigger if exists labor_market_guard on game.labor_market;
create trigger labor_market_guard before insert on game.labor_market
  for each row execute function game.guard_labor_market();
drop trigger if exists labor_market_immutable on game.labor_market;
create trigger labor_market_immutable before update or delete on game.labor_market
  for each row execute function game.forbid_change();
drop trigger if exists labor_market_no_truncate on game.labor_market;
create trigger labor_market_no_truncate before truncate on game.labor_market
  for each statement execute function game.forbid_change();

-- Le moteur lit et crée une ligne sans en choisir la date ; l'API la lit (relance d'un site). Les joueurs
-- la lisent par une vue (migration suivante).
alter table game.labor_market enable row level security;
revoke all on game.labor_market from public, anon, authenticated, oikos_service;
grant select on game.labor_market to oikos_service;
grant insert (world_id, city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles)
  on game.labor_market to oikos_service;
drop policy if exists service_all on game.labor_market;
create policy service_all on game.labor_market for all to oikos_service using (true) with check (true);

-- Flux de trésorerie : la migration 122, plus la nature `lodging` des écritures de l'hébergement.
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
         when e.kind in ('lodging.daily', 'lodging.restart') then 'lodging'
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

-- Compte de résultat : la migration 122, hébergement compris. Ses colonnes sont figées (ADR 0006) :
-- l'hébergement est une charge courante, comptée dans `upkeep` avec l'entretien et les salaires ;
-- `my_cash_flows` en donne le détail.
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
           coalesce(sum(f.amount) filter (where f.nature in ('upkeep', 'wages', 'lodging', 'transport')
             or (f.nature = 'rents' and f.amount < 0)), 0)::bigint as upkeep,
           coalesce(sum(f.amount) filter (where f.nature = 'acquisitions'), 0)::bigint as acquisitions,
           coalesce(sum(f.amount) filter (where f.nature = 'grant'), 0)::bigint as grants,
           coalesce(sum(f.amount) filter (where f.nature not in
             ('sales', 'purchases', 'taxes', 'upkeep', 'wages', 'lodging', 'transport', 'rents', 'acquisitions', 'grant')), 0)::bigint as other,
           sum(f.amount)::bigint as cash_change,
           coalesce(sum(f.amount) filter (where f.account = 'escrow'), 0)::bigint as escrow_change
    from public.my_cash_flows f
    left join game.clock_rules() c on true
    group by f.house_id, f.game_day, c.season_days
  ) d;
