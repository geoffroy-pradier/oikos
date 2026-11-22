-- Règlement des décrets de ligue (docs/specs/06-cites-politique-communaute.md, 6.3 et 6.5 ; ticket 737). Un décret
-- de ligue adopté passe une fois à `applied`, avec son effet écrit dans la même transaction (migration 500), ou devient
-- caduc (`lapsed`) sans effet ; il n'a pas de jour de règlement. Rejouable ; le code précédent ne règle aucun décret
-- de ligue, et la garde ne change pas pour les autres modèles.

-- Une demande d'entrée n'est admise qu'une fois, son identifiant lu sans casse.
create unique index if not exists decrees_league_request_admitted_once
  on game.decrees ((lower(params ->> 'joinDecreeId'))) where model = 'league_admit' and status = 'applied';
-- Chaque fait de ligue n'est annoncé qu'une fois, même si l'étape était jouée deux fois.
create unique index if not exists domain_events_league_founded_once on game.domain_events ((payload ->> 'decreeId'))
  where type = 'LeagueFounded';
create unique index if not exists domain_events_league_joined_once on game.domain_events ((payload ->> 'decreeId'))
  where type = 'LeagueJoined';
create unique index if not exists domain_events_league_left_once
  on game.domain_events ((payload ->> 'decreeId'), (payload ->> 'cityId')) where type = 'LeagueLeft';

-- Garde des décrets (migration 170), plus le règlement d'un décret de ligue : appliqué une fois, maintenant, avec son
-- effet écrit dans la transaction (la ligue fondée, la cité admise, la cité sortie ; une demande d'entrée appliquée
-- est une cité hors de toute ligue qui vise une ligue en activité), ou caduc sans effet. Sans jour de règlement.
create or replace function game.guard_decree() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  votes_for integer;
  votes_against integer;
  electorate integer;
  adopted boolean;
  effect boolean;
begin
  if tg_op = 'INSERT' then
    if new.proposed_at is distinct from now() or new.status <> 'proposed' or new.tallied_at is not null then
      raise exception 'a decree is proposed now, untallied' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.offices o
                   where o.id = new.office_id and o.office = 'archon' and o.city_id = new.city_id
                     and o.house_id = new.proposed_by and o.starts_at <= now() and now() < o.ends_at) then
      raise exception 'only the archon in office proposes' using errcode = 'check_violation', constraint = 'decrees_archon_only';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.city_id, new.model, new.params, new.office_id, new.proposed_by, new.proposed_at,
      new.voting_closes_at, new.quorum_bps)
     is distinct from (old.id, old.world_id, old.city_id, old.model, old.params, old.office_id, old.proposed_by,
      old.proposed_at, old.voting_closes_at, old.quorum_bps) then
    raise exception 'a decree is immutable' using errcode = 'restrict_violation';
  end if;
  if old.status = 'adopted' and new.status in ('applied', 'lapsed') then
    if (new.tallied_at, new.electorate, new.votes_for, new.votes_against)
       is distinct from (old.tallied_at, old.electorate, old.votes_for, old.votes_against) then
      raise exception 'a decree is applied once, now' using errcode = 'restrict_violation';
    end if;
    if new.model in ('league_found', 'league_join', 'league_admit', 'league_leave') then
      if new.settled_day is not null
         or new.applied_at is distinct from (case when new.status = 'applied' then now() end) then
        raise exception 'a league decree is settled once, now' using errcode = 'restrict_violation';
      end if;
      effect := case new.model
        when 'league_join' then
          not exists (select 1 from game.league_members m where m.city_id = new.city_id and m.left_at is null)
             and exists (select 1 from game.leagues l
                         where l.id = case when new.params ->> 'leagueId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                         then (new.params ->> 'leagueId')::uuid end
                           and l.world_id = new.world_id
                           and l.dissolved_at is null)
        when 'league_leave' then exists (select 1 from game.league_members m where m.exit_decree_id = new.id)
        -- Fondation ou admission : la cité est entrée par ce décret (la fondation a écrit sa ligue avant).
        else exists (select 1 from game.league_members m where m.entry_decree_id = new.id) end;
      if new.status = 'applied' and not effect
         or new.status = 'lapsed' and new.model <> 'league_join' and effect
         or new.status = 'lapsed' and exists (select 1 from game.leagues l where l.founding_decree_id = new.id) then
        raise exception 'a league decree is applied with its effect, and lapses without one'
          using errcode = 'restrict_violation';
      end if;
      return new;
    end if;
    if new.model in ('market_tax_rate', 'port_dues') then
      if new.status <> 'applied' or new.applied_at is distinct from now() or new.settled_day is not null then
        raise exception 'a decree is applied once, now' using errcode = 'restrict_violation';
      end if;
      return new;
    end if;
    if new.settled_day is null
       or new.applied_at is distinct from (case when new.status = 'applied' then now() end) then
      raise exception 'a spending decree is settled once, now, on its close' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.settled_day) then
      raise exception 'a spending decree is settled before its close is recorded' using errcode = 'restrict_violation';
    end if;
    -- Appliqué : une écriture de son modèle qui le désigne débite le trésor de sa cité. Caduc : aucune écriture.
    if (new.status = 'applied' and not exists (
          select 1 from game.ledger_entries e
          join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
          where e.kind = case new.model when 'public_works' then 'city.public_works' else 'city.festival' end
            and e.meta ->> 'decreeId' = new.id::text and l.amount < 0 and a.kind = 'treasury' and a.city_id = new.city_id))
       or (new.status = 'lapsed' and exists (select 1 from game.ledger_entries e
          where e.kind in ('city.public_works', 'city.festival') and e.meta ->> 'decreeId' = new.id::text)) then
      raise exception 'a spending decree is applied with its payment, and lapses without one'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.status <> 'proposed' or new.status not in ('adopted', 'rejected') or new.tallied_at is distinct from now() then
    raise exception 'a decree is tallied once, now' using errcode = 'restrict_violation';
  end if;
  if now() < old.voting_closes_at then
    raise exception 'a decree is tallied after its vote' using errcode = 'restrict_violation';
  end if;
  select count(*) filter (where v.approve), count(*) filter (where not v.approve) into votes_for, votes_against
  from game.decree_votes v where v.decree_id = new.id;
  select count(*) into electorate from game.citizenships c
  where c.city_id = new.city_id and c.status = 'citizen' and c.since < new.voting_closes_at;
  adopted := (votes_for + votes_against)::bigint * 10000 >= new.quorum_bps::bigint * electorate
             and votes_for > votes_against;
  if (new.votes_for, new.votes_against, new.electorate, new.status)
     is distinct from (votes_for, votes_against, electorate, case when adopted then 'adopted' else 'rejected' end) then
    raise exception 'a decree tally follows its votes' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_decree() from public, anon, authenticated, oikos_service;
