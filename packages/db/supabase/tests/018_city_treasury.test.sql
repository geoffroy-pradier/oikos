begin;
select plan(22);

-- La cité de test (seed) a son trésor sans qu'aucun script ne l'ouvre : à zéro, jamais débiteur.
select results_eq(
  $$select world_id, balance, allow_negative, house_id, system_key from game.accounts
    where kind = 'treasury' and not npc_purse and city_id = '01900000-0000-7000-8000-000000000101'$$,
  $$values ('01900000-0000-7000-8000-000000000001'::uuid, 0::bigint, false, null::uuid, null::text)$$,
  'la cité de test a un trésor, à zéro, dans son monde');
select is((select count(*) from game.accounts where kind = 'treasury' and not npc_purse), (select count(*) from game.cities),
  'un trésor par cité, pas un de plus');

-- Une cité naît avec son trésor, dans son monde.
insert into game.worlds (id, slug, name) values ('00000000-0000-7000-8000-00000000e001', 'essai-tresor', 'Essai');
insert into game.cities (id, world_id, slug, name) values
  ('00000000-0000-7000-8000-00000000c001', '00000000-0000-7000-8000-00000000e001', 'delos', 'Délos');
select is(
  (select array_agg(world_id) from game.accounts where kind = 'treasury' and not npc_purse and city_id = '00000000-0000-7000-8000-00000000c001'),
  array['00000000-0000-7000-8000-00000000e001'::uuid], 'une cité naît avec un trésor, dans son monde');

-- Forme du compte : un seul par cité, sans maison ni clé système, jamais débiteur, dans le monde de la cité.
select throws_ok($$insert into game.accounts (world_id, kind, city_id)
  values ('00000000-0000-7000-8000-00000000e001', 'treasury', '00000000-0000-7000-8000-00000000c001')$$, '23505', null,
  'pas de second trésor pour une cité');
select throws_ok($$insert into game.accounts (world_id, kind, city_id)
  values ('01900000-0000-7000-8000-000000000001', 'treasury', '00000000-0000-7000-8000-00000000c001')$$, '23505', null,
  'ni dans un autre monde');
delete from game.accounts where city_id = '00000000-0000-7000-8000-00000000c001';
select throws_ok($$insert into game.accounts (world_id, kind, city_id)
  values ('01900000-0000-7000-8000-000000000001', 'treasury', '00000000-0000-7000-8000-00000000c001')$$, '23503', null,
  'un trésor est tenu dans le monde de sa cité');
select throws_ok($$insert into game.accounts (world_id, kind, city_id, allow_negative)
  values ('00000000-0000-7000-8000-00000000e001', 'treasury', '00000000-0000-7000-8000-00000000c001', true)$$, '23514', null,
  'un trésor ne peut pas devenir débiteur');
select throws_ok($$insert into game.accounts (world_id, kind) values ('00000000-0000-7000-8000-00000000e001', 'treasury')$$,
  '23514', null, 'un trésor a une cité');
select throws_ok($$insert into game.accounts (world_id, kind, system_key, city_id)
  values ('00000000-0000-7000-8000-00000000e001', 'system', 'sink_city', '00000000-0000-7000-8000-00000000c001')$$, '23514', null,
  'un compte système n''a pas de cité');
select lives_ok($$insert into game.accounts (id, world_id, kind, city_id) values ('00000000-0000-7000-8000-0000000000cc',
  '00000000-0000-7000-8000-00000000e001', 'treasury', '00000000-0000-7000-8000-00000000c001')$$, 'le propriétaire ouvre un trésor');
select throws_ok($$update game.accounts set city_id = '01900000-0000-7000-8000-000000000101'
  where id = '00000000-0000-7000-8000-0000000000cc'$$, '23001', 'account identity is immutable', 'un trésor ne change pas de cité');

