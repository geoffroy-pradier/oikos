-- Prix de référence observé (docs/specs/05-economie.md, 5.3 ; ticket 71).
-- Pour chaque bien d'une cité, le prix moyen des échanges récents, pondéré par les volumes : le tick le
-- recalcule depuis les chandeliers. Une ligne par marché, remplacée à chaque calcul ; un marché sans
-- échange dans la fenêtre garde son dernier prix observé, daté. Affichage et tableau de bord seulement :
-- les PNJ achètent selon le prix de référence de la configuration, pas selon celui-ci.
create table if not exists game.observed_prices (
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Prix moyen par unité, en oboles, arrondi à l'obole la plus proche.
  price bigint not null check (price > 0),
  -- Unités échangées dans la fenêtre : ce sur quoi le prix s'appuie.
  volume bigint not null check (volume > 0),
  -- Fenêtre du calcul : sa durée, et l'instant de jeu du tick qui l'a fermée.
  window_seconds integer not null check (window_seconds > 0),
  observed_at timestamptz not null,
  primary key (city_id, good_id),
  constraint observed_prices_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id)
);

alter table game.observed_prices enable row level security;

-- Le moteur insère la ligne d'un marché puis en remplace les valeurs, jamais la clé ; il ne supprime pas.
grant select, insert on game.observed_prices to oikos_service;
grant update (price, volume, window_seconds, observed_at) on game.observed_prices to oikos_service;
drop policy if exists service_all on game.observed_prices;
create policy service_all on game.observed_prices for all to oikos_service using (true) with check (true);

-- Donnée publique du marché, déduite des chandeliers : même lecture qu'eux, sans identité.
drop policy if exists observed_prices_read on game.observed_prices;
create policy observed_prices_read on game.observed_prices for select to authenticated using (true);
grant select (city_id, good_id, price, volume, window_seconds, observed_at) on game.observed_prices to authenticated;

create or replace view public.observed_prices with (security_invoker = true) as
  select city_id, good_id, price, volume, window_seconds, observed_at from game.observed_prices;

grant select on public.observed_prices to authenticated;
