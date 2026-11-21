-- Liturgies : Timè et Charis du règlement (docs/specs/06-cites-politique-communaute.md, 6.4 ; 04-systemes-gestion.md,
-- 4.1 ; 07-dieux-faveur-evenements.md, 7.1 ; ticket 720). Une liturgie accomplie rapporte de la Timè et de la Charis
-- envers le dieu protecteur de sa cité, une fois ; une dérobade, prélevée d'office à l'échéance (migration 9730), coûte
-- de la Timè, une fois. Les montants viennent de la configuration, que la base ne lit pas ; la base les rattache à leur
-- liturgie. Rejouable (`if not exists`, `create or replace`, déclencheurs et droits recréés) ; compatible avec le code
-- précédent, qui n'écrit aucun de ces motifs ni de ces natures.

-- Charis d'une liturgie accomplie : une ligne `liturgy`, rattachée à sa liturgie, une fois.
alter table game.favor_ledger add column if not exists liturgy_id uuid references game.liturgies (id);
create unique index if not exists favor_ledger_liturgy_once on game.favor_ledger (liturgy_id) where liturgy_id is not null;
grant insert (liturgy_id) on game.favor_ledger to oikos_service;

-- La migration 230, plus la nature `liturgy` : la Charis que sa liturgie accomplie maintenant a fixée, envers son dieu.
create or replace function game.guard_favor_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Charis movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.liturgy_id is not null and new.kind <> 'liturgy' then
    raise exception 'only a liturgy movement names a liturgy' using errcode = 'restrict_violation';
  end if;
  if new.kind = 'grace' then
    if new.game_day is not null or new.offering_id is not null or not exists (
         select 1 from game.graces_used g
         where g.id = new.grace_use_id and g.invoked_at = now()
           and (g.world_id, g.house_id, g.god_id, g.charis_spent) = (new.world_id, new.house_id, new.god_id, -new.amount)) then
      raise exception 'a grace spends its own Charis, when invoked' using errcode = 'restrict_violation';
    end if;
  elsif new.grace_use_id is not null then
    raise exception 'only a grace movement names a grace' using errcode = 'restrict_violation';
  elsif new.kind = 'offering' then
    if new.game_day is not null or not exists (
         select 1 from game.offerings o
         where o.id = new.offering_id and o.created_at = now()
           and (o.world_id, o.house_id, o.god_id, o.charis) = (new.world_id, new.house_id, new.god_id, new.amount)) then
      raise exception 'an offering adds its own Charis, when it is made' using errcode = 'restrict_violation';
    end if;
  elsif new.offering_id is not null then
    raise exception 'only an offering movement names an offering' using errcode = 'restrict_violation';
  elsif new.kind = 'liturgy' then
    if new.game_day is not null or not exists (
         select 1 from game.liturgies l
         where l.id = new.liturgy_id and l.status = 'performed' and l.settled_at = now()
           and (l.world_id, l.house_id, l.god_id, l.charis_gained) = (new.world_id, new.house_id, new.god_id, new.amount)) then
      raise exception 'a performed liturgy adds its own Charis, when performed' using errcode = 'restrict_violation';
    end if;
  elsif new.kind = 'decay' then
    if new.amount > 0 or new.game_day is null then
      raise exception 'a decay removes Charis on a game day' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
      raise exception 'a decay is written before its close is recorded' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Charis movement' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_favor_movement() from public, anon, authenticated, oikos_service;

-- La migration 7040, plus deux motifs. `liturgy_performed` : un gain, pour une liturgie de la même maison et du même
-- monde accomplie maintenant. `liturgy_evaded` : une perte, pour une liturgie de la même maison, échue et encore
-- désignée, écrite par la clôture avant d'être prélevée (même verrou que la clôture) ; à la validation, la clôture de
-- son jour est enregistrée et la liturgie prélevée ce jour-là.
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
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
      raise exception 'an archon term is credited before its close is recorded' using errcode = 'restrict_violation';
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
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
      raise exception 'an evaded liturgy is charged before its close is recorded' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Timè reason' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create or replace function game.check_honor_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.game_day) then
    if new.reason = 'archon_term' then
      raise exception 'an archon term is credited by the close of its day' using errcode = 'restrict_violation';
    end if;
    raise exception 'an evaded liturgy is charged by the close of its day' using errcode = 'restrict_violation';
  end if;
  if new.reason = 'liturgy_evaded' and not exists (
       select 1 from game.liturgies l where l.id = new.reference and l.status = 'levied' and l.settled_day = new.game_day) then
    raise exception 'an evaded liturgy is levied by the close that charges it' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_honor_movement(), game.check_honor_on_close() from public, anon, authenticated, oikos_service;
drop trigger if exists honor_ledger_on_close on game.honor_ledger;
create constraint trigger honor_ledger_on_close after insert on game.honor_ledger
  deferrable initially deferred for each row when (new.reason in ('archon_term', 'liturgy_evaded'))
  execute function game.check_honor_on_close();
