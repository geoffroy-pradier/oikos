-- Discussion : canaux de cité, conversations privées et messages (docs/specs/06-cites-politique-communaute.md,
-- 6.6 ; ticket 273). En phase 2, un canal par cité, où écrit toute maison de la cité (métèque ou citoyenne),
-- et des conversations privées entre deux maisons d'un même monde. Les lectures des joueurs viennent avec la
-- migration 91, la purge des messages avec la migration 92.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés, `on conflict do nothing`) ;
-- le code précédent ne lit ni n'écrit ces tables.

-- Canal : celui d'une cité (`city_id`), ou la conversation privée de deux maisons, rangées dans l'ordre
-- (`house_low` < `house_high`) pour qu'une paire n'ait qu'une conversation, quel que soit qui l'ouvre.
create table if not exists game.channels (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  kind text not null default 'direct' check (kind in ('city', 'direct')),
  city_id uuid,
  house_low uuid,
  house_high uuid,
  created_at timestamptz not null default now(),
  constraint channels_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint channels_low_same_world foreign key (house_low, world_id) references game.houses (id, world_id),
  constraint channels_high_same_world foreign key (house_high, world_id) references game.houses (id, world_id),
  -- Une maison ne converse pas avec elle-même : l'ordre strict l'exclut.
  constraint channels_shape check (
    (kind = 'city' and city_id is not null and house_low is null and house_high is null)
    or (kind = 'direct' and city_id is null and house_low is not null and house_high is not null and house_low < house_high)),
  constraint channels_one_per_city unique (city_id),
  constraint channels_one_per_pair unique (house_low, house_high)
);
create index if not exists channels_house_high_idx on game.channels (house_high);

-- Membres d'une conversation privée : ses deux maisons, inscrites par la base à la création du canal. Le canal
-- d'une cité n'a pas de membres : ce sont les maisons de la cité, lues dans `citizenships`.
create table if not exists game.channel_members (
  channel_id uuid not null references game.channels (id),
  house_id uuid not null references game.houses (id),
  joined_at timestamptz not null default now(),
  primary key (channel_id, house_id)
);
create index if not exists channel_members_house_id_idx on game.channel_members (house_id);

-- Message : son canal, la maison qui l'écrit, son texte, sa date et l'instant où la modération l'a masqué.
-- `visible_body` est le texte tant que le message n'est pas masqué, nul ensuite : c'est la seule colonne de
-- texte que les joueurs lisent (migration 91), si bien qu'un message masqué ne rend plus son texte, à personne
-- d'autre que l'administration. Plafond technique de la longueur : `chat.maxMessageLength` (packages/config),
-- vérifié par la commande, ne le dépasse jamais.
create table if not exists game.messages (
  id uuid primary key default game.uuid_v7(),
  channel_id uuid not null references game.channels (id),
  house_id uuid not null references game.houses (id),
  body text not null,
  visible_body text generated always as (case when hidden_at is null then body end) stored,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  constraint messages_body_length check (char_length(body) between 1 and 2000),
  constraint messages_body_not_blank check (body ~ '[^[:space:]]')
);
create index if not exists messages_channel_created_idx on game.messages (channel_id, created_at desc, id desc);
create index if not exists messages_house_created_idx on game.messages (house_id, created_at);
create index if not exists messages_created_at_idx on game.messages (created_at);

-- Un canal naît maintenant et ne change plus. Le service ne crée que des conversations privées : il n'écrit
-- ni le type ni la cité (droits ci-dessous), et le type par défaut exige une paire de maisons.
create or replace function game.guard_channel() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a channel is immutable' using errcode = 'restrict_violation';
  end if;
  if new.created_at is distinct from now() then
    raise exception 'a channel is opened now' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Un membre est l'une des deux maisons de sa conversation privée, inscrit maintenant ; il ne change plus.
create or replace function game.guard_channel_member() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a channel member is immutable' using errcode = 'restrict_violation';
  end if;
  if new.joined_at is distinct from now() then
    raise exception 'a channel member joins now' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from game.channels c
                 where c.id = new.channel_id and c.kind = 'direct' and new.house_id in (c.house_low, c.house_high)) then
    raise exception 'only the two houses of a direct channel are its members' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Un message est écrit maintenant, non masqué, par une maison de la cité du canal (métèque ou citoyenne) ou
