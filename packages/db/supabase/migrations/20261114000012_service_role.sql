-- Rôle de service non propriétaire (docs/specs/12-modele-donnees.md ; ticket 64).
-- L'API de jeu et le moteur ne se connectent plus avec le rôle propriétaire des tables : leur rôle n'a
-- que les droits qu'ils utilisent, ne possède rien, ne peut ni supprimer ni vider une table.
--
-- Les gardes des soldes, des stocks et des ordres ne se fient plus à la seule profondeur de
-- déclencheur : un rôle capable de créer son propre déclencheur (table temporaire) atteignait la même
-- profondeur. Elles exigent maintenant que l'écriture vienne d'un déclencheur du propriétaire : les
-- fonctions qui appliquent les journaux s'exécutent avec les droits du propriétaire (SECURITY DEFINER),
-- et la garde compare l'utilisateur courant au propriétaire de la table.

-- Rôle sans connexion : le compte de connexion des services en est membre. Il est créé par un humain
-- sur le serveur, avec son mot de passe (aucun secret ici) ; en local, on prend ce rôle par SET ROLE.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'oikos_service') then
    create role oikos_service nologin noinherit;
  end if;
end $$;
do $$
begin
  execute format('grant oikos_service to %I with set true, inherit false', current_user);
exception when others then
  -- Déjà membre, ou superutilisateur : SET ROLE reste possible.
  null;
end $$;

-- Vrai si l'écriture en cours vient d'un déclencheur qui s'exécute au nom du propriétaire de la table.
create or replace function game.written_by_owner_trigger(target oid) returns boolean
language sql
stable
set search_path = ''
as $$
  select pg_catalog.pg_trigger_depth() >= 2
     and current_user = (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = target)
$$;

alter function game.apply_ledger_line() security definer;
alter function game.apply_stock_movement() security definer;
alter function game.apply_order_reservation() security definer;
alter function game.apply_trade() security definer;

create or replace function game.guard_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.balance <> 0 then
      raise exception 'an account starts with a zero balance' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.kind, new.house_id, new.system_key, new.allow_negative, new.created_at)
     is distinct from (old.id, old.world_id, old.kind, old.house_id, old.system_key, old.allow_negative, old.created_at) then
    raise exception 'account identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.balance is distinct from old.balance and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'account balance changes only through ledger lines' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create or replace function game.guard_inventory() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 0 or new.reserved <> 0 then
      raise exception 'an inventory starts empty' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.house_id, new.city_id, new.good_id, new.created_at)
     is distinct from (old.id, old.world_id, old.house_id, old.city_id, old.good_id, old.created_at) then
    raise exception 'inventory identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.quantity is distinct from old.quantity and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'inventory quantity changes only through the stock ledger' using errcode = 'restrict_violation';
  end if;
  if new.reserved is distinct from old.reserved and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'inventory reservation changes only through orders' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create or replace function game.guard_order() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.remaining <> new.quantity or new.status <> 'open' then
      raise exception 'an order starts open and whole' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.seq, new.world_id, new.city_id, new.house_id, new.good_id, new.side, new.price, new.quantity, new.created_at)
     is distinct from (old.id, old.seq, old.world_id, old.city_id, old.house_id, old.good_id, old.side, old.price, old.quantity, old.created_at) then
    raise exception 'order identity is immutable' using errcode = 'restrict_violation';
  end if;
  if old.status <> 'open' then
    raise exception 'a closed order does not change' using errcode = 'restrict_violation';
  end if;
  if (new.remaining <> old.remaining or new.status <> 'cancelled') and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'an order is only filled by a trade or cancelled' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Droits du rôle de service : lecture partout, écriture là où une commande ou le tick écrit.
-- Ni DELETE ni TRUNCATE nulle part ; aucun droit de création dans les schémas du jeu.
grant usage on schema game, config, telemetry, admin to oikos_service;
grant select on all tables in schema game, config, telemetry, admin to oikos_service;
grant usage on all sequences in schema game, config to oikos_service;
grant execute on all functions in schema game, config to oikos_service;
grant insert on
  game.houses, game.citizenships, game.sites, game.accounts, game.inventories,
  game.ledger_entries, game.ledger_lines, game.stock_ledger, game.orders, game.trades,
  game.npc_demand_carry, game.ticks, game.command_log, game.domain_events,
  config.versions, config.activations, telemetry.tick_runs
  to oikos_service;
-- UPDATE : renommer une maison, avancer le cycle d'un site, annuler un ordre, tenir le report de la
-- demande. Sur les comptes et les stocks, il ne sert qu'à verrouiller une ligne (SELECT ... FOR UPDATE) :
-- la garde refuse toute modification directe d'un solde, d'une quantité ou d'une réservation.
grant update on game.houses, game.sites, game.orders, game.npc_demand_carry, game.accounts, game.inventories
  to oikos_service;

-- Le service n'est pas propriétaire : les règles par ligne s'appliquent à lui. Il voit et écrit toutes
-- les lignes des tables qui lui sont ouvertes ; les droits ci-dessus bornent ce qu'il peut y faire.
do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('game', 'config', 'telemetry', 'admin') and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists service_all on %I.%I', target.schema_name, target.table_name);
    execute format('create policy service_all on %I.%I for all to oikos_service using (true) with check (true)',
                   target.schema_name, target.table_name);
  end loop;
end $$;

-- File de tâches du moteur (pg-boss) : il installe, possède et fait évoluer ses propres tables dans son
-- propre schéma (une file crée ses partitions à la volée). Le service reçoit pour cela le droit de créer
-- un schéma dans la base, et rien dans les schémas du jeu : ce qu'il crée ailleurs ne franchit aucune
-- garde, puisqu'elles exigent une écriture au nom du propriétaire des tables du jeu.
do $$
begin
  execute format('grant create on database %I to oikos_service', current_database());
end $$;
