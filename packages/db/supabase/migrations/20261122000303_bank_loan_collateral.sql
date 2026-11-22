-- Banques de joueurs : garantie des prêts de banque (docs/specs/05-economie.md, 5.4 ; 04-systemes-gestion.md, 4.5 ;
-- 12-modele-donnees.md ; ticket 728).
-- La garantie d'un prêt de banque, celle de son offre (migration 0300), se bloque à sa naissance et se libère à son solde.
-- Un stock gagé est retenu sur le stock de l'emprunteur dans sa cité, comme ce que réserve un ordre de vente : la
-- contrainte `inventories_reserved_within_quantity` (migration 10) refuse alors toute sortie qui l'entamerait, vente,
-- embarquement, offrande ou consommation, par quelque chemin que ce soit. Un logement gagé ne s'offre plus ni à la vente
-- ni à la location et ne change pas de propriétaire. Un prêt en défaut garde sa garantie jusqu'à sa saisie.
-- Rejouable (`create or replace`, déclencheurs et droits recréés) ; compatible avec le code précédent, qui ne gage rien.

-- Un logement est gagé tant qu'un prêt de banque qui le garantit n'est pas remboursé.
create or replace function game.property_pledged(p_property uuid, p_except uuid = null) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from game.loans o join game.bank_loan_offers f on f.id = o.offer_id
                 where f.collateral_property_id = p_property and o.status <> 'repaid' and o.id is distinct from p_except)
$$;

-- À la naissance d'un prêt de banque, au nom du propriétaire : son stock gagé est retenu sur celui de l'emprunteur dans
-- sa cité (le stock libre doit le couvrir), son logement gagé doit être à l'emprunteur, sans offre ouverte ni autre
-- prêt qui le gage. Le bien est verrouillé : une offre de vente ou de location qui le croise se suit.
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
         select 1 from game.property_listings l where l.property_id = offer.collateral_property_id and l.closed_at is null) then
      return null;
    end if;
  end if;
  raise exception 'a bank loan pledges collateral its borrower holds free' using errcode = 'check_violation',
    constraint = 'loans_collateral_free';
end;
$$;

-- Au solde d'un prêt de banque, au nom du propriétaire : son stock gagé se libère ; son logement, qui n'est gagé que
-- par un prêt non remboursé, l'est déjà.
create or replace function game.release_bank_loan_collateral() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.loans'::regclass then
    raise exception '% only runs on game.loans', tg_name using errcode = 'insufficient_privilege';
  end if;
  update game.inventories i set reserved = i.reserved - o.collateral_quantity
    from game.bank_loan_offers o
    where o.id = new.offer_id and o.collateral_kind = 'stock' and i.house_id = new.borrower_house_id
      and i.city_id = o.collateral_city_id and i.good_id = o.collateral_good_id;
  return null;
end;
$$;

-- Un logement gagé ne s'offre ni à la vente ni à la location, et ne change pas de propriétaire. Le bien est verrouillé
-- avant la lecture : un prêt qui le gage en même temps se suit.
create or replace function game.forbid_pledged_property() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if tg_relid = 'game.property_listings'::regclass then
    target := new.property_id;
  elsif tg_relid = 'game.properties'::regclass then
    target := new.id;
  else
    raise exception '% only runs on properties and their listings', tg_name using errcode = 'insufficient_privilege';
  end if;
  perform 1 from game.properties p where p.id = target for share;
  if game.property_pledged(target) then
    raise exception 'a pledged property is neither listed nor sold' using errcode = 'check_violation',
      constraint = 'properties_pledged';
  end if;
  return new;
end;
$$;
revoke execute on function game.pledge_bank_loan_collateral(), game.release_bank_loan_collateral(),
  game.forbid_pledged_property() from public, anon, authenticated, oikos_service;
revoke all on function game.property_pledged(uuid, uuid) from public, anon, authenticated, oikos_service;

drop trigger if exists loans_pledge_collateral on game.loans;
create trigger loans_pledge_collateral after insert on game.loans
  for each row when (new.lender = 'bank') execute function game.pledge_bank_loan_collateral();
drop trigger if exists loans_release_collateral on game.loans;
create trigger loans_release_collateral after update on game.loans
  for each row when (new.lender = 'bank' and old.status <> 'repaid' and new.status = 'repaid')
  execute function game.release_bank_loan_collateral();
drop trigger if exists property_listings_not_pledged on game.property_listings;
create trigger property_listings_not_pledged before insert on game.property_listings
  for each row execute function game.forbid_pledged_property();
drop trigger if exists properties_not_pledged on game.properties;
create trigger properties_not_pledged before update of owner_house_id on game.properties
  for each row when (new.owner_house_id is distinct from old.owner_house_id)
  execute function game.forbid_pledged_property();
