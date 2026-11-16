-- Immobilier entre maisons : offres et baux (docs/specs/04-systemes-gestion.md, 4.5 ;
-- docs/specs/12-modele-donnees.md ; ticket 257). Une maison propose un bien qu'elle possède à la vente ou à
-- la location ; une autre l'achète ou le loue, et le loyer se paie à chaque clôture. La revente et le loyer
-- passent par le grand livre (migration suivante). Rejouable (`if not exists`,
-- `create or replace`, contraintes et déclencheurs recréés) ; le code précédent n'écrit ni ne lit ces tables.

-- Un bien et son monde se désignent ensemble, comme une maison (migration 4).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_id_world_unique') then
    alter table game.properties add constraint properties_id_world_unique unique (id, world_id);
  end if;
end $$;

-- Offre d'un bien par sa maison : à la vente (prix) ou à la location (loyer quotidien), en oboles. Une offre
-- ouverte par bien ; elle se ferme une fois, par son retrait, la vente ou le bail.
create table if not exists game.property_listings (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  property_id uuid not null,
  house_id uuid not null,
  kind text not null check (kind in ('sale', 'lease')),
  -- Borne technique (`MAX_ORDER_PRICE`, packages/contracts) : prix × taux reste un entier exact.
  price_oboles bigint not null check (price_oboles between 1 and 1000000000),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  outcome text check (outcome in ('withdrawn', 'sold', 'leased')),
  -- Écriture `property.sale` qui a réglé la vente.
  ledger_entry_id uuid,
  constraint property_listings_id_world_unique unique (id, world_id),
  constraint property_listings_property_same_world foreign key (property_id, world_id) references game.properties (id, world_id),
  constraint property_listings_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint property_listings_entry_same_world foreign key (ledger_entry_id, world_id) references game.ledger_entries (id, world_id),
  constraint property_listings_closed_with_outcome check ((closed_at is null) = (outcome is null)),
  constraint property_listings_outcome_of_kind check (
    outcome is null or outcome = 'withdrawn' or outcome = case kind when 'sale' then 'sold' else 'leased' end),
  constraint property_listings_entry_when_sold check ((ledger_entry_id is not null) = (outcome is not distinct from 'sold'))
);
create unique index if not exists property_listings_open_once on game.property_listings (property_id) where closed_at is null;
create unique index if not exists property_listings_entry_once on game.property_listings (ledger_entry_id) where ledger_entry_id is not null;
create index if not exists property_listings_house_idx on game.property_listings (house_id);

-- Bail : un bien, son propriétaire et son locataire, au loyer de l'offre. Un bail actif par bien. La fin se
-- demande (par l'une ou l'autre partie), puis prend effet à une clôture ; un loyer impayé y met fin aussi.
create table if not exists game.leases (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  property_id uuid not null,
  listing_id uuid not null,
  landlord_house_id uuid not null,
  tenant_house_id uuid not null,
  rent_oboles bigint not null check (rent_oboles between 1 and 1000000000),
  started_at timestamptz not null default now(),
  end_requested_at timestamptz,
  end_requested_by text check (end_requested_by in ('landlord', 'tenant')),
  ended_at timestamptz,
  -- Jour de jeu de la clôture qui a mis fin au bail, vérifié à la validation (comme l'usure d'un bien).
  ended_day integer,
  end_reason text check (end_reason in ('requested', 'unpaid')),
  constraint leases_listing_once unique (listing_id),
  constraint leases_property_same_world foreign key (property_id, world_id) references game.properties (id, world_id),
  constraint leases_listing_same_world foreign key (listing_id, world_id) references game.property_listings (id, world_id),
  constraint leases_landlord_same_world foreign key (landlord_house_id, world_id) references game.houses (id, world_id),
  constraint leases_tenant_same_world foreign key (tenant_house_id, world_id) references game.houses (id, world_id),
  constraint leases_not_own_property check (tenant_house_id <> landlord_house_id),
  constraint leases_request_complete check ((end_requested_at is null) = (end_requested_by is null)),
  constraint leases_end_complete check ((ended_at is null) = (ended_day is null) and (ended_at is null) = (end_reason is null)),
  constraint leases_ended_on_close foreign key (world_id, ended_day)
    references game.daily_closes (world_id, game_day) deferrable initially deferred
);
create unique index if not exists leases_active_once on game.leases (property_id) where ended_at is null;
create index if not exists leases_world_active_idx on game.leases (world_id) where ended_at is null;
create index if not exists leases_landlord_idx on game.leases (landlord_house_id);
create index if not exists leases_tenant_idx on game.leases (tenant_house_id);

