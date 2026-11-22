-- Ligues (docs/specs/06-cites-politique-communaute.md, 6.3 et 6.5 ; ticket 737). Une cité fonde une ligue par décret
-- (`league_found`), une autre demande à y entrer (`league_join`) et la cité hégémon l'admet (`league_admit`) ; une cité
-- la quitte (`league_leave`), et une ligue réduite à une cité se dissout. Règlement des décrets : migration 501 ;
-- lectures : 502. Rejouable ; le code précédent ne propose aucun de ces modèles et n'écrit ni ne lit ces tables.

-- Catalogue : la contrainte garde son nom (un test d'intégration la compare à `DECREE_MODELS`) et n'est remplacée que
-- si elle ignore encore les ligues. Un décret de ligue peut devenir caduc, sans jour de règlement.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'game.decrees'::regclass and conname = 'decrees_model_check'
                   and pg_get_constraintdef(oid) like '%''league_leave''%') then
    alter table game.decrees drop constraint if exists decrees_model_check;
    alter table game.decrees add constraint decrees_model_check
      check (model in ('market_tax_rate', 'port_dues', 'public_works', 'festival', 'ostracism',
                       'league_found', 'league_join', 'league_admit', 'league_leave'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'game.decrees'::regclass and conname = 'decrees_settled'
                   and pg_get_constraintdef(oid) like '%''league_leave''%') then
    alter table game.decrees drop constraint if exists decrees_settled;
    alter table game.decrees add constraint decrees_settled check (
      (settled_day is not null) = (model in ('public_works', 'festival') and status in ('applied', 'lapsed'))
      and (status <> 'lapsed'
           or model in ('public_works', 'festival', 'league_found', 'league_join', 'league_admit', 'league_leave')));
  end if;
end $$;
create table if not exists game.leagues (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  -- Nom voté avec le décret de fondation : même forme qu'un nom de maison, unique parmi les ligues en activité.
  name text not null check (name ~ '^[[:alpha:]][[:alpha:] ''-]{1,22}[[:alpha:]]$'),
  -- Cité hégémon, membre de la ligue : la cité fondatrice, puis le plus ancien membre si elle s'en va.
  hegemon_city_id uuid not null,
  founding_decree_id uuid not null unique references game.decrees (id),
  founded_at timestamptz not null default now(),
  dissolved_at timestamptz,
  constraint leagues_id_world unique (id, world_id),
  constraint leagues_hegemon_same_world foreign key (hegemon_city_id, world_id) references game.cities (id, world_id),
  constraint leagues_calendar check (dissolved_at is null or dissolved_at >= founded_at)
);
create unique index if not exists leagues_name_active_idx on game.leagues (world_id, lower(name))
  where dissolved_at is null;
create index if not exists leagues_hegemon_city_id_idx on game.leagues (hegemon_city_id);

create table if not exists game.league_members (
  id uuid primary key default game.uuid_v7(),
  league_id uuid not null,
  world_id uuid not null,
  city_id uuid not null,
  -- Décret qui l'a fait entrer : la fondation pour la cité fondatrice, l'admission pour les autres.
  entry_decree_id uuid not null unique references game.decrees (id),
  joined_at timestamptz not null default now(),
  -- Sortie : par son décret `league_leave` (`left`), ou par la dissolution d'une ligue réduite à elle (`dissolved`).
  left_at timestamptz,
  exit_reason text check (exit_reason in ('left', 'dissolved')),
  exit_decree_id uuid unique references game.decrees (id),
  constraint league_members_league_same_world foreign key (league_id, world_id) references game.leagues (id, world_id),
  constraint league_members_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint league_members_exit check (
    (left_at is null) = (exit_reason is null) and (exit_decree_id is not null) = (exit_reason = 'left')
    and (left_at is null or left_at >= joined_at))
);
-- Une cité est dans une ligue au plus.
create unique index if not exists league_members_one_league_idx on game.league_members (city_id) where left_at is null;
create index if not exists league_members_league_idx on game.league_members (league_id) where left_at is null;
create index if not exists league_members_city_joined_idx on game.league_members (city_id, joined_at);

-- Ligue : fondée maintenant par un décret adopté de sa cité hégémon, hors de toute ligue, sous le nom voté. Ensuite seuls
-- changent l'hégémon (le plus ancien membre restant, si l'hégémon s'en va) et la dissolution, une fois, sans membre.
create or replace function game.guard_league() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.founded_at is distinct from now() or new.dissolved_at is not null then
      raise exception 'a league is founded now' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.decrees d
                   where d.id = new.founding_decree_id and d.model = 'league_found' and d.status = 'adopted'
                     and d.city_id = new.hegemon_city_id and d.world_id = new.world_id
                     and d.params ->> 'name' = new.name) then
      raise exception 'a league is founded by an adopted decree of its city'
        using errcode = 'check_violation', constraint = 'leagues_founding_decree';
    end if;
    if exists (select 1 from game.league_members m where m.city_id = new.hegemon_city_id and m.left_at is null) then
      raise exception 'a city is in one league at most' using errcode = 'check_violation', constraint = 'leagues_founder_free';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.name, new.founding_decree_id, new.founded_at)
     is distinct from (old.id, old.world_id, old.name, old.founding_decree_id, old.founded_at)
     or old.dissolved_at is not null then
    raise exception 'a league is immutable' using errcode = 'restrict_violation';
  end if;
  if new.dissolved_at is not null then
    if new.dissolved_at is distinct from now() or new.hegemon_city_id is distinct from old.hegemon_city_id
       or exists (select 1 from game.league_members m where m.league_id = new.id and m.left_at is null) then
      raise exception 'a league dissolves once, now, without members' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if exists (select 1 from game.league_members m
             where m.league_id = new.id and m.city_id = old.hegemon_city_id and m.left_at is null)
     or new.hegemon_city_id is distinct from (select m.city_id from game.league_members m
                                               where m.league_id = new.id and m.left_at is null
                                               order by m.joined_at, m.id limit 1) then
    raise exception 'the hegemony passes, when the hegemon leaves, to the oldest member'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Membre : entré maintenant dans une ligue en activité, qui a moins de cinq cités (6.5), par la fondation (la cité
-- hégémon de sa ligue) ou par un décret d'admission adopté de la cité hégémon, qui admet une demande d'entrée
-- appliquée de la cité vers cette ligue, sans que la cité soit entrée dans une ligue depuis. Verrou sur la ligue :
-- deux entrées simultanées se comptent l'une après l'autre, sous READ COMMITTED (le niveau du service), où le décompte
-- qui suit le verrou voit l'entrée validée de l'autre ; sous REPEATABLE READ il ne la verrait pas, et le plafond ne
-- tiendrait plus. Les identifiants lus dans les paramètres se comparent sans casse. Ensuite seule change la sortie,
-- une fois, maintenant : par un décret de départ adopté de la cité, ou par la dissolution quand une autre cité vient de
-- la quitter et qu'aucune autre ne reste.
create or replace function game.guard_league_member() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  league game.leagues;
  entry game.decrees;
  request game.decrees;
