begin;
select plan(59);

-- Jeu d'essai, posé par le propriétaire : une maison, son compte (500 oboles), son stock (100 blés), un ordre de vente.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'alice@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000001a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'wheat');

-- Le rôle : sans connexion, sans privilège d'instance, propriétaire de rien, sans droit de création.
select is((select rolcanlogin or rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolreplication from pg_roles where rolname = 'oikos_service'),
  false, 'oikos_service : ni connexion, ni privilège d''instance');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where pg_get_userbyid(c.relowner) = 'oikos_service' and n.nspname in ('game', 'config', 'telemetry', 'admin', 'public', 'auth')),
  0::bigint, 'oikos_service ne possède aucune table du jeu');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where pg_get_userbyid(p.proowner) = 'oikos_service' and n.nspname in ('game', 'config', 'telemetry', 'admin', 'public', 'auth')),
  0::bigint, 'ni aucune fonction du jeu');
select ok(not has_schema_privilege('oikos_service', 'auth', 'usage'), 'le service n''entre pas dans le schéma des comptes');
select ok(not has_schema_privilege('oikos_service', s, 'create'), format('pas de création dans le schéma %s', s))
from unnest(array['game', 'config', 'telemetry', 'admin', 'public']) s;
select is(
  (select count(*) from pg_class c, unnest(array['delete', 'truncate', 'references', 'trigger']) p
   where c.relnamespace in ('game'::regnamespace, 'config'::regnamespace, 'telemetry'::regnamespace, 'admin'::regnamespace)
     and c.relkind = 'r' and has_table_privilege('oikos_service', c.oid, p)),
  0::bigint, 'ni suppression, ni vidage, ni déclencheur sur aucune table du jeu');
-- Liste exacte des tables modifiables : toute extension doit modifier ce test.
select is(
  (select count(*) from pg_class c
   where c.relnamespace = 'game'::regnamespace and c.relkind = 'r' and has_table_privilege('oikos_service', c.oid, 'update')),
  0::bigint, 'aucune table de game modifiable en entier par le service');
-- Colonnes modifiables : celles qu'une commande ou le tick change, plus une colonne gardée par table à
-- verrouiller (solde, quantité : la garde refuse toute modification directe).
select is(
  (select string_agg(table_name || '.' || column_name, ' ' order by table_name collate "C", column_name collate "C")
   from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema in ('game', 'config', 'telemetry', 'admin') and privilege_type = 'UPDATE'),
  'accounts.balance api_refusals.count houses.name inventories.quantity npc_demand_carry.carry '
    || 'npc_demand_carry.updated_at npc_population.closed_day npc_population.coverage_bps npc_population.population '
    || 'npc_vital_coverage.demanded npc_vital_coverage.served observed_prices.observed_at observed_prices.price observed_prices.volume observed_prices.window_seconds '
    || 'orders.status price_candles.close price_candles.high price_candles.low price_candles.open '
    || 'price_candles.turnover price_candles.volume rate_windows.count sites.cycle_started_at sites.halted_at sites.recipe_id',
  'colonnes modifiables par le service, tous schémas du jeu : liste figée');
select is(
  (select count(*) from pg_class c
   where c.relnamespace in ('config'::regnamespace, 'telemetry'::regnamespace, 'admin'::regnamespace)
     and c.relkind = 'r' and has_table_privilege('oikos_service', c.oid, 'update')),
  0::bigint, 'aucune modification hors de game');
select ok(not has_table_privilege('oikos_service', 'admin.roles', 'insert'), 'le service n''inscrit aucun rôle à la main (seulement par admin.set_role, au nom d''un super-administrateur)');
-- Toute table à règles par ligne ouverte au service a sa règle : sinon il n'y verrait aucune ligne.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('game', 'config', 'telemetry', 'admin') and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname
                     and p.policyname = 'service_all' and p.roles = '{oikos_service}')),
  0::bigint, 'chaque table à règles par ligne a sa règle de service');
