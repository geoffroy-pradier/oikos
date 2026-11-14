-- Comptes de la maison : compte de résultat par jour et par saison (docs/specs/04-systemes-gestion.md,
-- 4.1 ; ticket 73). Deux vues `security_invoker` en lecture seule, dérivées de `my_cash_flows` : elles
-- n'ouvrent aucun droit nouveau sur `game`, les règles par ligne de la migration 32 s'appliquent.

-- Horloge : un fuseau que Postgres ne connaît pas est rendu nul. La configuration est validée par le
-- moteur (`Intl`), dont la liste de fuseaux n'est pas celle de la base : sans cette garde, un fuseau
-- inconnu ici ferait échouer `my_cash_flows` pour tous les joueurs. Avec elle, le jour de jeu est
-- inconnu (nul), comme sans horloge, et aucun flux ne disparaît. L'essai coûte une sous-transaction par
-- lecture, pas un parcours de `pg_timezone_names` (une dizaine de millisecondes). Même signature que la
-- migration 32 : droits et vues inchangés ; aucune ligne sans configuration en vigueur. `rows 1` : sans
-- lui, Postgres attend mille lignes de chaque appel, et le coût estimé des vues qui en joignent deux
-- déclenche une compilation à la volée de plusieurs centaines de millisecondes à chaque lecture.
create or replace function game.clock_rules()
returns table (daily_close_hour integer, timezone text, season_days integer)
language plpgsql stable security definer rows 1
set search_path = ''
as $$
declare
  clock jsonb;
begin
  select v.payload -> 'clock' into clock from config.versions v where v.id = config.active_version_at(now());
  if not found then
    return;
  end if;
  daily_close_hour := (clock ->> 'dailyCloseHour')::integer;
  timezone := clock ->> 'timezone';
  season_days := (clock ->> 'seasonDays')::integer;
  begin
    perform now() at time zone timezone;
  exception when invalid_parameter_value then
    timezone := null;
  end;
  return next;
end $$;

-- Compte de résultat par jour de jeu, en oboles, au flux de trésorerie : un produit ou une charge est
-- compté le jour où la monnaie change de mains, signé comme le flux (charge négative). Ni variation de
-- stock ni amortissement : les stocks sont au bilan.
--  - La monnaie de la maison est sa trésorerie plus son séquestre : retenir ou rendre le prix d'un achat
--    en attente est un mouvement entre ses deux comptes, sans effet ici ; l'achat est une charge le jour
--    où il est servi, payé par le séquestre. `escrow_change` est la part du séquestre dans la variation.
--  - Exploitation : `sales` (brut), `purchases`, `taxes`, `upkeep` ; `operating_result` est leur somme.
--  - Hors exploitation : `acquisitions` (un site), `grants` (dotation), `other` (tout le reste : nature
--    inconnue de `my_cash_flows`, ou mouvement de séquestre qui ne se compenserait pas) ; `non_operating`
--    est leur somme.
--  - `cash_change` = `operating_result` + `non_operating` : la variation de la monnaie de la maison ce
--    jour-là, quelles que soient les données, puisque chaque flux tombe dans une colonne et une seule.
-- `season` est l'indice de saison du moteur (`seasonIndexAt`, packages/sim) : les saisons durent
-- `season_days` jours de jeu, comptés depuis le lundi 5 janvier 1970. Nul sans jour de jeu ou sans durée
-- de saison utilisable (absente, nulle ou négative) : aucune ligne ne disparaît.
create or replace view public.my_income_statement with (security_invoker = true) as
  select d.house_id, d.game_day, d.season, d.sales, d.purchases, d.taxes, d.upkeep,
         d.sales + d.purchases + d.taxes + d.upkeep as operating_result,
         d.acquisitions, d.grants, d.other, d.acquisitions + d.grants + d.other as non_operating,
         d.cash_change, d.escrow_change
  from (
    select f.house_id, f.game_day,
           case when c.season_days > 0
             then floor((f.game_day - (date '1970-01-05' - date '1970-01-01'))::numeric / c.season_days)::integer
           end as season,
           coalesce(sum(f.amount) filter (where f.nature = 'sales'), 0)::bigint as sales,
           coalesce(sum(f.amount) filter (where f.nature = 'purchases'), 0)::bigint as purchases,
           coalesce(sum(f.amount) filter (where f.nature = 'taxes'), 0)::bigint as taxes,
           coalesce(sum(f.amount) filter (where f.nature = 'upkeep'), 0)::bigint as upkeep,
           coalesce(sum(f.amount) filter (where f.nature = 'acquisitions'), 0)::bigint as acquisitions,
           coalesce(sum(f.amount) filter (where f.nature = 'grant'), 0)::bigint as grants,
           coalesce(sum(f.amount) filter (where f.nature not in
             ('sales', 'purchases', 'taxes', 'upkeep', 'acquisitions', 'grant')), 0)::bigint as other,
           sum(f.amount)::bigint as cash_change,
           coalesce(sum(f.amount) filter (where f.account = 'escrow'), 0)::bigint as escrow_change
    from public.my_cash_flows f
    left join game.clock_rules() c on true
    group by f.house_id, f.game_day, c.season_days
  ) d;

-- Le même compte par saison : la somme des jours de la saison, avec le premier et le dernier jour de
-- jeu de la saison pour la nommer. Sans saison (nulle), une seule ligne par maison, sans bornes.
create or replace view public.my_income_statement_by_season with (security_invoker = true) as
  select s.house_id, s.season,
         s.season * c.season_days + (date '1970-01-05' - date '1970-01-01') as first_game_day,
         (s.season + 1) * c.season_days + (date '1970-01-05' - date '1970-01-01') - 1 as last_game_day,
         sum(s.sales)::bigint as sales, sum(s.purchases)::bigint as purchases, sum(s.taxes)::bigint as taxes,
         sum(s.upkeep)::bigint as upkeep, sum(s.operating_result)::bigint as operating_result,
         sum(s.acquisitions)::bigint as acquisitions, sum(s.grants)::bigint as grants, sum(s.other)::bigint as other,
         sum(s.non_operating)::bigint as non_operating, sum(s.cash_change)::bigint as cash_change,
         sum(s.escrow_change)::bigint as escrow_change
  from public.my_income_statement s
  left join game.clock_rules() c on true
  group by s.house_id, s.season, c.season_days;

grant select on public.my_income_statement, public.my_income_statement_by_season to authenticated;
