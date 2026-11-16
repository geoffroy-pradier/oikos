-- Décrets de dépense réglés (docs/specs/05-economie.md, 5.5 et 5.6 ; 06-cites-politique-communaute.md, 6.3 ;
-- ticket 263) : appliqué, un décret de grands travaux ou de fête paie du trésor de sa cité à un puits
-- (`sink_public_works`, `sink_festivals`) ; non couvert, il devient caduc (`lapsed`). Le trésor ne paie rien
-- d'autre. Rejouable ; le code précédent ne règle aucune dépense, ne débite aucun trésor, ignore `settled_day`.

insert into game.system_account_kinds (key, allow_negative) values ('sink_festivals', false) on conflict do nothing;

-- Jour de jeu de la clôture qui a réglé un décret de dépense, vérifié à la validation, comme la fin d'un bail.
alter table game.decrees add column if not exists settled_day integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'game.decrees'::regclass and conname = 'decrees_status_known') then
    alter table game.decrees drop constraint if exists decrees_status_check;
    alter table game.decrees add constraint decrees_status_known
      check (status in ('proposed', 'adopted', 'rejected', 'applied', 'lapsed'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'game.decrees'::regclass and conname = 'decrees_settled') then
    alter table game.decrees add constraint decrees_settled check (
      (settled_day is not null) = (model in ('public_works', 'festival') and status in ('applied', 'lapsed'))
      and (status <> 'lapsed' or model in ('public_works', 'festival')));
  end if;
end $$;
-- La clôture du jour de règlement est écrite avant la validation : déclencheur différé, car une clé étrangère
-- différée mettrait en attente toute insertion de décret (et un jeu d'essai ne rétablirait plus la garde levée).
create or replace function game.check_decree_settled_on_close() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.decrees'::regclass then
    raise exception '% only runs on game.decrees', tg_name using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day = new.settled_day) then
    raise exception 'decree % is settled on day %, whose close is not recorded', new.id, new.settled_day
      using errcode = 'foreign_key_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_decree_settled_on_close() from public, anon, authenticated, oikos_service;
drop trigger if exists decrees_settled_on_close on game.decrees;
create constraint trigger decrees_settled_on_close after update on game.decrees
  deferrable initially deferred
  for each row when (new.settled_day is not null) execute function game.check_decree_settled_on_close();
-- Un décret n'est annoncé caduc qu'une fois ; une dépense n'est payée qu'une fois par décret.
create unique index if not exists domain_events_decree_lapsed_once on game.domain_events ((payload ->> 'decreeId'))
  where type = 'DecreeLapsed';
create unique index if not exists ledger_entries_decree_spending_once on game.ledger_entries ((meta ->> 'decreeId'))
  where kind in ('city.public_works', 'city.festival');

-- Garde des décrets (migration 150), plus le règlement d'une dépense. Un décret adopté de dépense passe une
-- fois à `applied` (daté maintenant), s'il a son écriture de paiement, ou à `lapsed` s'il n'en a pas, avec le
-- jour de jeu d'une clôture que la transaction enregistre (aucune clôture de ce jour ou d'après n'est déjà
-- écrite, et le déclencheur différé exige qu'elle le soit à la validation). `applied` et `lapsed` sont
-- finaux ; un décret de taux ne devient pas caduc et n'a pas de jour de règlement.
create or replace function game.guard_decree() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  votes_for integer;
  votes_against integer;
  electorate integer;
  adopted boolean;
begin
  if tg_op = 'INSERT' then
    if new.proposed_at is distinct from now() or new.status <> 'proposed' or new.tallied_at is not null then
      raise exception 'a decree is proposed now, untallied' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.offices o
                   where o.id = new.office_id and o.office = 'archon' and o.city_id = new.city_id
                     and o.house_id = new.proposed_by and o.starts_at <= now() and now() < o.ends_at) then
      raise exception 'only the archon in office proposes' using errcode = 'check_violation', constraint = 'decrees_archon_only';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.city_id, new.model, new.params, new.office_id, new.proposed_by, new.proposed_at,
      new.voting_closes_at, new.quorum_bps)
     is distinct from (old.id, old.world_id, old.city_id, old.model, old.params, old.office_id, old.proposed_by,
      old.proposed_at, old.voting_closes_at, old.quorum_bps) then
    raise exception 'a decree is immutable' using errcode = 'restrict_violation';
  end if;
  if old.status = 'adopted' and new.status in ('applied', 'lapsed') then
    if (new.tallied_at, new.electorate, new.votes_for, new.votes_against)
       is distinct from (old.tallied_at, old.electorate, old.votes_for, old.votes_against) then
      raise exception 'a decree is applied once, now' using errcode = 'restrict_violation';
    end if;
    if new.model in ('market_tax_rate', 'port_dues') then
      if new.status <> 'applied' or new.applied_at is distinct from now() or new.settled_day is not null then
        raise exception 'a decree is applied once, now' using errcode = 'restrict_violation';
      end if;
      return new;
    end if;
    if new.settled_day is null
       or new.applied_at is distinct from (case when new.status = 'applied' then now() end) then
      raise exception 'a spending decree is settled once, now, on its close' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.settled_day) then
      raise exception 'a spending decree is settled before its close is recorded' using errcode = 'restrict_violation';
    end if;
    -- Appliqué : une écriture de son modèle qui le désigne débite le trésor de sa cité. Caduc : aucune écriture.
    if (new.status = 'applied' and not exists (
          select 1 from game.ledger_entries e
          join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
          where e.kind = case new.model when 'public_works' then 'city.public_works' else 'city.festival' end
            and e.meta ->> 'decreeId' = new.id::text and l.amount < 0 and a.kind = 'treasury' and a.city_id = new.city_id))
       or (new.status = 'lapsed' and exists (select 1 from game.ledger_entries e
          where e.kind in ('city.public_works', 'city.festival') and e.meta ->> 'decreeId' = new.id::text)) then
      raise exception 'a spending decree is applied with its payment, and lapses without one'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.status <> 'proposed' or new.status not in ('adopted', 'rejected') or new.tallied_at is distinct from now() then
    raise exception 'a decree is tallied once, now' using errcode = 'restrict_violation';
  end if;
  if now() < old.voting_closes_at then
    raise exception 'a decree is tallied after its vote' using errcode = 'restrict_violation';
  end if;
  select count(*) filter (where v.approve), count(*) filter (where not v.approve) into votes_for, votes_against
  from game.decree_votes v where v.decree_id = new.id;
  select count(*) into electorate from game.citizenships c
  where c.city_id = new.city_id and c.status = 'citizen' and c.since < new.voting_closes_at;
  adopted := (votes_for + votes_against)::bigint * 10000 >= new.quorum_bps::bigint * electorate
             and votes_for > votes_against;
  if (new.votes_for, new.votes_against, new.electorate, new.status)
     is distinct from (votes_for, votes_against, electorate, case when adopted then 'adopted' else 'rejected' end) then
    raise exception 'a decree tally follows its votes' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_decree() from public, anon, authenticated, oikos_service;
