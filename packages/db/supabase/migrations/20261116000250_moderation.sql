-- Modération, côté joueur (docs/specs/15-back-office-olympe.md, 15.1 ; 18, contenus ; 13, sanctions graduées ;
-- ticket 275) : signalements des messages, sanctions des comptes et leurs appels. Les commandes d'administration
-- (prononcer, lever, valider une sanction, traiter un signalement, masquer un message) viennent avec #276, les
-- lectures des joueurs avec la migration 251.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs et règles recréés, vues créées sous condition,
-- droits redonnés) ; le code précédent ne lit ni n'écrit ces tables, et la purge des messages (migration 92)
-- reste permise : un signalement perd alors son message, pas sa ligne.

-- Signalement : le message, la maison qui l'a écrit, celle qui le signale, le motif (un identifiant de
-- `moderation.reportReasons`) et l'état, ouvert à l'écriture. À la purge du message, `message_id` devient nul.
create table if not exists game.reports (
  id uuid primary key default game.uuid_v7(),
  message_id uuid references game.messages (id) on delete set null,
  reported_house_id uuid not null references game.houses (id),
  house_id uuid not null references game.houses (id),
  reason text not null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  constraint reports_state_known check (state in ('open', 'dismissed', 'upheld')),
  constraint reports_reason_shape check (reason ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint reports_not_own check (house_id <> reported_house_id),
  constraint reports_one_per_house unique (message_id, house_id)
);
create index if not exists reports_house_id_idx on game.reports (house_id);
create index if not exists reports_open_idx on game.reports (created_at) where state = 'open';

-- Sanction d'un compte, tous mondes confondus. Un avertissement, un silence et une suspension ont une fin ; une
-- exclusion n'en a pas, et n'est en vigueur qu'une fois validée par une seconde personne (15.4). L'appel du
-- compte se garde sur la ligne : son texte et son instant, posé par la base.
create table if not exists admin.sanctions (
  id uuid primary key default game.uuid_v7(),
  user_id uuid not null references auth.users (id),
  kind text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reason text not null,
  author_id uuid not null references auth.users (id),
  validated_by uuid references auth.users (id),
  appeal_body text,
  appealed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sanctions_kind_known check (kind in ('warning', 'silence', 'suspension', 'ban')),
  constraint sanctions_end_unless_ban check ((kind = 'ban') = (ends_at is null)),
  constraint sanctions_ends_after_start check (ends_at > starts_at),
  constraint sanctions_reason_length check (char_length(reason) between 1 and 2000 and reason ~ '[^[:space:]]'),
  constraint sanctions_not_self check (author_id <> user_id),
  constraint sanctions_validated_by_other check (validated_by <> author_id and validated_by <> user_id),
  constraint sanctions_appeal_dated check ((appeal_body is null) = (appealed_at is null)),
  constraint sanctions_appeal_length check (char_length(appeal_body) between 1 and 2000 and appeal_body ~ '[^[:space:]]')
);
create index if not exists sanctions_user_starts_idx on admin.sanctions (user_id, starts_at);

-- Un signalement s'écrit maintenant, ouvert, sur un message non masqué d'une autre maison, par une maison qui lit
-- son canal (celui de sa cité, ou sa conversation privée), et désigne la maison qui l'a écrit. Ensuite, seul le
-- départ de son message à la purge le change (réglage local de la purge, migration 92).
create or replace function game.guard_report() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  message game.messages;
  channel game.channels;
begin
  if tg_op = 'UPDATE' then
    if new.message_id is null and old.message_id is not null
       and pg_catalog.current_setting('oikos.message_purge', true) = 'on'
       and (new.id, new.reported_house_id, new.house_id, new.reason, new.state, new.created_at)
           is not distinct from (old.id, old.reported_house_id, old.house_id, old.reason, old.state, old.created_at) then
      return new;
    end if;
    raise exception 'a report is immutable' using errcode = 'restrict_violation';
  end if;
  if new.created_at is distinct from now() or new.state <> 'open' then
    raise exception 'a report is filed now, open' using errcode = 'restrict_violation';
  end if;
  select * into message from game.messages m where m.id = new.message_id;
  if not found then
    raise exception 'a report is filed on an existing message'
      using errcode = 'check_violation', constraint = 'reports_message_exists';
  end if;
  if message.hidden_at is not null then
    raise exception 'only a visible message is reported'
      using errcode = 'check_violation', constraint = 'reports_message_visible';
  end if;
  if new.reported_house_id is distinct from message.house_id then
    raise exception 'a report names the house that wrote the message'
      using errcode = 'check_violation', constraint = 'reports_names_author';
  end if;
  select * into channel from game.channels c where c.id = message.channel_id;
  if (channel.kind = 'city' and not exists (
        select 1 from game.citizenships z where z.house_id = new.house_id and z.city_id = channel.city_id))
     or (channel.kind = 'direct' and not exists (
        select 1 from game.channel_members m where m.channel_id = channel.id and m.house_id = new.house_id)) then
    raise exception 'a house only reports a message it reads'
      using errcode = 'check_violation', constraint = 'reports_reader';
  end if;
  return new;
end;
$$;

-- Une sanction s'écrit maintenant, sans appel. Ensuite, seul l'appel s'y ajoute, une fois : son instant est
-- celui de la transaction qui l'écrit, posé ici, et la sanction doit être encore en vigueur.
create or replace function admin.guard_sanction() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.appeal_body is not null or new.appealed_at is not null then
      raise exception 'a sanction is pronounced now, without appeal' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if (new.id, new.user_id, new.kind, new.starts_at, new.ends_at, new.reason, new.author_id, new.validated_by,
      new.created_at)
     is distinct from (old.id, old.user_id, old.kind, old.starts_at, old.ends_at, old.reason, old.author_id,
      old.validated_by, old.created_at)
     or old.appeal_body is not null or new.appeal_body is null then
    raise exception 'a sanction only takes one appeal' using errcode = 'restrict_violation';
  end if;
  if now() >= coalesce(old.ends_at, 'infinity') then
    raise exception 'an ended sanction is not appealed'
      using errcode = 'check_violation', constraint = 'sanctions_appeal_in_force';
  end if;
  new.appealed_at := now();
  return new;
end;
$$;
revoke execute on function game.guard_report(), admin.guard_sanction()
  from public, anon, authenticated, oikos_service;
drop trigger if exists reports_guard on game.reports;
create trigger reports_guard before insert or update on game.reports
  for each row execute function game.guard_report();
drop trigger if exists sanctions_guard on admin.sanctions;
create trigger sanctions_guard before insert or update on admin.sanctions
  for each row execute function admin.guard_sanction();

-- Droits du service : il écrit un signalement sans en choisir ni l'identifiant, ni l'état, ni la date ; il lit
-- les sanctions (relues à chaque commande) et n'y écrit que le texte d'un appel. Rien d'autre. Les joueurs n'ont
-- encore aucun droit : leurs lectures viennent avec la migration 251.
alter table game.reports enable row level security;
alter table admin.sanctions enable row level security;
revoke all on game.reports, admin.sanctions from public, anon, authenticated, oikos_service;
grant select on game.reports, admin.sanctions to oikos_service;
grant insert (message_id, reported_house_id, house_id, reason) on game.reports to oikos_service;
grant update (appeal_body) on admin.sanctions to oikos_service;
drop policy if exists service_all on game.reports;
create policy service_all on game.reports for all to oikos_service using (true) with check (true);
drop policy if exists service_all on admin.sanctions;
create policy service_all on admin.sanctions for all to oikos_service using (true) with check (true);
