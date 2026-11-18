-- Intendants des maisons (docs/specs/04-systemes-gestion.md, 4.4 ; 12 ; ticket 278) : un par site, avec des
-- règles de la grammaire fermée (`stewardRuleSchema`), exécutées avec #279, qui ne quittent jamais le serveur.
-- Rejouable (`if not exists`, `create or replace`, règles recréées) ; le code précédent ne lit ni n'écrit ces
-- tables ni ces vues.

-- Un intendant désigne son site avec sa maison et son monde : une seule clé étrangère les lie.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sites_id_house_world_unique') then
    alter table game.sites add constraint sites_id_house_world_unique unique (id, house_id, world_id);
  end if;
end $$;

create table if not exists game.stewards (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  house_id uuid not null,
  site_id uuid not null,
  -- Nom tiré de la liste de la configuration (`stewards.names`) à l'embauche.
  name text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  hired_at timestamptz not null default now(),
  -- Impayé depuis cet instant : l'intendant n'agit pas (#279). Posé à l'embauche, levé par la clôture qui
  -- paie son salaire, reposé par la clôture qui ne le paie pas.
  unpaid_since timestamptz default now(),
  -- Instant du renvoi ; nul pour un intendant en poste. Un intendant renvoyé ne change plus.
  dismissed_at timestamptz,
  -- Révision en vigueur de ses règles (0 : aucune), datée par la garde de la transaction qui l'ouvre.
  rules_revision integer not null default 0 check (rules_revision >= 0),
  rules_revised_at timestamptz,
  constraint stewards_site foreign key (site_id, house_id, world_id) references game.sites (id, house_id, world_id),
  constraint stewards_unpaid_after_hire check (unpaid_since is null or unpaid_since >= hired_at),
  constraint stewards_dismissed_after_hire check (dismissed_at is null or dismissed_at >= hired_at)
);
create unique index if not exists stewards_one_per_site_idx on game.stewards (site_id) where dismissed_at is null;
create index if not exists stewards_house_id_idx on game.stewards (house_id);

-- Un intendant naît maintenant, impayé et en poste ; son identité ne change plus. Son impayé change à une
-- clôture, daté de la transaction qui l'écrit ; son renvoi est daté de même, une fois pour toutes.
create or replace function game.guard_steward() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.hired_at is distinct from now() or new.unpaid_since is distinct from now()
       or new.dismissed_at is not null or new.rules_revision <> 0 or new.rules_revised_at is not null then
      raise exception 'a steward is hired now, unpaid until a close pays him' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.house_id, new.site_id, new.name, new.hired_at)
     is distinct from (old.id, old.world_id, old.house_id, old.site_id, old.name, old.hired_at) then
    raise exception 'steward identity is immutable' using errcode = 'restrict_violation';
  end if;
  if old.dismissed_at is not null then
    raise exception 'a dismissed steward does not change' using errcode = 'restrict_violation';
  end if;
  if new.rules_revision not in (old.rules_revision, old.rules_revision + 1) then
    raise exception 'rules are revised one at a time' using errcode = 'restrict_violation';
  end if;
  new.rules_revised_at := case when new.rules_revision = old.rules_revision then old.rules_revised_at else now() end;
  if new.dismissed_at is not null and new.dismissed_at is distinct from now() then
    raise exception 'a steward is dismissed now' using errcode = 'restrict_violation';
  end if;
  if new.unpaid_since is distinct from old.unpaid_since and new.unpaid_since is not null
     and new.unpaid_since is distinct from now() then
    raise exception 'a steward is unpaid from now' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_steward() from public, anon, authenticated, oikos_service;
drop trigger if exists stewards_guard on game.stewards;
create trigger stewards_guard before insert or update on game.stewards
  for each row execute function game.guard_steward();

