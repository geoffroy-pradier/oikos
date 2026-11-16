-- Décrets de taux appliqués (docs/specs/05-economie.md, 5.3 et 5.6 ; 06-cites-politique-communaute.md, 6.3 ;
-- ticket 262). Un décret adopté de taux de la taxe de marché ou de coefficient du droit de port passe une fois à
-- l'état `applied`, daté par la base, à la clôture qui le trouve adopté. Le taux en vigueur d'une cité est celui
-- de son dernier décret appliqué, borné par le monde, sinon celui de la configuration : une seule fonction le
-- calcule (`game.city_rates`), pour le service comme pour la lecture des joueurs (`public.city_rates`).
-- Rejouable ; le code précédent n'écrit pas `applied_at`, ne passe aucun décret à `applied` et ne lit ni la
-- fonction ni la vue. Les décrets de dépense (grands travaux, fête) restent adoptés : leurs effets viennent
-- avec #263, qui ouvrira la garde à leur modèle.

alter table game.decrees add column if not exists applied_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'game.decrees'::regclass and conname = 'decrees_applied') then
    alter table game.decrees add constraint decrees_applied check ((status = 'applied') = (applied_at is not null));
  end if;
end $$;
-- Décrets adoptés d'un monde (application), décrets appliqués d'une cité et d'un modèle, du plus récent.
create index if not exists decrees_world_adopted_idx on game.decrees (world_id) where status = 'adopted';
create index if not exists decrees_city_applied_idx on game.decrees (city_id, model, applied_at desc)
  where status = 'applied';
-- Un décret n'est annoncé appliqué qu'une fois, même si l'étape qui l'applique était jouée deux fois.
create unique index if not exists domain_events_decree_applied_once on game.domain_events ((payload ->> 'decreeId'))
  where type = 'DecreeApplied';

-- Garde des décrets (migration 130), plus une transition : un décret adopté de taux passe à `applied` une fois,
-- maintenant, sans rien changer d'autre. `applied` est un état final ; un décret de dépense n'y passe pas encore.
create or replace function game.guard_decree() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  votes_for integer;
  votes_against integer;
  electorate integer;
  adopted boolean;
begin
  if tg_op = 'INSERT' then
    if new.proposed_at is distinct from now() or new.status <> 'proposed' or new.tallied_at is not null then
      raise exception 'a decree is proposed now, untallied' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.offices o
                   where o.id = new.office_id and o.office = 'archon' and o.city_id = new.city_id
                     and o.house_id = new.proposed_by and o.starts_at <= now() and now() < o.ends_at) then
      raise exception 'only the archon in office proposes' using errcode = 'check_violation', constraint = 'decrees_archon_only';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.city_id, new.model, new.params, new.office_id, new.proposed_by, new.proposed_at,
      new.voting_closes_at, new.quorum_bps)
     is distinct from (old.id, old.world_id, old.city_id, old.model, old.params, old.office_id, old.proposed_by,
      old.proposed_at, old.voting_closes_at, old.quorum_bps) then
    raise exception 'a decree is immutable' using errcode = 'restrict_violation';
  end if;
  if old.status = 'adopted' and new.status = 'applied' then
    if new.model not in ('market_tax_rate', 'port_dues') then
      raise exception 'only a rate decree is applied' using errcode = 'restrict_violation';
    end if;
    if new.applied_at is distinct from now()
       or (new.tallied_at, new.electorate, new.votes_for, new.votes_against)
          is distinct from (old.tallied_at, old.electorate, old.votes_for, old.votes_against) then
      raise exception 'a decree is applied once, now' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if old.status <> 'proposed' or new.status not in ('adopted', 'rejected') or new.tallied_at is distinct from now() then
    raise exception 'a decree is tallied once, now' using errcode = 'restrict_violation';
  end if;
  if now() < old.voting_closes_at then
    raise exception 'a decree is tallied after its vote' using errcode = 'restrict_violation';
  end if;
  select count(*) filter (where v.approve), count(*) filter (where not v.approve) into votes_for, votes_against
  from game.decree_votes v where v.decree_id = new.id;
  select count(*) into electorate from game.citizenships c
  where c.city_id = new.city_id and c.status = 'citizen' and c.since < new.voting_closes_at;
  adopted := (votes_for + votes_against)::bigint * 10000 >= new.quorum_bps::bigint * electorate
             and votes_for > votes_against;
  if (new.votes_for, new.votes_against, new.electorate, new.status)
     is distinct from (votes_for, votes_against, electorate, case when adopted then 'adopted' else 'rejected' end) then
    raise exception 'a decree tally follows its votes' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function game.guard_decree() from public, anon, authenticated, oikos_service;
grant update (applied_at) on game.decrees to oikos_service;

