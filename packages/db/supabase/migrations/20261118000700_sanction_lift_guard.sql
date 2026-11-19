-- Garde des sanctions : une levée ne se réécrit pas (docs/specs/15-back-office-olympe.md, 15.4 ; ticket 616, suite de
-- la relecture de 531). Ce que la garde de la migration 390 admettait l'est toujours, sauf ce qui touche une sanction
-- déjà levée ou retirée (`lifted_by` posé) : ni appel, ni proposition de levée, ni levée par un appel accueilli.
-- La migration 390 le refusait déjà par l'heure (une levée fait finir la sanction à son instant), sauf quand la
-- transaction qui écrit a commencé avant celle qui a levé : son `now()` précède alors la fin. Un appel ainsi écrit
-- après une levée aurait laissé un appel à trancher sur une sanction levée, et l'appel accueilli en aurait réécrit
-- l'auteur et l'instant. Un appel accueilli sur une sanction déjà levée ne la lève donc pas de nouveau.
-- Rejouable (`create or replace`, droits redonnés) ; le code précédent n'écrit rien de ce qui est refusé en plus,
-- et sa décision sur un tel appel, qui lèverait, est refusée au lieu de réécrire la levée.

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
                       new.appeal_decided_at, new.lift_proposed_by, new.lift_proposed_at) > 0 then
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
        new.appeal_decided_by, new.appeal_decided_at, new.lift_proposed_by, new.lift_proposed_at)
       is distinct from (old.starts_at, old.ends_at, old.validated_by, old.lifted_at, old.lifted_by,
        old.appeal_decision, old.appeal_decided_by, old.appeal_decided_at, old.lift_proposed_by, old.lift_proposed_at)
       or old.appeal_body is not null or new.appeal_body is null then
      raise exception 'a sanction only takes one appeal' using errcode = 'restrict_violation';
    end if;
    if old.lifted_by is not null or now() >= coalesce(old.ends_at, 'infinity') then
      raise exception 'an ended sanction is not appealed'
        using errcode = 'check_violation', constraint = 'sanctions_appeal_in_force';
    end if;
    new.appealed_at := now();
    return new;
  end if;
  if new.validated_by is distinct from old.validated_by then
    if old.kind <> 'ban' or old.validated_by is not null or new.validated_by is null
       or (new.ends_at, new.lifted_at, new.lifted_by, new.appeal_decision, new.appeal_decided_by,
           new.appeal_decided_at, new.lift_proposed_by, new.lift_proposed_at)
          is distinct from (old.ends_at, old.lifted_at, old.lifted_by, old.appeal_decision, old.appeal_decided_by,
           old.appeal_decided_at, old.lift_proposed_by, old.lift_proposed_at) then
      raise exception 'an exclusion is confirmed once, alone' using errcode = 'restrict_violation';
    end if;
    if old.lifted_at is not null then
      raise exception 'a withdrawn exclusion is not confirmed'
        using errcode = 'check_violation', constraint = 'sanctions_confirm_not_withdrawn';
    end if;
    new.starts_at := now();
    return new;
  end if;
  if new.starts_at is distinct from old.starts_at then
    raise exception 'a sanction only changes by appeal, confirmation, decision or lift'
      using errcode = 'restrict_violation';
  end if;
  if (new.lift_proposed_by, new.lift_proposed_at) is distinct from (old.lift_proposed_by, old.lift_proposed_at) then
    if old.kind <> 'ban' or old.validated_by is null or old.lift_proposed_by is not null
       or new.lift_proposed_by is null
       or (new.ends_at, new.lifted_at, new.lifted_by, new.appeal_decision, new.appeal_decided_by,
           new.appeal_decided_at)
          is distinct from (old.ends_at, old.lifted_at, old.lifted_by, old.appeal_decision, old.appeal_decided_by,
           old.appeal_decided_at) then
      raise exception 'a lift is proposed once, alone, on a confirmed exclusion' using errcode = 'restrict_violation';
    end if;
    if old.lifted_by is not null or now() >= coalesce(old.ends_at, 'infinity') then
      raise exception 'only a sanction not yet ended is lifted'
        using errcode = 'check_violation', constraint = 'sanctions_lift_not_ended';
    end if;
    if old.appeal_body is not null and old.appeal_decision is null then
      raise exception 'a sanction under appeal is lifted by deciding its appeal'
        using errcode = 'check_violation', constraint = 'sanctions_lift_appeal_pending';
    end if;
    new.lift_proposed_at := now();
    return new;
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
    if decided then
      if old.lifted_by is not null then
        raise exception 'a sanction is lifted once, by an account' using errcode = 'restrict_violation';
      end if;
      if new.appeal_decision <> 'granted' or new.lifted_by is distinct from new.appeal_decided_by then
        raise exception 'a sanction is lifted only by granting its appeal' using errcode = 'restrict_violation';
      end if;
      if now() >= coalesce(old.ends_at, 'infinity') or (old.kind = 'ban' and old.validated_by is null) then
        raise exception 'only a sanction not yet ended is lifted'
          using errcode = 'check_violation', constraint = 'sanctions_lift_not_ended';
      end if;
    else
      if old.lifted_by is not null or new.lifted_by is null then
        raise exception 'a sanction is lifted once, by an account' using errcode = 'restrict_violation';
      end if;
      if now() >= coalesce(old.ends_at, 'infinity') then
        raise exception 'only a sanction not yet ended is lifted'
          using errcode = 'check_violation', constraint = 'sanctions_lift_not_ended';
      end if;
      if old.appeal_body is not null and old.appeal_decision is null then
        raise exception 'a sanction under appeal is lifted by deciding its appeal'
          using errcode = 'check_violation', constraint = 'sanctions_lift_appeal_pending';
      end if;
      if old.kind = 'ban' and old.validated_by is not null
         and (old.lift_proposed_by is null or new.lifted_by = old.lift_proposed_by) then
        raise exception 'a confirmed exclusion is lifted by a second person, after a proposal'
          using errcode = 'check_violation', constraint = 'sanctions_lift_confirmed_by_other';
      end if;
    end if;
    new.lifted_at := now();
    new.ends_at := now();
    return new;
  end if;
  if not decided then
    raise exception 'a sanction only changes by appeal, confirmation, decision or lift'
      using errcode = 'restrict_violation';
  end if;
  if new.appeal_decision = 'granted' and old.lifted_by is null and now() < coalesce(old.ends_at, 'infinity')
     and (old.kind <> 'ban' or old.validated_by is not null) then
    raise exception 'a granted appeal lifts a sanction not yet ended'
      using errcode = 'check_violation', constraint = 'sanctions_granted_appeal_lifts';
  end if;
  return new;
end;
$$;

revoke execute on function admin.guard_sanction() from public, anon, authenticated, oikos_service;