select is((select count(*) from pg_policies where policyname = 'service_all' and roles <> '{oikos_service}'), 0::bigint,
  'la règle de service ne vaut que pour le service');
-- Fonctions exécutées au nom du propriétaire : liste figée, toute extension doit modifier ce test.
select is(
  (select string_agg(n.nspname || '.' || p.proname, ' ' order by n.nspname, p.proname collate "C")
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname in ('game', 'config', 'telemetry', 'admin')
          or (n.nspname = 'public' and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')))
    and p.prosecdef),
  'admin.set_role config.cancel_clock_changing_activations game.apply_ledger_line game.apply_order_reservation game.apply_stock_movement game.apply_trade '
    || 'game.check_escrow_debit game.check_escrow_matches_orders game.check_trade_settled game.check_trade_settlement '
    || 'game.clock_rules game.create_city_treasury game.create_kind_system_accounts game.create_world_system_accounts game.current_house_ids game.market_rules game.order_book '
    || 'game.site_rules telemetry.prune_rate_windows telemetry.purge_runs',
  'fonctions SECURITY DEFINER : liste figée');
-- Une fonction exécutée au nom du propriétaire ne cherche ses objets dans aucun schéma implicite.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('game', 'config', 'telemetry', 'admin', 'public') and p.prosecdef
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and not coalesce(p.proconfig, '{}') @> array['search_path=""']),
  0::bigint, 'toute fonction SECURITY DEFINER fixe un search_path vide');
-- Le droit d'exécuter une fonction de déclencheur suffit à l'attacher à une table qu'on possède.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname in ('game', 'config', 'telemetry', 'admin')
          or (n.nspname = 'public' and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')))
    and p.prorettype = 'trigger'::regtype
     and has_function_privilege('oikos_service', p.oid, 'execute')),
  0::bigint, 'le service n''exécute aucune fonction de déclencheur');
select is(
  (select string_agg(n.nspname || '.' || p.proname, ' ' order by n.nspname, p.proname collate "C")
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname in ('game', 'config', 'telemetry', 'admin')
          or (n.nspname = 'public' and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')))
    and has_function_privilege('oikos_service', p.oid, 'execute')),
  'admin.set_role config.active_version_at config.cancel_clock_changing_activations game.uuid_v7 '
    || 'game.written_by_owner_trigger telemetry.prune_rate_windows telemetry.purge_runs',
  'fonctions exécutables par le service : liste figée');
select ok(not has_database_privilege('oikos_service', current_database(), 'create'), 'le service ne crée pas de schéma dans la base');
-- Échanges : le service ne choisit ni le rang d'exécution ni la date, qui décident des chandeliers de prix.
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'trades' and grantee = 'oikos_service' and privilege_type = 'INSERT'),
  'buy_order_id id ledger_entry_id price quantity sell_order_id world_id', 'colonnes d''un échange écrites par le service : liste figée, sans seq ni created_at');
select is((select indisunique from pg_index where indexrelid = 'game.trades_seq_unique'::regclass), true, 'le rang d''exécution d''un échange est unique');
-- Activations : le service ne choisit ni la date de création ni le rang (ticket 130).
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where table_schema = 'config' and table_name = 'activations' and grantee = 'oikos_service' and privilege_type = 'INSERT'),
  'activate_at created_by id version_id', 'colonnes d''une activation écrites par le service : liste figée, sans seq ni created_at');

-- Le service au travail : les journaux passent, et mettent à jour soldes, stocks, réservations.
-- Chaque instruction ci-dessous est exécutée sous le rôle de service (les assertions restent au propriétaire).
create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  seen text;
begin
  perform set_config('role', 'oikos_service', true);
  seen := current_user;
  execute statement;
  perform set_config('role', 'none', true);
  return seen;
