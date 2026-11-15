-- Règlement des échanges, tenu par la base (docs/specs/05-economie.md, 5.3 ; ticket 100). Jusqu'ici,
-- seul le code des commandes garantissait qu'un échange est payé de son montant. Le contrôle s'exécute
-- au nom du propriétaire (`security definer`) : ce que le rôle appelant peut lire n'y change rien. Le
-- séquestre a ses propres contrôles (migration 36).
-- Rejouable (`create or replace`, `drop ... if exists`) ; les contrôles portent sur les
-- lignes écrites après elle, et le code en place les respecte déjà.

-- L'échange d'une écriture se retrouve depuis ses lignes par l'index `trades_ledger_entry_idx` (migration 32).

-- Un échange est réglé par sa propre écriture : brut = prix × quantité, débité en une ligne du compte
-- de l'acheteur (robinet des achats des PNJ ; séquestre de l'acheteur si son ordre attendait, sa
-- trésorerie s'il arrive), et crédité en entier, réparti entre la trésorerie du vendeur (le net), le
-- puits de la taxe de marché du monde (la part détruite) et le trésor de la cité du marché. Le taux de
-- la taxe, lui, reste vérifié par la commande : la base ne lit pas la configuration.
create or replace function game.check_trade_settlement(checked_trade uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trade game.trades;
  sell game.orders;
  buy game.orders;
  gross numeric;
  expected_kind text;
  entry_kind text;
  payer uuid;
  payer_label text;
  debits integer;
  debited numeric;
  debited_account uuid;
  strays integer;
begin
  select * into trade from game.trades where id = checked_trade;
  select * into sell from game.orders where id = trade.sell_order_id;
  gross := trade.price::numeric * trade.quantity;
  if (select count(*) from game.trades t where t.ledger_entry_id = trade.ledger_entry_id) > 1 then
    raise exception 'ledger entry % settles more than one trade', trade.ledger_entry_id
      using errcode = 'check_violation';
  end if;

  expected_kind := case when trade.buy_order_id is null then 'npc.purchase' else 'market.trade' end;
  select e.kind into entry_kind from game.ledger_entries e where e.id = trade.ledger_entry_id;
  if entry_kind <> expected_kind then
    raise exception 'trade % is settled by a % entry, not %', trade.id, entry_kind, expected_kind
      using errcode = 'check_violation';
  end if;

  if trade.buy_order_id is null then
    payer_label := 'the NPC purchases faucet';
    select a.id into payer from game.accounts a
      where a.world_id = trade.world_id and a.system_key = 'faucet_npc_purchases';
  else
    select * into buy from game.orders where id = trade.buy_order_id;
    -- L'ordre le plus ancien des deux attendait dans le carnet : un achat qui attendait paie de son séquestre.
    payer_label := case when buy.seq < sell.seq then 'the buyer''s escrow' else 'the buyer''s treasury' end;
    select a.id into payer from game.accounts a
      where a.house_id = buy.house_id and a.kind = case when buy.seq < sell.seq then 'escrow' else 'house' end;
  end if;
  select count(*), coalesce(sum(l.amount), 0), (array_agg(l.account_id))[1]
    into debits, debited, debited_account
    from game.ledger_lines l where l.entry_id = trade.ledger_entry_id and l.amount < 0;
  if debits <> 1 or debited <> -gross or debited_account is distinct from payer then
    raise exception 'trade % must be paid % oboles in a single debit of %', trade.id, gross, payer_label
      using errcode = 'check_violation';
  end if;

  select count(*) filter (where not (
           (a.kind = 'house' and a.house_id = sell.house_id)
           or (a.kind = 'system' and a.world_id = trade.world_id and a.system_key = 'sink_market_tax')
           or (a.kind = 'treasury' and a.city_id = sell.city_id)))
    into strays
    from game.ledger_lines l join game.accounts a on a.id = l.account_id
    where l.entry_id = trade.ledger_entry_id and l.amount > 0;
  -- Le brut entier est crédité : l'écriture est équilibrée (migration 4) et son seul débit vaut le brut.
  if strays > 0 then
    raise exception 'trade % credits only the seller''s treasury, the market tax sink and the city treasury', trade.id
      using errcode = 'check_violation';
  end if;
end;
$$;
revoke execute on function game.check_trade_settlement(uuid) from public, anon, authenticated, oikos_service;

-- Contrôlé à la validation, à l'insertion de l'échange comme à celle de toute ligne de son écriture :
-- une ligne ajoutée après coup à l'écriture d'un échange est soumise au même contrôle.
create or replace function game.check_trade_settled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  settled uuid;
begin
  if tg_relid = 'game.trades'::regclass then
    perform game.check_trade_settlement(new.id);
  elsif tg_relid = 'game.ledger_lines'::regclass then
    for settled in select t.id from game.trades t where t.ledger_entry_id = new.entry_id loop
      perform game.check_trade_settlement(settled);
    end loop;
  else
    raise exception '% only runs on game.trades and game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_trade_settled() from public, anon, authenticated, oikos_service;

drop trigger if exists trades_settled on game.trades;
create constraint trigger trades_settled after insert on game.trades
  deferrable initially deferred
  for each row execute function game.check_trade_settled();
drop trigger if exists ledger_lines_trade_settled on game.ledger_lines;
create constraint trigger ledger_lines_trade_settled after insert on game.ledger_lines
  deferrable initially deferred
  for each row execute function game.check_trade_settled();
