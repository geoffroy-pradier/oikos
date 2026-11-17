-- Lectures de la Pythie par les joueurs (docs/specs/07-dieux-faveur-evenements.md, 7.3 ; 04-systemes-gestion.md,
-- 4.1 ; ticket 270) : le prix de la consultation dans les règles des temples (publiques), ses consultations et les
-- oracles qu'elles ont rendus (privés), et la consultation dans les comptes de la maison. Rejouable (fonction
-- nouvelle à type de retour `jsonb`, vues recréées sous condition ou aux colonnes inchangées, règles recréées) ; le
-- code précédent lit `temple_rules` et `my_cash_flows` par leurs colonnes, inchangées, et ne lit pas `my_oracles`.

-- Pythie de la configuration en vigueur (section `oracle`), règle du jeu connue de tous les joueurs (tout champ qui
-- y est ajouté leur devient visible). Nulle pour une version publiée avant elle ; sans version, aucune ligne.
-- `game.temple_rules()` (migration 182) et `game.temple_graces()` (232) gardent leur type de retour (ADR 0006).
create or replace function game.temple_oracle() returns table (oracle jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'oracle'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.temple_oracle() from public;
grant execute on function game.temple_oracle() to authenticated;

-- Consultations de sa maison, et oracles qu'elles ont rendus : règles par ligne et colonnes accordées une à une. Ni
-- l'événement d'un oracle, ni l'essai de réécriture, ni l'offrande d'une consultation (`my_cash_flows` la dit).
drop policy if exists oracle_consultations_read_own on game.oracle_consultations;
create policy oracle_consultations_read_own on game.oracle_consultations for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, house_id, city_id, oracle_ids, created_at) on game.oracle_consultations to authenticated;
drop policy if exists oracles_read_consulted on game.oracles;
create policy oracles_read_consulted on game.oracles for select to authenticated
  using (exists (select 1 from game.oracle_consultations c
                 where c.house_id in (select game.current_house_ids()) and oracles.id = any (c.oracle_ids)));
grant select (id, text_fr, text_en, source) on game.oracles to authenticated;

-- `temple_rules` gagne la colonne `oracle` une fois (ADR 0006). `my_oracles` est créée une fois : chaque oracle que
-- sa maison a consulté, avec le texte du moment (le repli, ou sa réécriture si elle a eu lieu depuis) et l'instant
-- de sa première consultation.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'temple_rules' and column_name = 'oracle') then
    create or replace view public.temple_rules with (security_invoker = true) as
      select r.gods, g.graces, o.oracle
      from game.temple_rules() r cross join game.temple_graces() g cross join game.temple_oracle() o;
  end if;
  if to_regclass('public.my_oracles') is null then
    create view public.my_oracles with (security_invoker = true) as
      select o.id, o.text_fr, o.text_en, o.source, c.house_id, min(c.created_at) as consulted_at
      from game.oracles o
      join game.oracle_consultations c on o.id = any (c.oracle_ids)
      group by o.id, o.text_fr, o.text_en, o.source, c.house_id;
  end if;
end $$;
revoke all on public.temple_rules, public.my_oracles from public, anon;
grant select on public.temple_rules, public.my_oracles to authenticated;

-- Flux de trésorerie : la migration 182, plus la nature `offerings` des écritures `temple.oracle`. Le compte de
-- résultat (migration 160) ne change pas : une consultation, offrande hors exploitation, y entre dans `other`.
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
         when e.kind in ('temple.offering', 'temple.oracle') then 'offerings'
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
