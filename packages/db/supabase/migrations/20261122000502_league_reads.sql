-- Lectures des ligues par les joueurs (docs/specs/06-cites-politique-communaute.md, 6.5 ; ticket 737). Les ligues et
-- leurs membres, présents et passés, sont publics dans le monde du joueur (`current_world_ids()`, migration 8570) :
-- une ligue d'un autre monde est invisible. Aucune écriture pour les joueurs.
-- Rejouable (règles recréées, droits redonnés) ; le code précédent ne lit pas ces vues, créées sous condition pour que
-- les tickets suivants (trésor commun, tarifs, élection de l'hégémon) puissent les étendre (ADR 0006).

drop policy if exists leagues_read on game.leagues;
create policy leagues_read on game.leagues for select to authenticated
  using (world_id in (select game.current_world_ids()));
drop policy if exists league_members_read on game.league_members;
create policy league_members_read on game.league_members for select to authenticated
  using (world_id in (select game.current_world_ids()));
grant select (id, world_id, name, hegemon_city_id, founding_decree_id, founded_at, dissolved_at) on game.leagues
  to authenticated;
grant select (id, league_id, world_id, city_id, entry_decree_id, joined_at, left_at, exit_reason, exit_decree_id)
  on game.league_members to authenticated;

do $$
begin
  if to_regclass('public.leagues') is null then
    create view public.leagues with (security_invoker = true) as
      select id, world_id, name, hegemon_city_id, founding_decree_id, founded_at, dissolved_at from game.leagues;
  end if;
  if to_regclass('public.league_members') is null then
    create view public.league_members with (security_invoker = true) as
      select id, league_id, world_id, city_id, entry_decree_id, joined_at, left_at, exit_reason, exit_decree_id
      from game.league_members;
  end if;
end $$;
revoke all on public.leagues, public.league_members from public, anon;
grant select on public.leagues, public.league_members to authenticated;
