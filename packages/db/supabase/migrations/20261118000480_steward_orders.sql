-- Ordres posés par un intendant (docs/specs/04-systemes-gestion.md, 4.4 ; ticket 562) : l'ordre nomme l'intendant
-- qui l'a posé, pour que ses règles nouvelles ou son renvoi annulent ses ordres ouverts, et que la fiche du site les
-- montre. Rejouable (`if not exists`, contrainte et vue sous condition, `create or replace`, droits redonnés) ; le
-- code précédent n'écrit pas la colonne nouvelle (nulle), ne lit pas la vue, et la garde lui admet les mêmes
-- écritures qu'avant.

-- Intendant qui a posé l'ordre, nul pour un ordre du joueur : de la même maison que l'ordre.
alter table game.orders add column if not exists steward_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stewards_id_house_unique') then
    alter table game.stewards add constraint stewards_id_house_unique unique (id, house_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_steward_same_house') then
    alter table game.orders add constraint orders_steward_same_house
      foreign key (steward_id, house_id) references game.stewards (id, house_id);
  end if;
end $$;
-- Ordres ouverts d'un intendant : ceux que ses règles nouvelles ou son renvoi annulent.
create index if not exists orders_steward_open_idx on game.orders (steward_id)
  where status = 'open' and steward_id is not null;

-- Ordres ouverts posés avant cette migration par un intendant : celui de l'opération réussie qui les a placés, lu
-- dans la réponse que le journal des commandes garde (`data.orderId`). Le journal et les opérations se purgent
-- (ADR 0002) : un ordre plus ancien qu'eux reste sans intendant. Un ordre ouvert d'un intendant déjà renvoyé est
-- rattaché sans être annulé : le joueur l'annule à l'agora. La garde des ordres refuse ce changement, que ce bloc
-- seul fait : il la suspend et la rétablit dans la même instruction, si bien qu'une erreur annule les deux. Un achat
-- modifié met en attente le contrôle différé du séquestre, et Postgres ne rétablit pas une garde tant qu'un
-- événement attend : le contrôle est mené tout de suite (le séquestre n'a pas bougé), puis redevient différé.
do $$
begin
  alter table game.orders disable trigger orders_guard;
  update game.orders o set steward_id = s.id
  from game.steward_operations so
  join game.command_log cl on cl.id = so.command_id
  join game.stewards s on s.id = so.steward_id
  where so.status = 'ok' and so.summary ->> 'command' = 'market.placeOrder'
    and cl.response #>> '{data,orderId}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and o.id = (cl.response #>> '{data,orderId}')::uuid
    and o.house_id = s.house_id and o.steward_id is null and o.status = 'open';
  set constraints game.orders_escrow_matches immediate;
  set constraints game.orders_escrow_matches deferred;
  alter table game.orders enable trigger orders_guard;
end $$;

-- Garde des ordres (migration 12), étendue : l'intendant fait partie de l'identité de l'ordre, et un ordre ne naît
-- au nom d'un intendant que s'il est en poste.
create or replace function game.guard_order() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.remaining <> new.quantity or new.status <> 'open' then
      raise exception 'an order starts open and whole' using errcode = 'restrict_violation';
    end if;
    if new.steward_id is not null and not exists (
      select 1 from game.stewards s where s.id = new.steward_id and s.dismissed_at is null) then
      raise exception 'an order is placed by a steward in post' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.seq, new.world_id, new.city_id, new.house_id, new.good_id, new.side, new.price, new.quantity, new.created_at, new.steward_id)
     is distinct from (old.id, old.seq, old.world_id, old.city_id, old.house_id, old.good_id, old.side, old.price, old.quantity, old.created_at, old.steward_id) then
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

-- Le service nomme l'intendant à la pose ; un joueur lit l'intendant de ses propres ordres (règle `orders_read_own`).
grant insert (steward_id) on game.orders to oikos_service;
grant select (steward_id) on game.orders to authenticated;

-- Vue de la maison pour la fiche de site : les ordres ouverts posés par chacun de ses intendants en poste, avec son
-- site. Créée sous condition (ADR 0006) : rejouée, cette migration ne la recrée pas.
do $$
begin
  if to_regclass('public.my_steward_orders') is null then
    create view public.my_steward_orders with (security_invoker = true) as
      select o.id, o.steward_id, s.site_id, o.city_id, o.good_id, o.side, o.price, o.quantity, o.remaining,
             o.created_at
      from game.orders o
      join game.stewards s on s.id = o.steward_id
      where o.status = 'open' and s.dismissed_at is null;
  end if;
end $$;
revoke all on public.my_steward_orders from public, anon, authenticated;
grant select on public.my_steward_orders to authenticated;