-- Une offre naît maintenant, ouverte, par la maison qui possède le bien, sur un bien qui n'est pas loué.
-- Elle ne change ensuite qu'une fois, en se fermant, datée de la transaction : retirée, vendue par une
-- écriture `property.sale` de la même transaction qui la désigne, débite l'acheteur du prix exact et ne
-- débite pas le vendeur, ou louée par un bail de la même transaction. Au nom du propriétaire de la base.
-- Comme pour un échange de l'agora (5.3), la base ne lit pas la taxe : le vendeur reçoit le net, qu'elle ne
-- borne pas (une vente d'une obole dont la taxe prend tout ne lui crédite rien).
create or replace function game.guard_property_listing() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() then
      raise exception 'a listing is made now' using errcode = 'restrict_violation';
    end if;
    if new.closed_at is not null or new.outcome is not null or new.ledger_entry_id is not null then
      raise exception 'a listing is made open' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.properties p where p.id = new.property_id and p.owner_house_id = new.house_id) then
      raise exception 'only its owner lists a property' using errcode = 'restrict_violation';
    end if;
    if exists (select 1 from game.leases l where l.property_id = new.property_id and l.ended_at is null) then
      raise exception 'a leased property is not listed' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.property_id, new.house_id, new.kind, new.price_oboles, new.created_at)
     is distinct from (old.id, old.world_id, old.property_id, old.house_id, old.kind, old.price_oboles, old.created_at) then
    raise exception 'listing terms are immutable' using errcode = 'restrict_violation';
  end if;
  if old.outcome is not null then
    raise exception 'a closed listing does not change' using errcode = 'restrict_violation';
  end if;
  new.closed_at := case when new.outcome is null then null else now() end;
  if new.outcome = 'sold' and not exists (
      select 1 from game.ledger_entries e
      where e.id = new.ledger_entry_id and e.kind = 'property.sale' and e.created_at = now()
        and e.meta ->> 'listingId' = new.id::text and e.meta ->> 'propertyId' = new.property_id::text
        and exists (select 1 from game.ledger_lines l join game.accounts a on a.id = l.account_id
                    where l.entry_id = e.id and a.kind = 'house' and a.house_id <> new.house_id
                      and l.amount = -new.price_oboles)
        and not exists (select 1 from game.ledger_lines l join game.accounts a on a.id = l.account_id
                        where l.entry_id = e.id and a.kind = 'house' and a.house_id = new.house_id and l.amount < 0)) then
    raise exception 'a listing is sold only by a sale entry of the same transaction, at its price'
      using errcode = 'restrict_violation';
  end if;
  if new.outcome = 'leased' and not exists (
      select 1 from game.leases l where l.listing_id = new.id and l.started_at = now()) then
    raise exception 'a listing is leased only by a lease of the same transaction' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_property_listing() from public, anon, authenticated, oikos_service;
drop trigger if exists property_listings_guard on game.property_listings;
create trigger property_listings_guard before insert or update on game.property_listings
  for each row execute function game.guard_property_listing();

