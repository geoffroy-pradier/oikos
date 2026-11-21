-- Liturgies : désignation (docs/specs/06-cites-politique-communaute.md, 6.4 ; docs/specs/12-modele-donnees.md ;
-- ticket 719). À la première clôture de chaque saison, chaque cité confie une dépense publique à ses maisons les plus
-- riches : une ligne par maison désignée, avec sa saison, son genre, son dû en oboles et son échéance. Le moteur
-- choisit les maisons et calcule le dû par la configuration, que la base ne lit pas ; la base garantit le reste.
-- L'accomplissement et le prélèvement d'office (#720) remplaceront la garde des modifications.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés, vues créées une fois) ; le code
-- précédent n'écrit ni ne lit cette table.

create table if not exists game.liturgies (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  -- Cité qui désigne : celle du foyer de la maison (`citizenships`).
  city_id uuid not null,
  house_id uuid not null,
  -- Indice de saison du moteur (`seasonOfGameDay`) à la clôture qui désigne.
  season integer not null,
  genre text not null check (genre in ('festival', 'trierarchy', 'choregia')),
  -- Dû, en oboles, en entiers sûrs des clients.
  due bigint not null check (due between 1 and 9007199254740991),
  -- Jour de jeu de la clôture qui désigne, et échéance : la clôture `due_day`, à l'instant `due_at`.
  designated_day integer not null check (designated_day >= 0),
  due_day integer not null,
  due_at timestamptz not null,
  -- Désignée, accomplie (#720) ou prélevée d'office (#720).
  status text not null default 'assigned' check (status in ('assigned', 'performed', 'levied')),
  created_at timestamptz not null default now(),
  constraint liturgies_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint liturgies_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint liturgies_calendar check (due_day > designated_day)
);
-- Une liturgie au plus par maison et par saison : rejouée, la désignation n'en écrit pas une seconde.
create unique index if not exists liturgies_one_per_season on game.liturgies (house_id, season);
create index if not exists liturgies_city_season_idx on game.liturgies (city_id, season);
-- Liturgies à régler d'un monde, par échéance (#720).
create index if not exists liturgies_due_idx on game.liturgies (world_id, due_at) where status = 'assigned';

-- Une liturgie naît maintenant, désignée, pour une maison de joueur qui a son foyer dans la cité et dont le compte
-- n'est pas exclu (exclusion validée en vigueur à l'heure de l'instruction, comme `notSanctioned`, 15.4), avant que
-- la clôture de son jour, ou d'un jour postérieur, soit enregistrée (même verrou que la clôture) ; le déclencheur
-- différé `liturgies_on_close` exige à la validation que cette clôture le soit. Ensuite elle ne change pas, jusqu'au
-- ticket 720.
create or replace function game.guard_liturgy() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() or new.status is distinct from 'assigned' then
    raise exception 'a liturgy is assigned now' using errcode = 'restrict_violation';
  end if;
  if not exists (
    select 1 from game.houses h join game.citizenships c on c.house_id = h.id
    where h.id = new.house_id and h.kind = 'player' and c.city_id = new.city_id
      and not exists (select 1 from admin.sanctions x
                      where x.user_id = h.user_id and x.kind = 'ban' and x.validated_by is not null
                        and x.starts_at <= statement_timestamp()
                        and (x.ends_at is null or x.ends_at > statement_timestamp()))) then
    raise exception 'a liturgy goes to a player house of the city that is not banned'
      using errcode = 'check_violation', constraint = 'liturgies_house_eligible';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.designated_day) then
    raise exception 'a liturgy is assigned before its close is recorded' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create or replace function game.check_liturgy_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.designated_day) then
    raise exception 'a liturgy is assigned by the close of its day' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_liturgy(), game.check_liturgy_on_close() from public, anon, authenticated, oikos_service;
drop trigger if exists liturgies_guard on game.liturgies;
create trigger liturgies_guard before insert on game.liturgies
  for each row execute function game.guard_liturgy();
drop trigger if exists liturgies_on_close on game.liturgies;
create constraint trigger liturgies_on_close after insert on game.liturgies
  deferrable initially deferred for each row execute function game.check_liturgy_on_close();
drop trigger if exists liturgies_immutable on game.liturgies;
create trigger liturgies_immutable before update or delete on game.liturgies
  for each row execute function game.forbid_change();
drop trigger if exists liturgies_no_truncate on game.liturgies;
create trigger liturgies_no_truncate before truncate on game.liturgies
  for each statement execute function game.forbid_change();

-- Le service lit et désigne, sans choisir ni l'identifiant, ni la date, ni l'état ; il ne modifie ni ne supprime.
alter table game.liturgies enable row level security;
revoke all on game.liturgies from public, anon, authenticated, oikos_service;
grant select on game.liturgies to oikos_service;
grant insert (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at) on game.liturgies to oikos_service;
drop policy if exists service_all on game.liturgies;
create policy service_all on game.liturgies for all to oikos_service using (true) with check (true);

-- Lectures des joueurs connectés : les liturgies des cités de leur monde sont publiques (maison, genre, état,
-- échéance), sans le dû, part de la fortune qu'aucun joueur ne lit hors de sa maison (4.1) : colonnes accordées une à
-- une. Ni l'identifiant (`uuid_v7`, préfixé par l'instant d'insertion) ni la date ne sont accordés : ils diraient
-- l'ordre des insertions d'une clôture, que le moteur suit (par identifiant de maison) sans jamais suivre la fortune.
-- Une liturgie se désigne par sa maison et sa saison. Le dû, l'identifiant et la date ne se lisent que pour sa
-- maison, par une fonction au nom du propriétaire. Rien pour un visiteur anonyme.
drop policy if exists liturgies_read on game.liturgies;
create policy liturgies_read on game.liturgies for select to authenticated
  using (world_id in (select game.current_world_ids()));
grant select (world_id, city_id, house_id, season, genre, designated_day, due_day, due_at, status)
  on game.liturgies to authenticated;

create or replace function game.my_liturgies()
returns table (
  id uuid, world_id uuid, city_id uuid, house_id uuid, season integer, genre text, due bigint,
  designated_day integer, due_day integer, due_at timestamptz, status text, created_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select l.id, l.world_id, l.city_id, l.house_id, l.season, l.genre, l.due, l.designated_day, l.due_day, l.due_at,
         l.status, l.created_at
  from game.liturgies l
  where l.house_id in (select game.current_house_ids());
$$;
revoke all on function game.my_liturgies() from public;
grant execute on function game.my_liturgies() to authenticated;

-- Vues créées une fois (ADR 0006) : rejouée, la migration ne les recrée pas, et #720 pourra les étendre.
do $$
begin
  if to_regclass('public.city_liturgies') is null then
    create view public.city_liturgies with (security_invoker = true) as
      select world_id, city_id, house_id, season, genre, status, designated_day, due_day, due_at
      from game.liturgies;
  end if;
  if to_regclass('public.my_liturgies') is null then
    create view public.my_liturgies with (security_invoker = true) as
      select id, world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at, status, created_at
      from game.my_liturgies();
  end if;
end $$;
revoke all on public.city_liturgies, public.my_liturgies from public, anon;
grant select on public.city_liturgies, public.my_liturgies to authenticated;