-- Taux en vigueur de chaque cité du monde, sous les règles données : la section de configuration que lit
-- l'appelant (`marketTax.rateBps`, `ships.portDues.cityCoefficientBps`, bornes `decrees.models`), telle que
-- la version la porte ou telle que le schéma partagé la complète. Taux de la taxe de marché et coefficient du
-- droit de port : la valeur du dernier décret appliqué de la cité, ramenée dans les bornes du modèle, sinon
-- celle de la configuration (taux nul, coefficient ×1 quand elle n'en a pas), que les bornes, faites pour les
-- votes des cités, ne touchent pas. Un modèle que la configuration ne borne plus rend la valeur de la
-- configuration : le monde a repris ce taux aux cités. Dernier appliqué : le
-- plus récemment appliqué, et parmi ceux d'une même clôture, celui que l'étape applique en dernier (fin de
-- vote, puis identifiant). Le service ne lit le taux d'une cité que par cette fonction.
create or replace function game.city_rates(p_world_id uuid, p_rules jsonb)
returns table (city_id uuid, market_tax_rate_bps integer, port_dues_coefficient_bps integer)
language sql stable
set search_path = ''
as $$
  select c.id,
         case when jsonb_typeof(r.tax_bounds) = 'object' and tax.rate is not null
              then least(greatest(tax.rate, (r.tax_bounds ->> 'minRateBps')::integer), (r.tax_bounds ->> 'maxRateBps')::integer)
              else r.tax_default end,
         case when jsonb_typeof(r.port_bounds) = 'object' and port.coefficient is not null
              then least(greatest(port.coefficient, (r.port_bounds ->> 'minCoefficientBps')::integer),
                         (r.port_bounds ->> 'maxCoefficientBps')::integer)
              else r.port_default end
  from game.cities c
  cross join lateral (select coalesce((p_rules #>> '{marketTax,rateBps}')::integer, 0) as tax_default,
                             p_rules #> '{decrees,models,market_tax_rate}' as tax_bounds,
                             coalesce((p_rules #>> array['ships', 'portDues', 'cityCoefficientBps', c.slug])::integer, 10000)
                               as port_default,
                             p_rules #> '{decrees,models,port_dues}' as port_bounds) r
  left join lateral (select (d.params ->> 'rateBps')::integer as rate from game.decrees d
                     where d.city_id = c.id and d.model = 'market_tax_rate' and d.status = 'applied'
                     order by d.applied_at desc, d.voting_closes_at desc, d.id desc limit 1) tax on true
  left join lateral (select (d.params ->> 'coefficientBps')::integer as coefficient from game.decrees d
                     where d.city_id = c.id and d.model = 'port_dues' and d.status = 'applied'
                     order by d.applied_at desc, d.voting_closes_at desc, d.id desc limit 1) port on true
  where c.world_id = p_world_id;
$$;
revoke all on function game.city_rates(uuid, jsonb) from public, anon, authenticated;
grant execute on function game.city_rates(uuid, jsonb) to oikos_service;

-- Lecture des joueurs : les taux en vigueur de chaque cité, toutes cités confondues, sous la version en
-- vigueur. Règles publiques, comme `market_rules` : la taxe annoncée avant une vente, le droit de port
-- annoncé avant un départ. Sans version en vigueur, aucune ligne. La vue est créée sous condition (ADR 0006).
create or replace function game.city_rates_in_force()
returns table (city_id uuid, market_tax_rate_bps integer, port_dues_coefficient_bps integer)
language sql stable security definer
set search_path = ''
as $$
  select r.city_id, r.market_tax_rate_bps, r.port_dues_coefficient_bps
  from config.versions v
  cross join game.worlds w
  cross join lateral game.city_rates(w.id, v.payload) r
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.city_rates_in_force() from public, anon, oikos_service;
grant execute on function game.city_rates_in_force() to authenticated;

do $$
begin
  if to_regclass('public.city_rates') is null then
    create view public.city_rates with (security_invoker = true) as
      select city_id, market_tax_rate_bps, port_dues_coefficient_bps from game.city_rates_in_force();
  end if;
end $$;
grant select on public.city_rates to authenticated;

-- Les décrets de chaque cité restent publics ; un joueur lit aussi quand un décret a été appliqué. La vue,
-- créée sous condition par la migration 131, gagne la colonne en fin de liste, sous condition elle aussi : au
-- rejeu, ce remplacement ne retire pas les colonnes qu'une migration suivante lui aura ajoutées (ADR 0006).
grant select (applied_at) on game.decrees to authenticated;
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'decrees' and column_name = 'applied_at') then
    create or replace view public.decrees with (security_invoker = true) as
      select id, world_id, city_id, model, params, proposed_by, status, proposed_at, voting_closes_at, quorum_bps,
             tallied_at, electorate, votes_for, votes_against, applied_at
      from game.decrees;
  end if;
end $$;
