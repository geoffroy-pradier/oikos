-- Immobilier urbain : le parc de logements des cités (docs/specs/04-systemes-gestion.md, 4.5 ;
-- docs/specs/12-modele-donnees.md ; ticket 256). Le moteur crée le parc, détenu d'abord par la cité ; une
-- maison achète un bien, le rénove, et en paie l'entretien à la clôture. Les vues de lecture viennent après.
-- Rejouable (`if not exists`, `create or replace`, `on conflict do nothing`, règles recréées) ; le code
-- précédent n'écrit ni ne lit cette table ni ces puits.

create table if not exists game.properties (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  -- Taille du logement, identifiant de la configuration (`properties.sizes`, packages/config).
  size_id text not null check (size_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Numéro du bien dans le parc de sa cité et de sa taille : le moteur complète le parc jusqu'au nombre de
  -- la configuration, et deux moteurs ne créent pas deux fois le même numéro.
  lot integer not null check (lot between 1 and 10000),
  -- Maison propriétaire ; nulle tant que la cité détient le bien. `acquired_at` : l'instant de son achat.
  owner_house_id uuid,
  acquired_at timestamptz,
  -- État de 0 à 10 000 (neuf) ; `worn_day` : jour de jeu de la dernière clôture qui l'a usé.
  condition integer not null default 10000 check (condition between 0 and 10000),
  worn_day integer,
  -- Instant où une clôture a trouvé l'entretien impayé : le bien ne loge personne jusqu'à celle qui le paie.
  upkeep_unpaid_since timestamptz,
  created_at timestamptz not null default now(),
  constraint properties_lot_unique unique (city_id, size_id, lot),
  constraint properties_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint properties_owner_same_world foreign key (owner_house_id, world_id) references game.houses (id, world_id),
  constraint properties_acquired_with_owner check ((owner_house_id is null) = (acquired_at is null)),
  constraint properties_unpaid_when_owned check (upkeep_unpaid_since is null or owner_house_id is not null),
  -- Le jour d'usure est celui d'une clôture enregistrée, vérifié à la validation (comme `npc_population`).
  constraint properties_worn_on_close foreign key (world_id, worn_day)
    references game.daily_closes (world_id, game_day) deferrable initially deferred
);
create index if not exists properties_owner_idx on game.properties (owner_house_id) where owner_house_id is not null;
create index if not exists properties_world_idx on game.properties (world_id);

-- Écritures d'achat et de rénovation d'un bien, retrouvées par la garde sans parcourir le grand livre.
-- Un bien n'est acheté à la cité qu'une fois : une seule écriture `property.buy` par bien, quelle que soit
-- la façon d'écrire son identifiant (clé typée, comme `ledger_entries_upkeep_once`, migration 27). La
-- revente entre maisons (#257) aura sa propre nature.
create unique index if not exists ledger_entries_property_bought_once
  on game.ledger_entries (((meta ->> 'propertyId')::uuid)) where kind = 'property.buy';
create index if not exists ledger_entries_property_renovated_idx
  on game.ledger_entries (((meta ->> 'propertyId')::uuid)) where kind = 'property.renovate';

-- Un bien naît maintenant, neuf, détenu par sa cité. Il ne change ensuite ni d'identifiant, ni de monde,
-- ni de cité, ni de taille, ni de numéro, ni de date de naissance.
-- 1. Il ne quitte la cité que par une écriture `property.buy` de la même transaction (datée de son
--    début), qui le désigne et débite la trésorerie de l'acheteur ; il ne revient pas à la cité, et ne
--    passe pas d'une maison à une autre (revente : #257). L'instant de l'achat est posé ici.
-- 2. Son état ne remonte que par une rénovation : jusqu'au maximum, par une écriture `property.renovate`
--    de la même transaction, qui le désigne et débite la trésorerie de son propriétaire.
-- 3. Il s'use une fois par jour de jeu, dans la transaction qui enregistre la clôture de ce jour : le jour
--    d'usure avance, et aucune clôture de ce jour ou d'un jour postérieur n'est encore enregistrée (même
--    montage et même verrou que `guard_npc_population`, migration 34).
-- 4. L'entretien impayé est daté de la transaction qui l'écrit et ne change plus ; il se lève sans que la
--    base le relie à un paiement (la clôture le garantit, comme le désarmement d'un navire).
-- Au nom du propriétaire de la base : ce que le service peut lire n'y change rien.
create or replace function game.guard_property() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() then
      raise exception 'a property is built now' using errcode = 'restrict_violation';
    end if;
    if new.owner_house_id is not null or new.acquired_at is not null then
      raise exception 'a property is first held by its city' using errcode = 'restrict_violation';
    end if;
    if new.condition <> 10000 or new.worn_day is not null or new.upkeep_unpaid_since is not null then
      raise exception 'a property is built new' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.city_id, new.size_id, new.lot, new.created_at)
     is distinct from (old.id, old.world_id, old.city_id, old.size_id, old.lot, old.created_at) then
    raise exception 'property identity is immutable' using errcode = 'restrict_violation';
  end if;
  new.acquired_at := old.acquired_at;
  if new.owner_house_id is distinct from old.owner_house_id then
    if new.owner_house_id is null then
      raise exception 'a property does not return to its city' using errcode = 'restrict_violation';
    end if;
    if old.owner_house_id is not null then
      raise exception 'a property is bought only from its city' using errcode = 'restrict_violation';
    end if;
    if not exists (
        select 1 from game.ledger_entries e
        join game.ledger_lines l on l.entry_id = e.id
        join game.accounts a on a.id = l.account_id
        where ((e.meta ->> 'propertyId')::uuid) = new.id and e.kind = 'property.buy'
          and e.world_id = new.world_id and e.created_at = now()
          and a.kind = 'house' and a.house_id = new.owner_house_id and l.amount < 0) then
      raise exception 'a property changes hands only by a purchase entry of the same transaction'
        using errcode = 'restrict_violation';
    end if;
    new.acquired_at := now();
  end if;
  if new.condition > old.condition then
    if new.condition <> 10000 or new.worn_day is distinct from old.worn_day then
      raise exception 'a renovation restores a property to its full condition' using errcode = 'restrict_violation';
    end if;
    if not exists (
        select 1 from game.ledger_entries e
        join game.ledger_lines l on l.entry_id = e.id
        join game.accounts a on a.id = l.account_id
        where ((e.meta ->> 'propertyId')::uuid) = new.id and e.kind = 'property.renovate'
          and e.world_id = new.world_id and e.created_at = now()
          and a.kind = 'house' and a.house_id = new.owner_house_id and l.amount < 0) then
      raise exception 'a property is restored only by a renovation entry of the same transaction'
        using errcode = 'restrict_violation';
    end if;
  elsif new.condition < old.condition or new.worn_day is distinct from old.worn_day then
    if new.worn_day is null or new.worn_day <= coalesce(old.worn_day, -1) then
      raise exception 'a property wears once per game day, forward' using errcode = 'restrict_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('close:' || new.world_id::text, 0));
    if exists (select 1 from game.daily_closes c where c.world_id = new.world_id and c.game_day >= new.worn_day) then
      raise exception 'a property wears before its close is recorded' using errcode = 'restrict_violation';
    end if;
  end if;
  if new.upkeep_unpaid_since is distinct from old.upkeep_unpaid_since and new.upkeep_unpaid_since is not null then
    if old.upkeep_unpaid_since is not null then
      raise exception 'an unpaid date does not change' using errcode = 'restrict_violation';
    end if;
    if new.upkeep_unpaid_since < now() or new.upkeep_unpaid_since > clock_timestamp() then
      raise exception 'unpaid upkeep is dated by the transaction that writes it' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_property() from public, anon, authenticated, oikos_service;
drop trigger if exists properties_guard on game.properties;
create trigger properties_guard before insert or update on game.properties
  for each row execute function game.guard_property();
drop trigger if exists properties_no_delete on game.properties;
create trigger properties_no_delete before delete on game.properties
  for each row execute function game.forbid_change();
drop trigger if exists properties_no_truncate on game.properties;
create trigger properties_no_truncate before truncate on game.properties
  for each statement execute function game.forbid_change();

-- Le service lit, crée un bien sans choisir ni son identifiant, ni sa date, ni son état, et n'en modifie
-- que le propriétaire, l'état, le jour d'usure et l'entretien impayé ; il ne le supprime pas. Les joueurs
-- lisent le parc par des vues (migration suivante).
alter table game.properties enable row level security;
revoke all on game.properties from public, anon, authenticated, oikos_service;
grant select on game.properties to oikos_service;
grant insert (world_id, city_id, size_id, lot) on game.properties to oikos_service;
grant update (owner_house_id, condition, worn_day, upkeep_unpaid_since) on game.properties to oikos_service;
drop policy if exists service_all on game.properties;
create policy service_all on game.properties for all to oikos_service using (true) with check (true);

-- Puits de monnaie : prix d'achat à la cité, entretien quotidien, rénovation. Le catalogue crée leurs
-- comptes dans chaque monde.
insert into game.system_account_kinds (key, allow_negative)
values ('sink_property_purchase', false), ('sink_property_upkeep', false), ('sink_property_works', false)
on conflict do nothing;
