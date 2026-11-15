begin;
select plan(24);

-- Le monde de test (seed) a reçu ses comptes sans qu'aucun script ne les crée.
select is(
  (select string_agg(system_key, ' ' order by system_key collate "C") from game.accounts
   where world_id = '01900000-0000-7000-8000-000000000001' and kind = 'system'),
  'faucet_good_buyback faucet_npc_purchases faucet_rewards faucet_starting_grant faucet_temple_loans '
    || 'sink_market_tax sink_npc_wages sink_offerings sink_public_works sink_site_acquisition sink_temple_interest sink_upkeep',
  'comptes système du monde de test : liste figée');

-- Un monde naît avec tous ses comptes système, à zéro ; seuls les robinets peuvent devenir débiteurs.
insert into game.worlds (id, slug, name) values ('00000000-0000-7000-8000-00000000e001', 'essai-comptes', 'Essai');
select is(
  (select count(*) from game.accounts where world_id = '00000000-0000-7000-8000-00000000e001' and kind = 'system'),
  (select count(*) from game.system_account_kinds), 'un monde naît avec un compte par robinet et par puits');
select is((select count(*) from game.system_account_kinds), 12::bigint, 'douze robinets et puits au catalogue');
select is(
  (select count(*) from game.accounts where world_id = '00000000-0000-7000-8000-00000000e001'
     and (balance <> 0 or allow_negative <> (system_key like 'faucet\_%'))),
  0::bigint, 'à zéro, et seuls les robinets peuvent devenir débiteurs');

-- Un ajout au catalogue crée le compte dans tous les mondes existants, une seule fois.
insert into game.system_account_kinds (key, allow_negative) values ('sink_test_only', false);
select is(
  (select count(*) from game.accounts where system_key = 'sink_test_only'),
  (select count(*) from game.worlds), 'un nouveau puits existe aussitôt dans chaque monde');
select throws_ok($$insert into game.system_account_kinds (key, allow_negative) values ('sink_test_only', false)$$, '23505', null,
  'pas de doublon au catalogue');
select throws_ok($$insert into game.system_account_kinds (key, allow_negative) values ('sink_debtor', true)$$, '23514', null,
  'un puits ne peut pas devenir débiteur');
select throws_ok($$insert into game.system_account_kinds (key, allow_negative) values ('faucet_capped', false)$$, '23514', null,
  'un robinet doit pouvoir devenir débiteur');
select throws_ok($$insert into game.system_account_kinds (key, allow_negative) values ('treasury', false)$$, '23514', null,
  'une clé est un robinet ou un puits');
select throws_ok($$delete from game.system_account_kinds$$, '23001', null, 'le catalogue ne perd rien');
select throws_ok($$update game.system_account_kinds set allow_negative = true where key = 'sink_upkeep'$$, '23001', null,
  'un puits ne devient pas robinet');

-- Clients : aucun accès au catalogue.
select ok(not has_table_privilege('authenticated', 'game.system_account_kinds', 'select'), 'catalogue illisible par un joueur');
select ok(not has_table_privilege('anon', 'game.system_account_kinds', 'select'), 'ni par un visiteur');

-- Service : il ouvre le compte d'une maison, jamais un compte système, et ne touche pas au catalogue.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'alice@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000e001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}');
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
select lives_ok($$select pg_temp.as_service($s$insert into game.accounts (world_id, kind, house_id)
  values ('00000000-0000-7000-8000-00000000e001', 'house', '00000000-0000-7000-8000-0000000000a1')$s$)$$,
  'le service ouvre le compte d''une maison');
select throws_ok($$select pg_temp.as_service($s$insert into game.accounts (world_id, kind, system_key, allow_negative)
  values ('00000000-0000-7000-8000-00000000e001', 'system', 'faucet_forged', true)$s$)$$, '42501', null,
  'le service ne crée pas de robinet');
select throws_ok($$select pg_temp.as_service($s$insert into game.accounts (world_id, kind, system_key, allow_negative)
  values ('00000000-0000-7000-8000-00000000e001', 'system', 'faucet_npc_purchases', true) on conflict do nothing$s$)$$, '42501', null,
  'ni par une insertion qui ignore les doublons');
select throws_ok($$select pg_temp.as_service($s$update game.accounts set kind = 'system', house_id = null, system_key = 'faucet_forged', allow_negative = true
  where house_id = '00000000-0000-7000-8000-0000000000a1'$s$)$$, '42501', null,
  'ni en transformant le compte d''une maison');
select throws_ok($$select pg_temp.as_service($s$insert into game.system_account_kinds (key, allow_negative) values ('faucet_forged', true)$s$)$$,
  '42501', null, 'ni n''en ajoute au catalogue');
select lives_ok($$select pg_temp.as_service($s$select count(*) from game.system_account_kinds$s$)$$, 'le service lit le catalogue');
-- Les fonctions qui créent les comptes ne s'attachent pas à une table du service.
select throws_ok(format($$select pg_temp.as_service($s$
  create temporary table fake_%1$s (id uuid, key text, allow_negative boolean);
  create trigger t after insert on fake_%1$s for each row execute function game.%1$s()$s$)$$, fn),
  '42501', null, format('le service n''attache pas %s à sa table', fn))
from unnest(array['create_world_system_accounts', 'create_kind_system_accounts']) fn;

-- La garde ne dépend pas de la règle par ligne : même avec une règle large (rejeu de la migration 12
-- seule), le service ne crée pas de compte système.
drop policy service_all on game.accounts;
create policy service_all on game.accounts for all to oikos_service using (true) with check (true);
select throws_ok($$select pg_temp.as_service($s$insert into game.accounts (world_id, kind, system_key, allow_negative)
  values ('00000000-0000-7000-8000-00000000e001', 'system', 'faucet_forged', true)$s$)$$, '42501',
  'system accounts are created with their world', 'sans la règle par ligne, la garde refuse encore');
select lives_ok($$select pg_temp.as_service($s$select 1 from game.accounts where kind = 'system' limit 1 for update$s$)$$,
  'le service verrouille toujours un robinet');
-- Le propriétaire, lui, peut encore créer un compte système (migrations, tests).
select lives_ok($$insert into game.accounts (world_id, kind, system_key, allow_negative)
  values ('00000000-0000-7000-8000-00000000e001', 'system', 'sink_owner_only', false)$$, 'le propriétaire crée un compte système');

select * from finish();
rollback;
