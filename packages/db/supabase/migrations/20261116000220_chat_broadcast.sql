-- Diffusion des messages par Realtime (docs/specs/06-cites-politique-communaute.md, 6.6 ; ADR 0008 ; ticket 274).
-- Seule la base diffuse : un message validé l'est sur le sujet de son canal (cité) ou de chacune des deux
-- maisons (conversation privée), en canal privé, avec ses seuls identifiants. Un joueur ne s'abonne qu'aux
-- sujets des canaux qu'il lit et de ses maisons ; aucun client n'écrit dans `realtime.messages`.
-- Rejouable (`create or replace`, déclencheur et règles recréés, droits redonnés) ; le code précédent n'en
-- dépend pas. Sans le schéma de Realtime (pile sans Realtime), le déclencheur ne diffuse rien et les règles
-- ne sont pas écrites : les canaux privés restent fermés, ce qui est sûr ; rejouer la migration une fois
-- Realtime en place (infra/README.md).

-- Sujets que le compte connecté peut écouter : `chat:<canal>` pour chaque canal qu'il lit (migration 91) et
-- `house:<maison>` pour chacune de ses maisons, où arrivent ses conversations privées. Exécutée au nom de
-- l'appelant : elle ne lit que par deux fonctions déjà accordées aux joueurs.
create or replace function game.readable_realtime_topics() returns setof text
language sql stable
set search_path = ''
as $$
  select 'chat:' || id::text from game.readable_channel_ids() id
  union all
  select 'house:' || id::text from game.current_house_ids() id;
$$;
revoke all on function game.readable_realtime_topics() from public, anon, oikos_service;
grant execute on function game.readable_realtime_topics() to authenticated;

-- Diffusion d'un message écrit, au nom du propriétaire (seul à pouvoir écrire dans `realtime.messages`).
-- `realtime.send` écrit dans une sous-transaction et ne rend qu'un avertissement en cas d'échec : le message
-- est écrit même si la diffusion échoue. Realtime lit ses lignes par réplication logique, donc à la validation
-- seulement. Ni le texte ni l'auteur : le client relit par `channel_messages`, sous règles par ligne.
create or replace function game.broadcast_message() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  channel game.channels;
  payload jsonb;
begin
  if tg_relid <> 'game.messages'::regclass then
    raise exception '% only runs on game.messages', tg_name using errcode = 'insufficient_privilege';
  end if;
  if pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return null;
  end if;
  select * into channel from game.channels c where c.id = new.channel_id;
  payload := pg_catalog.jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id);
  if channel.kind = 'city' then
    perform realtime.send(payload, 'message_posted', 'chat:' || new.channel_id::text, true);
  else
    perform realtime.send(payload, 'message_posted', 'house:' || channel.house_low::text, true);
    perform realtime.send(payload, 'message_posted', 'house:' || channel.house_high::text, true);
  end if;
  return null;
end;
$$;
revoke execute on function game.broadcast_message() from public, anon, authenticated, oikos_service;
drop trigger if exists messages_broadcast on game.messages;
create trigger messages_broadcast after insert on game.messages
  for each row execute function game.broadcast_message();

-- Règles de `realtime.messages`, que Realtime consulte au nom du joueur à l'abonnement d'un canal privé
-- (lecture : il peut écouter ; écriture : il peut diffuser). Lecture des seuls sujets du joueur, pour la
-- diffusion et non la présence ; règles restrictives : aucune écriture d'un client, quelles que soient les
-- règles permissives ajoutées plus tard.
do $$
begin
  if pg_catalog.to_regclass('realtime.messages') is null then
    raise warning 'realtime.messages is missing: Realtime subscriptions stay closed until this migration is replayed';
    return;
  end if;
  drop policy if exists chat_listen on realtime.messages;
  create policy chat_listen on realtime.messages for select to authenticated
    using (extension = 'broadcast' and topic in (select game.readable_realtime_topics()));
  drop policy if exists no_client_insert on realtime.messages;
  create policy no_client_insert on realtime.messages as restrictive for insert to anon, authenticated
    with check (false);
  drop policy if exists no_client_update on realtime.messages;
  create policy no_client_update on realtime.messages as restrictive for update to anon, authenticated
    using (false) with check (false);
  drop policy if exists no_client_delete on realtime.messages;
  create policy no_client_delete on realtime.messages as restrictive for delete to anon, authenticated
    using (false);
end $$;
