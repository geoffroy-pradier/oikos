-- Sites de production et lecture par le joueur de ses propres données (ticket 9).
-- Les données privées d'une maison (trésorerie, stocks, sites) ne sont lisibles que par son joueur :
-- règles par ligne sur les tables de `game`, vues `security_invoker` dans `public`.

create table if not exists game.sites (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  city_id uuid not null,
  -- Recette exploitée par le site, identifiant de la configuration (`packages/config`).
  recipe_id text not null check (recipe_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Début du cycle de production en cours : la production est calculée à la collecte (évaluation paresseuse).
  cycle_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint sites_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint sites_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id)
);
create index if not exists sites_house_id_idx on game.sites (house_id);

-- L'identité d'un site ne change pas ; seul l'horodatage du cycle avance.
create or replace function game.guard_site() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.world_id, new.house_id, new.city_id, new.recipe_id, new.created_at)
     is distinct from (old.id, old.world_id, old.house_id, old.city_id, old.recipe_id, old.created_at) then
    raise exception 'site identity is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists sites_guard on game.sites;
create trigger sites_guard before update on game.sites
  for each row execute function game.guard_site();

alter table game.sites enable row level security;

-- Règles par ligne : un joueur ne lit que ce qui appartient à sa maison. Aucune règle d'écriture.
drop policy if exists sites_read_own on game.sites;
create policy sites_read_own on game.sites for select to authenticated
  using (house_id in (select game.current_house_ids()));
drop policy if exists accounts_read_own on game.accounts;
create policy accounts_read_own on game.accounts for select to authenticated
  using (kind = 'house' and house_id in (select game.current_house_ids()));
drop policy if exists inventories_read_own on game.inventories;
create policy inventories_read_own on game.inventories for select to authenticated
  using (house_id in (select game.current_house_ids()));

-- Colonnes accordées une à une : rien d'autre n'est lisible, même pour ses propres lignes.
grant select (id, house_id, city_id, recipe_id, cycle_started_at) on game.sites to authenticated;
grant select (house_id, kind, balance) on game.accounts to authenticated;
grant select (id, house_id, city_id, good_id, quantity) on game.inventories to authenticated;

create or replace view public.my_sites with (security_invoker = true) as
  select id, house_id, city_id, recipe_id, cycle_started_at from game.sites;

-- Trésorerie de la maison, en oboles.
create or replace view public.my_treasury with (security_invoker = true) as
  select house_id, balance from game.accounts where kind = 'house';

create or replace view public.my_inventories with (security_invoker = true) as
  select id, house_id, city_id, good_id, quantity from game.inventories;

grant select on public.my_sites, public.my_treasury, public.my_inventories to authenticated;
