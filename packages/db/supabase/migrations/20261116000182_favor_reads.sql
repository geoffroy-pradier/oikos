-- Lectures de la Charis par les joueurs (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; ticket 265) : les
-- règles publiques des temples, la Charis de sa propre maison par dieu, la Charis de chaque cité envers son
-- dieu protecteur ; et les offrandes dans les comptes de la maison (4.1). Rejouable (`create or replace` aux
-- colonnes inchangées, vues créées une fois, règle recréée) ; le code précédent ne lit aucune de ces vues, et
-- lit les mêmes colonnes des comptes.

-- Règles des temples : la section `gods` de la configuration en vigueur, règles du jeu connues de tous les
-- joueurs (tout champ qui y est ajouté leur devient visible). Même montage que `property_rules` (migration
-- 112). Un dieu d'une version publiée avant la Charis n'y porte que son identifiant : le client applique les
-- valeurs par défaut du schéma partagé (aucune offrande acceptée), comme l'API. Sans version, aucune ligne.
create or replace function game.temple_rules() returns table (gods jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'gods'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.temple_rules() from public;
grant execute on function game.temple_rules() to authenticated;

-- Charis de cité (7.1) : pour chaque cité du monde que la configuration en vigueur dote d'un dieu protecteur,
-- la Charis de ses citoyennes envers ce dieu, sommée, fois son poids `cityCharisWeightBps` (absent : nul),
-- arrondie vers zéro et bornée au plus grand entier sûr. Une maison métèque n'y compte pas. Au nom du
-- propriétaire, la fonction ne rend que ce total : pas la Charis d'une maison, sauf à être seule citoyenne.
-- Créée sans condition, elle garde ce type de retour (ADR 0006).
create or replace function game.city_charis() returns table (city_id uuid, god_id text, charis bigint)
language sql stable security definer
set search_path = ''
as $$
  with patrons as (
    select c ->> 'id' as slug, c ->> 'patronGodId' as god_id,
           coalesce((select (g ->> 'cityCharisWeightBps')::bigint from jsonb_array_elements(v.payload -> 'gods') g
                     where g ->> 'id' = c ->> 'patronGodId'), 0) as weight
    from config.versions v
    cross join lateral jsonb_array_elements(v.payload -> 'cities') c
    where v.id = config.active_version_at(now()) and c ->> 'patronGodId' is not null
  )
  select city.id, p.god_id, least(div(coalesce(sum(f.charis), 0) * p.weight, 10000), 9007199254740991)::bigint
  from patrons p
  join game.cities city on city.slug = p.slug
  left join game.citizenships z on z.city_id = city.id and z.status = 'citizen'
  left join game.favor f on f.house_id = z.house_id and f.god_id = p.god_id
  group by city.id, p.god_id, p.weight;
$$;
revoke all on function game.city_charis() from public;
grant execute on function game.city_charis() to authenticated;

-- Charis de sa maison : règle par ligne et colonnes accordées une à une.
drop policy if exists favor_read_own on game.favor;
create policy favor_read_own on game.favor for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (house_id, god_id, charis) on game.favor to authenticated;

-- Vues créées une fois : rejouée ensuite, la migration ne les recrée pas, si bien que les grâces (#266) et la
-- Pythie (#270) pourront ajouter une colonne à `temple_rules` (ADR 0006).
do $$
begin
  if to_regclass('public.temple_rules') is null then
    create view public.temple_rules with (security_invoker = true) as select gods from game.temple_rules();
  end if;
  if to_regclass('public.city_charis') is null then
    create view public.city_charis with (security_invoker = true) as
      select city_id, god_id, charis from game.city_charis();
  end if;
  if to_regclass('public.my_favor') is null then
    create view public.my_favor with (security_invoker = true) as select house_id, god_id, charis from game.favor;
  end if;
end $$;
revoke all on public.temple_rules, public.city_charis, public.my_favor from public, anon;
grant select on public.temple_rules, public.city_charis, public.my_favor to authenticated;

-- Flux de trésorerie : la migration 160, plus la nature `offerings` des écritures `temple.offering`. Le compte
-- de résultat (migration 160) ne change pas : ses colonnes sont figées (ADR 0006), et une offrande, hors
-- exploitation, y entre dans `other` avec tout ce qu'il ne range pas ailleurs.
create or replace view public.my_cash_flows with (security_invoker = true) as
  select house_id, account, game_day, nature, sum(amount)::bigint as amount
  from (
    select a.house_id,
           case a.kind when 'house' then 'treasury' else a.kind end as account,
           ((e.created_at at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
             - date '1970-01-01' as game_day,
           f.nature, f.amount
    from game.accounts a
    join game.ledger_lines l on l.account_id = a.id
    join game.ledger_entries e on e.id = l.entry_id
    left join game.clock_rules() c on true
    left join lateral (
      select case when e.kind = 'property.sale'
        then (select o.price_oboles from game.property_listings o where o.ledger_entry_id = e.id)
        else (select sum(t.price * t.quantity) from game.trades t where t.ledger_entry_id = e.id)
      end as gross
    ) sale on l.nature is null and l.amount > 0 and e.kind in ('market.trade', 'npc.purchase', 'property.sale')
    cross join lateral (values
      (case
         when l.nature is not null then l.nature
         when e.kind in ('market.trade', 'npc.purchase') then case when l.amount > 0 then 'sales' else 'purchases' end
         when e.kind in ('market.escrow_hold', 'market.escrow_release') then 'escrow'
         when e.kind in ('upkeep.daily', 'upkeep.restart', 'property.renovate') then 'upkeep'
         when e.kind in ('lodging.daily', 'lodging.restart') then 'lodging'
         when e.kind in ('site.acquire', 'ship.acquire', 'property.buy', 'property.sale') then 'acquisitions'
         when e.kind = 'lease.rent' then 'rents'
         when e.kind = 'temple.offering' then 'offerings'
         when e.kind = 'voyage.departure' then 'transport'
         when e.kind = 'house.starting_grant' then 'grant'
         else 'other'
       end, coalesce(sale.gross, l.amount)),
      ('taxes', l.amount - sale.gross)
    ) f (nature, amount)
    where a.kind in ('house', 'escrow') and f.amount <> 0
  ) flows
  group by house_id, account, game_day, nature
  having sum(amount) <> 0;