-- Règles d'un intendant, par révision, dans l'ordre où il les mène (`position`). Donner des règles ouvre une
-- révision nouvelle, sans rien effacer : celle de `stewards.rules_revision` est en vigueur. `price_oboles` :
-- prix plancher d'une vente, prix plafond d'un rachat, par unité ; `units` : réserve gardée par une vente,
-- stock cible d'un rachat. Bornes du contrat (prix et quantité d'un ordre de l'agora, au plus 20 règles).
create table if not exists game.steward_rules (
  steward_id uuid not null references game.stewards (id),
  revision integer not null check (revision >= 1),
  position smallint not null check (position between 0 and 19),
  kind text not null check (kind in ('collect', 'sell', 'buy')),
  good_id text check (good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  price_oboles bigint check (price_oboles between 1 and 1000000000),
  units bigint check (units between 0 and 1000000),
  primary key (steward_id, revision, position),
  constraint steward_rules_shape check (
    case kind
      when 'collect' then good_id is null and price_oboles is null and units is null
      when 'sell' then good_id is not null and price_oboles is not null and units is not null
      else good_id is not null and price_oboles is not null and units >= 1
    end),
  -- Une règle par sorte et par bien (une seule récolte).
  constraint steward_rules_one_per_good unique nulls not distinct (steward_id, revision, kind, good_id)
);

-- Une règle s'écrit dans la révision en vigueur d'un intendant en poste, ouverte par la même transaction
-- (`rules_revised_at`) : une révision donnée ne s'allonge plus ensuite.
create or replace function game.guard_steward_rule() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from game.stewards s
                 where s.id = new.steward_id and s.rules_revision = new.revision
                   and s.rules_revised_at = now() and s.dismissed_at is null) then
    raise exception 'rules are written in the current revision of a steward in post' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_steward_rule() from public, anon, authenticated, oikos_service;
drop trigger if exists steward_rules_guard on game.steward_rules;
create trigger steward_rules_guard before insert on game.steward_rules
  for each row execute function game.guard_steward_rule();

-- Le service lit, embauche (sans choisir ni l'identifiant, ni les dates, ni l'impayé), puis ne change que
-- l'impayé (clôture), la révision des règles et le renvoi ; il écrit les règles sans les modifier ni les
-- supprimer.
-- Un joueur lit ses propres intendants et leurs règles, colonnes accordées une à une ; il n'écrit rien.
alter table game.stewards enable row level security;
revoke all on game.stewards from public, anon, authenticated, oikos_service;
grant select on game.stewards to oikos_service;
grant insert (world_id, house_id, site_id, name) on game.stewards to oikos_service;
grant update (unpaid_since, dismissed_at, rules_revision) on game.stewards to oikos_service;
drop policy if exists service_all on game.stewards;
create policy service_all on game.stewards for all to oikos_service using (true) with check (true);
drop policy if exists stewards_read_own on game.stewards;
create policy stewards_read_own on game.stewards for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, house_id, site_id, name, hired_at, unpaid_since, dismissed_at, rules_revision) on game.stewards to authenticated;

alter table game.steward_rules enable row level security;
revoke all on game.steward_rules from public, anon, authenticated, oikos_service;
grant select on game.steward_rules to oikos_service;
grant insert (steward_id, revision, position, kind, good_id, price_oboles, units) on game.steward_rules to oikos_service;
drop policy if exists service_all on game.steward_rules;
create policy service_all on game.steward_rules for all to oikos_service using (true) with check (true);
drop policy if exists steward_rules_read_own on game.steward_rules;
create policy steward_rules_read_own on game.steward_rules for select to authenticated
  using (steward_id in (select s.id from game.stewards s where s.house_id in (select game.current_house_ids())));
grant select (steward_id, revision, position, kind, good_id, price_oboles, units) on game.steward_rules to authenticated;

-- Vues de la maison : ses intendants en poste et leurs règles en vigueur. Elles gagneront des colonnes avec #279 :
-- rejouée ensuite, cette migration ne les recrée pas (ADR 0006).
do $$
begin
  if to_regclass('public.my_stewards') is null then
    create view public.my_stewards with (security_invoker = true) as
      select id, house_id, site_id, name, hired_at, unpaid_since, rules_revision
      from game.stewards where dismissed_at is null;
  end if;
  if to_regclass('public.my_steward_rules') is null then
    create view public.my_steward_rules with (security_invoker = true) as
      select r.steward_id, r.position, r.kind, r.good_id, r.price_oboles, r.units
      from game.steward_rules r join game.stewards s on s.id = r.steward_id and s.rules_revision = r.revision
      where s.dismissed_at is null;
  end if;
end $$;
revoke all on public.my_stewards, public.my_steward_rules from public, anon, authenticated;
grant select on public.my_stewards, public.my_steward_rules to authenticated;
