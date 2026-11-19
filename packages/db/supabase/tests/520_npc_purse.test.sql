begin;
select plan(24);

-- Bourse des PNJ (ticket 632) : une par cité, marquée sur un compte de cité, jamais débitrice, cachée au service
-- et aux joueurs, hors des comptes publics du trésor. Monde de test (seed) : Kallistè 101, Elaia 103.
select results_eq(
  $$select c.id, a.world_id, a.balance, a.allow_negative, a.house_id, a.system_key
    from game.cities c join game.accounts a on a.city_id = c.id and a.npc_purse order by c.id$$,
  $$select c.id, c.world_id, 0::bigint, false, null::uuid, null::text from game.cities c order by c.id$$,
  'chaque cité existante a sa bourse, à zéro, dans son monde');
select is((select count(*) from game.accounts where npc_purse), (select count(*) from game.cities),
  'une bourse par cité, pas une de plus');
select is((select count(*) from game.accounts where kind = 'treasury' and not npc_purse), (select count(*) from game.cities),
  'et toujours un trésor par cité');

insert into game.worlds (id, slug, name) values ('00000000-0000-7000-8000-00000000e520', 'essai-bourse', 'Essai');
insert into game.cities (id, world_id, slug, name) values
  ('00000000-0000-7000-8000-00000000c520', '00000000-0000-7000-8000-00000000e520', 'delos', 'Délos');
select is(
  (select array_agg(world_id) from game.accounts where npc_purse and city_id = '00000000-0000-7000-8000-00000000c520'),
  array['00000000-0000-7000-8000-00000000e520'::uuid], 'une cité naît avec sa bourse, dans son monde');
select throws_ok($$insert into game.accounts (world_id, kind, city_id, npc_purse)
  values ('00000000-0000-7000-8000-00000000e520', 'treasury', '00000000-0000-7000-8000-00000000c520', true)$$, '23505', null,
  'pas de seconde bourse pour une cité');
select throws_ok($$insert into game.accounts (world_id, kind, system_key, allow_negative, npc_purse)
  values ('00000000-0000-7000-8000-00000000e520', 'system', 'faucet_forged', true, true)$$, '23514', null,
  'seul un compte de cité est une bourse');
select throws_ok($$update game.accounts set npc_purse = false where npc_purse and city_id = '00000000-0000-7000-8000-00000000c520'$$,
  '23001', 'account identity is immutable', 'une bourse ne redevient pas trésor');
select throws_ok($$update game.accounts set npc_purse = true where kind = 'treasury' and not npc_purse
  and city_id = '00000000-0000-7000-8000-00000000c520'$$, '23001', 'account identity is immutable', 'ni un trésor bourse');

-- Robinet du revenu public : au catalogue, dans chaque monde, débiteur.
select is((select allow_negative from game.system_account_kinds where key = 'faucet_npc_public_income'), true,
  'le revenu public est un robinet du catalogue');
select is((select count(*) from game.accounts where system_key = 'faucet_npc_public_income'), (select count(*) from game.worlds),
  'il existe dans chaque monde');

-- Une écriture entre le robinet et la bourse de Délos ; une bourse n'est jamais débitrice.
create function pg_temp.fund(amount bigint) returns void language plpgsql as $$
declare
  entry uuid;
begin
  -- Un jour de jeu de plus par versement (migration 1200 : la cité et le jour, une fois chacun, migration 1120).
  insert into game.ledger_entries (world_id, kind, meta) values ('00000000-0000-7000-8000-00000000e520', 'npc.public_income',
    jsonb_build_object('cityId', '00000000-0000-7000-8000-00000000c520', 'gameDay', (select count(*) from game.ledger_entries
      where kind = 'npc.public_income' and meta ->> 'cityId' = '00000000-0000-7000-8000-00000000c520')))
    returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values
    (entry, (select account_id from game.npc_purses() where city_id = '00000000-0000-7000-8000-00000000c520'), amount),
    (entry, (select id from game.accounts where world_id = '00000000-0000-7000-8000-00000000e520'
               and system_key = 'faucet_npc_public_income'), -amount);
end $$;
grant execute on function pg_temp.fund(bigint) to oikos_service;
select lives_ok('select pg_temp.fund(500)', 'le robinet crédite la bourse');
select throws_ok('select pg_temp.fund(-501)', '23514',
  'new row for relation "accounts" violates check constraint "accounts_no_overdraft"', 'une bourse ne devient pas débitrice');
