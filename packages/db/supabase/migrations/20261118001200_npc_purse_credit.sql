-- Bourse des PNJ : les seules écritures qui la créditent (docs/specs/05-economie.md, 5.5 ; 12-modele-donnees.md ;
-- ticket 651). La migration 1110 tient ses débits ; celle-ci tient ses crédits, que seul le code applicatif
-- (`npc_purse = false`) et la règle par ligne du service gardaient jusqu'ici.
-- Rejouable (`create or replace`, contrainte et déclencheur recréés) ; compatible avec le code précédent, qui ne
-- crédite une bourse que par ces écritures et écrit déjà le revenu public sous cette forme (migration 1120).

-- 1. Revenu public : la cité et le jour de jeu sous une seule forme, comme `upkeep.daily` (migration 27) et
-- `lodging.daily` (migration 160). L'index `ledger_entries_npc_public_income_once` (migration 1120) compare le texte
-- de ces clés : une cité en majuscules, un jour `20771.0` ou une clé absente (nulle, donc jamais en conflit) y
-- seraient sinon un second versement du même jour. `is true` : une clé absente rend nul, qui passerait.
alter table game.ledger_entries drop constraint if exists ledger_entries_npc_public_income_meta;
alter table game.ledger_entries add constraint ledger_entries_npc_public_income_meta check (
  kind <> 'npc.public_income'
  or (jsonb_typeof(meta -> 'cityId') = 'string' and jsonb_typeof(meta -> 'gameDay') = 'number'
      and meta ->> 'cityId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      and meta ->> 'gameDay' ~ '^(0|[1-9][0-9]{0,8})$') is true
);

-- 2. Crédit d'une bourse (5.5) : les salaires des sites et des intendants (`upkeep.daily`, `upkeep.restart`),
-- l'hébergement (`lodging.daily`, `lodging.restart`) et son propre revenu public (`npc.public_income` de sa cité).
-- Rien d'autre : ni droit de port, ni revente, ni taxe d'un échange. Au nom du propriétaire, qui voit les bourses
-- que la règle par ligne cache au service ; à l'insertion, sans report possible, quel que soit le rôle.
create or replace function game.check_npc_purse_credit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  purse_city uuid;
  entry game.ledger_entries;
begin
  if tg_relid <> 'game.ledger_lines'::regclass then
    raise exception '% only runs on game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  select a.city_id into purse_city from game.accounts a where a.id = new.account_id and a.npc_purse;
  if purse_city is null then
    return null;
  end if;
  select * into entry from game.ledger_entries e where e.id = new.entry_id;
  if entry.kind is null
     or entry.kind not in ('upkeep.daily', 'upkeep.restart', 'lodging.daily', 'lodging.restart', 'npc.public_income')
     or (entry.kind = 'npc.public_income' and entry.meta ->> 'cityId' is distinct from purse_city::text) then
    raise exception 'the NPC purse of city % is credited only by wages, lodging and its own public income', purse_city
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_npc_purse_credit() from public, anon, authenticated, oikos_service;
drop trigger if exists ledger_lines_npc_purse_credit on game.ledger_lines;
create trigger ledger_lines_npc_purse_credit after insert on game.ledger_lines
  for each row when (new.amount > 0) execute function game.check_npc_purse_credit();
