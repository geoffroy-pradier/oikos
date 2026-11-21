-- File de la modération avec le pré-tri de l'IA (docs/specs/15-back-office-olympe.md, 15.1, 15.4 ; 08-ia.md, 8.1 ; ticket
-- 763). Même fonction que la migration 261, même forme rendue (`jsonb`), une clé de plus par entrée : `triage`, la catégorie et
-- le résumé que le pré-tri a rangés pour le message (`game.report_triage`), nuls sans pré-tri. L'ordre de la file change : les
-- violations probables d'abord, puis les messages douteux, puis ceux sans catégorie (IA coupée, sortie rejetée, pas encore
-- essayés : une catégorie manquante ne vaut ni « infondé » ni « grave »), puis les probablement infondés ; dans chacun,
-- l'ordre de la phase 2 (le plus ancien signalement, puis le plus signalé). Sans aucune catégorie, l'ordre est exactement
-- celui de la phase 2. La catégorie ne sert qu'à cet ordre et à l'affichage : c'est la seule fonction qui lit
-- `game.report_triage`, et aucune commande de sanction ne la lit (test pgTAP 763).
-- Rejouable (`create or replace`, droits redonnés) ; le code précédent ignore la clé ajoutée.

create or replace function admin.moderation_queue(context_size integer, max_entries integer) returns jsonb
language sql stable
set search_path = ''
as $$
  with entries as (
    select r.message_id, r.reported_house_id, min(r.created_at) as first_at, count(*) as n, min(r.id::text) as key,
           t.category, t.summary,
           case t.category when 'likely_violation' then 0 when 'doubtful' then 1 when 'likely_unfounded' then 3 else 2 end as triage_rank,
           jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'createdAt', admin.iso_instant(r.created_at))
                     order by r.created_at, r.id) as reports
    from game.reports r
    left join game.report_triage t on t.message_id = r.message_id
    where r.state = 'open'
    group by coalesce(r.message_id, r.id), r.message_id, r.reported_house_id, t.category, t.summary
    order by triage_rank, first_at, n desc, key
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
          'triage', case when e.category is not null then jsonb_build_object('category', e.category, 'summary', e.summary) end,
          'context', coalesce(around.messages, '[]'::jsonb))
        order by e.triage_rank, e.first_at, e.n desc, e.key)
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
revoke all on function admin.moderation_queue(integer, integer) from public, anon, authenticated;
grant execute on function admin.moderation_queue(integer, integer) to oikos_service;
