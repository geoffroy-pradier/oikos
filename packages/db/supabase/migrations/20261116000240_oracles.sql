-- La Pythie (docs/specs/07-dieux-faveur-evenements.md, 7.3 ; 08-ia.md, 8.1 et 8.4 ; ticket 270) : l'oracle de chaque
-- événement du monde, écrit en repli par la planification et réécrit une fois par l'IA, et les consultations, qui
-- sont des offrandes de monnaie au dieu de la Pythie (migration 181) payées par une écriture `temple.oracle`.
-- Rejouable (`if not exists`, `create or replace`, contraintes dans la création des tables, déclencheurs et règles
-- recréés) ; le code précédent n'écrit ni ne lit ces tables, et ses offrandes `temple.offering` restent admises.

-- Un oracle : son événement, ses textes en français et en anglais et leur source. Il naît en repli, dans la
-- transaction qui planifie son événement ; l'IA essaie une fois de le réécrire, avant que l'événement commence,
-- et l'issue de cet essai est gardée (l'oracle reste en repli sauf `ok`). Identifiant aléatoire, pas horodaté :
-- un identifiant v7 dirait aux joueurs la clôture qui a planifié l'événement, donc son premier jour.
create table if not exists game.oracles (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references game.worlds (id),
  event_id uuid not null references game.world_events (id),
  text_fr text not null,
  text_en text not null,
  source text not null default 'fallback',
  rewritten_at timestamptz,
  rewrite_outcome text,
  created_at timestamptz not null default now(),
  constraint oracles_event_once unique (event_id),
  -- Plafond technique : la réécriture est bornée par la configuration (au plus 1 000 caractères).
  constraint oracles_texts check (length(text_fr) between 1 and 1000 and length(text_en) between 1 and 1000),
  constraint oracles_source check (source in ('fallback', 'ai')),
  constraint oracles_rewrite check (
    (rewritten_at is null) = (rewrite_outcome is null)
    and (rewrite_outcome is null or rewrite_outcome in ('ok', 'invalid', 'timeout', 'error', 'capped'))
    and (source = 'ai') = (rewrite_outcome is not distinct from 'ok'))
);
create index if not exists oracles_world_idx on game.oracles (world_id) where rewritten_at is null;

-- Un oracle naît maintenant, en repli, avec un événement planifié dans la même transaction et du même monde.
-- Il ne change qu'une fois : l'essai de réécriture, maintenant, avant que l'événement commence ; ses textes ne
-- changent que si l'essai réussit.
create or replace function game.guard_oracle() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.source <> 'fallback' or new.rewritten_at is not null
       or not exists (select 1 from game.world_events e
                      where e.id = new.event_id and e.world_id = new.world_id and e.created_at = now()) then
      raise exception 'an oracle is written as a fallback with its event' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.rewritten_at is not null or new.rewritten_at is distinct from now()
     or (new.id, new.world_id, new.event_id, new.created_at)
        is distinct from (old.id, old.world_id, old.event_id, old.created_at)
     or (new.source = 'fallback' and (new.text_fr, new.text_en) is distinct from (old.text_fr, old.text_en))
     or not exists (select 1 from game.world_events e where e.id = new.event_id and e.starts_at > now()) then
    raise exception 'an oracle is rewritten once, now, before its event starts' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_oracle() from public, anon, authenticated, oikos_service;
drop trigger if exists oracles_guard on game.oracles;
create trigger oracles_guard before insert or update on game.oracles
  for each row execute function game.guard_oracle();
drop trigger if exists oracles_no_delete on game.oracles;
create trigger oracles_no_delete before delete on game.oracles
  for each row execute function game.forbid_change();
drop trigger if exists oracles_no_truncate on game.oracles;
create trigger oracles_no_truncate before truncate on game.oracles
  for each statement execute function game.forbid_change();

-- Une consultation : l'offrande de monnaie qui la paie, la maison et sa cité, et les oracles qu'elle rend, ceux des
-- événements à venir de la cité (une tempête sur une de ses routes comprise), dans l'ordre des identifiants.
create table if not exists game.oracle_consultations (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  city_id uuid not null,
  offering_id uuid not null,
  oracle_ids uuid[] not null,
  created_at timestamptz not null default now(),
  constraint oracle_consultations_offering_once unique (offering_id),
  constraint oracle_consultations_house_same_world foreign key (house_id, world_id)
    references game.houses (id, world_id),
  constraint oracle_consultations_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint oracle_consultations_offering_same_world foreign key (offering_id, world_id)
    references game.offerings (id, world_id),
  constraint oracle_consultations_oracles check (array_position(oracle_ids, null) is null and cardinality(oracle_ids) <= 1000)
);
create index if not exists oracle_consultations_house_idx on game.oracle_consultations (house_id);

