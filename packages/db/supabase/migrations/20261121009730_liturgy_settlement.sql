-- Liturgies : accomplissement et prélèvement d'office (docs/specs/06-cites-politique-communaute.md, 6.4 ;
-- 05-economie.md, 5.5 ; 04-systemes-gestion.md, 4.1 ; 07-dieux-faveur-evenements.md, 7.1 ; ticket 720).
-- Une liturgie désignée (#719) se règle une fois : accomplie par sa maison avant l'échéance (`liturgy.perform`, dû et
-- faste), ou prélevée d'office par la clôture de l'échéance, en entier ou pour ce que couvre la trésorerie. Ce qui est
-- payé va au puits `sink_liturgies` ; la Timè et la Charis de l'accomplissement et la Timè perdue d'une dérobade
-- viennent avec la migration suivante (9731).
-- Rejouable (`if not exists`, `create or replace`, déclencheurs, contraintes et droits recréés ou conditionnels) ;
-- compatible avec le code précédent, qui ne fait que désigner : les colonnes nouvelles sont nulles à la désignation.

-- Le catalogue crée le compte du puits dans chaque monde existant, et dans chaque monde à venir.
insert into game.system_account_kinds (key, allow_negative) values ('sink_liturgies', false) on conflict do nothing;

-- Règlement d'une liturgie : faste (oboles au-delà du dû), oboles payées, dieu et Charis gagnée d'un accomplissement,
-- jour de jeu et instant du règlement, écriture du grand livre (aucune pour un prélèvement qui ne trouve rien).
alter table game.liturgies
  add column if not exists splendor bigint check (splendor between 0 and 9007199254740991),
  add column if not exists paid bigint check (paid between 0 and 9007199254740991),
  add column if not exists god_id text check (god_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  add column if not exists charis_gained bigint check (charis_gained between 1 and 9007199254740991),
  add column if not exists settled_day integer check (settled_day >= 0),
  add column if not exists settled_at timestamptz,
  add column if not exists ledger_entry_id uuid references game.ledger_entries (id);
create unique index if not exists liturgies_ledger_entry_once on game.liturgies (ledger_entry_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'liturgies_settlement') then
    alter table game.liturgies add constraint liturgies_settlement check (
      (status = 'assigned' and splendor is null and paid is null and god_id is null and charis_gained is null
        and settled_day is null and settled_at is null and ledger_entry_id is null)
      or (status = 'performed' and splendor is not null and paid = due + splendor and settled_day is not null
        and settled_at is not null and ledger_entry_id is not null and (god_id is null) = (charis_gained is null))
      or (status = 'levied' and splendor = 0 and paid <= due and god_id is null and charis_gained is null
        and settled_day is not null and settled_at is not null and (ledger_entry_id is null) = (paid = 0)));
  end if;
end $$;

-- Une liturgie désignée se règle une fois, maintenant, sans rien changer à sa désignation :
-- - accomplie, avant son échéance (à l'instant de la transaction), en payant son dû et son faste ;
-- - prélevée d'office, une fois échue, par la clôture d'un jour dont l'enregistrement n'est pas encore fait (même
--   verrou que la clôture), pour son dû entier ou pour toute la trésorerie de sa maison, qui reste alors vide.
-- Ce qui est payé l'est par sa propre écriture (`liturgy.perform` ou `liturgy.levy`, datée de maintenant, qui la
-- nomme), de deux lignes : de la trésorerie de sa maison, hors séquestre, au puits `sink_liturgies`.
create or replace function game.guard_liturgy_settlement() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  moved boolean;
begin
  if old.status <> 'assigned' or new.status not in ('performed', 'levied') then
    raise exception 'a liturgy is settled once' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.world_id, new.city_id, new.house_id, new.season, new.genre, new.due, new.designated_day,
      new.due_day, new.due_at, new.created_at) is distinct from (old.id, old.world_id, old.city_id, old.house_id,
      old.season, old.genre, old.due, old.designated_day, old.due_day, old.due_at, old.created_at) then
    raise exception 'a liturgy keeps its designation' using errcode = 'restrict_violation';
  end if;
  new.settled_at := now();
  if new.status = 'performed' then
    if now() >= old.due_at then
      raise exception 'a liturgy is performed before it falls due' using errcode = 'restrict_violation';
    end if;
  else
    if now() < old.due_at then
      raise exception 'a liturgy is levied once due' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.settled_day) then
      raise exception 'a liturgy is levied before its close is recorded' using errcode = 'restrict_violation';
    end if;
  end if;
  if new.ledger_entry_id is not null then
    select count(*) = 2
       and count(*) filter (where a.kind = 'house' and a.house_id = new.house_id and l.amount = -new.paid) = 1
       and count(*) filter (where a.world_id = new.world_id and a.system_key = 'sink_liturgies' and l.amount = new.paid) = 1
      into moved
    from game.ledger_entries e
    join game.ledger_lines l on l.entry_id = e.id
    join game.accounts a on a.id = l.account_id
    where e.id = new.ledger_entry_id and e.world_id = new.world_id and e.created_at = now()
      and e.kind = case new.status when 'performed' then 'liturgy.perform' else 'liturgy.levy' end
      and e.meta ->> 'liturgyId' = new.id::text;
    if moved is not true then
      raise exception 'a liturgy is paid by its own entry, from its house treasury to sink_liturgies'
        using errcode = 'restrict_violation';
    end if;
  end if;
  if new.status = 'levied' and new.paid < old.due and exists (
       select 1 from game.accounts a where a.kind = 'house' and a.house_id = new.house_id and a.balance <> 0) then
    raise exception 'a levy takes the whole due, or all the treasury holds' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
