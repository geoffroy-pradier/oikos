-- Élection de l'archonte (docs/specs/06-cites-politique-communaute.md, 6.2 ; ticket 260).
-- La clôture ouvre et dépouille ; les citoyens se présentent, se retirent et votent par l'API. Lectures des
-- joueurs : migration 72. Rejouable ; le code précédent n'écrit ni ne lit ces tables.

create table if not exists game.elections (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  -- Seule charge de la phase 2 (6.2).
  office text not null check (office in ('archon')),
  candidacy_opens_at timestamptz not null,
  voting_opens_at timestamptz not null,
  -- Fin du vote : début du mandat pourvu, à la clôture qui dépouille.
  voting_closes_at timestamptz not null,
  term_ends_at timestamptz not null,
  -- Instant du dépouillement ; nul avant lui.
  tallied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint elections_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint elections_calendar check (
    candidacy_opens_at < voting_opens_at and voting_opens_at < voting_closes_at and voting_closes_at < term_ends_at),
  constraint elections_one_per_term unique (city_id, office, voting_closes_at),
  constraint elections_id_city_unique unique (id, city_id)
);
-- Au plus une élection non dépouillée par cité et par charge : une clôture rejouée n'en ouvre pas une seconde.
create unique index if not exists elections_one_open_idx on game.elections (city_id, office) where tallied_at is null;
create index if not exists elections_world_open_idx on game.elections (world_id, voting_closes_at) where tallied_at is null;

create table if not exists game.candidacies (
  id uuid primary key default game.uuid_v7(),
  election_id uuid not null references game.elections (id),
  house_id uuid not null references game.houses (id),
  -- Ancienneté de la candidature : elle départage une égalité.
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  -- Une candidature par maison et par élection ; retirée, elle ne se redépose pas.
  constraint candidacies_one_per_house unique (election_id, house_id),
  constraint candidacies_id_election_unique unique (id, election_id)
);

create table if not exists game.ballots (
  id uuid primary key default game.uuid_v7(),
  election_id uuid not null references game.elections (id),
  -- Maison qui vote.
  house_id uuid not null references game.houses (id),
  candidacy_id uuid not null,
  cast_at timestamptz not null default now(),
  constraint ballots_one_per_house unique (election_id, house_id),
  constraint ballots_candidacy_same_election foreign key (candidacy_id, election_id)
    references game.candidacies (id, election_id)
);
create index if not exists ballots_candidacy_id_idx on game.ballots (candidacy_id);

create table if not exists game.offices (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  office text not null check (office in ('archon')),
  house_id uuid not null,
  -- Élection qui l'a pourvue : une charge par élection.
  election_id uuid not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint offices_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint offices_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint offices_election_same_city foreign key (election_id, city_id) references game.elections (id, city_id)
);
create index if not exists offices_city_id_idx on game.offices (city_id, ends_at);

-- Élection : elle naît maintenant, non dépouillée ; son calendrier ne change plus. Seul le dépouillement la
-- modifie, une fois, daté de sa transaction, et jamais avant la fin du vote.
create or replace function game.guard_election() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.tallied_at is not null then
      raise exception 'an election opens now, untallied' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.city_id, new.office, new.candidacy_opens_at, new.voting_opens_at,
      new.voting_closes_at, new.term_ends_at, new.created_at)
     is distinct from (old.id, old.world_id, old.city_id, old.office, old.candidacy_opens_at, old.voting_opens_at,
      old.voting_closes_at, old.term_ends_at, old.created_at) then
    raise exception 'an election calendar is immutable' using errcode = 'restrict_violation';
  end if;
  if old.tallied_at is not null or new.tallied_at is distinct from now() then
    raise exception 'an election is tallied once, now' using errcode = 'restrict_violation';
  end if;
  if now() < old.voting_closes_at then
    raise exception 'an election is tallied after its vote' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Candidature : déposée maintenant, par un citoyen de la cité, pendant le dépôt des candidatures. Elle ne
-- change ensuite que par son retrait, daté, pendant ce même dépôt, et jamais si elle a reçu un bulletin.
create or replace function game.guard_candidacy() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  election game.elections;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.election_id, new.house_id, new.created_at)
       is distinct from (old.id, old.election_id, old.house_id, old.created_at)
       or old.withdrawn_at is not null or new.withdrawn_at is distinct from now() then
      raise exception 'a candidacy only changes by its withdrawal, now' using errcode = 'restrict_violation';
    end if;
  elsif new.created_at is distinct from now() or new.withdrawn_at is not null then
    raise exception 'a candidacy is filed now' using errcode = 'restrict_violation';
  end if;
  -- Verrou partagé : le dépouillement, qui verrouille l'élection, attend la candidature, ou l'inverse.
  select * into election from game.elections e where e.id = new.election_id for share;
  if election.tallied_at is not null or now() < election.candidacy_opens_at or now() >= election.voting_opens_at then
    raise exception 'outside the filing period' using errcode = 'check_violation', constraint = 'candidacies_filing_period';
  end if;
  if tg_op = 'UPDATE' then
    if exists (select 1 from game.ballots b where b.candidacy_id = new.id) then
      raise exception 'outside the filing period' using errcode = 'check_violation', constraint = 'candidacies_filing_period';
    end if;
    return new;
  end if;
  if not exists (select 1 from game.citizenships c
                 where c.house_id = new.house_id and c.city_id = election.city_id and c.status = 'citizen') then
    raise exception 'only citizens of the city stand' using errcode = 'check_violation', constraint = 'candidacies_citizens_only';
  end if;
  return new;
