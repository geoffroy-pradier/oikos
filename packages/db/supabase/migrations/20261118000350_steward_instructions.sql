-- Consignes d'intendant en langage naturel (docs/specs/04-systemes-gestion.md, 4.4 ; 8.1, 8.4 ; ticket 280) : le
-- joueur écrit une consigne, le moteur la fait traduire par la passerelle IA en règles de la grammaire fermée et
-- les simule à blanc ; il enregistre la proposition, ou un refus motivé. Le joueur valide par `steward.setRules` :
-- rien ici n'est mené par l'intendant. Consignes et propositions sont privées, comme les règles.
-- Rejouable (`if not exists`, `create or replace`, règles recréées) ; le code précédent ne lit ni n'écrit ces
-- tables, cette vue ni cette fonction.

-- Une consigne d'un intendant en poste, en attente du moteur (`pending`) puis répondue (`answered`), une seule en
-- attente par intendant. `rules_revision` : la révision des règles que le joueur avait sous les yeux, si bien
-- qu'une proposition est caduque dès que ses règles ont changé. Le texte est effacé par la fonction du
-- propriétaire à la conservation de la discussion (ADR 0002) ; il n'entre pas au journal des commandes.
create table if not exists game.steward_instructions (
  id uuid primary key default game.uuid_v7(),
  steward_id uuid not null references game.stewards (id),
  rules_revision integer not null check (rules_revision >= 0),
  text text check (char_length(text) between 1 and 500 and text ~ '\S'),
  status text not null default 'pending' check (status in ('pending', 'answered')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  constraint steward_instructions_answered check ((status = 'answered') = (answered_at is not null))
);
create unique index if not exists steward_instructions_one_pending_idx on game.steward_instructions (steward_id)
  where status = 'pending';
create index if not exists steward_instructions_steward_idx on game.steward_instructions (steward_id, created_at desc);
-- La purge de la conservation ne parcourt que les textes encore présents.
create index if not exists steward_instructions_purge_idx on game.steward_instructions (created_at) where text is not null;

-- Réponse du moteur à une consigne, une seule, jamais modifiée : les règles proposées (`stewardRulesSchema`) et leur
-- simulation à blanc (`stewardSimulationSchema`, nulle si elle n'a pas pu être faite), ou un code de refus.
create table if not exists game.steward_proposals (
  instruction_id uuid primary key references game.steward_instructions (id),
  rules jsonb check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 20),
  simulation jsonb check (jsonb_typeof(simulation) = 'array'),
  refusal text check (refusal ~ '^[A-Z][A-Z_]{1,63}$'),
  created_at timestamptz not null default now(),
  constraint steward_proposals_answer check ((rules is null) <> (refusal is null)),
  constraint steward_proposals_simulation check (simulation is null or rules is not null)
);

-- Une consigne s'écrit maintenant, en attente, pour un intendant en poste, à sa révision en vigueur. Ensuite, seul
-- son état change, une fois, vers `answered`, quand sa réponse existe ; son texte ne s'efface que par la purge de
-- la conservation, qui pose un réglage local le temps de l'écriture. Rien ne la supprime.
create or replace function game.guard_steward_instruction() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a steward instruction is never removed' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.status <> 'pending' or new.answered_at is not null
       or new.text is null then
      raise exception 'an instruction is submitted now, pending' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.stewards s where s.id = new.steward_id and s.dismissed_at is null
                     and s.rules_revision = new.rules_revision) then
      raise exception 'an instruction is given to a steward in post, at his current rules'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.steward_id, new.rules_revision, new.created_at)
     is distinct from (old.id, old.steward_id, old.rules_revision, old.created_at) then
    raise exception 'a steward instruction is immutable' using errcode = 'restrict_violation';
  end if;
  if new.text is distinct from old.text
     and (new.text is not null or pg_catalog.current_setting('oikos.steward_instruction_purge', true) is distinct from 'on') then
    raise exception 'an instruction text is only erased by the retention purge' using errcode = 'restrict_violation';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending'
       or not exists (select 1 from game.steward_proposals p where p.instruction_id = new.id) then
      raise exception 'an instruction is answered once, by its proposal' using errcode = 'restrict_violation';
    end if;
    new.answered_at := now();
  elsif new.answered_at is distinct from old.answered_at then
    raise exception 'a steward instruction is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_steward_instruction() from public, anon, authenticated, oikos_service;
drop trigger if exists steward_instructions_guard on game.steward_instructions;
create trigger steward_instructions_guard before insert or update or delete on game.steward_instructions
  for each row execute function game.guard_steward_instruction();
drop trigger if exists steward_instructions_no_truncate on game.steward_instructions;
create trigger steward_instructions_no_truncate before truncate on game.steward_instructions
  for each statement execute function game.forbid_change();

