-- Maisons PNJ de secours (docs/specs/08-ia.md, 8.3 ; 12-modele-donnees.md ; ticket 715).
-- Une maison PNJ est une maison du monde sans compte, de nature `npc` (colonne `houses.kind` de #718), que la clôture
-- fonde dans une cité pour une filière vitale de la configuration (`npcHouses`), une seule par cité et par filière.
-- Elle naît métèque de sa cité, et n'en devient jamais citoyenne : elle ne vote ni ne se présente nulle part, et
-- n'entre dans aucun électorat, que les gardes des votes et des candidatures réservent déjà aux citoyens.
-- Aucune commande de l'API de jeu n'agit pour elle : toute commande désigne la maison du compte qui l'envoie
-- (`accountHouseId`, `current_house_ids()`), et une maison PNJ n'a pas de compte.
--
-- Rejouable. Compatible avec le code précédent : il ne fonde que des maisons de joueur, avec leur compte, que les
-- contraintes nouvelles admettent ; il ne lit ni `npc_houses` ni sa vue. `public.houses` garde ses colonnes (ADR 0006) :
-- la nature d'une maison sort par la vue nouvelle `public.npc_houses`.

-- Une maison PNJ n'a pas de compte, une maison de joueur en a un. `not valid` : la contrainte vaut pour toute ligne
-- écrite ensuite ; elle n'est validée que si aucune ligne existante ne la viole. Seuls des jeux d'essai de #718 ont pu
-- marquer `npc` une maison qui a un compte : une base qui en garde une passe quand même.
alter table game.houses alter column user_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'houses_account_by_kind' and conrelid = 'game.houses'::regclass) then
    alter table game.houses add constraint houses_account_by_kind check ((kind = 'npc') = (user_id is null)) not valid;
  end if;
  if not exists (select 1 from game.houses where (kind = 'npc') <> (user_id is null)) then
    alter table game.houses validate constraint houses_account_by_kind;
  end if;
  -- Cible de la clé de `npc_houses` : une maison, son monde et sa nature.
  if not exists (select 1 from pg_constraint where conname = 'houses_id_world_kind_unique' and conrelid = 'game.houses'::regclass) then
    alter table game.houses add constraint houses_id_world_kind_unique unique (id, world_id, kind);
  end if;
end $$;

-- Le déclencheur d'une maison par compte (#604, migration 750) laisse passer une maison sans compte : son verrou
-- consultatif sur un compte nul n'est pas pris (`pg_advisory_xact_lock(null)`), et aucune maison n'a un compte nul égal.

-- Maison PNJ d'une filière d'une cité : une par cité et par filière, de la nature `npc` (clé étrangère sur la nature),
-- dans le monde de sa cité. La filière est l'identifiant de la configuration ; la date de fondation, celle de la base.
create table if not exists game.npc_houses (
  house_id uuid primary key,
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  chain_id text not null check (chain_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  house_kind text not null default 'npc' check (house_kind = 'npc'),
  founded_at timestamptz not null default now(),
  constraint npc_houses_house_is_npc foreign key (house_id, world_id, house_kind)
    references game.houses (id, world_id, kind),
  constraint npc_houses_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint npc_houses_one_per_chain unique (city_id, chain_id)
);
create index if not exists npc_houses_world_idx on game.npc_houses (world_id);

-- Le service fonde : maison, monde, cité et filière ; ni nature, ni date. Il ne modifie ni ne supprime rien.
alter table game.npc_houses enable row level security;
grant select on game.npc_houses to oikos_service;
grant insert (house_id, world_id, city_id, chain_id) on game.npc_houses to oikos_service;
drop policy if exists service_all on game.npc_houses;
create policy service_all on game.npc_houses for all to oikos_service using (true) with check (true);
-- Un joueur connecté lit les maisons PNJ de son monde (8.3 : « clairement identifiées comme telles »), sans la
-- filière ni la date ; un visiteur anonyme ne lit rien.
drop policy if exists npc_houses_read on game.npc_houses;
create policy npc_houses_read on game.npc_houses for select to authenticated
  using (world_id in (select game.current_world_ids()));
grant select (house_id, world_id, city_id) on game.npc_houses to authenticated;

do $$
begin
  if to_regclass('public.npc_houses') is null then
    create view public.npc_houses with (security_invoker = true) as
      select house_id, world_id, city_id from game.npc_houses;
  end if;
end $$;
revoke all on public.npc_houses from public, anon, authenticated;
grant select on public.npc_houses to authenticated;

-- Citoyenneté : la garde de la migration 70, et une maison PNJ ne devient jamais citoyenne.
create or replace function game.guard_citizenship() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'metic' then
      raise exception 'a house is welcomed as a metic' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.house_id, new.city_id) is distinct from (old.id, old.house_id, old.city_id) then
    raise exception 'citizenship identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.status = old.status then
    if new.since is distinct from old.since then
      raise exception 'the citizenship date only changes with its status' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.status <> 'metic' or new.status <> 'citizen' then
    raise exception 'a citizen stays a citizen' using errcode = 'restrict_violation';
  end if;
  if new.since is distinct from now() then
    raise exception 'citizenship is granted now' using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from game.houses h where h.id = new.house_id and h.kind = 'npc') then
    raise exception 'an NPC house is never a citizen' using errcode = 'check_violation',
      constraint = 'citizenships_npc_never_citizen';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_citizenship() from public, anon, authenticated, oikos_service;
