-- Banques de joueurs : saisie d'un logement gagé (docs/specs/05-economie.md, 5.4 ; 04-systemes-gestion.md, 4.5 ;
-- 12-modele-donnees.md ; #729).
-- La saisie d'un prêt de banque gagé sur un logement (migration 0600) le remet à la maison de la banque, avec son bail en
-- cours, dont elle devient le bailleur : un bien ne passe plus d'une maison à une autre que par une revente ou une
-- saisie, et un bail ne change de bailleur que par la saisie de son bien. Un logement loué à la maison de la banque ne
-- garantit pas un prêt de cette banque : saisi, elle se louerait son propre bien.
-- Rejouable (`create or replace`) ; compatible avec le code précédent, qui ne saisit rien et ne gage pas de logement loué
-- à la banque prêteuse.

-- Garde des biens : celle de la migration 121, plus la saisie, qui remet le bien de l'emprunteur à la maison de la banque,
-- même loué, dans la transaction de la saisie.
create or replace function game.guard_property() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seized boolean;
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
  -- Saisie (#729) : la saisie d'un prêt de banque gagé sur ce bien, faite dans la transaction, le remet de son
  -- emprunteur à la maison de la banque, bail en cours compris.
  seized := old.owner_house_id is not null and exists (
    select 1 from game.loan_seizures z
    join game.loans o on o.id = z.loan_id
    join game.bank_loan_offers f on f.id = o.offer_id
    where f.collateral_property_id = new.id and z.created_at = now()
      and z.borrower_house_id = old.owner_house_id and z.bank_house_id = new.owner_house_id);
  if new.owner_house_id is distinct from old.owner_house_id then
    if new.owner_house_id is null then
      raise exception 'a property does not return to its city' using errcode = 'restrict_violation';
    end if;
    if not seized and exists (select 1 from game.leases l where l.property_id = new.id and l.ended_at is null) then
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
    if old.owner_house_id is not null and not seized and not exists (
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

-- Garde des baux : celle de la migration 120, plus la saisie, qui remet le bail en cours du bien saisi à son nouveau
-- propriétaire.
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
  if (new.id, new.world_id, new.property_id, new.listing_id, new.tenant_house_id, new.rent_oboles, new.started_at)
     is distinct from (old.id, old.world_id, old.property_id, old.listing_id, old.tenant_house_id, old.rent_oboles,
      old.started_at) then
    raise exception 'lease terms are immutable' using errcode = 'restrict_violation';
  end if;
  -- Saisie (#729) : un bail en cours passe, avec son bien saisi dans la transaction, à son nouveau propriétaire.
  if new.landlord_house_id is distinct from old.landlord_house_id and not exists (
      select 1 from game.loan_seizures z
      join game.loans o on o.id = z.loan_id
      join game.bank_loan_offers f on f.id = o.offer_id
      join game.properties p on p.id = f.collateral_property_id
      where f.collateral_property_id = new.property_id and z.created_at = now() and p.owner_house_id = new.landlord_house_id)
  then
    raise exception 'a lease changes landlord only with the seizure of its property' using errcode = 'restrict_violation';
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

-- Gage d'un prêt de banque : celui de la migration 0303, plus le refus d'un logement loué à la maison de la banque.
create or replace function game.pledge_bank_loan_collateral() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  offer game.bank_loan_offers;
begin
  if tg_relid <> 'game.loans'::regclass then
    raise exception '% only runs on game.loans', tg_name using errcode = 'insufficient_privilege';
  end if;
  select * into offer from game.bank_loan_offers o where o.id = new.offer_id;
  if offer.collateral_kind = 'stock' then
    update game.inventories i set reserved = i.reserved + offer.collateral_quantity
      where i.house_id = new.borrower_house_id and i.city_id = offer.collateral_city_id
        and i.good_id = offer.collateral_good_id;
    if found then
      return null;
    end if;
  else
    perform 1 from game.properties p
      where p.id = offer.collateral_property_id and p.owner_house_id = new.borrower_house_id for update;
    if found and not game.property_pledged(offer.collateral_property_id, new.id) and not exists (
         select 1 from game.property_listings l where l.property_id = offer.collateral_property_id and l.closed_at is null)
       and not exists (
         select 1 from game.leases l join game.banks b on b.id = new.bank_id
         where l.property_id = offer.collateral_property_id and l.ended_at is null and l.tenant_house_id = b.house_id) then
      return null;
    end if;
  end if;
  raise exception 'a bank loan pledges collateral its borrower holds free' using errcode = 'check_violation',
    constraint = 'loans_collateral_free';
end;
$$;
-- La saisie : la migration 0601, plus le logement gagé, remis à la maison de la banque avec son bail en cours, dont elle
-- devient le bailleur ; le bien n'est plus gagé, le prêt étant soldé.
create or replace function game.apply_loan_seizure() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  offer game.bank_loan_offers;
  origin uuid;
  destination uuid;
begin
  if tg_relid <> 'game.loan_seizures'::regclass then
    raise exception '% only runs on game.loan_seizures', tg_name using errcode = 'insufficient_privilege';
  end if;
  update game.loans o set status = 'repaid', defaulted_day = new.game_day, written_off = o.outstanding, outstanding = 0
    where o.id = new.loan_id and o.status = 'active';
  select f.* into offer from game.bank_loan_offers f join game.loans o on o.offer_id = f.id where o.id = new.loan_id;
  if offer.collateral_kind = 'stock' then
    select i.id into origin from game.inventories i
      where i.house_id = new.borrower_house_id and i.city_id = offer.collateral_city_id and i.good_id = offer.collateral_good_id;
    insert into game.inventories (world_id, house_id, city_id, good_id)
      values (new.world_id, new.bank_house_id, offer.collateral_city_id, offer.collateral_good_id)
      on conflict (house_id, city_id, good_id) do nothing;
    select i.id into destination from game.inventories i
      where i.house_id = new.bank_house_id and i.city_id = offer.collateral_city_id and i.good_id = offer.collateral_good_id;
    insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_inventory_id, kind, loan_seizure_id)
      values (new.world_id, offer.collateral_good_id, offer.collateral_quantity, origin, destination, 'bank.loan_seize', new.id);
  else
    update game.properties p set owner_house_id = new.bank_house_id where p.id = offer.collateral_property_id;
    update game.leases l set landlord_house_id = new.bank_house_id
      where l.property_id = offer.collateral_property_id and l.ended_at is null;
  end if;
  return null;
end;
$$;

revoke execute on function game.guard_property(), game.guard_lease(), game.pledge_bank_loan_collateral(),
  game.apply_loan_seizure() from public, anon, authenticated, oikos_service;
