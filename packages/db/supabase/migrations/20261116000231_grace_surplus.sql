-- Surplus des grâces au journal des stocks (docs/specs/07-dieux-faveur-evenements.md, 7.1 ;
-- docs/specs/12-modele-donnees.md ; ticket 266). Une récolte qui consomme une récolte bénie ou un atelier inspiré
-- (migration 230) rend son surplus par des mouvements `grace.surplus` de l'extrémité `production` vers le stock
-- de la maison dans la cité du site, rattachés à la grâce, un par bien. Rejouable (`if not exists`, `create or
-- replace` à signature inchangée, contraintes posées si absentes, déclencheur recréé) ; le code précédent n'écrit
-- ni ne lit cette colonne.

-- `not valid` : aucune ligne antérieure n'a de grâce ; le journal n'est pas relu.
alter table game.stock_ledger add column if not exists grace_use_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_grace_same_world') then
    alter table game.stock_ledger add constraint stock_ledger_grace_same_world
      foreign key (grace_use_id, world_id) references game.graces_used (id, world_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_grace_from_production') then
    alter table game.stock_ledger add constraint stock_ledger_grace_from_production
      check (grace_use_id is null or (from_system = 'production' and to_inventory_id is not null
                                      and kind = 'grace.surplus')) not valid;
  end if;
end $$;
create unique index if not exists stock_ledger_grace_good_idx on game.stock_ledger (grace_use_id, good_id)
  where grace_use_id is not null;

-- Un surplus entre, dans la transaction qui consomme sa grâce par une récolte, au stock de sa maison dans la
-- cité du site.
create or replace function game.check_grace_stock_movement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
       select 1 from game.graces_used g
       join game.sites s on s.id = g.site_id
       join game.inventories i on i.id = new.to_inventory_id
       where g.id = new.grace_use_id and g.consumed_at = now()
         and i.house_id = g.house_id and i.city_id = s.city_id) then
    raise exception 'a grace surplus enters its house stock in the site city, when consumed'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.check_grace_stock_movement() from public, anon, authenticated, oikos_service;
drop trigger if exists stock_ledger_grace_guard on game.stock_ledger;
create trigger stock_ledger_grace_guard before insert on game.stock_ledger
  for each row when (new.grace_use_id is not null) execute function game.check_grace_stock_movement();

-- Contrôle à la validation (migration 230), plus la consommation par une récolte : elle a rendu son surplus.
-- Une récolte qui n'ajoute rien ne consomme pas la grâce, qui reste en attente.
create or replace function game.check_grace_settled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (new.charis_spent > 0) <> exists (
       select 1 from game.favor_ledger f where f.grace_use_id = new.id) then
    raise exception 'a grace spends its Charis' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' and new.site_id is not null
     and not exists (select 1 from game.stock_ledger s where s.grace_use_id = new.id) then
    raise exception 'a blessed collect yields its surplus' using errcode = 'restrict_violation';
  end if;
  return null;
end;
$$;
revoke execute on function game.check_grace_settled() from public, anon, authenticated, oikos_service;
