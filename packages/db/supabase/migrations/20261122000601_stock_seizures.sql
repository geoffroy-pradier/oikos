-- Banques de joueurs : saisie d'un stock gagé ; un stock ne change de maison que par un échange ou une saisie
-- (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ; #729).
-- La saisie (migration 0600) remet le stock gagé au stock de la maison de la banque dans la même cité, par un mouvement
-- `bank.loan_seize` du journal des stocks rattaché à elle. D'un stock à un autre de deux maisons, un mouvement n'est plus
-- que la livraison d'un échange de l'agora, une fois par échange, ou cette remise ; tout autre chemin passe par une
-- extrémité système (production, consommation, transit), que ses propres gardes tiennent.
-- Rejouable (`if not exists`, contraintes conditionnelles, `create or replace`, déclencheur recréé) ; compatible avec le
-- code précédent, qui ne saisit rien et ne déplace un stock d'une maison à une autre que par un échange, livré une fois.

-- Journal des stocks : un mouvement `bank.loan_seize` est rattaché à sa saisie, d'un stock à un autre, un par saisie.
-- `not valid` : aucune ligne antérieure n'a de saisie.
alter table game.stock_ledger add column if not exists loan_seizure_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_seizure_same_world') then
    alter table game.stock_ledger add constraint stock_ledger_seizure_same_world
      foreign key (loan_seizure_id, world_id) references game.loan_seizures (id, world_id);
    alter table game.stock_ledger add constraint stock_ledger_seizure_link check (
      (kind = 'bank.loan_seize') = (loan_seizure_id is not null)
      and (loan_seizure_id is null or (from_inventory_id is not null and to_inventory_id is not null))) not valid;
  end if;
end $$;
create unique index if not exists stock_ledger_seizure_once on game.stock_ledger (loan_seizure_id)
  where loan_seizure_id is not null;


-- La saisie : la migration 0600, plus le stock gagé, que le déclencheur du solde libère et qui passe ici, par le journal
-- des stocks, au stock de la maison de la banque dans la même cité. Les réservations des ventes en attente et des autres
-- gages restent sur le stock de l'emprunteur (`inventories_reserved_within_quantity`).
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
  end if;
  return null;
end;
$$;

-- Un échange de l'agora ne livre qu'une fois : une écriture d'échange règle un seul échange (index de `trades`).
create unique index if not exists stock_ledger_trade_once on game.stock_ledger (ledger_entry_id) where kind = 'market.trade';

-- Un stock ne change de maison que par un échange de l'agora (mouvement `market.trade` de l'écriture d'un échange, du
-- stock du vendeur dans la cité de son ordre à celui de l'acheteur, de la quantité de l'échange) ou par une saisie (son
-- stock gagé, de l'emprunteur à la maison de la banque, dans la transaction de la saisie). D'un stock à un autre de la
-- même maison, rien ne change de main. Au nom du propriétaire, quel que soit le rôle.
create or replace function game.guard_stock_change_of_hands() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origin game.inventories;
  destination game.inventories;
begin
  if tg_relid <> 'game.stock_ledger'::regclass then
    raise exception '% only runs on game.stock_ledger', tg_name using errcode = 'insufficient_privilege';
  end if;
  select * into origin from game.inventories i where i.id = new.from_inventory_id;
  select * into destination from game.inventories i where i.id = new.to_inventory_id;
  if new.loan_seizure_id is not null then
    if exists (select 1 from game.loan_seizures z
               join game.loans o on o.id = z.loan_id
               join game.bank_loan_offers f on f.id = o.offer_id
               where z.id = new.loan_seizure_id and z.created_at = now() and f.collateral_kind = 'stock'
                 and z.borrower_house_id = origin.house_id and z.bank_house_id = destination.house_id
                 and f.collateral_city_id = origin.city_id and f.collateral_city_id = destination.city_id
                 and f.collateral_good_id = new.good_id and f.collateral_quantity = new.quantity) then
      return new;
    end if;
  elsif origin.house_id = destination.house_id then
    return new;
  elsif new.kind = 'market.trade' and exists (
      select 1 from game.trades t
      join game.orders s on s.id = t.sell_order_id
      join game.orders b on b.id = t.buy_order_id
      where t.ledger_entry_id = new.ledger_entry_id and t.world_id = new.world_id and t.quantity = new.quantity
        and s.house_id = origin.house_id and s.city_id = origin.city_id and s.good_id = new.good_id
        and b.house_id = destination.house_id and b.city_id = destination.city_id) then
    return new;
  end if;
  raise exception 'a stock changes hands only by a trade or a loan seizure' using errcode = 'check_violation',
    constraint = 'stock_ledger_change_of_hands';
end;
$$;

revoke execute on function game.apply_loan_seizure(), game.guard_stock_change_of_hands()
  from public, anon, authenticated, oikos_service;
drop trigger if exists stock_ledger_change_of_hands on game.stock_ledger;
create trigger stock_ledger_change_of_hands before insert on game.stock_ledger
  for each row when (new.loan_seizure_id is not null or (new.from_inventory_id is not null and new.to_inventory_id is not null))
  execute function game.guard_stock_change_of_hands();
