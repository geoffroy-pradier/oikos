-- Population des PNJ : état du monde et mesure du jour (docs/specs/05-economie.md, 5.2 ; ticket 75).

-- Population courante d'une classe dans une cité. Le moteur crée la ligne à la population de la
-- configuration en vigueur, au premier tick de demande qui connaît la cité et la classe ; chaque
-- clôture quotidienne la fait ensuite évoluer d'après la couverture de la veille.
create table if not exists game.npc_population (
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  class_id text not null check (class_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Habitants entiers, dans la limite du calcul exact (`MAX_CLASS_POPULATION`, packages/sim).
  population integer not null check (population between 0 and 100000000),
  -- Dernière clôture qui a fait évoluer la classe, et couverture qu'elle a retenue (points de base).
  closed_day integer,
  coverage_bps integer check (coverage_bps between 0 and 10000),
  primary key (city_id, class_id),
  constraint npc_population_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint npc_population_closed_together check ((closed_day is null) = (coverage_bps is null)),
  -- Une population n'évolue que dans la transaction d'une clôture jouée : la ligne `daily_closes` du
  -- jour est écrite à la fin de la clôture, la référence est donc vérifiée à la validation.
  constraint npc_population_played_close foreign key (world_id, closed_day)
    references game.daily_closes (world_id, game_day) deferrable initially deferred
);

-- Au plus une évolution par jour de jeu, jamais en arrière : même si une clôture était rejouée par
-- erreur, la base refuserait la seconde. Toute modification doit avancer le jour de clôture.
create or replace function game.guard_npc_population() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.closed_day is null or new.closed_day <= coalesce(old.closed_day, -1) then
    raise exception 'a population moves once per game day, forward' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists npc_population_guard on game.npc_population;
create trigger npc_population_guard before update on game.npc_population
  for each row execute function game.guard_npc_population();

-- Mesure du jour : par classe, unités de ses biens vitaux demandées (besoin de référence) et servies,
-- cumulées par les ticks de demande du jour de jeu ; la clôture suivante lit celles de la veille.
-- Nombres réels : ni le besoin (Q0 × N ÷ 1000) ni la part d'une classe dans un achat ne sont entiers.
create table if not exists game.npc_vital_coverage (
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  class_id text not null check (class_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  game_day integer not null check (game_day >= 0),
  -- `< 'Infinity'` écarte aussi NaN, que Postgres classe au-dessus de l'infini.
  served double precision not null check (served >= 0 and served < 'Infinity'),
  demanded double precision not null check (demanded >= 0 and demanded < 'Infinity'),
  primary key (city_id, class_id, game_day),
  constraint npc_vital_coverage_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id)
);

-- Le moteur crée une ligne et en remplace les valeurs, jamais la clé ; il ne supprime pas. La mesure
-- est un état interne : aucune règle ni droit pour les clients.
alter table game.npc_population enable row level security;
alter table game.npc_vital_coverage enable row level security;
revoke all on game.npc_population, game.npc_vital_coverage from public, anon, authenticated, oikos_service;
grant select, insert (world_id, city_id, class_id, population) on game.npc_population to oikos_service;
grant update (population, closed_day, coverage_bps) on game.npc_population to oikos_service;
grant select, insert on game.npc_vital_coverage to oikos_service;
grant update (served, demanded) on game.npc_vital_coverage to oikos_service;
drop policy if exists service_all on game.npc_population;
create policy service_all on game.npc_population for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.npc_vital_coverage;
create policy service_all on game.npc_vital_coverage for all to oikos_service using (true) with check (true);

-- Donnée publique de la cité, comme les prix du marché : tout joueur connecté lit la population et la
-- dernière couverture de chaque classe, toutes cités confondues ; un visiteur anonyme ne lit rien.
drop policy if exists npc_population_read on game.npc_population;
create policy npc_population_read on game.npc_population for select to authenticated using (true);
grant select (city_id, class_id, population, closed_day, coverage_bps) on game.npc_population to authenticated;

create or replace view public.city_population with (security_invoker = true) as
  select city_id, class_id, population, closed_day, coverage_bps from game.npc_population;

grant select on public.city_population to authenticated;
