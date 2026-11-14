-- Clôtures quotidiennes jouées, arrêt d'un site impayé (docs/specs/03-boucles-progression.md et
-- 05-economie.md, 5.5 ; ticket 72).

-- Une clôture jouée : une ligne par monde et par jour de jeu, écrite dans la transaction qui applique
-- ses effets. La clé primaire garantit qu'une clôture n'est appliquée qu'une fois, quels que soient le
-- nombre de moteurs et la durée du tick : le jour de jeu ne dépend pas de l'indice d'un tick.
create table if not exists game.daily_closes (
  world_id uuid not null references game.worlds (id),
  -- Jour de jeu que la clôture ouvre : rang du jour civil local, en jours depuis 1970-01-01.
  game_day integer not null check (game_day >= 0),
  -- Instant de jeu de la clôture, quel que soit le moment réel de son exécution.
  close_at timestamptz not null,
  -- Une clôture lit une version de configuration et une seule.
  config_version_id uuid not null references config.versions (id),
  summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
  -- Horloge réelle à l'écriture de la ligne.
  finished_at timestamptz not null default clock_timestamp(),
  primary key (world_id, game_day),
  -- Une clôture ne se joue pas avant son heure : `finished_at` est toujours l'horloge de la base, le
  -- service n'ayant pas le droit de l'écrire (droits par colonnes ci-dessous).
  constraint daily_closes_not_early check (close_at <= finished_at)
);
drop trigger if exists daily_closes_immutable on game.daily_closes;
create trigger daily_closes_immutable before update or delete on game.daily_closes
  for each row execute function game.forbid_change();
drop trigger if exists daily_closes_no_truncate on game.daily_closes;
create trigger daily_closes_no_truncate before truncate on game.daily_closes
  for each statement execute function game.forbid_change();
-- Non exposée aux clients : règles par ligne actives, aucune règle ni droit pour eux.
alter table game.daily_closes enable row level security;
revoke all on game.daily_closes from public, anon, authenticated, oikos_service;
grant select on game.daily_closes to oikos_service;
grant insert (world_id, game_day, close_at, config_version_id, summary) on game.daily_closes to oikos_service;
drop policy if exists service_all on game.daily_closes;
create policy service_all on game.daily_closes for all to oikos_service using (true) with check (true);

-- L'entretien d'une maison n'est prélevé qu'une fois par jour de jeu : même si une clôture était
-- rejouée par erreur, la base refuserait la seconde écriture.
-- La clé porte sur des valeurs typées, et la contrainte n'admet qu'une écriture de chacune : un
-- identifiant de maison en minuscules, un jour de jeu entier sans zéro de tête ni décimale (`20771.0`
-- serait sinon une autre clé que `20771`). `is true` : une clé absente rend nul, qui passerait.
alter table game.ledger_entries drop constraint if exists ledger_entries_upkeep_meta;
alter table game.ledger_entries add constraint ledger_entries_upkeep_meta check (
  kind <> 'upkeep.daily'
  or (jsonb_typeof(meta -> 'houseId') = 'string' and jsonb_typeof(meta -> 'gameDay') = 'number'
      and meta ->> 'houseId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      and meta ->> 'gameDay' ~ '^(0|[1-9][0-9]{0,8})$') is true
);
drop index if exists game.ledger_entries_upkeep_once;
create unique index ledger_entries_upkeep_once
  on game.ledger_entries (world_id, ((meta ->> 'houseId')::uuid), ((meta ->> 'gameDay')::integer))
  where kind = 'upkeep.daily';

-- Site à l'arrêt : instant de l'arrêt, nul pour un site qui tourne. Un site à l'arrêt ne produit pas :
-- la récolte compte le temps jusqu'à cet instant, et la reprise décale le cycle de la durée de l'arrêt.
alter table game.sites add column if not exists halted_at timestamptz;
-- Pendant l'arrêt, le cycle ne dépasse pas l'instant de l'arrêt. Un changement de recette, qui repart
-- d'un cycle neuf maintenant, est donc refusé à un site à l'arrêt.
alter table game.sites drop constraint if exists sites_cycle_not_after_halt;
alter table game.sites add constraint sites_cycle_not_after_halt
  check (halted_at is null or cycle_started_at <= halted_at);

-- La garde des sites (migration 17) tient en plus les règles de l'arrêt : un site naît en marche ; il
-- s'arrête maintenant ; l'instant d'un arrêt ne change pas ; à la reprise, le cycle avance exactement
-- de la durée de l'arrêt, si bien que le temps passé à l'arrêt n'est jamais récolté. Cette durée est
-- comptée en secondes : un intervalle en jours, ajouté à une date, dépendrait du fuseau de la session
-- (un jour de 23 ou 25 heures au changement d'heure).
create or replace function game.guard_site() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at <> now() or new.cycle_started_at <> now() or new.halted_at is not null then
      raise exception 'a site starts now' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if new.cycle_started_at < old.cycle_started_at or new.cycle_started_at > now() then
    raise exception 'a site cycle only moves forward, up to now' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.world_id, new.house_id, new.city_id, new.created_at)
     is distinct from (old.id, old.world_id, old.house_id, old.city_id, old.created_at) then
    raise exception 'site identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.recipe_id is distinct from old.recipe_id and new.cycle_started_at <> now() then
    raise exception 'a site that changes recipe starts a new cycle now' using errcode = 'restrict_violation';
  end if;
  if new.halted_at is distinct from old.halted_at then
    if old.halted_at is null and new.halted_at <> now() then
      raise exception 'a site halts now' using errcode = 'restrict_violation';
    elsif old.halted_at is not null and new.halted_at is not null then
      raise exception 'a halt keeps its instant' using errcode = 'restrict_violation';
    elsif new.halted_at is null and new.cycle_started_at
        <> old.cycle_started_at + extract(epoch from now() - old.halted_at) * interval '1 second' then
      raise exception 'a site resumes with its cycle shifted by the halt' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Le service arrête un site à la clôture et le relance au paiement.
grant update (halted_at) on game.sites to oikos_service;
