-- Commandes d'administration de la modération (docs/specs/15-back-office-olympe.md, 15.1, 15.4 ; ticket 276). Ce que
-- les gardes de la migration 250 admettaient l'est toujours (naissance, appel, purge). Rejouable (`if not exists`,
-- contraintes et fonctions recréées, droits redonnés) ; le code précédent n'écrit aucune de ces colonnes, et une
-- sanction levée y reste lisible : sa fin devient l'instant de la levée.

-- Levée (fin avancée à cet instant, par un compte), décision sur l'appel, traitement d'un signalement.
alter table admin.sanctions add column if not exists lifted_at timestamptz;
alter table admin.sanctions add column if not exists lifted_by uuid references auth.users (id);
alter table admin.sanctions add column if not exists appeal_decision text;
alter table admin.sanctions add column if not exists appeal_decided_by uuid references auth.users (id);
alter table admin.sanctions add column if not exists appeal_decided_at timestamptz;
alter table game.reports add column if not exists resolved_at timestamptz;
alter table game.reports add column if not exists resolved_by uuid references auth.users (id);

-- Une exclusion levée prend une fin, celle de sa levée ; une sanction levée avant son début finit avant lui. Un appel
-- est tranché par une autre personne que l'auteur de la sanction et que le compte sanctionné.
alter table admin.sanctions drop constraint if exists sanctions_end_unless_ban,
  drop constraint if exists sanctions_end_unless_ban_in_force, drop constraint if exists sanctions_ends_after_start,
  drop constraint if exists sanctions_lift_shape, drop constraint if exists sanctions_decision_shape,
  drop constraint if exists sanctions_decided_by_other,
  add constraint sanctions_end_unless_ban_in_force check ((kind = 'ban' and lifted_at is null) = (ends_at is null)),
  add constraint sanctions_ends_after_start check (ends_at > starts_at or (lifted_at is not null and ends_at = lifted_at)),
  add constraint sanctions_lift_shape check ((lifted_at is null) = (lifted_by is null)
    and (lifted_at is null or ends_at = lifted_at) and lifted_by <> user_id),
  add constraint sanctions_decision_shape check ((appeal_decision is null) = (appeal_decided_by is null)
    and (appeal_decision is null) = (appeal_decided_at is null)
    and (appeal_decision is null or (appeal_decision in ('granted', 'rejected') and appeal_body is not null))),
  add constraint sanctions_decided_by_other check (appeal_decided_by <> author_id and appeal_decided_by <> user_id);
alter table game.reports drop constraint if exists reports_resolution_shape, add constraint reports_resolution_shape
  check ((state = 'open') = (resolved_at is null) and (resolved_at is null) = (resolved_by is null));
-- File de la modération : exclusions à valider, appels à trancher.
create index if not exists sanctions_pending_ban_idx on admin.sanctions (created_at)
  where kind = 'ban' and validated_by is null and lifted_at is null;
create index if not exists sanctions_pending_appeal_idx on admin.sanctions (appealed_at)
  where appeal_body is not null and appeal_decision is null;

-- La garde de la migration 250 ne tient plus que la naissance d'un signalement ; ses changements passent par
-- celle-ci. Outre le départ de son message à la purge, un signalement est traité une fois : ouvert, il est écarté
-- ou retenu par un compte autre que ceux de la maison signalée et de celle qui signale ; la base le date.
create or replace function game.guard_report_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.resolved_at is not null or new.resolved_by is not null then
      raise exception 'a report is filed now, open' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if new.message_id is null and old.message_id is not null
     and pg_catalog.current_setting('oikos.message_purge', true) = 'on'
     and (new.id, new.reported_house_id, new.house_id, new.reason, new.state, new.created_at, new.resolved_at,
          new.resolved_by)
         is not distinct from (old.id, old.reported_house_id, old.house_id, old.reason, old.state, old.created_at,
          old.resolved_at, old.resolved_by) then
    return new;
  end if;
  if old.state = 'open' and new.state in ('dismissed', 'upheld') and old.resolved_by is null
     and new.resolved_by is not null
     and (new.id, new.message_id, new.reported_house_id, new.house_id, new.reason, new.created_at)
         is not distinct from (old.id, old.message_id, old.reported_house_id, old.house_id, old.reason,
          old.created_at) then
    if exists (select 1 from game.houses h
               where h.id in (new.reported_house_id, new.house_id) and h.user_id = new.resolved_by) then
      raise exception 'a report is resolved by another account than the reported one and the reporter'
        using errcode = 'check_violation', constraint = 'reports_resolved_by_other';
    end if;
    new.resolved_at := now();
    return new;
  end if;
  raise exception 'a report is immutable' using errcode = 'restrict_violation';
end;
$$;

