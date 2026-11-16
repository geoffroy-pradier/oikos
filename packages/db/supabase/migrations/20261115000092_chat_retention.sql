-- Conservation limitée des messages (docs/specs/18-indicateurs-risques-conformite.md, contenus ; ADR 0002 ;
-- ticket 273). Le moteur supprime les messages écrits avant un instant, au-delà de la conservation de la
-- configuration (`chat.retentionDays`), par cette fonction du propriétaire : `messages` n'admet aucune autre
-- suppression (garde de la migration 90). Rejouable (`create or replace`, droits redonnés) ; le code précédent
-- ne l'appelle pas.

-- Supprime les messages écrits avant `before` et rend leur nombre. Borne technique, comme pour la télémétrie
-- (migration 41) : jamais un message de moins d'un jour, ce qui couvre aussi la plus longue fenêtre de débit de
-- la discussion (un jour). Le réglage local n'ouvre la garde que le temps de la suppression.
create or replace function game.purge_messages(before timestamptz) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged bigint;
begin
  if before is null or before > pg_catalog.clock_timestamp() - interval '1 day' then
    raise exception 'messages younger than one day cannot be purged'
      using errcode = 'check_violation', constraint = 'messages_purge_keeps_one_day';
  end if;
  perform pg_catalog.set_config('oikos.message_purge', 'on', true);
  delete from game.messages m where m.created_at < before;
  get diagnostics purged = row_count;
  perform pg_catalog.set_config('oikos.message_purge', 'off', true);
  return purged;
end;
$$;
revoke execute on function game.purge_messages(timestamptz) from public, anon, authenticated;
grant execute on function game.purge_messages(timestamptz) to oikos_service;
