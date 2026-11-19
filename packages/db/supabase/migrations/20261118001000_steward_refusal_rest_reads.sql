-- Repos d'une règle refusée, lu par le client (docs/specs/04-systemes-gestion.md, 4.4 ; ticket 640). Une règle refusée
-- se repose `stewards.refusalRestTicks` ticks sous la révision du refus (#621) : la fiche du site annonce quand elle
-- sera retentée. Il lui faut la révision des règles de chaque opération et la durée du tick.
-- Rejouable (`create or replace`, droits redonnés) ; le client précédent lit les mêmes colonnes, et ignore une clé
-- nouvelle de `sites`.

-- La vue de la migration 340, et une colonne en fin de liste : la révision des règles sous laquelle l'opération a été
-- menée. Créée sous condition en migration 340 (ADR 0006) : son rejeu ne la recrée pas, et celle-ci la redéfinit à
-- l'identique. La colonne de la table est déjà accordée aux joueurs, sous la règle `steward_operations_read_own`.
create or replace view public.my_steward_operations with (security_invoker = true) as
  select s.id as steward_id, s.site_id, o.tick_index, o.rank, o.created_at, o.status, o.error_code, o.summary,
         r.kind, r.good_id, o.rules_revision
  from game.stewards s
  cross join lateral (
    (select o.tick_index, o.rank, o.rules_revision, o.rule_position, o.created_at, o.status, o.error_code, o.summary
     from game.steward_operations o where o.steward_id = s.id order by o.tick_index desc, o.rank desc limit 5)
    union
    (select o.tick_index, o.rank, o.rules_revision, o.rule_position, o.created_at, o.status, o.error_code, o.summary
     from game.steward_operations o where o.steward_id = s.id and o.status = 'rejected'
     order by o.tick_index desc, o.rank desc limit 1)
  ) o
  join game.steward_rules r
    on r.steward_id = s.id and r.revision = o.rules_revision and r.position = o.rule_position
  where s.dismissed_at is null;
-- Les droits par défaut de Supabase donnent tout à `service_role` sur une vue de `public` : l'API ne lit pas celle-ci.
revoke all on public.my_steward_operations from public, anon, authenticated, oikos_service, service_role;
grant select on public.my_steward_operations to authenticated;

-- La fonction des migrations 18, 61 et 271, à forme égale (ADR 0006), et une clé de plus dans la colonne `sites` :
-- `clock`, la seule durée du tick (`clock.tickMinutes`), qui ne change pas d'une version à l'autre (#123). Le client en
-- déduit l'heure d'un tick, rang de l'intervalle depuis l'époque Unix (migration 7). Comme `staff` et `stewards`, la
-- clé n'est ajoutée que si `sites` est un objet : une version publiée avant la section n'a pas d'intendants.
create or replace function game.site_rules() returns table (recipes jsonb, sites jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'recipes',
         case when jsonb_typeof(v.payload -> 'sites') = 'object'
           then (v.payload -> 'sites')
             || case when v.payload ? 'staff'
                  then jsonb_build_object('staff', v.payload -> 'staff') else '{}'::jsonb end
             || case when jsonb_typeof(v.payload -> 'stewards') = 'object'
                  then jsonb_build_object('stewards', (v.payload -> 'stewards') - 'names') else '{}'::jsonb end
             || case when jsonb_typeof(v.payload -> 'clock' -> 'tickMinutes') = 'number'
                  then jsonb_build_object('clock', jsonb_build_object('tickMinutes', v.payload -> 'clock' -> 'tickMinutes'))
                  else '{}'::jsonb end
           else v.payload -> 'sites'
         end
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.site_rules() from public;
grant execute on function game.site_rules() to authenticated;