end $$;
select is(pg_temp.as_service('select 1'), 'oikos_service', 'le propriétaire prend le rôle de service');
select is(current_user::text, session_user::text, 'et le rend');
select lives_ok($$select pg_temp.as_service($s$
  with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'test') returning id)
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry.id, a.id, case when a.kind = 'house' then 500 else -500 end
  from entry, game.accounts a
  where a.id = '00000000-0000-7000-8000-0000000000aa'
     or (a.system_key = 'faucet_npc_purchases' and a.world_id = '01900000-0000-7000-8000-000000000001')$s$)$$,
  'une écriture équilibrée passe');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000aa'), 500::bigint, 'le solde suit le journal');
select lives_ok($$select pg_temp.as_service($s$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-000000000001', 'wheat', 100, 'production', '00000000-0000-7000-8000-0000000001a1', 'site.collect')$s$)$$,
  'un mouvement de stock passe');
select lives_ok($$select pg_temp.as_service($s$insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining)
  values ('00000000-0000-7000-8000-000000000301', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101',
          '00000000-0000-7000-8000-0000000000a1', 'wheat', 'sell', 6, 60, 60)$s$)$$, 'un ordre de vente passe');
select is((select quantity || '/' || reserved from game.inventories where id = '00000000-0000-7000-8000-0000000001a1'), '100/60',
  'stock et réservation suivent les journaux');

-- Écritures directes : refusées par la garde (ou par les droits).
select throws_ok($$select pg_temp.as_service($s$update game.accounts set balance = balance + 1000000$s$)$$, '23001', null, 'pas de solde modifié à la main');
select throws_ok($$select pg_temp.as_service($s$update game.inventories set quantity = 1000000$s$)$$, '23001', null, 'pas de quantité modifiée à la main');
select throws_ok($$select pg_temp.as_service($s$update game.inventories set reserved = 0$s$)$$, '42501', null, 'pas de réservation modifiée à la main (colonne fermée)');
select throws_ok($$select pg_temp.as_service($s$update game.orders set remaining = 1$s$)$$, '42501', null, 'pas d''ordre servi à la main (colonne fermée)');
select throws_ok($$select pg_temp.as_service($s$update game.orders set status = 'filled'$s$)$$, '23001', null,
  'ni déclaré servi par son état');
select throws_ok($$select pg_temp.as_service($s$update game.houses set user_id = gen_random_uuid()$s$)$$, '42501', null,
  'pas de maison changée de compte');
select throws_ok($$select pg_temp.as_service($s$delete from game.ledger_lines$s$)$$, '42501', null, 'pas de suppression d''écriture');
select throws_ok($$select pg_temp.as_service($s$truncate game.stock_ledger$s$)$$, '42501', null, 'pas de vidage de journal');
select throws_ok($$select pg_temp.as_service($s$insert into admin.roles (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'super_admin')$s$)$$, '42501', null,
  'pas de rôle d''administration auto-accordé');
select throws_ok($$select pg_temp.as_service($s$create table game.backdoor (id int)$s$)$$, '42501', null, 'pas de table dans game');
select throws_ok($$select pg_temp.as_service($s$create trigger backdoor after insert on game.ticks for each row execute function game.apply_ledger_line()$s$)$$, '42501', null,
  'pas de déclencheur sur une table du jeu');

-- Contournement par son propre déclencheur : même profondeur que les journaux, mais pas au nom du propriétaire.
select lives_ok($$select pg_temp.as_service($s$
  create function pg_temp.forge() returns trigger language plpgsql as $f$
  begin
    execute new.statement;
    return null;
  end $f$;
  create temporary table forge (statement text);
  create trigger forge after insert on forge for each row execute function pg_temp.forge()$s$)$$,
  'le service crée sa table temporaire et son déclencheur');