-- Une proposition s'inscrit maintenant, pour une consigne en attente d'un intendant en poste ; elle ne change plus.
create or replace function game.guard_steward_proposal() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a steward proposal does not change' using errcode = 'restrict_violation';
  end if;
  if new.created_at is distinct from now() then
    raise exception 'a steward proposal is recorded now' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from game.steward_instructions i join game.stewards s on s.id = i.steward_id
                 where i.id = new.instruction_id and i.status = 'pending' and s.dismissed_at is null) then
    raise exception 'a proposal answers a pending instruction of a steward in post' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_steward_proposal() from public, anon, authenticated, oikos_service;
drop trigger if exists steward_proposals_guard on game.steward_proposals;
create trigger steward_proposals_guard before insert or update or delete on game.steward_proposals
  for each row execute function game.guard_steward_proposal();
drop trigger if exists steward_proposals_no_truncate on game.steward_proposals;
create trigger steward_proposals_no_truncate before truncate on game.steward_proposals
  for each statement execute function game.forbid_change();

-- Le service lit, inscrit une consigne (sans choisir ni l'identifiant, ni l'état, ni les dates), puis n'en change que
-- l'état ; il inscrit une proposition sans choisir sa date. Un joueur lit les consignes et propositions de ses
-- propres intendants, colonnes accordées une à une ; il n'écrit rien.
alter table game.steward_instructions enable row level security;
revoke all on game.steward_instructions from public, anon, authenticated, oikos_service;
grant select on game.steward_instructions to oikos_service;
grant insert (steward_id, rules_revision, text) on game.steward_instructions to oikos_service;
grant update (status) on game.steward_instructions to oikos_service;
drop policy if exists service_all on game.steward_instructions;
create policy service_all on game.steward_instructions for all to oikos_service using (true) with check (true);
drop policy if exists steward_instructions_read_own on game.steward_instructions;
create policy steward_instructions_read_own on game.steward_instructions for select to authenticated
  using (steward_id in (select s.id from game.stewards s where s.house_id in (select game.current_house_ids())));
grant select (id, steward_id, rules_revision, text, status, created_at, answered_at)
  on game.steward_instructions to authenticated;

alter table game.steward_proposals enable row level security;
revoke all on game.steward_proposals from public, anon, authenticated, oikos_service;
grant select on game.steward_proposals to oikos_service;
grant insert (instruction_id, rules, simulation, refusal) on game.steward_proposals to oikos_service;
drop policy if exists service_all on game.steward_proposals;
create policy service_all on game.steward_proposals for all to oikos_service using (true) with check (true);
drop policy if exists steward_proposals_read_own on game.steward_proposals;
create policy steward_proposals_read_own on game.steward_proposals for select to authenticated
  using (instruction_id in (select i.id from game.steward_instructions i join game.stewards s on s.id = i.steward_id
                            where s.house_id in (select game.current_house_ids())));
grant select (instruction_id, rules, simulation, refusal, created_at) on game.steward_proposals to authenticated;

-- Efface le texte des consignes écrites avant `before` et rend leur nombre. Comme pour les messages (migration 92) :
-- jamais une consigne de moins d'un jour ; le réglage local n'ouvre la garde que le temps de l'écriture.
create or replace function game.purge_steward_instructions(before timestamptz) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged bigint;
begin
  if before is null or before > pg_catalog.clock_timestamp() - interval '1 day' then
    raise exception 'instructions younger than one day cannot be purged'
      using errcode = 'check_violation', constraint = 'steward_instructions_purge_keeps_one_day';
  end if;
  perform pg_catalog.set_config('oikos.steward_instruction_purge', 'on', true);
  update game.steward_instructions i set text = null where i.created_at < before and i.text is not null;
  get diagnostics purged = row_count;
  perform pg_catalog.set_config('oikos.steward_instruction_purge', 'off', true);
  return purged;
end;
$$;
revoke execute on function game.purge_steward_instructions(timestamptz) from public, anon, authenticated;
grant execute on function game.purge_steward_instructions(timestamptz) to oikos_service;

-- Vue de la maison pour la fiche de site : la dernière consigne de chacun de ses intendants en poste, avec sa
-- réponse. Créée sous condition (ADR 0006) : rejouée, cette migration ne la recrée pas.
do $$
begin
  if to_regclass('public.my_steward_instructions') is null then
    create view public.my_steward_instructions with (security_invoker = true) as
      select s.id as steward_id, s.site_id, i.id as instruction_id, i.rules_revision, i.text, i.status,
             i.created_at, i.answered_at, p.rules, p.simulation, p.refusal
      from game.stewards s
      cross join lateral (
        select i.id, i.rules_revision, i.text, i.status, i.created_at, i.answered_at
        from game.steward_instructions i where i.steward_id = s.id
        order by i.created_at desc, i.id desc limit 1
      ) i
      left join game.steward_proposals p on p.instruction_id = i.id
      where s.dismissed_at is null;
  end if;
end $$;
revoke all on public.my_steward_instructions from public, anon, authenticated;
grant select on public.my_steward_instructions to authenticated;
