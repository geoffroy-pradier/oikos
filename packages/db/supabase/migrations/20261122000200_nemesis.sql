-- Présages et Némésis (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; 12-modele-donnees.md ; ticket 735).
-- Quand la jauge d'Hybris d'une maison de joueur dépasse le seuil, la clôture lui adresse un présage (`nemesis_omens`) et
-- fixe une sanction quelques jours plus tard ; la clôture de l'échéance la fait frapper ou l'évite, une fois. Une
-- sanction qui frappe fait redescendre la jauge par une ligne `nemesis` du journal de l'Hybris. Ce qu'elle prend passe
-- par les journaux : l'amende d'un procès vient avec la migration 201, un stock détruit, un atelier arrêté et une
-- cargaison perdue avec la migration 202.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés) ; compatible avec le code précédent,
-- qui n'écrit ni ne lit cette table, et dont les causes d'Hybris restent admises.

-- Un présage : sa maison, le modèle de sa sanction, ses textes de repli, le jour de la clôture qui l'adresse et celui de
-- l'échéance ; puis son issue, écrite une fois par la clôture d'un jour d'échéance ou d'après (clôture manquée) : évitée,
-- ou frappée, avec ce qu'elle a pris (ampleur, baisse de la jauge, oboles ou biens, atelier, voyage) et rien d'autre.
create table if not exists game.nemesis_omens (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  model text not null check (model in ('warehouse_fire', 'lawsuit', 'artisan_desertion', 'ship_lost')),
  text_fr text not null check (length(text_fr) between 1 and 1000),
  text_en text not null check (length(text_en) between 1 and 1000),
  omen_day integer not null check (omen_day >= 0),
  due_day integer not null,
  created_at timestamptz not null default now(),
  outcome text check (outcome in ('struck', 'averted')),
  settled_day integer,
  settled_at timestamptz,
  magnitude_bps integer check (magnitude_bps between 0 and 10000),
  relief bigint check (relief between 1 and 9007199254740991),
  oboles bigint check (oboles between 0 and 9007199254740991),
  ledger_entry_id uuid,
  inventory_id uuid,
  quantity bigint check (quantity between 0 and 9007199254740991),
  site_id uuid,
  resumes_at timestamptz,
  voyage_id uuid,
  constraint nemesis_omens_id_world_unique unique (id, world_id),
  constraint nemesis_omens_house_same_world foreign key (house_id, world_id) references game.houses (id, world_id),
  constraint nemesis_omens_entry_same_world foreign key (ledger_entry_id, world_id)
    references game.ledger_entries (id, world_id),
  constraint nemesis_omens_inventory_same_world foreign key (inventory_id, world_id)
    references game.inventories (id, world_id),
  constraint nemesis_omens_site_of_house foreign key (site_id, house_id, world_id)
    references game.sites (id, house_id, world_id),
  constraint nemesis_omens_voyage_same_world foreign key (voyage_id, world_id) references game.voyages (id, world_id),
  constraint nemesis_omens_due check (due_day > omen_day),
  -- Une issue par modèle : l'incendie a son ampleur et sa quantité (un stock seulement s'il en prend), le procès son
  -- ampleur et son amende (une écriture seulement si elle n'est pas nulle), la désertion son atelier et l'instant de sa
  -- reprise, ou aucun, le navire son voyage, ou aucun.
  constraint nemesis_omens_settlement check (
    (outcome is null and num_nonnulls(settled_day, settled_at, magnitude_bps, relief, oboles, ledger_entry_id,
                                      inventory_id, quantity, site_id, resumes_at, voyage_id) = 0)
    or (outcome = 'averted' and settled_day >= due_day and settled_at is not null
        and num_nonnulls(magnitude_bps, relief, oboles, ledger_entry_id, inventory_id, quantity, site_id, resumes_at,
                         voyage_id) = 0)
    or (outcome = 'struck' and settled_day >= due_day and settled_at is not null and relief is not null
        and case model
          when 'warehouse_fire' then magnitude_bps is not null and quantity is not null
            and (inventory_id is null) = (quantity = 0)
            and num_nonnulls(oboles, ledger_entry_id, site_id, resumes_at, voyage_id) = 0
          when 'lawsuit' then magnitude_bps is not null and oboles is not null
            and (ledger_entry_id is null) = (oboles = 0)
            and num_nonnulls(inventory_id, quantity, site_id, resumes_at, voyage_id) = 0
          when 'artisan_desertion' then (site_id is null) = (resumes_at is null)
            and num_nonnulls(magnitude_bps, oboles, ledger_entry_id, inventory_id, quantity, voyage_id) = 0
          else num_nonnulls(magnitude_bps, oboles, ledger_entry_id, inventory_id, quantity, site_id, resumes_at) = 0
        end))
);
-- Un présage en attente au plus par maison, un par jour, une écriture d'amende par présage, un voyage condamné une fois.
create unique index if not exists nemesis_omens_pending on game.nemesis_omens (house_id) where outcome is null;
create unique index if not exists nemesis_omens_voyage_once on game.nemesis_omens (voyage_id) where outcome = 'struck';
create unique index if not exists nemesis_omens_once_a_day on game.nemesis_omens (house_id, omen_day);
create unique index if not exists nemesis_omens_entry_once on game.nemesis_omens (ledger_entry_id);
create index if not exists nemesis_omens_due_idx on game.nemesis_omens (world_id, due_day) where outcome is null;