-- par un membre de la conversation privée. Ensuite, seul son masquage change, une fois, daté de la
-- transaction qui l'écrit. Il ne se supprime que par la purge de la conservation (migration 92), qui pose un
-- réglage local le temps de sa suppression ; le réglage seul ne donne rien sans le droit DELETE, que seul
-- le propriétaire a.
create or replace function game.guard_message() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  channel game.channels;
begin
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting('oikos.message_purge', true) = 'on' then
      return old;
    end if;
    raise exception 'a message is only removed by the retention purge' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'TRUNCATE' then
    raise exception 'game.messages is only purged by retention' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.channel_id, new.house_id, new.body, new.created_at)
       is distinct from (old.id, old.channel_id, old.house_id, old.body, old.created_at) then
      raise exception 'a message is immutable, except for its hiding' using errcode = 'restrict_violation';
    end if;
    if new.hidden_at is distinct from old.hidden_at
       and (old.hidden_at is not null or new.hidden_at is distinct from now()) then
      raise exception 'a message is hidden once, now' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if new.created_at is distinct from now() or new.hidden_at is not null then
    raise exception 'a message is posted now, visible' using errcode = 'restrict_violation';
  end if;
  select * into channel from game.channels c where c.id = new.channel_id;
  if not found
     or (channel.kind = 'city' and not exists (
           select 1 from game.citizenships z where z.house_id = new.house_id and z.city_id = channel.city_id))
     or (channel.kind = 'direct' and not exists (
           select 1 from game.channel_members m where m.channel_id = channel.id and m.house_id = new.house_id)) then
    raise exception 'a house only writes in its city channel and its own conversations'
      using errcode = 'check_violation', constraint = 'messages_author_member';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_channel(), game.guard_channel_member(), game.guard_message()
  from public, anon, authenticated, oikos_service;
drop trigger if exists channels_guard on game.channels;
create trigger channels_guard before insert or update on game.channels
  for each row execute function game.guard_channel();
drop trigger if exists channel_members_guard on game.channel_members;
create trigger channel_members_guard before insert or update on game.channel_members
  for each row execute function game.guard_channel_member();
drop trigger if exists messages_guard on game.messages;
create trigger messages_guard before insert or update or delete on game.messages
  for each row execute function game.guard_message();
drop trigger if exists messages_no_truncate on game.messages;
create trigger messages_no_truncate before truncate on game.messages
  for each statement execute function game.guard_message();

-- Le canal d'une cité naît avec elle, comme son trésor (migration 20) ; une conversation privée inscrit ses
-- deux maisons. Exécutées au nom du propriétaire, et seulement sur leur table.
create or replace function game.create_city_channel() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.cities'::regclass then
    raise exception '% only runs on game.cities', tg_name using errcode = 'insufficient_privilege';
  end if;
  insert into game.channels (world_id, kind, city_id) values (new.world_id, 'city', new.id)
    on conflict do nothing;
  return null;
end;
$$;
create or replace function game.create_direct_channel_members() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_relid <> 'game.channels'::regclass then
    raise exception '% only runs on game.channels', tg_name using errcode = 'insufficient_privilege';
  end if;
  if new.kind = 'direct' then
    insert into game.channel_members (channel_id, house_id) values (new.id, new.house_low), (new.id, new.house_high);
  end if;
  return null;
end;
$$;
revoke execute on function game.create_city_channel(), game.create_direct_channel_members()
  from public, anon, authenticated, oikos_service;
drop trigger if exists cities_channel on game.cities;
create trigger cities_channel after insert on game.cities
  for each row execute function game.create_city_channel();
drop trigger if exists channels_members on game.channels;
create trigger channels_members after insert on game.channels
  for each row execute function game.create_direct_channel_members();
-- Cités existantes.
insert into game.channels (world_id, kind, city_id)
select c.world_id, 'city', c.id from game.cities c
on conflict do nothing;

-- Droits du service : il ouvre une conversation privée (deux maisons) et écrit un message, sans en choisir ni
-- l'identifiant, ni la date, ni le masquage ; il ne modifie ni ne supprime rien. Les joueurs n'ont encore aucun
-- droit : leurs lectures viennent avec la migration 91.
alter table game.channels enable row level security;
alter table game.channel_members enable row level security;
alter table game.messages enable row level security;
revoke all on game.channels, game.channel_members, game.messages from public, anon, authenticated, oikos_service;
grant select on game.channels, game.channel_members, game.messages to oikos_service;
grant insert (world_id, house_low, house_high) on game.channels to oikos_service;
grant insert (channel_id, house_id, body) on game.messages to oikos_service;
drop policy if exists service_all on game.channels;
create policy service_all on game.channels for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.channel_members;
create policy service_all on game.channel_members for all to oikos_service using (true) with check (true);
drop policy if exists service_all on game.messages;
create policy service_all on game.messages for all to oikos_service using (true) with check (true);
