-- Lectures de l'élection de l'archonte par les joueurs (docs/specs/06-cites-politique-communaute.md, 6.2 ;
-- ticket 260). Le vote est secret : un joueur ne lit que le fait que sa maison a voté, jamais un bulletin, et
-- les résultats ne sont publics qu'après le dépouillement.
-- Rejouable (règles recréées, `create or replace`, droits redonnés) ; le code précédent ne lit ni ces
-- fonctions ni ces vues.

-- Joueurs connectés : calendrier, candidatures et charges sont publics ; d'un bulletin, seule la maison qui
-- l'a déposé lit qu'il existe et quand, jamais pour qui.
drop policy if exists elections_read on game.elections;
create policy elections_read on game.elections for select to authenticated using (true);
drop policy if exists candidacies_read on game.candidacies;
create policy candidacies_read on game.candidacies for select to authenticated using (true);
drop policy if exists offices_read on game.offices;
create policy offices_read on game.offices for select to authenticated using (true);
drop policy if exists ballots_read_own on game.ballots;
create policy ballots_read_own on game.ballots for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
  on game.elections to authenticated;
grant select (id, election_id, house_id, created_at, withdrawn_at) on game.candidacies to authenticated;
grant select (election_id, house_id, cast_at) on game.ballots to authenticated;
grant select (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at) on game.offices to authenticated;

-- Résultats : bulletins par candidature maintenue, une fois l'élection dépouillée, et jamais avant. Exécutée
-- au nom du propriétaire, seule à compter des bulletins pour un joueur ; elle ne rend que ces totaux.
create or replace function game.election_results()
returns table (election_id uuid, candidacy_id uuid, house_id uuid, votes bigint)
language sql stable security definer
set search_path = ''
as $$
  select c.election_id, c.id, c.house_id, count(b.id)
  from game.elections e
  join game.candidacies c on c.election_id = e.id and c.withdrawn_at is null
  left join game.ballots b on b.candidacy_id = c.id
  where e.tallied_at is not null
  group by c.election_id, c.id, c.house_id;
$$;
revoke all on function game.election_results() from public;
grant execute on function game.election_results() to authenticated;

-- Règles de la citoyenneté et des magistratures : la section `politics` de la configuration en vigueur, règles
-- du jeu connues de tous (tout champ qui y est ajouté leur devient visible). Même montage que `ship_rules`
-- (migration 51). Nulle pour une version publiée avant la citoyenneté ; sans version en vigueur, aucune ligne.
create or replace function game.politics_rules() returns table (politics jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'politics'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.politics_rules() from public;
grant execute on function game.politics_rules() to authenticated;

create or replace view public.elections with (security_invoker = true) as
  select id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at
  from game.elections;
create or replace view public.election_candidates with (security_invoker = true) as
  select id, election_id, house_id, created_at as filed_at, withdrawn_at from game.candidacies;
create or replace view public.election_results with (security_invoker = true) as
  select r.election_id, r.candidacy_id, r.house_id, r.votes,
         exists (select 1 from game.offices o where o.election_id = r.election_id and o.house_id = r.house_id) as elected
  from game.election_results() r;
-- Charges pourvues, mandats passés compris ; `in_office` : en cours à l'instant de la lecture.
create or replace view public.offices with (security_invoker = true) as
  select id, world_id, city_id, office, house_id, election_id, starts_at, ends_at,
         starts_at <= now() and now() < ends_at as in_office
  from game.offices;
-- « J'ai voté » : les bulletins de la maison du joueur, sans la candidature choisie.
create or replace view public.my_ballots with (security_invoker = true) as
  select election_id, house_id, cast_at from game.ballots;
create or replace view public.politics_rules with (security_invoker = true) as
  select politics from game.politics_rules();
grant select on public.elections, public.election_candidates, public.election_results, public.offices,
  public.my_ballots, public.politics_rules to authenticated;
