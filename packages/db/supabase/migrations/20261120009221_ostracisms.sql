-- Votes d'ostracisme (docs/specs/06-cites-politique-communaute.md, 6.4 ; ticket 722).
-- La clôture qui trouve un décret `ostracism` adopté ouvre son vote, avec les règles de sa configuration ; chaque
-- citoyen de la cité y inscrit, par l'API, le nom d'un citoyen de la même cité ; la clôture qui suit la fin du vote
-- dépouille. Le plus nommé, seul en tête et si les bulletins atteignent le quorum, est ostracisé jusqu'à `ends_at`.
-- Effets sur les charges : migration 9222 ; lectures des joueurs : migration 9223.
-- Rejouable ; le code précédent n'écrit ni ne lit ces tables.

create table if not exists game.ostracisms (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  -- Décret adopté qui l'ouvre : un vote par décret.
  decree_id uuid not null unique references game.decrees (id),
  -- Ouverture : base de l'écart entre deux ostracismes d'une cité (`intervalDays`, contrôlé par l'API).
  opened_at timestamptz not null default now(),
  voting_closes_at timestamptz not null,
  -- Règles fixées à l'ouverture : une version de configuration publiée ensuite ne les change pas.
  quorum_bps integer not null check (quorum_bps between 0 and 10000),
  ostracism_days integer not null check (ostracism_days between 1 and 366),
  -- Dépouillement : instant, citoyens à la fin du vote, bulletins, issue ; nuls avant lui.
  tallied_at timestamptz,
  electorate integer check (electorate >= 0),
  ballots integer check (ballots >= 0),
  outcome text check (outcome in ('ostracized', 'tie', 'no_quorum')),
  ostracized_house_id uuid,
  -- Fin de l'ostracisme : la clôture `ostracism_days` jours de jeu après celle du dépouillement, datée par le jour de
  -- jeu de cette clôture et non par l'heure où elle est jouée : une clôture rattrapée en retard peut l'écrire déjà passée.
  ends_at timestamptz,
  constraint ostracisms_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint ostracisms_house_same_world foreign key (ostracized_house_id, world_id) references game.houses (id, world_id),
  constraint ostracisms_calendar check (opened_at < voting_closes_at),
  constraint ostracisms_tally check (
    (tallied_at is null) = (electorate is null) and (tallied_at is null) = (ballots is null)
    and (tallied_at is null) = (outcome is null)
    and (outcome is not distinct from 'ostracized') = (ostracized_house_id is not null)
    and (ostracized_house_id is null) = (ends_at is null) and (ends_at is null or ends_at > voting_closes_at))
);
-- Au plus un vote non dépouillé par cité ; votes d'un monde par échéance (dépouillement) ; ostracismes d'une maison.
create unique index if not exists ostracisms_one_open_idx on game.ostracisms (city_id) where tallied_at is null;
create index if not exists ostracisms_world_open_idx on game.ostracisms (world_id, voting_closes_at) where tallied_at is null;
create index if not exists ostracisms_city_opened_idx on game.ostracisms (city_id, opened_at);
create index if not exists ostracisms_house_idx on game.ostracisms (ostracized_house_id, ends_at)
  where ostracized_house_id is not null;

create table if not exists game.ostraca (
  id uuid primary key default game.uuid_v7(),
  ostracism_id uuid not null references game.ostracisms (id),
  -- Maison qui vote, et maison qu'elle nomme.
  house_id uuid not null references game.houses (id),
  target_house_id uuid not null references game.houses (id),
  cast_at timestamptz not null default now(),
  constraint ostraca_one_per_house unique (ostracism_id, house_id)
);
create index if not exists ostraca_house_id_idx on game.ostraca (house_id);
create index if not exists ostraca_target_house_id_idx on game.ostraca (target_house_id);

-- Vote : ouvert maintenant, non dépouillé, par un décret d'ostracisme adopté de sa cité. Ensuite seul le
-- dépouillement le modifie, une fois, daté de sa transaction, jamais avant la fin du vote ; la base recompte
-- les bulletins et les citoyens devenus citoyens avant la fin du vote, et n'admet que l'issue qu'ils donnent.
create or replace function game.guard_ostracism() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  electorate integer;
  ballots integer;
  first_house uuid;
  first_votes integer;
  second_votes integer;
  expected text;
begin
  if tg_op = 'INSERT' then
    if new.opened_at is distinct from now() or new.tallied_at is not null then
      raise exception 'an ostracism opens now, untallied' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.decrees d
                   where d.id = new.decree_id and d.model = 'ostracism' and d.status = 'adopted'
                     and d.city_id = new.city_id and d.world_id = new.world_id) then
      raise exception 'an ostracism is opened by an adopted decree of its city'
        using errcode = 'check_violation', constraint = 'ostracisms_decree_adopted';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.city_id, new.decree_id, new.opened_at, new.voting_closes_at, new.quorum_bps,
      new.ostracism_days)
     is distinct from (old.id, old.world_id, old.city_id, old.decree_id, old.opened_at, old.voting_closes_at,
      old.quorum_bps, old.ostracism_days) then
    raise exception 'an ostracism is immutable' using errcode = 'restrict_violation';
  end if;
  if old.tallied_at is not null or new.tallied_at is distinct from now() then
    raise exception 'an ostracism is tallied once, now' using errcode = 'restrict_violation';
  end if;
  if now() < old.voting_closes_at then
    raise exception 'an ostracism is tallied after its vote' using errcode = 'restrict_violation';
  end if;
  select count(*) into ballots from game.ostraca o where o.ostracism_id = new.id;
  select count(*) into electorate from game.citizenships c
  where c.city_id = new.city_id and c.status = 'citizen' and c.since < new.voting_closes_at;
  select o.target_house_id, count(*) into first_house, first_votes from game.ostraca o
  where o.ostracism_id = new.id group by o.target_house_id order by count(*) desc limit 1;
  select count(*) into second_votes from game.ostraca o
  where o.ostracism_id = new.id group by o.target_house_id order by count(*) desc offset 1 limit 1;
  expected := case when ballots::bigint * 10000 < new.quorum_bps::bigint * electorate then 'no_quorum'
                   when first_house is null or first_votes = second_votes then 'tie'
                   else 'ostracized' end;
  if (new.ballots, new.electorate, new.outcome, new.ostracized_house_id)
     is distinct from (ballots, electorate, expected, case when expected = 'ostracized' then first_house end) then
    raise exception 'an ostracism tally follows its ostraca' using errcode = 'restrict_violation';
  end if;
  -- Fin : après la fin du vote (contrainte, vraie aussi pour une clôture rattrapée en retard), au plus
  -- `ostracism_days` jours de jeu après le dépouillement.
  if new.ends_at > now() + (new.ostracism_days + 1) * interval '1 day' then
    raise exception 'an ostracism lasts its days' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Bulletin : déposé maintenant, pendant le vote, par un citoyen de la cité, au nom d'un citoyen de la même cité ;