end;
$$;

-- Bulletin : déposé maintenant, par un citoyen de la cité, pendant le vote, pour une candidature maintenue
-- de la même élection (clé étrangère) ; un seul par maison et par élection (contrainte unique). Il ne
-- change plus.
create or replace function game.guard_ballot() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  election game.elections;
begin
  if tg_op = 'UPDATE' then
    raise exception 'a ballot is final' using errcode = 'restrict_violation';
  end if;
  if new.cast_at is distinct from now() then
    raise exception 'a ballot is cast now' using errcode = 'restrict_violation';
  end if;
  -- Verrous partagés : le dépouillement et le retrait d'une candidature attendent le bulletin, ou l'inverse,
  -- et l'état relu ensuite est celui qu'ils ont validé.
  select * into election from game.elections e where e.id = new.election_id for share;
  if election.tallied_at is not null or now() < election.voting_opens_at or now() >= election.voting_closes_at then
    raise exception 'outside the voting period' using errcode = 'check_violation', constraint = 'ballots_voting_period';
  end if;
  if not exists (select 1 from game.citizenships c
                 where c.house_id = new.house_id and c.city_id = election.city_id and c.status = 'citizen') then
    raise exception 'only citizens of the city vote' using errcode = 'check_violation', constraint = 'ballots_citizens_only';
  end if;
  perform 1 from game.candidacies c where c.id = new.candidacy_id and c.withdrawn_at is null for share;
  if not found then
    raise exception 'the candidacy was withdrawn' using errcode = 'check_violation', constraint = 'ballots_candidate_standing';
  end if;
  return new;
end;
$$;

-- Charge : pourvue par le dépouillement de son élection, dans sa transaction, aux dates de son mandat, et
-- donnée à la candidature maintenue qui a le plus de bulletins, la plus ancienne en cas d'égalité. Elle ne
-- change plus.
create or replace function game.guard_office() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  election game.elections;
  elected uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'an office is final' using errcode = 'restrict_violation';
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
  where c.election_id = new.election_id and c.withdrawn_at is null
  group by c.id, c.house_id, c.created_at
  order by count(b.id) desc, c.created_at, c.id
  limit 1;
  if elected is distinct from new.house_id then
    raise exception 'an office goes to the elected candidate' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_election(), game.guard_candidacy(), game.guard_ballot(), game.guard_office()
  from public, anon, authenticated, oikos_service;
drop trigger if exists elections_guard on game.elections;
create trigger elections_guard before insert or update on game.elections
  for each row execute function game.guard_election();
drop trigger if exists candidacies_guard on game.candidacies;
create trigger candidacies_guard before insert or update on game.candidacies
  for each row execute function game.guard_candidacy();
drop trigger if exists ballots_guard on game.ballots;
create trigger ballots_guard before insert or update on game.ballots
  for each row execute function game.guard_ballot();
drop trigger if exists offices_guard on game.offices;
create trigger offices_guard before insert or update on game.offices
  for each row execute function game.guard_office();

-- Droits du service : ni identifiant ni date que la garde fixe, aucune suppression. Les verrous partagés des
-- gardes exigent le droit de modifier une colonne de la table verrouillée.
alter table game.elections enable row level security;
alter table game.candidacies enable row level security;
alter table game.ballots enable row level security;
alter table game.offices enable row level security;
revoke all on game.elections, game.candidacies, game.ballots, game.offices from public, anon, authenticated, oikos_service;
grant select on game.elections, game.candidacies, game.ballots, game.offices to oikos_service;
grant insert (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
  on game.elections to oikos_service;
grant update (tallied_at) on game.elections to oikos_service;
grant insert (election_id, house_id) on game.candidacies to oikos_service;
grant update (withdrawn_at) on game.candidacies to oikos_service;
grant insert (election_id, house_id, candidacy_id) on game.ballots to oikos_service;
grant insert (world_id, city_id, office, house_id, election_id, starts_at, ends_at) on game.offices to oikos_service;
drop policy if exists service_all on game.elections;
create policy service_all on game.elections for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.candidacies;
create policy service_all on game.candidacies for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.ballots;
create policy service_all on game.ballots for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.offices;
create policy service_all on game.offices for all to oikos_service using (true) with check (true);
