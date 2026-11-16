-- Revente d'un bien entre maisons et loyer quotidien (docs/specs/04-systemes-gestion.md, 4.5 ;
-- docs/specs/12-modele-donnees.md ; ticket 257). Rejouable (`create or replace`, contraintes recréées,
-- `if not exists`) ; le code précédent n'écrit ni `property.sale` ni `lease.rent`, et la garde des biens
-- garde pour lui le même comportement (achat à la cité, rénovation, usure, impayé).

-- Loyer d'un jour : une écriture `lease.rent` par bail et par jour de jeu, quelle que soit la façon d'écrire
-- la clé (clé typée, forme unique imposée, comme `upkeep.daily`, migration 27).
alter table game.ledger_entries drop constraint if exists ledger_entries_lease_rent_meta;
alter table game.ledger_entries add constraint ledger_entries_lease_rent_meta check (
  kind <> 'lease.rent'
  or (jsonb_typeof(meta -> 'leaseId') = 'string' and jsonb_typeof(meta -> 'gameDay') = 'number'
      and meta ->> 'leaseId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      and meta ->> 'gameDay' ~ '^(0|[1-9][0-9]{0,8})$') is true
);
create unique index if not exists ledger_entries_lease_rent_once
  on game.ledger_entries (((meta ->> 'leaseId')::uuid), ((meta ->> 'gameDay')::integer)) where kind = 'lease.rent';

-- Revente : l'écriture `property.sale` désigne le bien et l'offre qu'elle règle, sous une seule forme ;
-- une offre n'est réglée qu'une fois (index unique de la migration 120 sur l'écriture d'une offre, et ici
-- sur l'offre d'une écriture), et la garde retrouve les ventes d'un bien sans parcourir le grand livre.
alter table game.ledger_entries drop constraint if exists ledger_entries_property_sale_meta;
alter table game.ledger_entries add constraint ledger_entries_property_sale_meta check (
  kind <> 'property.sale'
  or (meta ->> 'propertyId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      and meta ->> 'listingId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') is true
);
create unique index if not exists ledger_entries_property_sold_once
  on game.ledger_entries (((meta ->> 'listingId')::uuid)) where kind = 'property.sale';
create index if not exists ledger_entries_property_sold_idx
  on game.ledger_entries (((meta ->> 'propertyId')::uuid)) where kind = 'property.sale';

-- Garde des biens : celle de la migration 110, sauf le point 1, qui admet la revente. Un bien quitte la
-- cité par une écriture `property.buy` comme avant ; il passe d'une maison à une autre par une écriture
-- `property.sale` de la même transaction qui le désigne, débite l'acheteur (pas le vendeur) et règle
-- l'offre de vente du vendeur, fermée vendue dans cette transaction. Dans les deux cas, ni bail actif ni
-- offre ouverte ne restent sur le bien. Il ne revient jamais à la cité.
create or replace function game.guard_property() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() then
      raise exception 'a property is built now' using errcode = 'restrict_violation';
    end if;
    if new.owner_house_id is not null or new.acquired_at is not null then
      raise exception 'a property is first held by its city' using errcode = 'restrict_violation';
    end if;
    if new.condition <> 10000 or new.worn_day is not null or new.upkeep_unpaid_since is not null then
      raise exception 'a property is built new' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.city_id, new.size_id, new.lot, new.created_at)
     is distinct from (old.id, old.world_id, old.city_id, old.size_id, old.lot, old.created_at) then
    raise exception 'property identity is immutable' using errcode = 'restrict_violation';
  end if;
  new.acquired_at := old.acquired_at;
  if new.owner_house_id is distinct from old.owner_house_id then
    if new.owner_house_id is null then
      raise exception 'a property does not return to its city' using errcode = 'restrict_violation';
    end if;
    if exists (select 1 from game.leases l where l.property_id = new.id and l.ended_at is null) then
      raise exception 'a leased property does not change hands' using errcode = 'restrict_violation';
    end if;
    if exists (select 1 from game.property_listings o where o.property_id = new.id and o.closed_at is null) then
      raise exception 'a listed property changes hands only once its listing is closed' using errcode = 'restrict_violation';
    end if;
    if old.owner_house_id is null and not exists (
        select 1 from game.ledger_entries e
        join game.ledger_lines l on l.entry_id = e.id
        join game.accounts a on a.id = l.account_id
        where ((e.meta ->> 'propertyId')::uuid) = new.id and e.kind = 'property.buy'
          and e.world_id = new.world_id and e.created_at = now()
          and a.kind = 'house' and a.house_id = new.owner_house_id and l.amount < 0) then
      raise exception 'a property changes hands only by a purchase entry of the same transaction'
        using errcode = 'restrict_violation';
    end if;
    -- Revente (#257) : l'écriture `property.sale` de la transaction, qui débite l'acheteur, pas le vendeur,
    -- et règle l'offre de vente du vendeur, fermée (vendue) dans la même transaction.
    if old.owner_house_id is not null and not exists (
        select 1 from game.ledger_entries e
        join game.property_listings o on o.ledger_entry_id = e.id
        where ((e.meta ->> 'propertyId')::uuid) = new.id and e.kind = 'property.sale'
          and e.world_id = new.world_id and e.created_at = now()
          and o.property_id = new.id and o.house_id = old.owner_house_id and o.outcome = 'sold' and o.closed_at = now()
          and exists (select 1 from game.ledger_lines l join game.accounts a on a.id = l.account_id
                      where l.entry_id = e.id and a.kind = 'house' and a.house_id = new.owner_house_id and l.amount < 0)
          and not exists (select 1 from game.ledger_lines l join game.accounts a on a.id = l.account_id
                          where l.entry_id = e.id and a.kind = 'house' and a.house_id = old.owner_house_id and l.amount < 0)) then
      raise exception 'a property passes between houses only by a sale entry of the same transaction'
        using errcode = 'restrict_violation';
    end if;
    new.acquired_at := now();
  end if;
  if new.condition > old.condition then
    if new.condition <> 10000 or new.worn_day is distinct from old.worn_day then
      raise exception 'a renovation restores a property to its full condition' using errcode = 'restrict_violation';
    end if;
    if not exists (
        select 1 from game.ledger_entries e
        join game.ledger_lines l on l.entry_id = e.id
        join game.accounts a on a.id = l.account_id
        where ((e.meta ->> 'propertyId')::uuid) = new.id and e.kind = 'property.renovate'
          and e.world_id = new.world_id and e.created_at = now()
          and a.kind = 'house' and a.house_id = new.owner_house_id and l.amount < 0) then
      raise exception 'a property is restored only by a renovation entry of the same transaction'
        using errcode = 'restrict_violation';
    end if;
  elsif new.condition < old.condition or new.worn_day is distinct from old.worn_day then
    if new.worn_day is null or new.worn_day <= coalesce(old.worn_day, -1) then
      raise exception 'a property wears once per game day, forward' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.worn_day) then
      raise exception 'a property wears before its close is recorded' using errcode = 'restrict_violation';
    end if;
  end if;
  if new.upkeep_unpaid_since is distinct from old.upkeep_unpaid_since and new.upkeep_unpaid_since is not null then
    if old.upkeep_unpaid_since is not null then
      raise exception 'an unpaid date does not change' using errcode = 'restrict_violation';
    end if;
    if new.upkeep_unpaid_since < now() or new.upkeep_unpaid_since > clock_timestamp() then
      raise exception 'unpaid upkeep is dated by the transaction that writes it' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_property() from public, anon, authenticated, oikos_service;

-- La suite d'une vente et d'un bail, contrôlée à la validation (déclencheurs différés) : une offre fermée
-- vendue a cédé son bien à l'acheteur, la maison que son écriture débite du prix ; un bail créé a fermé son
-- offre louée. Sans ce contrôle, une transaction pourrait faire payer l'acheteur en laissant le bien au
-- vendeur, ou ouvrir un bail en laissant son offre ouverte, puis la retirer. Au nom du propriétaire.
create or replace function game.check_property_listing_settled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'leases' then
    if not exists (select 1 from game.property_listings o where o.id = new.listing_id and o.outcome = 'leased') then
      raise exception 'a lease closes its offer as leased in its transaction' using errcode = 'restrict_violation';
    end if;
  elsif not exists (
      select 1 from game.properties p
      join game.ledger_lines l on l.entry_id = new.ledger_entry_id
      join game.accounts a on a.id = l.account_id
      where p.id = new.property_id and a.kind = 'house' and a.house_id = p.owner_house_id
        and p.owner_house_id <> new.house_id and l.amount = -new.price_oboles) then
    raise exception 'a sold listing hands its property to the buyer in its transaction' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_property_listing_settled() from public, anon, authenticated, oikos_service;
drop trigger if exists property_listings_settled on game.property_listings;
create constraint trigger property_listings_settled after update of outcome on game.property_listings
  deferrable initially deferred for each row when (new.outcome = 'sold')
  execute function game.check_property_listing_settled();
drop trigger if exists leases_settled on game.leases;
create constraint trigger leases_settled after insert on game.leases
  deferrable initially deferred for each row execute function game.check_property_listing_settled();
