-- Décrets de la cité (docs/specs/06-cites-politique-communaute.md, 6.3 ; ticket 261).
-- L'archonte en charge propose un décret pris dans le catalogue fermé ; les citoyens de la cité votent pour ou
-- contre ; la clôture dépouille. Les effets d'un décret adopté (état `applied`) viennent avec #262 et #263.
-- Lectures des joueurs : migration 131. Rejouable ; le code précédent n'écrit ni ne lit ces tables.

create table if not exists game.decrees (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  -- Catalogue fermé de la phase 2 (`DECREE_MODELS` de `@oikos/contracts`).
  model text not null check (model in ('market_tax_rate', 'port_dues', 'public_works', 'festival')),
  -- Paramètres, validés par l'API contre les bornes de la configuration en vigueur à la proposition.
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  -- Charge de l'archonte qui propose, et sa maison.
  office_id uuid not null references game.offices (id),
  proposed_by uuid not null,
  status text not null default 'proposed' check (status in ('proposed', 'adopted', 'rejected', 'applied')),
  proposed_at timestamptz not null default now(),
  voting_closes_at timestamptz not null,
  -- Quorum fixé à la proposition : une version de configuration publiée ensuite ne le change pas.
  quorum_bps integer not null check (quorum_bps between 0 and 10000),
  -- Dépouillement : instant, citoyens à la fin du vote, votes pour et contre ; nuls avant lui.
  tallied_at timestamptz,
  electorate integer check (electorate >= 0),
  votes_for integer check (votes_for >= 0),
  votes_against integer check (votes_against >= 0),
  constraint decrees_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint decrees_author_same_world foreign key (proposed_by, world_id) references game.houses (id, world_id),
  constraint decrees_calendar check (proposed_at < voting_closes_at),
  constraint decrees_tally check (
    (status = 'proposed') = (tallied_at is null) and (tallied_at is null) = (electorate is null)
    and (tallied_at is null) = (votes_for is null) and (tallied_at is null) = (votes_against is null))
);
-- Décrets au vote d'une cité (plafond `maxOpenPerCity`), et d'un monde par échéance (dépouillement).
create index if not exists decrees_city_open_idx on game.decrees (city_id) where status = 'proposed';
create index if not exists decrees_world_open_idx on game.decrees (world_id, voting_closes_at) where status = 'proposed';
create index if not exists decrees_office_id_idx on game.decrees (office_id);

create table if not exists game.decree_votes (
  id uuid primary key default game.uuid_v7(),
  decree_id uuid not null references game.decrees (id),
  -- Maison qui vote.
  house_id uuid not null references game.houses (id),
  approve boolean not null,
  cast_at timestamptz not null default now(),
  constraint decree_votes_one_per_house unique (decree_id, house_id)
);
create index if not exists decree_votes_house_id_idx on game.decree_votes (house_id);

-- Décret : proposé maintenant, au vote, par la maison qui tient la charge d'archonte de sa cité à cet instant.
-- Ensuite seul le dépouillement le modifie, une fois, daté de sa transaction, jamais avant la fin du vote, et
-- la base recompte elle-même les votes et les citoyens : citoyens de la cité devenus citoyens avant la fin du
-- vote ; adopté si les votes exprimés atteignent le quorum et que les votes pour l'emportent strictement.
create or replace function game.guard_decree() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  votes_for integer;
  votes_against integer;
  electorate integer;
  adopted boolean;
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

-- Vote : déposé maintenant, par un citoyen de la cité du décret, pendant le vote ; un par maison et par décret
-- (contrainte unique). Il ne change plus. Verrou partagé sur le décret : le dépouillement l'attend et le compte,
-- ou il attend le dépouillement et se voit refuser.
create or replace function game.guard_decree_vote() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  decree game.decrees;
begin
  if tg_op = 'UPDATE' then
    raise exception 'a decree vote is final' using errcode = 'restrict_violation';
  end if;
  if new.cast_at is distinct from now() then
    raise exception 'a decree vote is cast now' using errcode = 'restrict_violation';
  end if;
  select * into decree from game.decrees d where d.id = new.decree_id for share;
  if decree.status <> 'proposed' or now() >= decree.voting_closes_at then
    raise exception 'outside the voting period' using errcode = 'check_violation', constraint = 'decree_votes_voting_period';
  end if;
  if not exists (select 1 from game.citizenships c
                 where c.house_id = new.house_id and c.city_id = decree.city_id and c.status = 'citizen') then
    raise exception 'only citizens of the city vote' using errcode = 'check_violation', constraint = 'decree_votes_citizens_only';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_decree(), game.guard_decree_vote() from public, anon, authenticated, oikos_service;
drop trigger if exists decrees_guard on game.decrees;
create trigger decrees_guard before insert or update on game.decrees
  for each row execute function game.guard_decree();
drop trigger if exists decree_votes_guard on game.decree_votes;
create trigger decree_votes_guard before insert or update on game.decree_votes
  for each row execute function game.guard_decree_vote();

-- Droits du service : ni identifiant, ni date, ni état que la garde fixe, aucune suppression. Le verrou partagé
-- de la garde des votes exige le droit de modifier une colonne des décrets.
alter table game.decrees enable row level security;
alter table game.decree_votes enable row level security;
revoke all on game.decrees, game.decree_votes from public, anon, authenticated, oikos_service;
grant select on game.decrees, game.decree_votes to oikos_service;
grant insert (world_id, city_id, model, params, office_id, proposed_by, voting_closes_at, quorum_bps)
  on game.decrees to oikos_service;
grant update (status, tallied_at, electorate, votes_for, votes_against) on game.decrees to oikos_service;
grant insert (decree_id, house_id, approve) on game.decree_votes to oikos_service;
drop policy if exists service_all on game.decrees;
create policy service_all on game.decrees for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.decree_votes;
create policy service_all on game.decree_votes for all to oikos_service using (true) with check (true);
