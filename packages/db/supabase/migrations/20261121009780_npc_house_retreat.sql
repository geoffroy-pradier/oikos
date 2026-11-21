-- Retrait des maisons PNJ de secours devant les joueurs (docs/specs/08-ia.md, 8.3 ; 12-modele-donnees.md ; ticket 717).
-- À chaque clôture, la part des maisons de joueurs dans les ventes du bien d'une filière décide si sa maison PNJ ferme
-- un site ou en rouvre un ; sans site, elle vend son stock, verse sa trésorerie au puits du surplus et se dissout.
--
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés). Compatible avec le code précédent :
-- il ne ferme aucun site (`closed_at` reste nul, que la garde admet à l'insertion) et ne lit ni n'écrit la table
-- nouvelle ; un site jamais fermé se lit et s'écrit comme avant.

-- Fermeture d'un site d'une maison PNJ : l'instant, nul pour un site ouvert. Un site fermé n'emploie, ne paie et ne
-- produit rien ; il se rouvre en place, à la même recette.
alter table game.sites add column if not exists closed_at timestamptz;

-- Garde de la fermeture, à côté de celle des sites (`sites_guard`, qu'elle ne remplace pas) : un site naît ouvert ;
-- seul un site d'une maison PNJ se ferme, maintenant ; un site fermé ne change ni de recette, ni de cycle, ni d'arrêt ;
-- il se rouvre à la même recette, sur un cycle neuf commencé maintenant (le temps fermé n'est jamais récolté), ou,
-- s'il était à l'arrêt, sans toucher au cycle ni à l'arrêt, que la relance décalera comme pour tout site.
create or replace function game.guard_site_closure() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.closed_at is not null then
      raise exception 'a site starts open' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.closed_at is not null and new.closed_at is not null then
    if (new.closed_at, new.recipe_id, new.cycle_started_at, new.halted_at)
       is distinct from (old.closed_at, old.recipe_id, old.cycle_started_at, old.halted_at) then
      raise exception 'a closed site does not change' using errcode = 'restrict_violation';
    end if;
  elsif old.closed_at is null and new.closed_at is not null then
    if new.closed_at <> now() then
      raise exception 'a site closes now' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.houses h where h.id = new.house_id and h.kind = 'npc') then
      raise exception 'only a site of an NPC house closes' using errcode = 'check_violation',
        constraint = 'sites_closed_npc_only';
    end if;
    if (new.recipe_id, new.cycle_started_at, new.halted_at)
       is distinct from (old.recipe_id, old.cycle_started_at, old.halted_at) then
      raise exception 'a closed site does not change' using errcode = 'restrict_violation';
    end if;
  elsif old.closed_at is not null and new.closed_at is null then
    if new.recipe_id is distinct from old.recipe_id
       or (old.halted_at is null and new.cycle_started_at <> now())
       or (old.halted_at is not null
           and (new.cycle_started_at, new.halted_at) is distinct from (old.cycle_started_at, old.halted_at)) then
      raise exception 'a site reopens with its recipe, on a new cycle unless halted' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_site_closure() from public, anon, authenticated, oikos_service;
drop trigger if exists sites_closure_guard on game.sites;
create trigger sites_closure_guard before insert or update on game.sites
  for each row execute function game.guard_site_closure();
grant update (closed_at) on game.sites to oikos_service;

-- Mémoire du retrait d'une maison PNJ, une ligne par maison : le jour de jeu de la dernière clôture jouée (clé
-- d'idempotence : il ne fait que croître), le rang du dernier échange compté (les ventes d'une clôture sont celles
-- d'après), la fenêtre des ventes des dernières clôtures (`[ventes des joueurs, ventes en tout]`, la plus récente en
-- dernier), la série de clôtures au-dessus du seuil haut, et l'instant de la dissolution.
create table if not exists game.npc_house_retreats (
  house_id uuid primary key,
  world_id uuid not null references game.worlds (id),
  house_kind text not null default 'npc' check (house_kind = 'npc'),
  game_day integer not null check (game_day >= 0),
  trade_seq bigint not null check (trade_seq >= 0),
  sales jsonb not null default '[]' check (jsonb_typeof(sales) = 'array' and jsonb_array_length(sales) <= 30),
  above_days integer not null default 0 check (above_days >= 0),
  dissolved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint npc_house_retreats_house_is_npc foreign key (house_id, world_id, house_kind)
    references game.houses (id, world_id, kind)
);

-- Une clôture suit la précédente : jour de jeu strictement croissant, rang des échanges jamais en arrière, identité
-- fixe. Une dissolution est datée de maintenant, définitive (plus rien ne change ensuite), et la base vérifie qu'il ne
-- reste rien à la maison : aucun site ouvert, aucun ordre ouvert, aucun stock, aucun solde.
create or replace function game.guard_npc_house_retreat() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.house_id, new.world_id, new.house_kind) is distinct from (old.house_id, old.world_id, old.house_kind) then
      raise exception 'an NPC house retreat keeps its house' using errcode = 'restrict_violation';
    end if;
    if old.dissolved_at is not null then
      raise exception 'a dissolved NPC house is final' using errcode = 'restrict_violation';
    end if;
    if new.game_day <= old.game_day or new.trade_seq < old.trade_seq then
      raise exception 'an NPC house retreat follows the previous close' using errcode = 'restrict_violation';
    end if;
  end if;
  if new.dissolved_at is not null then
    if new.dissolved_at <> now() then
      raise exception 'an NPC house dissolves now' using errcode = 'restrict_violation';
    end if;
    if exists (select 1 from game.sites s where s.house_id = new.house_id and s.closed_at is null)
       or exists (select 1 from game.orders o where o.house_id = new.house_id and o.status = 'open')
       or exists (select 1 from game.inventories i where i.house_id = new.house_id and i.quantity <> 0)
       or exists (select 1 from game.accounts a where a.house_id = new.house_id and a.balance <> 0) then
      raise exception 'an NPC house dissolves with nothing left' using errcode = 'check_violation',
        constraint = 'npc_house_retreats_dissolved_empty';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function game.guard_npc_house_retreat() from public, anon, authenticated, oikos_service;
drop trigger if exists npc_house_retreats_guard on game.npc_house_retreats;
create trigger npc_house_retreats_guard before insert or update on game.npc_house_retreats
  for each row execute function game.guard_npc_house_retreat();
drop trigger if exists npc_house_retreats_no_delete on game.npc_house_retreats;
create trigger npc_house_retreats_no_delete before delete on game.npc_house_retreats
  for each row execute function game.forbid_change();
drop trigger if exists npc_house_retreats_no_truncate on game.npc_house_retreats;
create trigger npc_house_retreats_no_truncate before truncate on game.npc_house_retreats
  for each statement execute function game.forbid_change();

-- Seul le moteur, sous le rôle de service, lit et écrit la mémoire du retrait ; aucun joueur ne la lit.
alter table game.npc_house_retreats enable row level security;
revoke all on game.npc_house_retreats from public, anon, authenticated, oikos_service;
grant select on game.npc_house_retreats to oikos_service;
grant insert (house_id, world_id, game_day, trade_seq, sales, above_days, dissolved_at)
  on game.npc_house_retreats to oikos_service;
grant update (game_day, trade_seq, sales, above_days, dissolved_at) on game.npc_house_retreats to oikos_service;
drop policy if exists service_all on game.npc_house_retreats;
create policy service_all on game.npc_house_retreats for all to oikos_service using (true) with check (true);
