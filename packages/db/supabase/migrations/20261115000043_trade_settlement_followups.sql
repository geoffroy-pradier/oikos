-- Règlement des échanges : suivis de la relecture du ticket 100 (docs/specs/05-economie.md, 5.3 ;
-- docs/specs/12-modele-donnees.md ; ticket 205). Rejouable (`if not exists`, `create or replace`) ; le
-- code précédent règle déjà chaque échange par sa propre écriture, et les contrôles gardent leurs messages.

-- 1. Une écriture ne règle qu'un échange, tenu par un index unique : deux transactions concurrentes qui
-- rattacheraient chacune un échange à la même écriture ne passent plus toutes les deux, ce qu'un comptage
-- en READ COMMITTED ne garantissait pas. Le code du jeu a toujours écrit une écriture par échange ; si
-- l'historique d'une base en contenait pourtant deux pour une écriture, la migration s'arrête en le
-- disant, sans rien réécrire : c'est à un humain de décider (CLAUDE.md, données à supprimer).
-- `trades_ledger_entry_idx` (migration 32) reste : la migration 32, rejouée à chaque déploiement, le
-- reconstruirait sinon à chaque fois.
do $$
declare
  shared uuid;
begin
  if to_regclass('game.trades_ledger_entry_unique') is null then
    select t.ledger_entry_id into shared from game.trades t group by t.ledger_entry_id having count(*) > 1 limit 1;
    if shared is not null then
      raise exception 'ledger entry % settles more than one trade: review the history before migration 43', shared
        using errcode = 'unique_violation';
    end if;
  end if;
end $$;
create unique index if not exists trades_ledger_entry_unique on game.trades (ledger_entry_id);

-- 2. Le contrôle du règlement (migration 35) sans le comptage, que l'index rend inutile.
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

-- 3. Une ligne écrite avant son échange, dans la même transaction, n'est plus contrôlée pour lui : le
-- contrôle de l'échange (`trades_settled`) s'exécute après l'insertion de l'échange, donc après elle, et
-- lit toutes les lignes de l'écriture. Le règlement coûte ainsi un contrôle par échange, plus un par ligne
-- ajoutée après lui, même si l'appelant force ses contrôles différés entre-temps.
-- « Avant », c'est la même transaction (`xmin`, et la date de l'échange, posée par la base) et une commande
-- antérieure ou la même (`cmin`). `cmin` n'est le rang de la commande d'insertion que parce que lignes et
-- échanges ne sont ni modifiés ni supprimés (gardes `*_immutable`). Une ligne et un échange de
-- sous-transactions différentes ne se reconnaissent pas : le contrôle est alors refait, jamais omis.
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
    select t.id into settled from game.trades t
      where t.ledger_entry_id = new.entry_id
        and not exists (select 1 from game.ledger_lines l
                        where l.id = new.id and l.xmin = t.xmin and l.cmin::text::bigint <= t.cmin::text::bigint
                          and t.created_at = now());
    if settled is not null then
      perform game.check_trade_settlement(settled);
    end if;
  else
    raise exception '% only runs on game.trades and game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_trade_settled() from public, anon, authenticated, oikos_service;