-- À la validation, un prélèvement a la clôture de son jour, enregistrée dans la même transaction.
create or replace function game.check_liturgy_levy_on_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.settled_day) then
    raise exception 'a liturgy is levied by the close of its day' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_liturgy_settlement(), game.check_liturgy_levy_on_close()
  from public, anon, authenticated, oikos_service;
drop trigger if exists liturgies_immutable on game.liturgies;
drop trigger if exists liturgies_settle on game.liturgies;
create trigger liturgies_settle before update on game.liturgies
  for each row execute function game.guard_liturgy_settlement();
drop trigger if exists liturgies_no_delete on game.liturgies;
create trigger liturgies_no_delete before delete on game.liturgies
  for each row execute function game.forbid_change();
drop trigger if exists liturgies_levy_on_close on game.liturgies;
create constraint trigger liturgies_levy_on_close after update on game.liturgies
  deferrable initially deferred for each row when (new.status = 'levied')
  execute function game.check_liturgy_levy_on_close();
-- Le service règle une liturgie sans en choisir l'instant ; il ne supprime rien. Aucun droit nouveau pour un joueur :
-- ni le faste, ni ce qui est payé, ni la Charis ne lui sont accordés, ce qui dirait une part de la fortune (4.1).
grant update (status, splendor, paid, god_id, charis_gained, settled_day, ledger_entry_id) on game.liturgies to oikos_service;

-- Flux de trésorerie : la migration 241, plus la nature `liturgies` des écritures `liturgy.perform` et `liturgy.levy`.
-- Le compte de résultat (migration 160) ne change pas : une liturgie, hors exploitation, y entre dans `other`.
create or replace view public.my_cash_flows with (security_invoker = true) as
  select house_id, account, game_day, nature, sum(amount)::bigint as amount
  from (
    select a.house_id,
           case a.kind when 'house' then 'treasury' else a.kind end as account,
           ((e.created_at at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
             - date '1970-01-01' as game_day,
           f.nature, f.amount
    from game.accounts a
    join game.ledger_lines l on l.account_id = a.id
    join game.ledger_entries e on e.id = l.entry_id
    left join game.clock_rules() c on true
    left join lateral (
      select case when e.kind = 'property.sale'
        then (select o.price_oboles from game.property_listings o where o.ledger_entry_id = e.id)
        else (select sum(t.price * t.quantity) from game.trades t where t.ledger_entry_id = e.id)
      end as gross
    ) sale on l.nature is null and l.amount > 0 and e.kind in ('market.trade', 'npc.purchase', 'property.sale')
    cross join lateral (values
      (case
         when l.nature is not null then l.nature
         when e.kind in ('market.trade', 'npc.purchase') then case when l.amount > 0 then 'sales' else 'purchases' end
         when e.kind in ('market.escrow_hold', 'market.escrow_release') then 'escrow'
         when e.kind in ('upkeep.daily', 'upkeep.restart', 'property.renovate') then 'upkeep'
         when e.kind in ('lodging.daily', 'lodging.restart') then 'lodging'
         when e.kind in ('site.acquire', 'ship.acquire', 'property.buy', 'property.sale') then 'acquisitions'
         when e.kind = 'lease.rent' then 'rents'
         when e.kind in ('temple.offering', 'temple.oracle') then 'offerings'
         when e.kind in ('liturgy.perform', 'liturgy.levy') then 'liturgies'
         when e.kind = 'voyage.departure' then 'transport'
         when e.kind = 'house.starting_grant' then 'grant'
         else 'other'
       end, coalesce(sale.gross, l.amount)),
      ('taxes', l.amount - sale.gross)
    ) f (nature, amount)
    where a.kind in ('house', 'escrow') and f.amount <> 0
  ) flows
  group by house_id, account, game_day, nature
  having sum(amount) <> 0;
