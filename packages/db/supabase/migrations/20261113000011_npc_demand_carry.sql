-- Demande des PNJ : fraction d'unité reportée d'un tick au suivant (docs/specs/05-economie.md, 5.2 ; ticket 9).
-- La demande est un nombre réel, les biens se comptent en unités : ce que le tick n'a pas pu arrondir
-- est gardé ici, par cité et par bien, pour que rien ne soit créé ni perdu sur la durée.
create table if not exists game.npc_demand_carry (
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  good_id text not null check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Toujours moins d'une unité : une unité entière aurait été demandée.
  carry double precision not null check (carry >= 0 and carry < 1),
  updated_at timestamptz not null default now(),
  primary key (city_id, good_id),
  constraint npc_demand_carry_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id)
);

-- État interne du moteur, non exposé aux clients : règles par ligne actives, aucune règle, aucun droit.
alter table game.npc_demand_carry enable row level security;