-- Un présage naît maintenant, sans issue, pour une maison de joueur, avant que la clôture de son jour, ou d'un jour
-- postérieur, soit enregistrée (même verrou que la clôture) ; il ne change qu'une fois, sans rien changer de ce qu'il
-- annonce : son issue, maintenant, avant que la clôture du jour de l'issue soit enregistrée. Un atelier déserté est de la
-- maison et ouvert, un voyage perdu est de la maison et encore en mer, un stock incendié est de la maison. Le contrôle
-- différé `nemesis_omens_on_close` vérifie à la validation la clôture du jour et ce que la sanction a pris.
create or replace function game.guard_nemesis_omen() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  day integer;
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.outcome is not null then
      raise exception 'an omen is sent now, pending' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.houses h
                   where h.id = new.house_id and h.world_id = new.world_id and h.kind = 'player') then
      raise exception 'only a player house receives omens'
        using errcode = 'check_violation', constraint = 'nemesis_omens_player_house';
    end if;
    day := new.omen_day;
  else
    if old.outcome is not null or new.outcome is null then
      raise exception 'an omen is settled once' using errcode = 'restrict_violation';
    end if;
    if (new.id, new.world_id, new.house_id, new.model, new.text_fr, new.text_en, new.omen_day, new.due_day,
        new.created_at) is distinct from (old.id, old.world_id, old.house_id, old.model, old.text_fr, old.text_en,
        old.omen_day, old.due_day, old.created_at) then
      raise exception 'an omen keeps what it announces' using errcode = 'restrict_violation';
    end if;
    new.settled_at := now();
    if new.inventory_id is not null and not exists (
         select 1 from game.inventories i where i.id = new.inventory_id and i.house_id = new.house_id) then
      raise exception 'a fire burns a stock of its house' using errcode = 'restrict_violation';
    end if;
    if new.site_id is not null and not exists (
         select 1 from game.sites s where s.id = new.site_id and s.closed_at is null) then
      raise exception 'an artisan deserts an open workshop' using errcode = 'restrict_violation';
    end if;
    if new.voyage_id is not null and not exists (
         select 1 from game.voyages v where v.id = new.voyage_id and v.house_id = new.house_id and v.arrived_at is null) then
      raise exception 'a ship is lost at sea, on a voyage of its house' using errcode = 'restrict_violation';
    end if;
    day := new.settled_day;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= day) then
    raise exception 'an omen is written before its close is recorded' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- À la validation : la clôture du jour du présage, ou de son issue, est enregistrée, donc dans la même transaction. Une
