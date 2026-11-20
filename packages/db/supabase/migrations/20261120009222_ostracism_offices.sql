-- Effets de l'ostracisme sur les charges (docs/specs/06-cites-politique-communaute.md, 6.2 à 6.4 ; ticket 722).
-- Jusqu'à la fin de son ostracisme, une maison ne se présente à aucune élection, n'est élue à aucune, et ne
-- propose aucun décret ; archonte en charge, elle la quitte au dépouillement qui l'ostracise (`vacated_at`), et
-- la charge reste vacante jusqu'au mandat suivant. Elle garde ses biens, sa Timè et son vote.
-- Rejouable. Compatible avec le code précédent : sans décret d'ostracisme, qu'il ne sait pas proposer, aucune
-- maison n'est ostracisée et aucune charge n'est quittée, et les gardes remplacées se comportent comme avant.

-- Une maison est-elle ostracisée à un instant : du dépouillement qui l'ostracise (inclus) à la fin (exclue).
create or replace function game.house_ostracized(p_house_id uuid, p_at timestamptz) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from game.ostracisms o
                 where o.ostracized_house_id = p_house_id and o.tallied_at <= p_at and p_at < o.ends_at);
$$;
revoke execute on function game.house_ostracized(uuid, timestamptz) from public, anon, authenticated;
grant execute on function game.house_ostracized(uuid, timestamptz) to oikos_service;

alter table game.offices add column if not exists vacated_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'game.offices'::regclass and conname = 'offices_vacated_in_term') then
    alter table game.offices add constraint offices_vacated_in_term
      check (vacated_at is null or (starts_at <= vacated_at and vacated_at < ends_at));
  end if;
end $$;

-- Garde des charges (migration 71), plus l'ostracisme. Une charge ne change que pour être quittée, une fois,
-- maintenant, pendant son mandat, par une maison qu'un dépouillement de sa cité ostracise dans la transaction.
-- À sa création, l'élu est la candidature maintenue qui a le plus de bulletins, la plus ancienne à égalité,
-- parmi celles des maisons qui ne sont pas ostracisées à cet instant.
create or replace function game.guard_office() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  election game.elections;
  elected uuid;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.world_id, new.city_id, new.office, new.house_id, new.election_id, new.starts_at, new.ends_at)
       is distinct from (old.id, old.world_id, old.city_id, old.office, old.house_id, old.election_id, old.starts_at, old.ends_at)
       or old.vacated_at is not null or new.vacated_at is distinct from now()
       or not exists (select 1 from game.ostracisms o
                      where o.city_id = old.city_id and o.ostracized_house_id = old.house_id and o.tallied_at = now()) then
      raise exception 'an office is final, but for its vacancy by the ostracism of its holder, now'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if new.vacated_at is not null then
    raise exception 'an office is filled, not vacated' using errcode = 'restrict_violation';
  end if;
  select * into election from game.elections e where e.id = new.election_id;
  if election.tallied_at is distinct from now() then
    raise exception 'an office is filled by the tally of its election' using errcode = 'restrict_violation';
  end if;
  if (new.world_id, new.city_id, new.office, new.starts_at, new.ends_at)
     is distinct from (election.world_id, election.city_id, election.office, election.voting_closes_at, election.term_ends_at) then
    raise exception 'an office follows its election calendar' using errcode = 'restrict_violation';
  end if;
  select c.house_id into elected
  from game.candidacies c
  left join game.ballots b on b.candidacy_id = c.id
  where c.election_id = new.election_id and c.withdrawn_at is null and not game.house_ostracized(c.house_id, now())
  group by c.id, c.house_id, c.created_at
  order by count(b.id) desc, c.created_at, c.id
  limit 1;
  if elected is distinct from new.house_id then
    raise exception 'an office goes to the elected candidate' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_office() from public, anon, authenticated, oikos_service;

-- Une maison ostracisée ne propose aucun décret, et une charge quittée n'en propose plus. Verrou partagé sur la
-- charge : le dépouillement qui la fait quitter attend la proposition, ou la proposition l'attend et se voit
-- refuser. S'ajoute à la garde des décrets (migrations 130 à 170), sans la remplacer.
create or replace function game.guard_decree_ostracism() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from game.offices o where o.id = new.office_id and o.vacated_at is null for share;
  if not found then
    raise exception 'only the archon in office proposes' using errcode = 'check_violation', constraint = 'decrees_archon_only';
  end if;
  if game.house_ostracized(new.proposed_by, now()) then
    raise exception 'an ostracized house proposes no decree'
      using errcode = 'check_violation', constraint = 'decrees_not_ostracized';
  end if;
  return new;
end;
$$;
-- Une maison ostracisée ne se présente à aucune élection. S'ajoute à la garde des candidatures (migration 71).
create or replace function game.guard_candidacy_ostracism() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if game.house_ostracized(new.house_id, now()) then
    raise exception 'an ostracized house stands for no election'
      using errcode = 'check_violation', constraint = 'candidacies_not_ostracized';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_decree_ostracism(), game.guard_candidacy_ostracism()
  from public, anon, authenticated, oikos_service;
drop trigger if exists decrees_guard_ostracism on game.decrees;
create trigger decrees_guard_ostracism before insert on game.decrees
  for each row execute function game.guard_decree_ostracism();
drop trigger if exists candidacies_guard_ostracism on game.candidacies;
create trigger candidacies_guard_ostracism before insert on game.candidacies
  for each row execute function game.guard_candidacy_ostracism();

-- Le service quitte une charge (la garde décide quand) ; les joueurs lisent si elle l'est, par `in_office`.
grant update (vacated_at) on game.offices to oikos_service;
grant select (vacated_at) on game.offices to authenticated;
-- Vue de la migration 72, mêmes colonnes (ADR 0006) : une charge quittée n'est plus en cours.
create or replace view public.offices with (security_invoker = true) as
  select id, world_id, city_id, office, house_id, election_id, starts_at, ends_at,
         starts_at <= now() and now() < ends_at and (vacated_at is null or now() < vacated_at) as in_office
  from game.offices;
grant select on public.offices to authenticated;
