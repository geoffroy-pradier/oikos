-- Arrêt d'un site pendant une clôture longue (docs/specs/12-modele-donnees.md ; ticket 72).
-- La garde (migration 27) exigeait un arrêt daté exactement du début de la transaction. Or une récolte
-- de site plein ou un changement de recette, validés après le début de la transaction de clôture mais
-- avant qu'elle ne verrouille le site, laissent un cycle postérieur à cet instant : l'arrêt violait
-- alors `sites_cycle_not_after_halt` et la clôture du monde entier échouait.
-- Un arrêt est désormais daté dans la transaction qui l'écrit : entre son début et l'heure réelle. La
-- clôture date l'arrêt du début du cycle quand celui-ci est postérieur au sien. Pour la même raison,
-- « le cycle ne dépasse pas maintenant » n'est exigé que d'une écriture qui change le cycle : arrêter
-- un site ne le change pas. Le reste de la garde est repris tel quel.
create or replace function game.guard_site() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at <> now() or new.cycle_started_at <> now() or new.halted_at is not null then
      raise exception 'a site starts now' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if new.cycle_started_at < old.cycle_started_at
     or (new.cycle_started_at <> old.cycle_started_at and new.cycle_started_at > now()) then
    raise exception 'a site cycle only moves forward, up to now' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.world_id, new.house_id, new.city_id, new.created_at)
     is distinct from (old.id, old.world_id, old.house_id, old.city_id, old.created_at) then
    raise exception 'site identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.recipe_id is distinct from old.recipe_id and new.cycle_started_at <> now() then
    raise exception 'a site that changes recipe starts a new cycle now' using errcode = 'restrict_violation';
  end if;
  if new.halted_at is distinct from old.halted_at then
    if old.halted_at is null and (new.halted_at < now() or new.halted_at > clock_timestamp()) then
      raise exception 'a site halts now' using errcode = 'restrict_violation';
    elsif old.halted_at is not null and new.halted_at is not null then
      raise exception 'a halt keeps its instant' using errcode = 'restrict_violation';
    elsif new.halted_at is null and new.cycle_started_at
        <> old.cycle_started_at + extract(epoch from now() - old.halted_at) * interval '1 second' then
      raise exception 'a site resumes with its cycle shifted by the halt' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
