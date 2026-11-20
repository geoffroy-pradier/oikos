-- Lectures de l'ostracisme par les joueurs (docs/specs/06-cites-politique-communaute.md, 6.4 ; ticket 722).
-- Les votes d'ostracisme des cités du monde du joueur sont publics, leur décompte seulement après le dépouillement
-- (nul avant, par contrainte). Le vote est secret (ADR 0007) : un joueur ne lit que le fait que sa maison a voté,
-- jamais le nom qu'elle a inscrit, et le bulletin d'aucune autre ; les voix de chaque maison nommée ne sortent
-- qu'après le dépouillement, par une fonction exécutée au nom du propriétaire.
-- Rejouable (règles recréées, `create or replace`, droits redonnés) ; le code précédent ne lit ni ces fonctions ni
-- ces vues, créées sous condition (ADR 0006).

drop policy if exists ostracisms_read on game.ostracisms;
create policy ostracisms_read on game.ostracisms for select to authenticated
  using (world_id in (select game.current_world_ids()));
drop policy if exists ostraca_read_own on game.ostraca;
create policy ostraca_read_own on game.ostraca for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days, tallied_at,
  electorate, ballots, outcome, ostracized_house_id, ends_at) on game.ostracisms to authenticated;
grant select (ostracism_id, house_id, cast_at) on game.ostraca to authenticated;

-- Décompte : bulletins par maison nommée, une fois le vote dépouillé, et jamais avant ; votes du monde du joueur.
create or replace function game.ostracism_results()
returns table (ostracism_id uuid, house_id uuid, ostraca bigint)
language sql stable security definer
set search_path = ''
as $$
  select o.id, b.target_house_id, count(*)
  from game.ostracisms o
  join game.ostraca b on b.ostracism_id = o.id
  where o.tallied_at is not null and o.world_id in (select game.current_world_ids())
  group by o.id, b.target_house_id;
$$;
revoke all on function game.ostracism_results() from public;
grant execute on function game.ostracism_results() to authenticated;

do $$
begin
  if to_regclass('public.ostracisms') is null then
    -- `in_force` : la maison ostracisée l'est encore à l'instant de la lecture.
    create view public.ostracisms with (security_invoker = true) as
      select id, world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days, tallied_at,
             electorate, ballots, outcome, ostracized_house_id, ends_at,
             ostracized_house_id is not null and now() < ends_at as in_force
      from game.ostracisms;
  end if;
  if to_regclass('public.ostracism_results') is null then
    create view public.ostracism_results with (security_invoker = true) as
      select ostracism_id, house_id, ostraca from game.ostracism_results();
  end if;
  -- « J'ai voté » : les bulletins de la maison du joueur, sans le nom inscrit.
  if to_regclass('public.my_ostraca') is null then
    create view public.my_ostraca with (security_invoker = true) as
      select ostracism_id, house_id, cast_at from game.ostraca;
  end if;
end $$;
grant select on public.ostracisms, public.ostracism_results, public.my_ostraca to authenticated;
