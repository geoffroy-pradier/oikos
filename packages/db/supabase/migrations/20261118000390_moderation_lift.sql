-- Retrait d'une exclusion proposée, levée d'une sanction sans appel (docs/specs/15-back-office-olympe.md, 15.4 ;
-- ticket 531). Ce que la garde de la migration 260 admettait l'est toujours (naissance, appel, validation, décision,
-- levée par un appel accueilli), sauf la validation d'une exclusion retirée, que rien n'écrivait.
-- Rejouable (`if not exists`, contraintes et fonctions recréées, droits redonnés) ; le code précédent n'écrit ni ne
-- lit les colonnes nouvelles, et ne lève ni ne retire rien sans appel.

-- Proposition de lever une exclusion validée, à confirmer par une seconde personne (double validation, 15.4).
alter table admin.sanctions add column if not exists lift_proposed_by uuid references auth.users (id);
alter table admin.sanctions add column if not exists lift_proposed_at timestamptz;
alter table admin.sanctions drop constraint if exists sanctions_lift_proposal_shape,
  add constraint sanctions_lift_proposal_shape check ((lift_proposed_by is null) = (lift_proposed_at is null)
    and (lift_proposed_by is null or (kind = 'ban' and validated_by is not null)) and lift_proposed_by <> user_id);

-- Une sanction naît maintenant, sans appel, ni levée, ni décision, ni proposition de levée. Ensuite, un seul
-- changement par écriture, daté par la base :
-- - l'appel, une fois, sur une sanction pas encore finie (migration 250) ;
-- - la validation d'une exclusion ni validée ni retirée, une fois, par une autre personne que son auteur et que le
--   compte exclu (contrainte), qui la fait commencer ;
-- - la proposition de lever une exclusion validée pas encore finie, une fois, hors d'un appel à trancher ;
-- - la décision sur l'appel, une fois : accueilli, il lève par le même compte la sanction pas encore finie ;
-- - la levée sans appel d'une sanction pas encore finie, hors d'un appel à trancher, par un autre compte que le
--   sanctionné (contrainte) : le retrait d'une exclusion proposée ; pour une exclusion validée, la confirmation
--   d'une proposition de levée par une autre personne que celle qui l'a faite ; pour toute autre sanction, seule.
-- Une levée, ou un retrait, fait finir la sanction à cet instant.
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
    if now() >= coalesce(old.ends_at, 'infinity') then
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
  if new.appeal_decision = 'granted' and now() < coalesce(old.ends_at, 'infinity')
     and (old.kind <> 'ban' or old.validated_by is not null) then
    raise exception 'a granted appeal lifts a sanction not yet ended'
      using errcode = 'check_violation', constraint = 'sanctions_granted_appeal_lifts';
  end if;
  return new;
end;
$$;

-- Depuis la migration 260, la garde de la migration 250 ne tient plus que la naissance d'un signalement : son
-- déclencheur n'est appelé qu'à l'insertion, et `game.guard_report_change()` tient les changements. Sa branche de
-- mise à jour, jamais atteinte, est retirée.
create or replace function game.guard_report() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  message game.messages;
  channel game.channels;
begin
  if new.created_at is distinct from now() or new.state <> 'open' then
    raise exception 'a report is filed now, open' using errcode = 'restrict_violation';
  end if;
  select * into message from game.messages m where m.id = new.message_id;
  if not found then
    raise exception 'a report is filed on an existing message'
      using errcode = 'check_violation', constraint = 'reports_message_exists';
  end if;
  if message.hidden_at is not null then
    raise exception 'only a visible message is reported'
      using errcode = 'check_violation', constraint = 'reports_message_visible';
  end if;
  if new.reported_house_id is distinct from message.house_id then
    raise exception 'a report names the house that wrote the message'
      using errcode = 'check_violation', constraint = 'reports_names_author';
  end if;
  select * into channel from game.channels c where c.id = message.channel_id;
  if (channel.kind = 'city' and not exists (
        select 1 from game.citizenships z where z.house_id = new.house_id and z.city_id = channel.city_id))
     or (channel.kind = 'direct' and not exists (
        select 1 from game.channel_members m where m.channel_id = channel.id and m.house_id = new.house_id)) then
    raise exception 'a house only reports a message it reads'
      using errcode = 'check_violation', constraint = 'reports_reader';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_report(), admin.guard_sanction()
  from public, anon, authenticated, oikos_service;

-- Droits du service, en plus de ceux des migrations 250 et 260 : il propose une levée sans en écrire l'instant.
grant update (lift_proposed_by) on admin.sanctions to oikos_service;
