-- Bourse des PNJ : elle paie les achats des PNJ de sa cité (docs/specs/05-economie.md, 5.2 ; 12-modele-donnees.md ;
-- ticket 632). Rejouable (`create or replace`) ; compatible avec le code précédent, qui paie encore ces achats par le
-- robinet `faucet_npc_purchases` : la base admet l'un ou l'autre payeur. Une migration ultérieure pourra retirer le
-- robinet de ce contrôle quand plus aucun moteur déployé ne l'écrira.

-- 1. Règlement d'un échange (migration 42) : un achat des PNJ est payé, en un seul débit, par la bourse des PNJ de la
-- cité du marché, ou par le robinet des achats des PNJ ; seul le trésor de la cité, pas sa bourse, reçoit la taxe.
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
  payers uuid[];
  payer_label text;
  debits integer;
  debited numeric;
  debited_account uuid;
  strays integer;
begin
  select * into trade from game.trades where id = checked_trade;
  select * into sell from game.orders where id = trade.sell_order_id;
  gross := trade.price::numeric * trade.quantity;

  expected_kind := case when trade.buy_order_id is null then 'npc.purchase' else 'market.trade' end;
  select e.kind into entry_kind from game.ledger_entries e where e.id = trade.ledger_entry_id;
  if entry_kind <> expected_kind then
    raise exception 'trade % is settled by a % entry, not %', trade.id, entry_kind, expected_kind
      using errcode = 'check_violation';
  end if;

  if trade.buy_order_id is null then
    payer_label := 'the NPC purse of its city or the NPC purchases faucet';
    select array_agg(a.id) into payers from game.accounts a
      where a.world_id = trade.world_id
        and ((a.npc_purse and a.city_id = sell.city_id) or a.system_key = 'faucet_npc_purchases');
  else
    select * into buy from game.orders where id = trade.buy_order_id;
    -- L'ordre le plus ancien des deux attendait dans le carnet : un achat qui attendait paie de son séquestre.
    payer_label := case when buy.seq < sell.seq then 'the buyer''s escrow' else 'the buyer''s treasury' end;
    select array_agg(a.id) into payers from game.accounts a
      where a.house_id = buy.house_id and a.kind = case when buy.seq < sell.seq then 'escrow' else 'house' end;
  end if;
  select count(*), coalesce(sum(l.amount), 0), (array_agg(l.account_id))[1]
    into debits, debited, debited_account
    from game.ledger_lines l where l.entry_id = trade.ledger_entry_id and l.amount < 0;
  if debits <> 1 or debited <> -gross or not coalesce(debited_account = any (payers), false) then
    raise exception 'trade % must be paid % oboles in a single debit of %', trade.id, gross, payer_label
      using errcode = 'check_violation';
  end if;

  select count(*) filter (where not (
           (a.kind = 'house' and a.house_id = sell.house_id)
           or (a.kind = 'system' and a.world_id = trade.world_id and a.system_key = 'sink_market_tax')
           or (a.kind = 'treasury' and not a.npc_purse and a.city_id = sell.city_id)))
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

-- 2. Débit d'un compte de cité (migration 170) : le trésor ne paie que les dépenses de ses décrets ; la bourse ne paie
-- que des achats des PNJ, dans une écriture `npc.purchase` qui règle un échange, dont le contrôle ci-dessus vérifie
-- le marché, le montant et le vendeur. Au nom du propriétaire, à la validation. Jamais débiteurs : contrainte du compte.
create or replace function game.check_treasury_debit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  treasury_city uuid;
  purse boolean;
  entry game.ledger_entries;
  decree game.decrees;
begin
  if tg_relid <> 'game.ledger_lines'::regclass then
    raise exception '% only runs on game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  select a.city_id, a.npc_purse into treasury_city, purse from game.accounts a
    where a.id = new.account_id and a.kind = 'treasury';
  if treasury_city is null then
    return null;
  end if;
  select * into entry from game.ledger_entries e where e.id = new.entry_id;
  if purse then
    if entry.kind <> 'npc.purchase' or not exists (select 1 from game.trades t where t.ledger_entry_id = entry.id) then
      raise exception 'the NPC purse of city % pays only NPC purchases', treasury_city using errcode = 'check_violation';
    end if;
    return null;
  end if;
  if entry.kind in ('city.public_works', 'city.festival')
     and entry.meta ->> 'decreeId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into decree from game.decrees d where d.id = (entry.meta ->> 'decreeId')::uuid;
  end if;
  if decree.id is null or decree.city_id <> treasury_city or decree.status <> 'applied'
     or entry.kind <> 'city.' || decree.model
     or (select -sum(l.amount) from game.ledger_lines l where l.entry_id = entry.id and l.account_id = new.account_id)
        > (decree.params ->> 'amountOboles')::bigint
     or exists (select 1 from game.ledger_lines l join game.accounts a on a.id = l.account_id
                where l.entry_id = entry.id and l.account_id <> new.account_id
                  and not (l.amount > 0 and a.kind = 'system' and a.world_id = decree.world_id
                           and a.system_key = case decree.model when 'public_works' then 'sink_public_works'
                                                                 else 'sink_festivals' end)) then
    raise exception 'the treasury of city % pays only the spending of its applied decrees', treasury_city
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_treasury_debit() from public, anon, authenticated, oikos_service;