grant update (settled_day) on game.decrees to oikos_service;

-- Le trésor d'une cité ne paie que la dépense d'un décret de sa cité appliqué dans la transaction : une
-- écriture `city.public_works` ou `city.festival` qui le désigne, du modèle de l'écriture, dont les autres
-- lignes créditent le puits de ce modèle, pour au plus le montant voté. Au nom du propriétaire, à la
-- validation (le décret passe à `applied` après son écriture). Jamais débiteur : contrainte du compte.
create or replace function game.check_treasury_debit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  treasury_city uuid;
  entry game.ledger_entries;
  decree game.decrees;
begin
  if tg_relid <> 'game.ledger_lines'::regclass then
    raise exception '% only runs on game.ledger_lines', tg_name using errcode = 'insufficient_privilege';
  end if;
  select a.city_id into treasury_city from game.accounts a where a.id = new.account_id and a.kind = 'treasury';
  if treasury_city is null then
    return null;
  end if;
  select * into entry from game.ledger_entries e where e.id = new.entry_id;
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
drop trigger if exists ledger_lines_treasury_debit on game.ledger_lines;
create constraint trigger ledger_lines_treasury_debit after insert on game.ledger_lines
  deferrable initially deferred
  for each row when (new.amount < 0) execute function game.check_treasury_debit();

-- Les joueurs lisent aussi le jour de jeu du règlement d'une dépense. La vue, créée sous condition par la
-- migration 131 et étendue par la 150, gagne la colonne en fin de liste, sous condition (ADR 0006).
grant select (settled_day) on game.decrees to authenticated;
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'decrees' and column_name = 'settled_day') then
    create or replace view public.decrees with (security_invoker = true) as
      select id, world_id, city_id, model, params, proposed_by, status, proposed_at, voting_closes_at, quorum_bps,
             tallied_at, electorate, votes_for, votes_against, applied_at, settled_day
      from game.decrees;
  end if;
end $$;