-- Un bail naît maintenant, d'une offre de location encore ouverte, à son loyer, entre la maison qui
-- possède le bien et une autre. Ses termes ne changent plus. Sa fin se demande une fois (datée de la
-- transaction), puis il prend fin une fois, dans la transaction qui enregistre la clôture de son jour (même
-- montage que l'usure d'un bien, migration 110) : demandée, ou faute du loyer de ce jour.
create or replace function game.guard_lease() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.started_at is distinct from now() then
      raise exception 'a lease starts now' using errcode = 'restrict_violation';
    end if;
    if (new.end_requested_at, new.end_requested_by, new.ended_at, new.ended_day, new.end_reason) is distinct from
       (null::timestamptz, null::text, null::timestamptz, null::integer, null::text) then
      raise exception 'a lease starts running' using errcode = 'restrict_violation';
    end if;
    if not exists (
        select 1 from game.property_listings o join game.properties p on p.id = o.property_id
        where o.id = new.listing_id and o.property_id = new.property_id and o.kind = 'lease' and o.outcome is null
          and o.house_id = new.landlord_house_id and o.price_oboles = new.rent_oboles
          and p.owner_house_id = new.landlord_house_id) then
      raise exception 'a lease follows an open lease offer of the owner, at its rent' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.property_id, new.listing_id, new.landlord_house_id, new.tenant_house_id,
      new.rent_oboles, new.started_at)
     is distinct from (old.id, old.world_id, old.property_id, old.listing_id, old.landlord_house_id,
      old.tenant_house_id, old.rent_oboles, old.started_at) then
    raise exception 'lease terms are immutable' using errcode = 'restrict_violation';
  end if;
  if old.ended_at is not null then
    raise exception 'an ended lease does not change' using errcode = 'restrict_violation';
  end if;
  if new.end_requested_by is distinct from old.end_requested_by then
    if old.end_requested_by is not null then
      raise exception 'an end is requested once' using errcode = 'restrict_violation';
    end if;
    new.end_requested_at := now();
  else
    new.end_requested_at := old.end_requested_at;
  end if;
  if new.ended_day is not null then
    if new.end_reason = 'requested' and new.end_requested_by is null then
      raise exception 'a lease ends on request only once requested' using errcode = 'restrict_violation';
    end if;
    if new.end_reason = 'unpaid' and exists (
        select 1 from game.ledger_entries e where e.kind = 'lease.rent'
          and ((e.meta ->> 'leaseId')::uuid) = new.id and ((e.meta ->> 'gameDay')::integer) = new.ended_day) then
      raise exception 'a lease whose rent is paid does not end unpaid' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.ended_day) then
      raise exception 'a lease ends before its close is recorded' using errcode = 'restrict_violation';
    end if;
    new.ended_at := now();
  else
    new.ended_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_lease() from public, anon, authenticated, oikos_service;
drop trigger if exists leases_guard on game.leases;
create trigger leases_guard before insert or update on game.leases
  for each row execute function game.guard_lease();

do $$
declare
  t text;
begin
  foreach t in array array['property_listings', 'leases'] loop
    execute format('drop trigger if exists %1$s_no_delete on game.%1$s', t);
    execute format('create trigger %1$s_no_delete before delete on game.%1$s for each row execute function game.forbid_change()', t);
    execute format('drop trigger if exists %1$s_no_truncate on game.%1$s', t);
    execute format('create trigger %1$s_no_truncate before truncate on game.%1$s for each statement execute function game.forbid_change()', t);
  end loop;
end $$;

-- Le service lit, ouvre une offre ou un bail sans en choisir l'identifiant ni les dates, et n'en modifie
-- que la fermeture (offre), la demande de fin et la fin (bail). Les joueurs lisent par des vues (#257, plus
-- loin).
alter table game.property_listings enable row level security;
alter table game.leases enable row level security;
revoke all on game.property_listings, game.leases from public, anon, authenticated, oikos_service;
grant select on game.property_listings, game.leases to oikos_service;
grant insert (world_id, property_id, house_id, kind, price_oboles) on game.property_listings to oikos_service;
grant update (outcome, ledger_entry_id) on game.property_listings to oikos_service;
grant insert (world_id, property_id, listing_id, landlord_house_id, tenant_house_id, rent_oboles) on game.leases to oikos_service;
grant update (end_requested_by, ended_day, end_reason) on game.leases to oikos_service;
drop policy if exists service_all on game.property_listings;
create policy service_all on game.property_listings for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.leases;
create policy service_all on game.leases for all to oikos_service using (true) with check (true);