-- sanction qui frappe a fait redescendre la jauge de sa baisse, ce jour-là. Les migrations 201 et 202 y ajoutent ce
-- que prend la sanction.
create or replace function game.check_nemesis_omen_on_close() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  omen game.nemesis_omens;
begin
  select * into omen from game.nemesis_omens o where o.id = new.id;
  if not exists (select 1 from game.daily_closes c where c.world_id = omen.world_id
                   and c.game_day = coalesce(omen.settled_day, omen.omen_day)) then
    raise exception 'an omen is written by the close of its day' using errcode = 'restrict_violation';
  end if;
  if omen.outcome = 'struck' and not exists (
       select 1 from game.hubris_ledger h where h.house_id = omen.house_id and h.cause = 'nemesis'
         and h.game_day = omen.settled_day and h.amount = -omen.relief) then
    raise exception 'a sanction lowers the Hybris gauge by its relief' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.guard_nemesis_omen(), game.check_nemesis_omen_on_close()
  from public, anon, authenticated, oikos_service;
drop trigger if exists nemesis_omens_guard on game.nemesis_omens;
create trigger nemesis_omens_guard before insert or update on game.nemesis_omens
  for each row execute function game.guard_nemesis_omen();
drop trigger if exists nemesis_omens_on_close on game.nemesis_omens;
create constraint trigger nemesis_omens_on_close after insert or update on game.nemesis_omens
  deferrable initially deferred for each row execute function game.check_nemesis_omen_on_close();
drop trigger if exists nemesis_omens_no_delete on game.nemesis_omens;
create trigger nemesis_omens_no_delete before delete on game.nemesis_omens
  for each row execute function game.forbid_change();
drop trigger if exists nemesis_omens_no_truncate on game.nemesis_omens;
create trigger nemesis_omens_no_truncate before truncate on game.nemesis_omens
  for each statement execute function game.forbid_change();

-- Journal de l'Hybris (migration 100) : la cause `nemesis`, la baisse qui suit une sanction, s'ajoute aux baisses.
create or replace function game.guard_hubris_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from now() then
    raise exception 'a Hybris movement is written now' using errcode = 'restrict_violation';
  end if;
  if new.cause in ('market_share', 'wealth', 'liturgy_levied') then
    if new.amount < 0 then
      raise exception 'a Hybris gain raises the gauge' using errcode = 'restrict_violation';
    end if;
  elsif new.cause in ('offering', 'liturgy_performed', 'decay', 'nemesis') then
    if new.amount > 0 then
      raise exception 'a Hybris relief lowers the gauge' using errcode = 'restrict_violation';
    end if;
  else
    raise exception 'unknown Hybris cause' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from game.houses h
                 where h.id = new.house_id and h.world_id = new.world_id and h.kind = 'player') then
    raise exception 'only a player house has a Hybris gauge'
      using errcode = 'check_violation', constraint = 'hubris_player_house';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
  if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.game_day) then
    raise exception 'a Hybris movement is written before its close is recorded' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_hubris_movement() from public, anon, authenticated, oikos_service;

-- Le service adresse un présage sans en choisir l'identifiant ni la date, et n'écrit ensuite que son issue ; il ne
-- supprime rien. Aucun droit ni aucune règle pour un client : la migration 202 rend ses présages à un joueur.
alter table game.nemesis_omens enable row level security;
revoke all on game.nemesis_omens from public, anon, authenticated, oikos_service;
grant select on game.nemesis_omens to oikos_service;
grant insert (world_id, house_id, model, text_fr, text_en, omen_day, due_day) on game.nemesis_omens to oikos_service;
grant update (outcome, settled_day, magnitude_bps, relief, oboles, ledger_entry_id, inventory_id, quantity, site_id,
  resumes_at, voyage_id) on game.nemesis_omens to oikos_service;
drop policy if exists service_all on game.nemesis_omens;
create policy service_all on game.nemesis_omens for all to oikos_service using (true) with check (true);