select lives_ok($$select pg_temp.as_service($s$insert into forge values ('select 1')$s$)$$, 'qui s''exécute');
select throws_ok($$select pg_temp.as_service($s$insert into forge values ('update game.accounts set balance = balance + 1000000')$s$)$$, '23001',
  'account balance changes only through ledger lines', 'un déclencheur du service ne forge pas de solde');
select throws_ok($$select pg_temp.as_service($s$insert into forge values ('update game.inventories set quantity = quantity + 1000000')$s$)$$, '23001',
  'inventory quantity changes only through the stock ledger', 'ni de stock');
select throws_ok($$select pg_temp.as_service($s$insert into forge values ('update game.inventories set reserved = 0')$s$)$$, '42501',
  null, 'ni ne libère une réservation');
select throws_ok($$select pg_temp.as_service($s$insert into forge values ('update game.orders set status = ''filled''')$s$)$$, '23001',
  'an order is only filled by a trade or cancelled', 'ni ne sert un ordre');

-- Contournement par les fonctions du propriétaire : le service ne peut pas les attacher à sa table.
select lives_ok($$select pg_temp.as_service($s$
  create temporary table fake_lines (account_id uuid, amount bigint);
  create temporary table fake_moves (from_inventory_id uuid, to_inventory_id uuid, good_id text, quantity bigint);
  create temporary table fake_orders (house_id uuid, city_id uuid, good_id text, side text, status text, remaining bigint);
  create temporary table fake_trades (sell_order_id uuid, buy_order_id uuid, price bigint, quantity bigint)$s$)$$,
  'le service crée des tables à la forme des journaux');
select throws_ok(format($$select pg_temp.as_service($s$create trigger t after insert on %s for each row execute function game.%s()$s$)$$, target, fn),
  '42501', null, format('le service n''attache pas %s à sa table', fn))
from (values ('fake_lines', 'apply_ledger_line'), ('fake_moves', 'apply_stock_movement'),
             ('fake_orders', 'apply_order_reservation'), ('fake_trades', 'apply_trade')) as forged (target, fn);
-- Défense en profondeur : même attachées par le propriétaire à une autre table, elles refusent de s'exécuter.
create temporary table owner_lines (account_id uuid, amount bigint);
create trigger t after insert on owner_lines for each row execute function game.apply_ledger_line();
select throws_ok($$insert into owner_lines values ('00000000-0000-7000-8000-0000000000aa', 1000000)$$, '42501',
  't only runs on game.ledger_lines', 'apply_ledger_line ne s''exécute que sur son journal');
create temporary table owner_moves (from_inventory_id uuid, to_inventory_id uuid, good_id text, quantity bigint);
create trigger t after insert on owner_moves for each row execute function game.apply_stock_movement();
select throws_ok($$insert into owner_moves values (null, '00000000-0000-7000-8000-0000000001a1', 'wheat', 1000000)$$, '42501',
  't only runs on game.stock_ledger', 'apply_stock_movement ne s''exécute que sur son journal');
create temporary table owner_orders (house_id uuid, city_id uuid, good_id text, side text, status text, remaining bigint);
create trigger t after insert on owner_orders for each row execute function game.apply_order_reservation();
select throws_ok($$insert into owner_orders values ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'wheat', 'sell', 'open', -60)$$,
  '42501', 't only runs on game.orders', 'apply_order_reservation ne s''exécute que sur les ordres');
create temporary table owner_trades (sell_order_id uuid, buy_order_id uuid, price bigint, quantity bigint);
create trigger t after insert on owner_trades for each row execute function game.apply_trade();
select throws_ok($$insert into owner_trades values ('00000000-0000-7000-8000-000000000301', null, 6, 60)$$, '42501',
  't only runs on game.trades', 'apply_trade ne s''exécute que sur les échanges');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000aa'), 500::bigint, 'le solde n''a pas bougé');
select is((select quantity || '/' || reserved from game.inventories where id = '00000000-0000-7000-8000-0000000001a1'), '100/60',
  'ni le stock, ni la réservation');

select * from finish();
rollback;
