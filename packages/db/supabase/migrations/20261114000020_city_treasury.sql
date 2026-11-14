-- Trésor de la cité (docs/specs/05-economie.md, 5.3 et 5.6 ; ticket 70).
-- Un compte du grand livre par cité, qui recevra la part non détruite de la taxe de marché. Il naît
-- avec la cité, comme les comptes système naissent avec le monde, et n'est jamais débiteur : le trésor
-- ne dépense que ce qu'il a reçu. Rien ne l'alimente encore.

alter table game.accounts add column if not exists city_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cities_id_world_unique' and conrelid = 'game.cities'::regclass) then
    alter table game.cities add constraint cities_id_world_unique unique (id, world_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounts_one_per_city' and conrelid = 'game.accounts'::regclass) then
    alter table game.accounts add constraint accounts_one_per_city unique (city_id);
    -- Le trésor d'une cité est tenu dans le monde de sa cité.
    alter table game.accounts add constraint accounts_city_same_world
      foreign key (city_id, world_id) references game.cities (id, world_id);
  end if;
end $$;
alter table game.accounts drop constraint if exists accounts_kind_check;
alter table game.accounts add constraint accounts_kind_check check (kind in ('house', 'system', 'escrow', 'treasury'));
alter table game.accounts drop constraint if exists accounts_owner;
alter table game.accounts add constraint accounts_owner check (
  (kind in ('house', 'escrow') and house_id is not null and system_key is null and city_id is null and not allow_negative)
  or (kind = 'system' and house_id is null and system_key is not null and city_id is null)
  or (kind = 'treasury' and city_id is not null and house_id is null and system_key is null and not allow_negative)
);

-- La cité d'un compte fait partie de son identité, immuable comme le reste (migration 12).
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
  if (new.id, new.world_id, new.kind, new.house_id, new.system_key, new.city_id, new.allow_negative, new.created_at)
     is distinct from (old.id, old.world_id, old.kind, old.house_id, old.system_key, old.city_id, old.allow_negative, old.created_at) then
    raise exception 'account identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.balance is distinct from old.balance and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'account balance changes only through ledger lines' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create or replace function game.create_city_treasury() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.cities'::regclass then
    raise exception '% only runs on game.cities', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.accounts (world_id, kind, city_id) values (new.world_id, 'treasury', new.id)
    on conflict do nothing;
  return null;
end;
$$;
revoke execute on function game.create_city_treasury() from public, anon, authenticated, oikos_service;
drop trigger if exists cities_treasury on game.cities;
create trigger cities_treasury after insert on game.cities
  for each row execute function game.create_city_treasury();
-- Cités existantes.
insert into game.accounts (world_id, kind, city_id)
select c.world_id, 'treasury', c.id from game.cities c
on conflict do nothing;

-- Le service n'ouvre pas de trésor : la règle par ligne (migration 19) n'admet que maison et séquestre,
-- et la garde des comptes système, indépendante de toute règle, s'applique aussi aux trésors. Il le
-- crédite par les journaux, comme tout compte.
drop trigger if exists accounts_treasury_guard on game.accounts;
create trigger accounts_treasury_guard before insert on game.accounts
  for each row when (new.kind = 'treasury') execute function game.guard_system_account();
