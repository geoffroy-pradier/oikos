-- Masquage d'un message diffusé en temps réel (ADR 0008, ticket 532).
-- Le masquage d'un message est diffusé sur les mêmes sujets que sa création, sous l'événement `message_hidden`,
-- avec les seuls identifiants (canal, message) : jamais le texte. Le client relit alors le message par la vue
-- `channel_messages`, sous règles par ligne, qui ne rend plus son texte.
-- Rejouable (`create or replace`, déclencheur recréé) ; le code précédent n'en dépend pas : il ignore l'événement.
-- Sans le schéma de Realtime, le déclencheur ne diffuse rien.

create or replace function game.broadcast_message() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  channel game.channels;
  payload jsonb;
  event text;
begin
  if tg_relid <> 'game.messages'::regclass then
    raise exception '% only runs on game.messages', tg_name using errcode = 'insufficient_privilege';
  end if;
  if pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return null;
  end if;
  event := case tg_op when 'INSERT' then 'message_posted' else 'message_hidden' end;
  select * into channel from game.channels c where c.id = new.channel_id;
  payload := pg_catalog.jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id);
  if channel.kind = 'city' then
    perform realtime.send(payload, event, 'chat:' || new.channel_id::text, true);
  else
    perform realtime.send(payload, event, 'house:' || channel.house_low::text, true);
    perform realtime.send(payload, event, 'house:' || channel.house_high::text, true);
  end if;
  return null;
end;
$$;
revoke execute on function game.broadcast_message() from public, anon, authenticated, oikos_service;

drop trigger if exists messages_broadcast_hidden on game.messages;
create trigger messages_broadcast_hidden after update of hidden_at on game.messages
  for each row when (old.hidden_at is null and new.hidden_at is not null)
  execute function game.broadcast_message();
