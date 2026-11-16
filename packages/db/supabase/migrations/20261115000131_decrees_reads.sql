-- Lectures des décrets par les joueurs (docs/specs/06-cites-politique-communaute.md, 6.3 ; ticket 261).
-- Les décrets de chaque cité sont publics, leur décompte seulement après le dépouillement (nul avant). Le vote
-- est secret : un joueur ne lit que le fait que sa maison a voté, jamais son choix, et le vote d'aucune autre.
-- Rejouable (règles recréées, `create or replace`, droits redonnés) ; le code précédent ne lit ni ces
-- fonctions ni ces vues. Les vues sont créées sous condition : les effets des décrets (#262, #263) pourront
-- les étendre sans que le rejeu de cette migration échoue (ADR 0006).

drop policy if exists decrees_read on game.decrees;
create policy decrees_read on game.decrees for select to authenticated using (true);
drop policy if exists decree_votes_read_own on game.decree_votes;
create policy decree_votes_read_own on game.decree_votes for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, world_id, city_id, model, params, proposed_by, status, proposed_at, voting_closes_at, quorum_bps,
  tallied_at, electorate, votes_for, votes_against) on game.decrees to authenticated;
grant select (decree_id, house_id, cast_at) on game.decree_votes to authenticated;

-- Règles des décrets en vigueur : une ligne par modèle ouvert, avec les bornes de ses paramètres (`jsonb`, tel
-- que la configuration les écrit) et les règles communes. Règles du jeu connues de tous ; même montage que
-- `politics_rules` (migration 72). Sans section `decrees`, ou sans version en vigueur, aucune ligne.
create or replace function game.decree_rules()
returns table (model text, bounds jsonb, voting_days integer, quorum_bps integer, max_open_per_city integer,
  spending_cap_share_bps integer)
language sql stable security definer
set search_path = ''
as $$
  select m.key, m.value, (d ->> 'votingDays')::integer, (d ->> 'quorumBps')::integer,
         (d ->> 'maxOpenPerCity')::integer, (d ->> 'spendingCapShareBps')::integer
  from config.versions v
  cross join lateral (select v.payload -> 'decrees' as d) section
  cross join lateral jsonb_each(coalesce(section.d -> 'models', '{}'::jsonb)) m
  where v.id = config.active_version_at(now()) and jsonb_typeof(section.d) = 'object';
$$;
revoke all on function game.decree_rules() from public;
grant execute on function game.decree_rules() to authenticated;

do $$
begin
  if to_regclass('public.decrees') is null then
    create view public.decrees with (security_invoker = true) as
      select id, world_id, city_id, model, params, proposed_by, status, proposed_at, voting_closes_at, quorum_bps,
             tallied_at, electorate, votes_for, votes_against
      from game.decrees;
  end if;
  -- « J'ai voté » : les votes de la maison du joueur, sans le choix.
  if to_regclass('public.my_decree_votes') is null then
    create view public.my_decree_votes with (security_invoker = true) as
      select decree_id, house_id, cast_at from game.decree_votes;
  end if;
  if to_regclass('public.decree_rules') is null then
    create view public.decree_rules with (security_invoker = true) as
      select model, bounds, voting_days, quorum_bps, max_open_per_city, spending_cap_share_bps from game.decree_rules();
  end if;
end $$;
grant select on public.decrees, public.my_decree_votes, public.decree_rules to authenticated;
