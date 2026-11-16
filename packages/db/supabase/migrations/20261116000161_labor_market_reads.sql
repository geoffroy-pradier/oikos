-- Marché du travail et logement des travailleurs, lectures des joueurs (docs/specs/04-systemes-gestion.md,
-- 4.4 et 4.5 ; docs/specs/12-modele-donnees.md ; ticket 258). Rejouable (règles et droits recréés,
-- `create or replace` d'une fonction au type rendu inchangé, vues créées une fois) ; le code précédent ne
-- lit ni cette fonction ni ces vues.

-- Donnée publique de la cité, comme sa population : tout joueur connecté lit le marché du travail de
-- chaque cité, toutes cités confondues ; un visiteur anonyme ne lit rien.
drop policy if exists labor_market_read on game.labor_market;
create policy labor_market_read on game.labor_market for select to authenticated using (true);
grant select (city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles)
  on game.labor_market to authenticated;

-- Travailleurs des sites de sa maison, logés ou non, calculés à la lecture comme la clôture et la relance
-- les comptent (4.5) : chaque site emploie les travailleurs de sa recette dans la configuration en vigueur
-- (aucun pour une recette retirée) ; les logements utiles de la maison dans la cité du site (biens
-- possédés et non loués, ou loués par un bail en cours ; état au moins au seuil de sa taille et entretien
-- payé) logent d'abord ses sites les plus anciens. Au nom du propriétaire de la base, la fonction ne rend
-- que les sites des maisons du joueur ; créée sans condition, elle garde ce type de retour (ADR 0006).
create or replace function game.my_workforce()
returns table (house_id uuid, site_id uuid, city_id uuid, recipe_id text, workers integer, housed integer,
  unhoused integer)
language sql stable security definer
set search_path = ''
as $$
  with payload as (
    select v.payload from config.versions v where v.id = config.active_version_at(now())
  ),
  recipe as (
    select r ->> 'id' as id, coalesce((r ->> 'workers')::integer, 0) as workers
    from payload, jsonb_array_elements(
      case when jsonb_typeof(payload.payload -> 'recipes') = 'array' then payload.payload -> 'recipes' else '[]' end) r
  ),
  size as (
    select s ->> 'id' as id, (s ->> 'housingUnits')::integer as units,
           (s ->> 'minHabitableCondition')::integer as threshold
    from payload, jsonb_array_elements(
      case when jsonb_typeof(payload.payload #> '{properties,sizes}') = 'array'
        then payload.payload #> '{properties,sizes}' else '[]' end) s
  ),
  holding as (
    select coalesce(l.tenant_house_id, p.owner_house_id) as house_id, p.city_id,
           sum(case when p.upkeep_unpaid_since is null and p.condition >= z.threshold then z.units else 0 end) as units
    from game.properties p
    join size z on z.id = p.size_id
    left join game.leases l on l.property_id = p.id and l.ended_at is null
    where p.owner_house_id is not null
      and coalesce(l.tenant_house_id, p.owner_house_id) in (select game.current_house_ids())
    group by 1, 2
  ),
  staffed as (
    select s.house_id, s.id as site_id, s.city_id, s.recipe_id, coalesce(r.workers, 0) as workers,
           sum(coalesce(r.workers, 0)) over (partition by s.house_id, s.city_id order by s.created_at, s.id) as through
    from game.sites s left join recipe r on r.id = s.recipe_id
    where s.house_id in (select game.current_house_ids())
  ),
  housed as (
    select st.*, greatest(0, least(st.workers, coalesce(h.units, 0) - (st.through - st.workers))) as housed
    from staffed st left join holding h on h.house_id = st.house_id and h.city_id = st.city_id
  )
  select house_id, site_id, city_id, recipe_id, workers::integer, housed::integer, (workers - housed)::integer
  from housed;
$$;
revoke all on function game.my_workforce() from public;
grant execute on function game.my_workforce() to authenticated;

-- Vues créées une fois (ADR 0006). Le marché du travail public est celui du dernier jour fixé de chaque
-- cité (la clôture la plus récente).
do $$
begin
  if to_regclass('public.labor_market') is null then
    create view public.labor_market with (security_invoker = true) as
      select distinct on (city_id) city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles
      from game.labor_market order by city_id, game_day desc;
  end if;
  if to_regclass('public.my_workforce') is null then
    create view public.my_workforce with (security_invoker = true) as
      select house_id, site_id, city_id, recipe_id, workers, housed, unhoused from game.my_workforce();
  end if;
end $$;
revoke all on public.labor_market, public.my_workforce from public, anon;
grant select on public.labor_market, public.my_workforce to authenticated;
