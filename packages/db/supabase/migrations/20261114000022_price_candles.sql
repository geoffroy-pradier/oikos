-- Historique des prix de l'agora en chandeliers (docs/specs/05-economie.md, 5.3 ; ticket 71).
-- Un chandelier résume les échanges d'un bien dans une cité pendant une période : premier prix, plus
-- haut, plus bas, dernier prix, unités échangées et montant brut. Une période sans échange n'a pas de
-- ligne. C'est un agrégat des échanges (`game.trades`), recalculable à tout moment : le tick le remplit
-- et le corrige, et rien de la monnaie ni des stocks n'en dépend.
create table if not exists game.price_candles (
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Durée de la période. Elle vient de la configuration et fait partie de la clé : la changer ouvre une
  -- nouvelle série sans réécrire l'ancienne, et plusieurs finesses peuvent coexister.
  period_seconds integer not null check (period_seconds > 0),
  -- Début de la période [début, début + durée), aligné sur un multiple de la durée depuis l'époque Unix.
  period_start timestamptz not null,
  -- Prix par unité, en oboles.
  open bigint not null,
  high bigint not null,
  low bigint not null,
  close bigint not null,
  -- Unités échangées, et somme des prix × quantités (brut, avant taxe de marché), en oboles.
  volume bigint not null check (volume > 0),
  turnover bigint not null,
  primary key (city_id, good_id, period_seconds, period_start),
  constraint price_candles_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint price_candles_period_aligned
    check (mod(extract(epoch from period_start), nullif(period_seconds, 0)) = 0),
  constraint price_candles_prices_ordered
    check (low > 0 and low <= open and low <= close and open <= high and close <= high),
  -- Chaque unité s'est échangée entre le plus bas et le plus haut.
  constraint price_candles_turnover_bounds check (turnover >= low * volume and turnover <= high * volume)
);

alter table game.price_candles enable row level security;

-- Le moteur insère un chandelier puis le recalcule tant que sa période reçoit des échanges : il n'en
-- modifie que les valeurs, jamais la clé, et n'en supprime pas.
grant select, insert on game.price_candles to oikos_service;
grant update (open, high, low, close, volume, turnover) on game.price_candles to oikos_service;
drop policy if exists service_all on game.price_candles;
create policy service_all on game.price_candles for all to oikos_service using (true) with check (true);

-- Donnée publique du marché, comme le carnet agrégé : tout joueur connecté lit l'historique de toutes
-- les cités. Aucune identité n'y figure (ni maison, ni ordre, ni échange individuel).
drop policy if exists price_candles_read on game.price_candles;
create policy price_candles_read on game.price_candles for select to authenticated using (true);
grant select (city_id, good_id, period_seconds, period_start, open, high, low, close, volume, turnover)
  on game.price_candles to authenticated;

create or replace view public.price_candles with (security_invoker = true) as
  select city_id, good_id, period_seconds, period_start, open, high, low, close, volume, turnover
  from game.price_candles;

grant select on public.price_candles to authenticated;
