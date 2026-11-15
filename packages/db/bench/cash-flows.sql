-- Mesure reproductible de la lecture des flux de trésorerie par un joueur (ticket 155).
--
--   BENCH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/oikos_bench \
--     pnpm --filter @oikos/db bench:cash-flows
--
-- Pas de base par défaut : la variable dédiée `BENCH_DATABASE_URL` est obligatoire, et le script refuse une
-- base qui contient autre chose que le seed (comptes, maisons ou écritures). À jouer dans une base neuve,
-- migrations et seed appliqués, avec le compte propriétaire du schéma (`postgres` en local) : le script
-- crée des comptes, désactive un déclencheur et lance ANALYZE. `DATABASE_URL` (`.env.example`) endosse
-- `oikos_service`, qui n'en a pas le droit.
--
-- Jeu d'essai du ticket : 40 maisons, 40 000 écritures (deux lignes chacune), réparties sur 60 jours,
-- statistiques à jour. Tout se joue dans une transaction annulée : rien n'est écrit, mais ANALYZE met à
-- jour en place le nombre de lignes estimé des tables.
--
-- La lecture est faite comme par PostgREST : rôle `authenticated`, jeton d'Alice, puis les réglages
-- propres à ce rôle (`alter role authenticated set …`), que PostgREST applique à chaque requête. Chaque
-- mesure est la médiane de sept lectures complètes, avec `jit` actif puis avec les réglages du rôle. La
-- lecture est planifiée une fois puis son plan réutilisé (PL/pgSQL) : la mesure porte sur l'exécution,
-- compilation à la volée comprise, pas sur la planification. Le script échoue si `jit` reste actif avec
-- les réglages du rôle ou si la médiane atteint 50 ms. `pg_jit_available()` faux : la grappe n'embarque
-- pas la compilation, et les deux mesures sont alors égales.
\set ON_ERROR_STOP on
\set world '01900000-0000-7000-8000-000000000001'
begin;

select pg_jit_available() as compilation_disponible;
do $$
begin
  if exists (select from auth.users) or exists (select from game.houses) or exists (select from game.ledger_entries) then
    raise exception 'base non neuve (comptes, maisons ou écritures) : mesure refusée, voir l''en-tête du script';
  end if;
end $$;

insert into auth.users (id, email)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'bench-' || n || '@example.test'
from generate_series(1, 40) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid, :'world',
       ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Maison ' || chr(65 + (n - 1) / 26) || chr(65 + (n - 1) % 26), '{}'
from generate_series(1, 40) n;
insert into game.accounts (id, world_id, kind, house_id)
select ('00000000-0000-7000-8000-' || lpad((1000 + n)::text, 12, '0'))::uuid, :'world', 'house',
       ('00000000-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid
from generate_series(1, 40) n;

-- Horloge en vigueur : la vue calcule le jour de jeu de chaque écriture.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000b155',
  '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id) values ('00000000-0000-7000-8000-00000000b155');

-- 40 000 écritures, crédits d'une maison (`n % 40`) par un robinet : dotations et ventes aux PNJ, sur
-- soixante jours. Les soldes ne sont pas tenus (la transaction est annulée) : sans cela, 80 000 mises à
-- jour des mêmes 42 comptes prendraient une minute.
alter table game.ledger_lines disable trigger ledger_lines_apply;
create temporary table bench_entries on commit drop as
select game.uuid_v7() as id, n from generate_series(1, 40000) n;
insert into game.ledger_entries (id, world_id, kind, created_at)
select id, :'world', case when n % 3 = 0 then 'npc.purchase' else 'house.starting_grant' end,
       now() - make_interval(days => (n / 40) % 60, mins => n % 1440)
from bench_entries;
insert into game.ledger_lines (entry_id, account_id, amount)
select e.id, a.id, case when n % 3 = 0 then 3 else 2 end
from bench_entries e
join game.accounts a on a.id = ('00000000-0000-7000-8000-' || lpad((1000 + e.n % 40 + 1)::text, 12, '0'))::uuid
union all
select e.id, s.id, case when n % 3 = 0 then -3 else -2 end
from bench_entries e
join game.accounts s on s.world_id = :'world'
  and s.system_key = case when e.n % 3 = 0 then 'faucet_npc_purchases' else 'faucet_starting_grant' end;
analyze game.accounts, game.ledger_entries, game.ledger_lines, game.trades, game.houses;

-- Médiane, en millisecondes, de sept lectures complètes de la vue par Alice (maison 1).
create function pg_temp.median_read_ms() returns numeric language plpgsql as $$
declare
  started timestamptz;
  timings numeric[] := '{}';
begin
  for i in 1 .. 7 loop
    started := clock_timestamp();
    perform count(*) from (select * from public.my_cash_flows) f;
    timings := timings || extract(epoch from clock_timestamp() - started) * 1000;
  end loop;
  return (select percentile_cont(0.5) within group (order by t) from unnest(timings) t);
end $$;
grant execute on function pg_temp.median_read_ms() to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select count(*) as flux_lus_par_alice from public.my_cash_flows;

set local jit = on;
select round(pg_temp.median_read_ms(), 1) as jit_actif_ms;

-- Réglages du rôle, appliqués comme le fait PostgREST.
select set_config(split_part(s, '=', 1), substr(s, strpos(s, '=') + 1), true) as reglage_du_role
from pg_db_role_setting d, unnest(d.setconfig) s
where d.setrole = 'authenticated'::regrole and d.setdatabase in (0, (select oid from pg_database where datname = current_database()));
select current_setting('jit') as jit, round(pg_temp.median_read_ms(), 1) as reglages_du_role_ms \gset
\echo 'jit :' :jit ', médiane avec les réglages du rôle :' :reglages_du_role_ms 'ms'
do $$
begin
  if current_setting('jit')::bool or pg_temp.median_read_ms() >= 50 then
    raise exception 'lecture des flux trop lente pour un joueur (jit %), objectif : moins de 50 ms', current_setting('jit');
  end if;
end $$;

rollback;
