-- Némésis : l'amende d'un procès (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; 05-economie.md, 5.5 ;
-- 12-modele-donnees.md ; ticket 735). Un procès qui frappe prend une amende, part bornée de la trésorerie de la maison,
-- détruite par le puits `sink_nemesis` : elle est payée par sa propre écriture `nemesis.fine`, qui nomme son présage
-- (migration 200), de la trésorerie au puits ; une amende nulle n'a pas d'écriture.
-- Rejouable (`on conflict do nothing`, `create or replace`, contrainte, index et déclencheurs recréés) ; compatible avec
-- le code précédent, qui n'écrit aucune écriture `nemesis.*` et ne mouvemente pas ce puits.

-- Le catalogue crée le compte du puits dans chaque monde existant, et dans chaque monde à venir.
insert into game.system_account_kinds (key, allow_negative) values ('sink_nemesis', false) on conflict do nothing;

-- Amende d'un procès : l'écriture `nemesis.fine` nomme son présage (`meta.nemesisId`), une fois. À la validation de
-- chaque transaction qui insère l'écriture ou lui ajoute une ligne, même plus tard, la base rejoue le contrôle de
-- l'écriture entière (comme les écritures des banques, migration 9941) : un procès frappé qui la nomme, deux lignes
-- exactement, de la trésorerie de sa maison au puits `sink_nemesis` de son monde, pour l'amende du présage.
alter table game.ledger_entries drop constraint if exists ledger_entries_nemesis_meta;
alter table game.ledger_entries add constraint ledger_entries_nemesis_meta check (
  kind not like 'nemesis.%'
  or (kind = 'nemesis.fine' and jsonb_typeof(meta -> 'nemesisId') = 'string'
      and meta ->> 'nemesisId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') is true
) not valid;
create unique index if not exists ledger_entries_nemesis_fine_once on game.ledger_entries ((meta ->> 'nemesisId'))
  where kind = 'nemesis.fine';
create or replace function game.check_nemesis_fine() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry game.ledger_entries;
  omen game.nemesis_omens;
  moved record;
begin
  if tg_relid = 'game.ledger_lines'::regclass then
    select * into entry from game.ledger_entries e where e.id = new.entry_id;
  elsif tg_relid = 'game.ledger_entries'::regclass then
    select * into entry from game.ledger_entries e where e.id = new.id;
  else
    raise exception '% only runs on the ledger', tg_name using errcode = 'insufficient_privilege';
  end if;
  if entry.kind is distinct from 'nemesis.fine' then
    return null;
  end if;
  select * into omen from game.nemesis_omens o
    where o.id = (entry.meta ->> 'nemesisId')::uuid and o.world_id = entry.world_id;
  select count(*) as lines,
         count(*) filter (where a.kind = 'house' and a.house_id = omen.house_id and l.amount = -omen.oboles) as treasury,
         count(*) filter (where a.world_id = omen.world_id and a.system_key = 'sink_nemesis' and l.amount = omen.oboles)
           as sink
    into moved
    from game.ledger_lines l join game.accounts a on a.id = l.account_id
    where l.entry_id = entry.id;
  if omen.id is null or omen.outcome is distinct from 'struck' or omen.model <> 'lawsuit'
     or omen.ledger_entry_id is distinct from entry.id
     or moved.lines <> 2 or moved.treasury <> 1 or moved.sink <> 1 then
    raise exception 'a fine moves its amount from the house treasury to sink_nemesis, by its own entry'
      using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_nemesis_fine() from public, anon, authenticated, oikos_service;
drop trigger if exists ledger_entries_nemesis_fine on game.ledger_entries;
create constraint trigger ledger_entries_nemesis_fine after insert on game.ledger_entries
  deferrable initially deferred for each row when (new.kind = 'nemesis.fine')
  execute function game.check_nemesis_fine();
-- Toute ligne d'une amende, insérée avec elle ou après : la fonction écarte les autres écritures.
drop trigger if exists ledger_lines_nemesis_fine on game.ledger_lines;
create constraint trigger ledger_lines_nemesis_fine after insert on game.ledger_lines
  deferrable initially deferred for each row execute function game.check_nemesis_fine();

-- À la validation, un procès frappé qui nomme une écriture est payé par elle : une écriture `nemesis.fine` qui le nomme
-- en retour (son contenu est contrôlé ci-dessus).
create or replace function game.check_nemesis_omen_fine() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from game.nemesis_omens o join game.ledger_entries e on e.id = o.ledger_entry_id
                 where o.id = new.id and e.kind = 'nemesis.fine' and e.meta ->> 'nemesisId' = o.id::text) then
    raise exception 'a fine is paid by its own entry' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_nemesis_omen_fine() from public, anon, authenticated, oikos_service;
drop trigger if exists nemesis_omens_fine on game.nemesis_omens;
create constraint trigger nemesis_omens_fine after update on game.nemesis_omens
  deferrable initially deferred for each row when (new.ledger_entry_id is not null)
  execute function game.check_nemesis_omen_fine();