-- Une bourse ne paie que des achats des PNJ (migration 1110, test 530). Hors du revenu public, que seul son robinet
-- débite (migration 1300, test 580).
create function pg_temp.spend(amount bigint) returns void language sql as $$
  with entry as (insert into game.ledger_entries (world_id, kind) values ('00000000-0000-7000-8000-00000000e520', 'test.spend')
                 returning id)
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry.id, (select account_id from game.npc_purses() where city_id = '00000000-0000-7000-8000-00000000c520'), -amount
    from entry
  union all
  select entry.id, (select id from game.accounts where world_id = '00000000-0000-7000-8000-00000000e520'
                      and system_key = 'faucet_npc_public_income'), amount
    from entry
$$;
select throws_like('select pg_temp.spend(500); set constraints all immediate',
  'the NPC purse of city % pays only NPC purchases', 'une bourse ne paie rien d''autre');

-- Service : il ne voit aucune bourse dans la table, ne les ouvre ni ne les modifie, mais les lit et les verrouille par
-- les fonctions, et les mouvemente par les journaux.
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
do $$
begin
  perform set_config('role', 'oikos_service', true);
  perform set_config('t.seen', (select count(*) from game.accounts where npc_purse)::text, true);
  perform set_config('t.treasuries', (select count(*) from game.accounts where city_id = '00000000-0000-7000-8000-00000000c520')::text, true);
  perform set_config('t.read', (select string_agg(city_id || ':' || balance, ',') from game.npc_purses()
    where world_id = '00000000-0000-7000-8000-00000000e520'), true);
  perform set_config('t.locked', (select string_agg(city_id::text, ',' order by city_id) from game.lock_npc_purses('01900000-0000-7000-8000-000000000001')), true);
  perform set_config('t.one', (select count(*) from game.lock_npc_purses('01900000-0000-7000-8000-000000000001',
    '01900000-0000-7000-8000-000000000103'))::text, true);
  perform set_config('role', 'none', true);
end $$;
select is(current_setting('t.seen'), '0', 'le service ne voit aucune bourse dans la table');
select is(current_setting('t.treasuries'), '1', 'chercher le compte d''une cité ne lui rend que son trésor');
select is(current_setting('t.read'), '00000000-0000-7000-8000-00000000c520:500', 'il lit les bourses par la fonction');
select is(current_setting('t.locked'), (select string_agg(id::text, ',' order by id) from game.cities
  where world_id = '01900000-0000-7000-8000-000000000001'), 'il verrouille celles d''un monde, par cité');
select is(current_setting('t.one'), '1', 'ou celle d''une cité');
select throws_ok($$select pg_temp.as_service($s$insert into game.accounts (world_id, kind, city_id, npc_purse)
  values ('00000000-0000-7000-8000-00000000e520', 'treasury', '00000000-0000-7000-8000-00000000c520', true)$s$)$$, '42501', null,
  'le service n''ouvre pas de bourse');
select lives_ok($$select pg_temp.as_service('select pg_temp.fund(30)')$$, 'il crédite une bourse par le grand livre');
select is((select balance from game.accounts where npc_purse and city_id = '00000000-0000-7000-8000-00000000c520'), 530::bigint,
  'et le solde suit');

-- Une ligne d'une bourse d'un autre monde déséquilibre l'écriture, même écrite par le service qui ne la voit pas.
create function pg_temp.foreign_line() returns void language plpgsql as $$
declare
  entry uuid;
begin
  -- Une écriture qui peut créditer cette bourse (migration 1200) : seul le monde de ses comptes la fait refuser.
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', 'npc.public_income',
    '{"cityId": "00000000-0000-7000-8000-00000000c520", "gameDay": 999}') returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values
    (entry, (select account_id from game.npc_purses() where city_id = '00000000-0000-7000-8000-00000000c520'), 5),
    (entry, (select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001'
               and system_key = 'faucet_npc_public_income'), -5);
  set constraints all immediate;
end $$;
grant execute on function pg_temp.foreign_line() to oikos_service;
select throws_like($$select pg_temp.as_service('select pg_temp.foreign_line()')$$, '%foreign accounts: 1)',
  'une bourse d''un autre monde est un compte étranger');

-- Joueurs : ni la fonction, ni la bourse dans les comptes publics du trésor.
select ok(not has_function_privilege('authenticated', 'game.npc_purses()', 'execute')
  and not has_function_privilege('anon', 'game.lock_npc_purses(uuid, uuid)', 'execute'), 'aucun joueur n''exécute ces fonctions');
select is((select count(*) from game.city_treasuries() where city_id = '00000000-0000-7000-8000-00000000c520'), 1::bigint,
  'le trésor public d''une cité reste une ligne, sans la bourse');

select * from finish();
rollback;
