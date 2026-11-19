-- Bourse des PNJ : qui paie chaque crédit (docs/specs/05-economie.md, 5.5 ; 12-modele-donnees.md ; ticket 655).
-- La garde de la migration 1200 regarde la nature de l'écriture qui crédite une bourse ; ce contrôle regarde qui la paie.
-- Rejouable (`create or replace`, déclencheur recréé) ; compatible avec le code précédent, dont la clôture, la relance
-- et le revenu public écrivent déjà ces formes. Un déclencheur ne relit pas le grand livre existant : rien à valider.

-- Au nom du propriétaire, qui voit les bourses et les sites ; à la validation, sur l'écriture entière, à chaque ligne
-- de crédit insérée. Une ligne n'est jamais nulle et l'écriture s'équilibre (migration 4) : un débit ajouté après une
-- première validation vient avec un crédit, qui fait recontrôler l'écriture.
-- 1. `npc.public_income` n'est débitée que du robinet `faucet_npc_public_income` de son monde.
-- 2. `upkeep.*` et `lodging.*` ne créditent une bourse que débitées d'un seul compte, la trésorerie d'une maison qui a
-- un site dans la cité de cette bourse. Un intendant est sur un site de sa maison (clé `stewards_site`), et
-- l'hébergement va à la bourse de la cité du site : le site suffit. Un site ne change ni de maison ni de cité.
create or replace function game.check_npc_purse_payer() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry game.ledger_entries;
  payer_house uuid;
  unpaid_city uuid;
begin
  if tg_relid <> 'game.ledger_lines'::regclass then
    raise exception '% only runs on game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  select * into entry from game.ledger_entries e where e.id = new.entry_id;
  if entry.kind = 'npc.public_income' then
    if exists (select 1 from game.ledger_lines l join game.accounts a on a.id = l.account_id
               where l.entry_id = entry.id and l.amount < 0
                 and not (a.kind = 'system' and a.world_id = entry.world_id
                          and a.system_key = 'faucet_npc_public_income')) then
      raise exception 'NPC public income entry % is paid only by the NPC public income faucet', entry.id
        using errcode = 'check_violation';
    end if;
    return null;
  end if;
  if entry.kind is null or not (entry.kind like 'upkeep.%' or entry.kind like 'lodging.%') then
    return null;
  end if;
  -- La maison payeuse : nulle si l'écriture est débitée de plusieurs comptes, ou d'un compte qui n'est pas une trésorerie.
  select case when count(distinct l.account_id) = 1 and bool_and(a.kind = 'house') then (array_agg(a.house_id))[1] end
    into payer_house
    from game.ledger_lines l join game.accounts a on a.id = l.account_id
    where l.entry_id = entry.id and l.amount < 0;
  select a.city_id into unpaid_city
    from game.ledger_lines l join game.accounts a on a.id = l.account_id
    where l.entry_id = entry.id and l.amount > 0 and a.npc_purse
      and not exists (select 1 from game.sites s where s.house_id = payer_house and s.city_id = a.city_id)
    order by a.city_id
    limit 1;
  if unpaid_city is not null then
    raise exception 'the NPC purse of city % is paid wages and lodging only by the treasury of a house with a site there',
      unpaid_city using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_npc_purse_payer() from public, anon, authenticated, oikos_service;
drop trigger if exists ledger_lines_npc_purse_payer on game.ledger_lines;
create constraint trigger ledger_lines_npc_purse_payer after insert on game.ledger_lines
  deferrable initially deferred for each row when (new.amount > 0) execute function game.check_npc_purse_payer();