-- Une consultation naît maintenant, avec son offrande de la même maison, de la même cité et de la même transaction ;
-- elle ne rend que des oracles distincts, de son monde, d'événements de sa cité qui n'ont pas commencé. Elle ne
-- change plus.
create or replace function game.guard_oracle_consultation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() or not exists (
       select 1 from game.offerings o
       where o.id = new.offering_id and o.created_at = now() and o.oboles > 0
         and (o.world_id, o.house_id, o.city_id) = (new.world_id, new.house_id, new.city_id)) then
    raise exception 'a consultation is paid by an offering of its house, now' using errcode = 'restrict_violation';
  end if;
  if (select count(distinct o.id) from unnest(new.oracle_ids) as u (id)
        join game.oracles o on o.id = u.id
        join game.world_events e on e.id = o.event_id
      where o.world_id = new.world_id and new.city_id in (e.city_id, e.other_city_id) and e.starts_at > now())
     <> cardinality(new.oracle_ids) then
    raise exception 'a consultation reveals distinct oracles of upcoming events of its city'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_oracle_consultation() from public, anon, authenticated, oikos_service;
drop trigger if exists oracle_consultations_guard on game.oracle_consultations;
create trigger oracle_consultations_guard before insert on game.oracle_consultations
  for each row execute function game.guard_oracle_consultation();
drop trigger if exists oracle_consultations_immutable on game.oracle_consultations;
create trigger oracle_consultations_immutable before update or delete on game.oracle_consultations
  for each row execute function game.forbid_change();
drop trigger if exists oracle_consultations_no_truncate on game.oracle_consultations;
create trigger oracle_consultations_no_truncate before truncate on game.oracle_consultations
  for each statement execute function game.forbid_change();

-- Contrôle des offrandes (migration 181), plus la consultation : une offrande qui paie une consultation règle ses
-- oboles par une écriture `temple.oracle`, et ne donne aucun bien ; toute autre, par une écriture `temple.offering`.
create or replace function game.check_offering_settled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid record;
  consulted boolean := exists (select 1 from game.oracle_consultations c where c.offering_id = new.id);
begin
  if new.oboles > 0 then
    select e.kind, e.created_at, count(*) as lines,
           coalesce(sum(l.amount) filter (where a.kind = 'house' and a.house_id = new.house_id), 0) as debit,
           coalesce(sum(l.amount) filter (where a.world_id = new.world_id and a.system_key = 'sink_offerings'), 0) as credit
      into paid
      from game.ledger_entries e
      join game.ledger_lines l on l.entry_id = e.id
      join game.accounts a on a.id = l.account_id
      where e.id = new.ledger_entry_id
      group by e.kind, e.created_at;
    if (paid.kind, paid.created_at, paid.lines, paid.debit, paid.credit)
       is distinct from (case when consulted then 'temple.oracle' else 'temple.offering' end,
                         new.created_at, 2::bigint, -new.oboles, new.oboles) then
      raise exception 'an offering pays its oboles to sink_offerings' using errcode = 'restrict_violation';
    end if;
  elsif not exists (select 1 from game.stock_ledger s where s.offering_id = new.id) then
    raise exception 'an offering gives oboles or goods' using errcode = 'restrict_violation';
  end if;
  if consulted and exists (select 1 from game.stock_ledger s where s.offering_id = new.id) then
    raise exception 'a consultation is paid in money only' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from game.favor_ledger f where f.offering_id = new.id) then
    raise exception 'an offering adds its Charis' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_offering_settled() from public, anon, authenticated, oikos_service;

-- Le service lit ; il écrit un oracle et sa réécriture sans en choisir l'identifiant ni les dates d'origine, et une
-- consultation sans en choisir l'identifiant ni la date. Les joueurs lisent par des vues (migration 241).
alter table game.oracles enable row level security;
alter table game.oracle_consultations enable row level security;
revoke all on game.oracles, game.oracle_consultations from public, anon, authenticated, oikos_service;
grant select on game.oracles, game.oracle_consultations to oikos_service;
grant insert (world_id, event_id, text_fr, text_en) on game.oracles to oikos_service;
grant update (text_fr, text_en, source, rewritten_at, rewrite_outcome) on game.oracles to oikos_service;
grant insert (world_id, house_id, city_id, offering_id, oracle_ids) on game.oracle_consultations to oikos_service;
drop policy if exists service_all on game.oracles;
create policy service_all on game.oracles for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.oracle_consultations;
create policy service_all on game.oracle_consultations for all to oikos_service using (true) with check (true);
