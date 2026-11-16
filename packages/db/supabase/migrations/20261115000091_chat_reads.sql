-- Lectures de la discussion par les joueurs (docs/specs/06-cites-politique-communaute.md, 6.6 ; ticket 273).
-- Un joueur lit le canal de la cité de sa maison (métèque ou citoyenne) et ses conversations privées, rien
-- d'autre ; d'un message masqué, il lit qu'il l'est, jamais son texte.
-- Rejouable (`create or replace`, règles recréées, vues créées sous condition, droits redonnés) ; le code
-- précédent ne lit ni ces fonctions ni ces vues.

-- Canaux lisibles par le compte connecté : celui de la cité de chacune de ses maisons, et ses conversations
-- privées. Exécutée au nom du propriétaire, comme `current_house_ids` : elle ne lit les citoyennetés et les
-- membres que pour ce compte, et ne rend que des identifiants de canaux.
create or replace function game.readable_channel_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select ch.id from game.channels ch
  join game.citizenships z on z.city_id = ch.city_id
  where z.house_id in (select game.current_house_ids())
  union
  select m.channel_id from game.channel_members m
  where m.house_id in (select game.current_house_ids());
$$;
revoke all on function game.readable_channel_ids() from public, anon, oikos_service;
grant execute on function game.readable_channel_ids() to authenticated;

-- Règles par ligne et colonnes accordées une à une : du message, le texte visible seulement (`visible_body`,
-- nul une fois masqué), jamais le texte original (`body`) ; des membres, rien.
drop policy if exists channels_read on game.channels;
create policy channels_read on game.channels for select to authenticated
  using (id in (select game.readable_channel_ids()));
drop policy if exists messages_read on game.messages;
create policy messages_read on game.messages for select to authenticated
  using (channel_id in (select game.readable_channel_ids()));
grant select (id, world_id, kind, city_id, house_low, house_high, created_at) on game.channels to authenticated;
grant select (id, channel_id, house_id, visible_body, created_at, hidden_at) on game.messages to authenticated;

-- Vues créées sous condition (ADR 0006) : l'onglet Messages (#274) pourra les étendre sans que le rejeu de
-- cette migration échoue. `other_house_id` : l'autre maison d'une conversation privée, nulle pour une cité.
do $$
begin
  if to_regclass('public.my_channels') is null then
    create view public.my_channels with (security_invoker = true) as
      select c.id, c.world_id, c.kind, c.city_id,
             case when c.kind = 'direct' then
               case when c.house_low in (select game.current_house_ids()) then c.house_high else c.house_low end
             end as other_house_id,
             c.created_at
      from game.channels c;
  end if;
  if to_regclass('public.channel_messages') is null then
    create view public.channel_messages with (security_invoker = true) as
      select m.id, m.channel_id, m.house_id, m.visible_body as body, m.created_at, m.hidden_at
      from game.messages m;
  end if;
end $$;
grant select on public.my_channels, public.channel_messages to authenticated;
