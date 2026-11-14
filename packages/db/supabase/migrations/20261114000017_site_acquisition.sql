-- Acquisition de sites et changement de recette (docs/specs/04-systemes-gestion.md, 4.1 et 4.2 ; ticket 66).

-- Un site peut désormais changer de recette. La garde tient la règle : au changement de recette, le cycle
-- repart de l'instant présent, si bien qu'aucune production de l'ancienne recette ne peut être récoltée
-- sous la nouvelle. Le reste de l'identité d'un site ne change toujours pas.
create or replace function game.guard_site() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at <> now() or new.cycle_started_at <> now() then
      raise exception 'a site starts now' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if new.cycle_started_at < old.cycle_started_at or new.cycle_started_at > now() then
    raise exception 'a site cycle only moves forward, up to now' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.world_id, new.house_id, new.city_id, new.created_at)
     is distinct from (old.id, old.world_id, old.house_id, old.city_id, old.created_at) then
    raise exception 'site identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.recipe_id is distinct from old.recipe_id and new.cycle_started_at <> now() then
    raise exception 'a site that changes recipe starts a new cycle now' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Le service change la recette d'un site (commande `site.setRecipe`).
grant update (recipe_id) on game.sites to oikos_service;

-- Puits de monnaie : le prix d'acquisition d'un site est détruit. Le catalogue crée le compte dans
-- chaque monde existant.
insert into game.system_account_kinds (key, allow_negative)
values ('sink_site_acquisition', false)
on conflict do nothing;