-- Service : il n'ouvre pas de trésor, mais le crédite par les journaux, sans jamais le rendre débiteur.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'alice@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000e001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-00000000e001', 'house', '00000000-0000-7000-8000-0000000000a1');
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Une écriture équilibrée à trois lignes : `gross` sort du robinet, `tax` va au trésor, le reste à la maison.
create function pg_temp.pay(gross bigint, tax bigint) returns void language plpgsql as $$
declare
  entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('00000000-0000-7000-8000-00000000e001', 'test') returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values
    (entry, (select id from game.accounts where world_id = '00000000-0000-7000-8000-00000000e001' and system_key = 'faucet_npc_purchases'), -gross),
    (entry, '00000000-0000-7000-8000-0000000000aa', gross - tax),
    (entry, '00000000-0000-7000-8000-0000000000cc', tax);
end $$;
grant execute on function pg_temp.pay(bigint, bigint) to oikos_service;
delete from game.accounts where id = '00000000-0000-7000-8000-0000000000cc';
select throws_ok($$select pg_temp.as_service($s$insert into game.accounts (world_id, kind, house_id, city_id) select world_id, k, house_id,
  '00000000-0000-7000-8000-00000000c001' from game.accounts, unnest(array['house', 'escrow']) k where id = '00000000-0000-7000-8000-0000000000aa'$s$)$$,
  '23514', 'new row for relation "accounts" violates check constraint "accounts_owner"', 'ni ne rattache une trésorerie ou un séquestre à une cité');
select throws_ok($$select pg_temp.as_service($s$insert into game.accounts (world_id, kind, city_id)
  values ('00000000-0000-7000-8000-00000000e001', 'treasury', '00000000-0000-7000-8000-00000000c001')$s$)$$, '42501', null,
  'le service n''ouvre pas de trésor');
drop policy service_all on game.accounts;
create policy service_all on game.accounts for all to oikos_service using (true) with check (true);
select throws_ok($$select pg_temp.as_service($s$insert into game.accounts (world_id, kind, city_id)
  values ('00000000-0000-7000-8000-00000000e001', 'treasury', '00000000-0000-7000-8000-00000000c001')$s$)$$, '42501',
  'system accounts are created with their world', 'même sans la règle par ligne : la garde refuse');
select throws_ok($$select pg_temp.as_service($s$
  create temporary table fake_cities (id uuid, world_id uuid);
  create trigger t after insert on fake_cities for each row execute function game.create_city_treasury()$s$)$$,
  '42501', null, 'le service n''attache pas create_city_treasury à sa table');
insert into game.accounts (id, world_id, kind, city_id) values ('00000000-0000-7000-8000-0000000000cc',
  '00000000-0000-7000-8000-00000000e001', 'treasury', '00000000-0000-7000-8000-00000000c001');
select lives_ok($$select pg_temp.as_service('select pg_temp.pay(100, 3)')$$, 'le service crédite le trésor dans l''écriture du paiement');
select results_eq(
  $$select kind, balance from game.accounts where world_id = '00000000-0000-7000-8000-00000000e001' and balance <> 0 order by kind$$,
  $$values ('house', 97::bigint), ('system', -100::bigint), ('treasury', 3::bigint)$$,
  'brut au débit du robinet, net à la maison, taxe au trésor : somme nulle');
select throws_ok($$select pg_temp.as_service('select pg_temp.pay(-10, -4)')$$, '23514',
  'new row for relation "accounts" violates check constraint "accounts_no_overdraft"', 'le trésor ne devient pas débiteur');
select throws_ok($$select pg_temp.as_service($s$update game.accounts set balance = 500 where kind = 'treasury'$s$)$$, '23001',
  'account balance changes only through ledger lines', 'le service ne modifie pas le solde d''un trésor à la main');
select is((select bool_and(ok) from game.account_balance_check where world_id = '00000000-0000-7000-8000-00000000e001'), true,
  'solde = cumul des lignes pour tous les comptes du monde');

-- Joueur : le trésor de la cité n'est pas lisible (aucune vue publique ne l'expose encore).
insert into game.citizenships (house_id, city_id) values ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000c001');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select is((select array_agg(kind) from game.accounts), array['house'], 'un joueur ne lit que la trésorerie de sa maison');
select is((select count(*) from public.my_treasury), 1::bigint, 'et sa vue de trésorerie n''a qu''une ligne');
reset role;

select * from finish();
rollback;
