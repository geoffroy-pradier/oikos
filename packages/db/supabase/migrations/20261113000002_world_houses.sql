-- Monde, cités, maisons et citoyennetés (docs/specs/12-modele-donnees.md, ticket 3).
-- Lecture par les vues de `public` (security_invoker) sous règles par ligne ; aucune écriture cliente.

-- Identifiants UUID v7 (ordonnés dans le temps) : horodatage en millisecondes sur 48 bits, puis aléa.
create or replace function game.uuid_v7() returns uuid
language sql volatile parallel safe
set search_path = ''
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

create table if not exists game.worlds (
  id uuid primary key default game.uuid_v7(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,32}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists game.cities (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  slug text not null check (slug ~ '^[a-z0-9-]{2,32}$'),
  name text not null,
  created_at timestamptz not null default now(),
  unique (world_id, slug)
);

create table if not exists game.houses (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  user_id uuid not null references auth.users (id),
  -- 3 à 24 caractères : lettres, espaces, apostrophes, tirets ; commence et finit par une lettre.
  name text not null check (name ~ '^[[:alpha:]][[:alpha:] ''-]{1,22}[[:alpha:]]$'),
  -- Unicité insensible à la casse.
  name_key text generated always as (lower(name)) stored,
  blazon jsonb not null check (jsonb_typeof(blazon) = 'object'),
  created_at timestamptz not null default now(),
  -- Une seule maison par joueur et par monde.
  constraint houses_one_per_user unique (world_id, user_id),
  constraint houses_name_unique unique (world_id, name_key)
);

create table if not exists game.citizenships (
  id uuid primary key default game.uuid_v7(),
  -- Une maison n'a qu'une citoyenneté (docs/specs/06-cites-politique-communaute.md).
  house_id uuid not null unique references game.houses (id),
  city_id uuid not null references game.cities (id),
  -- Le nouveau venu est accueilli comme métèque avant d'obtenir la citoyenneté.
  status text not null default 'metic' check (status in ('metic', 'citizen')),
  since timestamptz not null default now()
);
create index if not exists citizenships_city_id_idx on game.citizenships (city_id);

-- Règles par ligne : le monde, les cités, le profil d'une maison et sa cité sont publics pour les joueurs connectés.
-- Aucune règle d'écriture : seuls l'API de jeu et le moteur écrivent.
alter table game.worlds enable row level security;
alter table game.cities enable row level security;
alter table game.houses enable row level security;
alter table game.citizenships enable row level security;

drop policy if exists worlds_read on game.worlds;
create policy worlds_read on game.worlds for select to authenticated using (true);
drop policy if exists cities_read on game.cities;
create policy cities_read on game.cities for select to authenticated using (true);
drop policy if exists houses_read on game.houses;
create policy houses_read on game.houses for select to authenticated using (true);
drop policy if exists citizenships_read on game.citizenships;
create policy citizenships_read on game.citizenships for select to authenticated using (true);

-- Les vues s'exécutent avec les droits de l'appelant : il lui faut la lecture, et rien d'autre, sur `game`.
-- Sur `houses`, les colonnes sont accordées une à une : ni `user_id` ni `name_key` ne sont lisibles par un client.
grant usage on schema game to authenticated;
grant select on game.worlds, game.cities, game.citizenships to authenticated;
grant select (id, world_id, name, blazon, created_at) on game.houses to authenticated;

-- Maisons du compte connecté. Seule fonction à lire `user_id` pour le client : elle ne rend que des
-- identifiants de maison, déjà publics, et ne prend aucun paramètre.
create or replace function game.current_house_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select id from game.houses where user_id = (select auth.uid());
$$;
revoke all on function game.current_house_ids() from public, anon;
grant execute on function game.current_house_ids() to authenticated;

create or replace view public.worlds with (security_invoker = true) as
  select id, slug, name from game.worlds;

create or replace view public.cities with (security_invoker = true) as
  select id, world_id, slug, name from game.cities;

-- Profil public d'une maison. L'identifiant du compte ne sort pas : seul `is_mine` est exposé.
create or replace view public.houses with (security_invoker = true) as
  select h.id, h.world_id, h.name, h.blazon, h.created_at,
         c.city_id, c.status as citizenship_status,
         h.id in (select game.current_house_ids()) as is_mine
  from game.houses h
  left join game.citizenships c on c.house_id = h.id;

grant select on public.worlds, public.cities, public.houses to authenticated;
