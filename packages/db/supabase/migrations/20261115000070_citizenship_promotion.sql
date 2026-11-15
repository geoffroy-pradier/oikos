-- Citoyenneté acquise à la clôture (docs/specs/03-boucles-progression.md, progression ;
-- docs/specs/06-cites-politique-communaute.md, 6.2 ; ticket 260).
-- Une maison naît métèque dans sa cité ; la clôture la fait citoyenne après le nombre de jours de jeu de la
-- configuration (`politics.meticDays`), et elle le reste.
-- Rejouable (`create or replace`, droits redonnés, déclencheur recréé) ; le code précédent n'écrit que la
-- maison et la cité d'une citoyenneté, à la fondation, et ne la modifie jamais.

-- Le service fonde une citoyenneté sans en choisir ni l'identifiant, ni le statut, ni la date : une maison
-- naît métèque, maintenant. La clôture la promeut : statut et date.
revoke insert on game.citizenships from oikos_service;
grant insert (house_id, city_id) on game.citizenships to oikos_service;
grant update (status, since) on game.citizenships to oikos_service;

-- Une citoyenneté naît métèque. Elle ne change ensuite ni de maison, ni de cité, ni d'identifiant ; son
-- statut ne fait que passer de métèque à citoyen, daté de la transaction qui l'écrit, et sa date ne change
-- qu'avec lui.
create or replace function game.guard_citizenship() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'metic' then
      raise exception 'a house is welcomed as a metic' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.house_id, new.city_id) is distinct from (old.id, old.house_id, old.city_id) then
    raise exception 'citizenship identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.status = old.status then
    if new.since is distinct from old.since then
      raise exception 'the citizenship date only changes with its status' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.status <> 'metic' or new.status <> 'citizen' then
    raise exception 'a citizen stays a citizen' using errcode = 'restrict_violation';
  end if;
  if new.since is distinct from now() then
    raise exception 'citizenship is granted now' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_citizenship() from public, anon, authenticated, oikos_service;
drop trigger if exists citizenships_guard on game.citizenships;
create trigger citizenships_guard before insert or update on game.citizenships
  for each row execute function game.guard_citizenship();

-- La clôture cherche, par cité, les métèques arrivés avant un instant donné.
create index if not exists citizenships_metics_idx on game.citizenships (city_id, since) where status = 'metic';
