-- Banques de joueurs : Timè perdue et marque de déshonneur d'un prêt saisi (docs/specs/05-economie.md, 5.4 ;
-- 12-modele-donnees.md ; #729).
-- Un prêt de banque saisi (migration 0600) passe en défaut et se solde le jour de sa saisie : il coûte la Timè d'un
-- défaut (motif `loan_defaulted`) ce jour-là, et la marque de déshonneur court jusqu'à la clôture `dishonorDays` jours
-- après ce jour, son solde.
-- Rejouable (`create or replace`, type rendu inchangé, ADR 0006) ; compatible avec le code précédent, qui ne saisit rien.

-- Timè : la migration 9921, plus le prêt saisi, en défaut et soldé le jour de sa saisie.
create or replace function game.guard_honor_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Timè movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.reason = 'archon_term' then
    if new.amount < 0 then
      raise exception 'a completed archon term raises Timè' using errcode = 'restrict_violation';
    end if;
    perform 1 from game.offices o
    where o.id = new.reference and o.house_id = new.house_id and o.world_id = new.world_id and o.ends_at <= now();
    if not found then
      raise exception 'an archon term is credited to its house once ended' using errcode = 'restrict_violation';
    end if;
  elsif new.reason = 'liturgy_performed' then
    if new.amount < 0 then
      raise exception 'a performed liturgy raises Timè' using errcode = 'restrict_violation';
    end if;
    perform 1 from game.liturgies l
    where l.id = new.reference and l.house_id = new.house_id and l.world_id = new.world_id
      and l.status = 'performed' and l.settled_at = now();
    if not found then
      raise exception 'a liturgy is credited to its house when performed' using errcode = 'restrict_violation';
    end if;
    return new;
  elsif new.reason = 'liturgy_evaded' then
    if new.amount > 0 then
      raise exception 'an evaded liturgy lowers Timè' using errcode = 'restrict_violation';
    end if;
    perform 1 from game.liturgies l
    where l.id = new.reference and l.house_id = new.house_id and l.world_id = new.world_id
      and l.status = 'assigned' and l.due_at <= now();
    if not found then
      raise exception 'an evaded liturgy is charged to its house once due' using errcode = 'restrict_violation';
    end if;
  elsif new.reason = 'loan_defaulted' then
    if new.amount > 0 then
      raise exception 'a defaulted loan lowers Timè' using errcode = 'restrict_violation';
    end if;
    -- Passé en défaut ce jour-là, qu'il le reste ou que sa saisie l'ait soldé aussitôt (#729).
    perform 1 from game.loans o
    where o.id = new.reference and o.borrower_house_id = new.house_id and o.world_id = new.world_id
      and o.defaulted_day = new.game_day;
    if not found then
      raise exception 'a defaulted loan is charged to its borrower the day it defaults' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Timè reason' using errcode = 'restrict_violation';
  end if;
  -- Les motifs de la clôture : écrits avant que la clôture de leur jour, ou d'un jour postérieur, soit enregistrée.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
    raise exception using errcode = 'restrict_violation', message = case new.reason
      when 'archon_term' then 'an archon term is credited before its close is recorded'
      when 'liturgy_evaded' then 'an evaded liturgy is charged before its close is recorded'
      else 'a defaulted loan is charged before its close is recorded' end;
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_honor_movement() from public, anon, authenticated, oikos_service;

-- Marque : la migration 9922, plus le prêt saisi, soldé le jour de sa saisie, jour de son défaut, sans remboursement.
create or replace function game.house_dishonor()
returns table (house_id uuid, dishonored boolean, dishonored_until_day integer)
language sql stable security definer
set search_path = ''
as $$
  with marks as (
    select o.borrower_house_id as house_id, bool_or(o.status = 'defaulted') as open,
           max(greatest(r.game_day, case when o.written_off > 0 then o.defaulted_day end))
             filter (where o.status = 'repaid' and o.defaulted_day is not null) as repaid_day
    from game.loans o
    left join lateral (select max(p.game_day) as game_day from game.loan_repayments p where p.loan_id = o.id) r
      on o.status = 'repaid'
    where o.world_id in (select game.current_world_ids()) and (o.status = 'defaulted' or o.defaulted_day is not null)
    group by o.borrower_house_id
  ), ends as (
    select m.house_id, m.open,
           m.repaid_day + coalesce((select (v.payload -> 'templeTreasury' ->> 'dishonorDays')::integer
             from config.versions v where v.id = config.active_version_at(now())), 0) as until_day
    from marks m
  )
  select e.house_id, e.open or coalesce(game.game_day_at(now()) < e.until_day, false),
         case when not e.open and game.game_day_at(now()) < e.until_day then e.until_day end
  from ends e
  where e.open or game.game_day_at(now()) < e.until_day;
$$;
revoke all on function game.house_dishonor() from public, anon;
grant execute on function game.house_dishonor() to authenticated;