-- un par maison et par vote (contrainte unique). Il ne change plus. Verrou partagé sur le vote : le dépouillement
-- l'attend et le compte, ou il attend le dépouillement et se voit refuser.
create or replace function game.guard_ostracon() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ostracism game.ostracisms;
begin
  if tg_op = 'UPDATE' then
    raise exception 'an ostracon is final' using errcode = 'restrict_violation';
  end if;
  if new.cast_at is distinct from now() then
    raise exception 'an ostracon is cast now' using errcode = 'restrict_violation';
  end if;
  select * into ostracism from game.ostracisms o where o.id = new.ostracism_id for share;
  if ostracism.tallied_at is not null or now() >= ostracism.voting_closes_at then
    raise exception 'outside the voting period' using errcode = 'check_violation', constraint = 'ostraca_voting_period';
  end if;
  if not exists (select 1 from game.citizenships c
                 where c.house_id = new.house_id and c.city_id = ostracism.city_id and c.status = 'citizen') then
    raise exception 'only citizens of the city vote' using errcode = 'check_violation', constraint = 'ostraca_citizens_only';
  end if;
  if not exists (select 1 from game.citizenships c
                 where c.house_id = new.target_house_id and c.city_id = ostracism.city_id and c.status = 'citizen') then
    raise exception 'only a citizen of the city is named' using errcode = 'check_violation', constraint = 'ostraca_target_citizen';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_ostracism(), game.guard_ostracon() from public, anon, authenticated, oikos_service;
drop trigger if exists ostracisms_guard on game.ostracisms;
create trigger ostracisms_guard before insert or update on game.ostracisms
  for each row execute function game.guard_ostracism();
drop trigger if exists ostraca_guard on game.ostraca;
create trigger ostraca_guard before insert or update on game.ostraca
  for each row execute function game.guard_ostracon();

-- Droits du service : ni identifiant, ni date que la garde fixe, aucune suppression. Le verrou partagé de la garde
-- des bulletins exige le droit de modifier une colonne des votes.
alter table game.ostracisms enable row level security;
alter table game.ostraca enable row level security;
revoke all on game.ostracisms, game.ostraca from public, anon, authenticated, oikos_service;
grant select on game.ostracisms, game.ostraca to oikos_service;
grant insert (world_id, city_id, decree_id, voting_closes_at, quorum_bps, ostracism_days) on game.ostracisms to oikos_service;
grant update (tallied_at, electorate, ballots, outcome, ostracized_house_id, ends_at) on game.ostracisms to oikos_service;
grant insert (ostracism_id, house_id, target_house_id) on game.ostraca to oikos_service;
drop policy if exists service_all on game.ostracisms;
create policy service_all on game.ostracisms for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.ostraca;
create policy service_all on game.ostraca for all to oikos_service using (true) with check (true);
