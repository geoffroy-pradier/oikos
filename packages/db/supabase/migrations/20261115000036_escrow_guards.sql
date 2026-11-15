-- Séquestre : contrôles tenus par la base, au nom du propriétaire (docs/specs/05-economie.md, 5.3 ;
-- docs/specs/12-modele-donnees.md ; ticket 100). Jusqu'ici, seul le montant retenu était contrôlé, et
-- avec les droits du rôle appelant. Rejouable ; le code en place respecte déjà ces règles.

-- Un séquestre ne paie que deux choses : un échange dont l'ordre d'achat est de sa maison (le contrôle
-- du règlement, migration 35, vérifie alors à qui va la monnaie), ou un retour à la trésorerie de sa
-- maison (écriture dont toutes les autres lignes créditent cette trésorerie).
create or replace function game.check_escrow_debit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  escrow_house uuid;
begin
  if tg_relid <> 'game.ledger_lines'::regclass then
    raise exception '% only runs on game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  select a.house_id into escrow_house from game.accounts a where a.id = new.account_id and a.kind = 'escrow';
  if escrow_house is null then
    return null;
  end if;
  if exists (select 1 from game.trades t join game.orders b on b.id = t.buy_order_id
             where t.ledger_entry_id = new.entry_id and b.house_id = escrow_house) then
    return null;
  end if;
  if exists (select 1 from game.ledger_lines l join game.accounts a on a.id = l.account_id
             where l.entry_id = new.entry_id
               and not (a.house_id = escrow_house
                        and ((a.kind = 'escrow' and l.amount < 0) or (a.kind = 'house' and l.amount > 0)))) then
    raise exception 'escrow of house % pays only for its own trades or back to its own treasury', escrow_house
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_escrow_debit() from public, anon, authenticated, oikos_service;

drop trigger if exists ledger_lines_escrow_debit on game.ledger_lines;
create constraint trigger ledger_lines_escrow_debit after insert on game.ledger_lines
  deferrable initially deferred
  for each row when (new.amount < 0) execute function game.check_escrow_debit();

-- Séquestre = somme des restes à payer (migration 19), désormais calculé au nom du propriétaire : un
-- rôle appelant qui verrait moins d'ordres ou de comptes ne passerait plus en silence. Le reste est repris
-- tel quel.
create or replace function game.check_escrow_matches_orders() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_house uuid;
  held bigint;
  owed numeric;
begin
  if tg_relid = 'game.orders'::regclass then
    checked_house := new.house_id;
  elsif tg_relid = 'game.ledger_lines'::regclass then
    select a.house_id into checked_house from game.accounts a where a.id = new.account_id and a.kind = 'escrow';
    if checked_house is null then
      return null;
    end if;
  else
    raise exception '% only runs on game.orders and game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
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
