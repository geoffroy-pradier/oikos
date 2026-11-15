-- Navires des maisons (docs/specs/04-systemes-gestion.md, 4.6 ; ticket 251).
-- Une maison achète un navire, qui naît à quai dans sa cité ; le départ et l'entretien viennent avec #252.
-- Rejouable (`if not exists`, `create or replace`, `on conflict do nothing`, règles recréées) ; le code
-- précédent n'écrit ni ne lit cette table, ce puits ni ces vues, et `my_cash_flows` garde ses colonnes.

create table if not exists game.ships (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  -- Classe du navire, identifiant de la configuration (`ships.classes`, packages/config).
  class_id text not null check (class_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Cité où le navire est à quai ; nulle quand il est en mer (#252).
  docked_city_id uuid,
  -- Instant où le navire a été désarmé, entretien impayé (#252) ; nul pour un navire armé.
  laid_up_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ships_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint ships_docked_city_same_world foreign key (docked_city_id, world_id) references game.cities (id, world_id)
);
create index if not exists ships_house_id_idx on game.ships (house_id);

-- Un navire naît maintenant, à quai (dans une cité de son monde : clé étrangère ci-dessus) et armé. Il ne
-- change ensuite ni d'identifiant, ni de monde, ni de maison, ni de classe, ni de date de naissance : la
-- revente n'existe pas. Le quai et le désarmement changeront avec les voyages et l'entretien (#252).
create or replace function game.guard_ship() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() then
      raise exception 'a ship is commissioned now' using errcode = 'restrict_violation';
    end if;
    if new.docked_city_id is null then
      raise exception 'a ship is commissioned docked in a city' using errcode = 'restrict_violation';
    end if;
    if new.laid_up_at is not null then
      raise exception 'a ship is commissioned in service' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.house_id, new.class_id, new.created_at)
     is distinct from (old.id, old.world_id, old.house_id, old.class_id, old.created_at) then
    raise exception 'ship identity is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_ship() from public, anon, authenticated, oikos_service;
drop trigger if exists ships_guard on game.ships;
create trigger ships_guard before insert or update on game.ships
  for each row execute function game.guard_ship();

-- Le service lit et crée un navire, sans choisir ni sa date, ni son désarmement, ni son identifiant ; il
-- ne le modifie ni ne le supprime. Un joueur lit ses propres navires, colonnes accordées une à une.
alter table game.ships enable row level security;
revoke all on game.ships from public, anon, authenticated, oikos_service;
grant select on game.ships to oikos_service;
grant insert (world_id, house_id, class_id, docked_city_id) on game.ships to oikos_service;
drop policy if exists service_all on game.ships;
create policy service_all on game.ships for all to oikos_service using (true) with check (true);
drop policy if exists ships_read_own on game.ships;
create policy ships_read_own on game.ships for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, house_id, class_id, docked_city_id, laid_up_at) on game.ships to authenticated;

-- `my_ships` gagnera des colonnes avec les voyages : rejouée ensuite, cette migration ne la recrée pas
-- (`create or replace` ne retire pas de colonne), comme `my_sites` (migration 9).
do $$
begin
  if to_regclass('public.my_ships') is null then
    create view public.my_ships with (security_invoker = true) as
      select id, house_id, class_id, docked_city_id, laid_up_at from game.ships;
  end if;
end $$;
grant select on public.my_ships to authenticated;

-- Puits de monnaie : le prix d'un navire neuf est détruit. Le catalogue crée le compte dans chaque monde.
insert into game.system_account_kinds (key, allow_negative)
values ('sink_ship_purchase', false)
on conflict do nothing;

-- Règles des navires lues par le client : la section `ships` de la configuration en vigueur, règles du jeu
-- connues de tous les joueurs (tout champ qui y est ajouté leur devient visible). Même montage que
-- `site_rules` (migration 18). Nulle pour une version publiée avant le transport : le client applique la
-- valeur par défaut du schéma partagé (aucune classe), comme l'API. Sans version en vigueur, aucune ligne.
create or replace function game.ship_rules() returns table (ships jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'ships'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.ship_rules() from public;
grant execute on function game.ship_rules() to authenticated;

create or replace view public.ship_rules with (security_invoker = true) as
  select ships from game.ship_rules();
grant select on public.ship_rules to authenticated;

-- Flux de trésorerie (migration 32) : l'achat d'un navire est une acquisition, hors exploitation, comme
-- celle d'un site. Seule la ligne `ship.acquire` change ; colonnes, droits et vues dérivées sont inchangés.
create or replace view public.my_cash_flows with (security_invoker = true) as
  select house_id, account, game_day, nature, sum(amount)::bigint as amount
  from (
    select a.house_id,
           case a.kind when 'house' then 'treasury' else a.kind end as account,
           ((e.created_at at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
             - date '1970-01-01' as game_day,
           f.nature, f.amount
    from game.accounts a
    join game.ledger_lines l on l.account_id = a.id
    join game.ledger_entries e on e.id = l.entry_id
    left join game.clock_rules() c on true
    left join lateral (
      select sum(t.price * t.quantity) as gross from game.trades t where t.ledger_entry_id = e.id
    ) sale on l.amount > 0 and e.kind in ('market.trade', 'npc.purchase')
    cross join lateral (values
      (case
         when e.kind in ('market.trade', 'npc.purchase') then case when l.amount > 0 then 'sales' else 'purchases' end
         when e.kind in ('market.escrow_hold', 'market.escrow_release') then 'escrow'
         when e.kind in ('upkeep.daily', 'upkeep.restart') then 'upkeep'
         when e.kind in ('site.acquire', 'ship.acquire') then 'acquisitions'
         when e.kind = 'house.starting_grant' then 'grant'
         else 'other'
       end, coalesce(sale.gross, l.amount)),
      ('taxes', l.amount - sale.gross)
    ) f (nature, amount)
    where a.kind in ('house', 'escrow') and f.amount <> 0
  ) flows
  group by house_id, account, game_day, nature
  having sum(amount) <> 0;
