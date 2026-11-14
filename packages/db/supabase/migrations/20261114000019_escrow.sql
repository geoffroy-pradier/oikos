-- Achats en attente et séquestre (docs/specs/05-economie.md, 5.3 ; ticket 69).
-- Un achat peut désormais attendre dans le carnet : la monnaie qu'il engage (prix × reste) quitte la
-- trésorerie de la maison pour son compte de séquestre, comme une vente réserve son stock. La base
-- garantit : séquestre d'une maison = somme des restes à payer de ses achats ouverts.

-- Compte de séquestre : un par maison, jamais débiteur, ouvert à la première mise en attente.
alter table game.accounts drop constraint if exists accounts_kind_check;
alter table game.accounts add constraint accounts_kind_check check (kind in ('house', 'system', 'escrow'));
alter table game.accounts drop constraint if exists accounts_owner;
alter table game.accounts add constraint accounts_owner check (
  (kind in ('house', 'escrow') and house_id is not null and system_key is null and not allow_negative)
  or (kind = 'system' and house_id is null and system_key is not null)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_one_per_house_kind') then
    alter table game.accounts add constraint accounts_one_per_house_kind unique (house_id, kind);
  end if;
end $$;
alter table game.accounts drop constraint if exists accounts_one_per_house;

-- Le service ouvre les comptes des maisons et leur séquestre, jamais un compte système (migration 13).
drop policy if exists service_all on game.accounts;
create policy service_all on game.accounts for all to oikos_service
  using (true) with check (kind in ('house', 'escrow'));

-- Échanges : entre un ordre de vente et, sauf pour les PNJ, un ordre d'achat ; au prix du plus ancien
-- des deux, celui qui attendait dans le carnet. Les PNJ paient le prix de la vente qu'ils servent.
create or replace function game.apply_trade() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sell game.orders;
  buy game.orders;
begin
  if tg_relid <> 'game.trades'::regclass then
    raise exception '% only runs on game.trades', tg_name using errcode = 'insufficient_privilege';
  end if;
  update game.orders set remaining = remaining - new.quantity,
                         status = case when remaining = new.quantity then 'filled' else 'open' end
    where id = new.sell_order_id and side = 'sell' and status = 'open' and price <= new.price
      and remaining >= new.quantity
    returning * into sell;
  if not found or (new.buy_order_id is null and sell.price <> new.price) then
    raise exception 'trade does not match an open sell order' using errcode = 'check_violation';
  end if;
  if new.buy_order_id is not null then
    update game.orders set remaining = remaining - new.quantity,
                           status = case when remaining = new.quantity then 'filled' else 'open' end
      where id = new.buy_order_id and side = 'buy' and status = 'open' and price >= new.price
        and remaining >= new.quantity
        and city_id = sell.city_id and good_id = sell.good_id and house_id <> sell.house_id
      returning * into buy;
    if not found then
      raise exception 'trade does not match its buy order' using errcode = 'check_violation';
    end if;
    if (buy.seq < sell.seq and new.price <> buy.price) or (buy.seq > sell.seq and new.price <> sell.price) then
      raise exception 'a trade executes at the price of the resting order' using errcode = 'check_violation';
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function game.apply_trade() from public, anon, authenticated, oikos_service;

-- Séquestre = somme des restes à payer. Contrôlé à la validation de la transaction, pour la maison de
-- tout ordre d'achat créé ou modifié et de tout compte de séquestre mouvementé : ni achat en attente
-- sans monnaie retenue, ni monnaie retenue sans achat en attente.
create or replace function game.check_escrow_matches_orders() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  checked_house uuid;
  held bigint;
  owed numeric;
begin
  if tg_table_name = 'orders' then
    checked_house := new.house_id;
  else
    select a.house_id into checked_house from game.accounts a where a.id = new.account_id and a.kind = 'escrow';
    if checked_house is null then
      return null;
    end if;
  end if;
  select coalesce(sum(a.balance), 0) into held
    from game.accounts a where a.house_id = checked_house and a.kind = 'escrow';
  select coalesce(sum(o.price * o.remaining), 0) into owed
    from game.orders o where o.house_id = checked_house and o.side = 'buy' and o.status = 'open';
  if held <> owed then
    raise exception 'escrow of house % holds % for % owed by its open buy orders', checked_house, held, owed
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_escrow_matches_orders() from public, anon, authenticated, oikos_service;

drop trigger if exists orders_escrow_matches on game.orders;
create constraint trigger orders_escrow_matches after insert or update on game.orders
  deferrable initially deferred
  for each row when (new.side = 'buy') execute function game.check_escrow_matches_orders();
drop trigger if exists ledger_lines_escrow_matches on game.ledger_lines;
create constraint trigger ledger_lines_escrow_matches after insert on game.ledger_lines
  deferrable initially deferred
  for each row execute function game.check_escrow_matches_orders();

-- L'ancienne garde (« un achat ne reste pas dans le carnet ») est remplacée par celle du séquestre. Le
-- code précédent, qui annule le reste d'un achat dans sa transaction, la respecte : rien n'attend, rien
-- n'est retenu.
drop trigger if exists orders_no_resting_buy on game.orders;
drop function if exists game.forbid_resting_buy_order();
