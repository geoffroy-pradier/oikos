-- Lectures de l'immobilier par les joueurs (docs/specs/04-systemes-gestion.md, 4.5 ;
-- docs/specs/12-modele-donnees.md ; ticket 256) : les règles publiques, le parc de chaque cité sans
-- propriétaire nommé, et les biens de sa propre maison. Rejouable (`create or replace`, vues créées une
-- fois, règles recréées) ; le code précédent ne lit aucune de ces vues.

-- Règles de l'immobilier : la section `properties` de la configuration en vigueur, règles du jeu connues
-- de tous les joueurs (tout champ qui y est ajouté leur devient visible). Même montage que `ship_rules`
-- (migration 51). Nulle pour une version publiée avant l'immobilier : le client applique la valeur par
-- défaut du schéma partagé (aucune taille), comme l'API. Sans version en vigueur, aucune ligne.
create or replace function game.property_rules() returns table (properties jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'properties'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.property_rules() from public;
grant execute on function game.property_rules() to authenticated;

-- Parc de chaque cité, toutes cités confondues, comme leur population : une ligne par bien (sa taille, son
-- numéro), qui dit s'il est encore à vendre par la cité, et, seulement alors, son état ; d'un bien qu'une
-- maison détient, ni le propriétaire, ni l'état, ni l'impayé. Au nom du propriétaire de la base, la
-- fonction ne rend que ces colonnes. Créée sans condition, elle garde ce type de retour (ADR 0006) : une
-- donnée nouvelle passera par une autre fonction.
create or replace function game.city_properties()
returns table (id uuid, city_id uuid, size_id text, lot integer, for_sale boolean, condition integer)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.city_id, p.size_id, p.lot, p.owner_house_id is null,
         case when p.owner_house_id is null then p.condition end
  from game.properties p;
$$;
revoke all on function game.city_properties() from public;
grant execute on function game.city_properties() to authenticated;

-- Biens de sa maison : règle par ligne et colonnes accordées une à une.
drop policy if exists properties_read_own on game.properties;
create policy properties_read_own on game.properties for select to authenticated
  using (owner_house_id in (select game.current_house_ids()));
grant select (id, city_id, size_id, lot, owner_house_id, acquired_at, condition, upkeep_unpaid_since)
  on game.properties to authenticated;

-- Vues créées une fois : rejouée ensuite, la migration ne les recrée pas, si bien qu'une migration
-- suivante pourra leur ajouter une colonne (ADR 0006).
do $$
begin
  if to_regclass('public.property_rules') is null then
    create view public.property_rules with (security_invoker = true) as
      select properties from game.property_rules();
  end if;
  if to_regclass('public.city_properties') is null then
    create view public.city_properties with (security_invoker = true) as
      select id, city_id, size_id, lot, for_sale, condition from game.city_properties();
  end if;
  if to_regclass('public.my_properties') is null then
    create view public.my_properties with (security_invoker = true) as
      select id, owner_house_id as house_id, city_id, size_id, lot, acquired_at, condition, upkeep_unpaid_since
      from game.properties;
  end if;
end $$;
revoke all on public.property_rules, public.city_properties, public.my_properties from public, anon;
grant select on public.property_rules, public.city_properties, public.my_properties to authenticated;
