-- File de la modération, lue par Olympe (docs/specs/15-back-office-olympe.md, 15.1, 15.4 ; ticket 276) par la route
-- `GET /api/admin/reports` de l'API, sous le rôle de service. Exécutée au nom de l'appelant, et accordée au seul
-- service : un modérateur, qui peut être un joueur bénévole, n'en lit rien par Supabase, et elle ne rend que des
-- signalements, les messages signalés, leur contexte, les appels à trancher et les exclusions à valider, jamais une
-- donnée économique. Rejouable (`create or replace`, droits redonnés) ; le code précédent ne l'appelle pas.

-- Instant en ISO 8601, à la milliseconde, en UTC : la forme des autres lectures de l'API.
create or replace function admin.iso_instant(at timestamptz) returns text
language sql immutable
set search_path = ''
as $$
  select pg_catalog.to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- File : une entrée par message qui a des signalements ouverts (un signalement dont la purge a emporté le message
-- fait son entrée seul), la plus ancienne d'abord, puis la plus signalée ; au plus `max_entries` entrées. Chacune
-- porte la maison signalée et son compte (pour le sanctionner), le message, même masqué, ses signalements ouverts
-- (motif et date, jamais la maison qui signale) et les `context_size` messages qui le précèdent et qui le suivent
-- dans son canal. Puis les appels à trancher et les exclusions à valider, les plus anciens d'abord.
create or replace function admin.moderation_queue(context_size integer, max_entries integer) returns jsonb
language sql stable
set search_path = ''
as $$
  with entries as (
    select r.message_id, r.reported_house_id, min(r.created_at) as first_at, count(*) as n, min(r.id::text) as key,
           jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'createdAt', admin.iso_instant(r.created_at))
                     order by r.created_at, r.id) as reports
    from game.reports r
    where r.state = 'open'
    group by coalesce(r.message_id, r.id), r.message_id, r.reported_house_id
    order by first_at, n desc, key
    limit greatest(max_entries, 0)
  )
  select jsonb_build_object(
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object(
          'world', w.slug,
          'reportedHouse', jsonb_build_object('id', h.id, 'name', h.name, 'userId', h.user_id),
          'channel', case when m.id is not null then jsonb_build_object('id', c.id, 'kind', c.kind, 'city', ci.slug) end,
          'message', case when m.id is not null then jsonb_build_object('id', m.id, 'houseId', m.house_id,
            'houseName', h.name, 'body', m.body, 'createdAt', admin.iso_instant(m.created_at),
            'hiddenAt', admin.iso_instant(m.hidden_at)) end,
          'reports', e.reports,
          'context', coalesce(around.messages, '[]'::jsonb))
        order by e.first_at, e.n desc, e.key)
      from entries e
      join game.houses h on h.id = e.reported_house_id
      join game.worlds w on w.id = h.world_id
      left join game.messages m on m.id = e.message_id
      left join game.channels c on c.id = m.channel_id
      left join game.cities ci on ci.id = c.city_id
      left join lateral (
        select jsonb_agg(jsonb_build_object('id', x.id, 'houseId', x.house_id, 'houseName', xh.name, 'body', x.body,
                 'createdAt', admin.iso_instant(x.created_at), 'hiddenAt', admin.iso_instant(x.hidden_at))
               order by x.created_at, x.id) as messages
        from (
          (select b.id, b.house_id, b.body, b.created_at, b.hidden_at from game.messages b
           where b.channel_id = m.channel_id and (b.created_at, b.id) < (m.created_at, m.id)
           order by b.created_at desc, b.id desc limit greatest(context_size, 0))
          union all
          (select a.id, a.house_id, a.body, a.created_at, a.hidden_at from game.messages a
           where a.channel_id = m.channel_id and (a.created_at, a.id) > (m.created_at, m.id)
           order by a.created_at, a.id limit greatest(context_size, 0))
        ) x
        join game.houses xh on xh.id = x.house_id
      ) around on true), '[]'::jsonb),
    'appeals', coalesce((
      select jsonb_agg(jsonb_build_object('sanctionId', s.id, 'userId', s.user_id, 'kind', s.kind, 'reason', s.reason,
               'startsAt', admin.iso_instant(s.starts_at), 'endsAt', admin.iso_instant(s.ends_at),
               'authorId', s.author_id, 'appealBody', s.appeal_body, 'appealedAt', admin.iso_instant(s.appealed_at))
             order by s.appealed_at, s.id)
      from (select * from admin.sanctions p where p.appeal_body is not null and p.appeal_decision is null
            order by p.appealed_at, p.id limit greatest(max_entries, 0)) s), '[]'::jsonb),
    'pendingExclusions', coalesce((
      select jsonb_agg(jsonb_build_object('sanctionId', s.id, 'userId', s.user_id, 'reason', s.reason,
               'authorId', s.author_id, 'proposedAt', admin.iso_instant(s.created_at))
             order by s.created_at, s.id)
      from (select * from admin.sanctions p where p.kind = 'ban' and p.validated_by is null and p.lifted_at is null
            order by p.created_at, p.id limit greatest(max_entries, 0)) s), '[]'::jsonb));
$$;
revoke all on function admin.iso_instant(timestamptz), admin.moderation_queue(integer, integer)
  from public, anon, authenticated;
grant execute on function admin.iso_instant(timestamptz), admin.moderation_queue(integer, integer)
  to oikos_service;