begin
  if tg_op = 'INSERT' then
    if new.joined_at is distinct from now() or new.left_at is not null then
      raise exception 'a city joins a league now' using errcode = 'restrict_violation';
    end if;
    select * into league from game.leagues l where l.id = new.league_id for update;
    select * into entry from game.decrees d where d.id = new.entry_decree_id;
    if league.dissolved_at is not null then
      raise exception 'a dissolved league admits no city' using errcode = 'check_violation', constraint = 'league_members_league_active';
    end if;
    if entry.model = 'league_admit' then
      select * into request from game.decrees d
      where d.id = case when entry.params ->> 'joinDecreeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (entry.params ->> 'joinDecreeId')::uuid end
        and d.model = 'league_join'
        and d.status = 'applied' and d.world_id = new.world_id;
    end if;
    if entry.status is distinct from 'adopted' or entry.world_id is distinct from new.world_id
       or not coalesce(
         (entry.model = 'league_found' and league.founding_decree_id = entry.id and league.hegemon_city_id = new.city_id)
         or (entry.model = 'league_admit' and entry.city_id = league.hegemon_city_id
             and request.city_id = new.city_id and lower(request.params ->> 'leagueId') = new.league_id::text
             and not exists (select 1 from game.league_members m
                             where m.city_id = new.city_id and m.joined_at >= request.applied_at)), false) then
      raise exception 'a city enters a league by its founding, or by the admission of its request'
        using errcode = 'check_violation', constraint = 'league_members_entry_decree';
    end if;
    if (select count(*) from game.league_members m where m.league_id = new.league_id and m.left_at is null) >= 5 then
      raise exception 'a league has five cities at most' using errcode = 'check_violation', constraint = 'league_members_at_most_five';
    end if;
    return new;
  end if;
  if (new.id, new.league_id, new.world_id, new.city_id, new.entry_decree_id, new.joined_at)
     is distinct from (old.id, old.league_id, old.world_id, old.city_id, old.entry_decree_id, old.joined_at)
     or old.left_at is not null or new.left_at is distinct from now() then
    raise exception 'a city leaves its league once, now' using errcode = 'restrict_violation';
  end if;
  if (new.exit_reason = 'left' and not exists (
        select 1 from game.decrees d
        where d.id = new.exit_decree_id and d.model = 'league_leave' and d.status = 'adopted'
          and d.city_id = new.city_id and d.world_id = new.world_id))
     or (new.exit_reason = 'dissolved' and (
        exists (select 1 from game.league_members m
                where m.league_id = new.league_id and m.left_at is null and m.id <> new.id)
        or not exists (select 1 from game.league_members m
                       where m.league_id = new.league_id and m.left_at = now() and m.exit_reason = 'left'))) then
    raise exception 'a city leaves by its decree, or with the dissolution of its league'
      using errcode = 'check_violation', constraint = 'league_members_exit_decree';
  end if;
  return new;
end;
$$;

revoke execute on function game.guard_league(), game.guard_league_member()
  from public, anon, authenticated, oikos_service;
drop trigger if exists leagues_guard on game.leagues;
create trigger leagues_guard before insert or update on game.leagues
  for each row execute function game.guard_league();
drop trigger if exists league_members_guard on game.league_members;
create trigger league_members_guard before insert or update on game.league_members
  for each row execute function game.guard_league_member();

-- Droits du service : ni identifiant, ni date que la garde fixe, aucune suppression. Le verrou de la garde des
-- membres exige le droit de modifier une colonne des ligues.
alter table game.leagues enable row level security;
alter table game.league_members enable row level security;
revoke all on game.leagues, game.league_members from public, anon, authenticated, oikos_service;
grant select on game.leagues, game.league_members to oikos_service;
grant insert (world_id, name, hegemon_city_id, founding_decree_id) on game.leagues to oikos_service;
grant update (hegemon_city_id, dissolved_at) on game.leagues to oikos_service;
grant insert (league_id, world_id, city_id, entry_decree_id) on game.league_members to oikos_service;
grant update (left_at, exit_reason, exit_decree_id) on game.league_members to oikos_service;
drop policy if exists service_all on game.leagues;
create policy service_all on game.leagues for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.league_members;
create policy service_all on game.league_members for all to oikos_service using (true) with check (true);