-- Une sanction naît maintenant, sans appel, ni levée, ni décision. Ensuite, un seul changement par écriture, daté par
-- la base : l'appel (migration 250), une fois, sur une sanction pas encore finie ; la validation d'une exclusion, une
-- fois, par une autre personne que son auteur et que le compte exclu, qui la fait commencer ; la décision sur l'appel,
-- une fois : accueilli, il lève par le même compte, et seul il lève, la sanction pas encore finie, qui finit alors.
create or replace function admin.guard_sanction() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  decided boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.appeal_body is not null or new.appealed_at is not null
       or num_nonnulls(new.lifted_at, new.lifted_by, new.appeal_decision, new.appeal_decided_by,
                       new.appeal_decided_at) > 0 then
      raise exception 'a sanction is pronounced now, without appeal' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.user_id, new.kind, new.reason, new.author_id, new.created_at)
     is distinct from (old.id, old.user_id, old.kind, old.reason, old.author_id, old.created_at) then
    raise exception 'a sanction only changes by appeal, confirmation, decision or lift'
      using errcode = 'restrict_violation';
  end if;
  if new.appeal_body is distinct from old.appeal_body or new.appealed_at is distinct from old.appealed_at then
    if (new.starts_at, new.ends_at, new.validated_by, new.lifted_at, new.lifted_by, new.appeal_decision,
        new.appeal_decided_by, new.appeal_decided_at)
       is distinct from (old.starts_at, old.ends_at, old.validated_by, old.lifted_at, old.lifted_by,
        old.appeal_decision, old.appeal_decided_by, old.appeal_decided_at)
       or old.appeal_body is not null or new.appeal_body is null then
      raise exception 'a sanction only takes one appeal' using errcode = 'restrict_violation';
    end if;
    if now() >= coalesce(old.ends_at, 'infinity') then
      raise exception 'an ended sanction is not appealed'
        using errcode = 'check_violation', constraint = 'sanctions_appeal_in_force';
    end if;
    new.appealed_at := now();
    return new;
  end if;
  if new.validated_by is distinct from old.validated_by then
    if old.kind <> 'ban' or old.validated_by is not null or new.validated_by is null
       or (new.ends_at, new.lifted_at, new.lifted_by, new.appeal_decision, new.appeal_decided_by,
           new.appeal_decided_at)
          is distinct from (old.ends_at, old.lifted_at, old.lifted_by, old.appeal_decision, old.appeal_decided_by,
           old.appeal_decided_at) then
      raise exception 'an exclusion is confirmed once, alone' using errcode = 'restrict_violation';
    end if;
    new.starts_at := now();
    return new;
  end if;
  if new.starts_at is distinct from old.starts_at then
    raise exception 'a sanction only changes by appeal, confirmation, decision or lift'
      using errcode = 'restrict_violation';
  end if;
  if (new.appeal_decision, new.appeal_decided_by, new.appeal_decided_at)
     is distinct from (old.appeal_decision, old.appeal_decided_by, old.appeal_decided_at) then
    if old.appeal_body is null or old.appeal_decision is not null or new.appeal_decision is null
       or new.appeal_decided_by is null then
      raise exception 'an appeal is decided once' using errcode = 'restrict_violation';
    end if;
    new.appeal_decided_at := now();
    decided := true;
  end if;
  if (new.ends_at, new.lifted_at, new.lifted_by) is distinct from (old.ends_at, old.lifted_at, old.lifted_by) then
    if not decided or new.appeal_decision <> 'granted' or new.lifted_by is distinct from new.appeal_decided_by then
      raise exception 'a sanction is lifted only by granting its appeal' using errcode = 'restrict_violation';
    end if;
    if now() >= coalesce(old.ends_at, 'infinity') or (old.kind = 'ban' and old.validated_by is null) then
      raise exception 'only a sanction not yet ended is lifted'
        using errcode = 'check_violation', constraint = 'sanctions_lift_not_ended';
    end if;
    new.lifted_at := now();
    new.ends_at := now();
    return new;
  end if;
  if not decided then
    raise exception 'a sanction only changes by appeal, confirmation, decision or lift'
      using errcode = 'restrict_violation';
  end if;
  if new.appeal_decision = 'granted' and now() < coalesce(old.ends_at, 'infinity')
     and (old.kind <> 'ban' or old.validated_by is not null) then
    raise exception 'a granted appeal lifts a sanction not yet ended'
      using errcode = 'check_violation', constraint = 'sanctions_granted_appeal_lifts';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_report_change(), admin.guard_sanction()
  from public, anon, authenticated, oikos_service;
drop trigger if exists reports_guard on game.reports;
create trigger reports_guard before insert on game.reports
  for each row execute function game.guard_report();
drop trigger if exists reports_change_guard on game.reports;
create trigger reports_change_guard before insert or update on game.reports
  for each row execute function game.guard_report_change();

-- Droits du service, en plus de ceux des migrations 90 et 250 : il prononce une sanction sans en choisir ni le
-- début, ni la validation ; il valide, lève et tranche sans en écrire l'instant ; il traite un signalement sans
-- le dater ; il masque un message (la garde de la migration 90 n'admet que maintenant, une fois).
grant insert (user_id, kind, ends_at, reason, author_id) on admin.sanctions to oikos_service;
grant update (appeal_body, validated_by, lifted_by, appeal_decision, appeal_decided_by) on admin.sanctions
  to oikos_service;
grant update (state, resolved_by) on game.reports to oikos_service;
grant update (hidden_at) on game.messages to oikos_service;
