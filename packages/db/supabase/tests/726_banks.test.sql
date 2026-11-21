begin;
select plan(26);

-- Jeu d'essai : un monde à lui, deux cités. Alice (a) et Bob (b), maisons de joueur, et les Greniers (e), maison PNJ, sont
-- de Kallistè (k) ; Chloé (c) est d'Elaia (l). Trésoreries : 50 000 chacune.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000726f0', 'banques-726', 'Banques');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000726c1', '01900000-0000-7000-8000-0000000726f0', 'k726', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000726c2', '01900000-0000-7000-8000-0000000726f0', 'l726', 'Elaia');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000726a' || n)::uuid, 'banks-726-' || n || '@example.test' from unnest(array['a', 'b', 'c']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000726' || n || '1')::uuid, '01900000-0000-7000-8000-0000000726f0',
       case when kind = 'player' then ('00000000-0000-4000-8000-0000000726a' || n)::uuid end, name, '{}', kind
from (values ('a', 'Alcméonides', 'player'), ('b', 'Philaïdes', 'player'), ('c', 'Kerykes', 'player'),
             ('e', 'Greniers', 'npc')) h (n, name, kind);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000000726' || n || '1')::uuid, ('01900000-0000-7000-8000-0000000726' || c)::uuid
from (values ('a', 'c1'), ('b', 'c1'), ('c', 'c2'), ('e', 'c1')) h (n, c);
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000726f0';
do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000726f0', 'house.starting_grant')
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then 50000 else -200000 end from game.accounts
  where (world_id = '01900000-0000-7000-8000-0000000726f0' and kind = 'house')
     or (world_id = '01900000-0000-7000-8000-0000000726f0' and system_key = 'faucet_starting_grant');
end $$;

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000726' || n || '1')::uuid
$$;
create function pg_temp.bank(n text) returns uuid language sql as $$
  select id from game.banks where house_id = pg_temp.house(n)
$$;
-- Compte : la trésorerie d'une maison (`a`), le coffre de sa banque (`vault:a`) ou un compte système du monde.
create function pg_temp.account(n text) returns uuid language sql as $$
  select id from game.accounts
  where case when n like 'vault:%' then bank_id = pg_temp.bank(substr(n, 7))
             when length(n) = 1 then kind = 'house' and house_id = pg_temp.house(n)
             else world_id = '01900000-0000-7000-8000-0000000726f0' and system_key = n end
$$;
create function pg_temp.balance(n text) returns bigint language sql as $$
  select balance from game.accounts where id = pg_temp.account(n)
$$;
-- Fondation comme l'écrit la commande, au nom du service : la banque, pour un droit `fee` (la migration 9941 tiendra ses
-- écritures).
create function pg_temp.found(n text, name text, fee bigint = 0, city text = 'c1')
returns void language plpgsql as $$
declare h uuid := pg_temp.house(n);
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
  values ('01900000-0000-7000-8000-0000000726f0', ('01900000-0000-7000-8000-0000000726' || city)::uuid, h, name, 100, 500,
          fee);
  perform set_config('role', 'none', true);
end $$;

-- Catalogue et droits du service.
select is((select allow_negative from game.accounts
           where world_id = '01900000-0000-7000-8000-0000000726f0' and system_key = 'sink_bank_charter'),
  false, 'chaque monde a le puits du droit de fondation, jamais débiteur');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'banks' and privilege_type = 'INSERT'),
  'charter_fee city_id deposit_rate_bps house_id loan_rate_bps name world_id',
  'le service ne choisit ni l''identifiant ni la date d''une banque');
select is(
  (select count(*)::integer from information_schema.column_privileges where table_schema = 'game' and table_name = 'banks'
     and privilege_type in ('UPDATE', 'DELETE') and grantee in ('oikos_service', 'authenticated', 'anon')),
  0, 'personne ne modifie une banque');
select ok(not has_table_privilege('authenticated', 'game.banks', 'select')
          and not has_table_privilege('anon', 'game.banks', 'select'), 'les joueurs ne lisent pas la table');

-- Fondation : une maison de joueur, dans sa cité, une banque au plus ; le coffre naît avec elle.
select throws_ok($$select pg_temp.found('e', 'Trapeza Sitos')$$, '23514', 'a bank belongs to a player house, in its city',
  'une maison PNJ ne fonde pas de banque');
select throws_ok($$select pg_temp.found('a', 'Trapeza Alkmaion', city => 'c2')$$, '23514',
  'a bank belongs to a player house, in its city', 'ni une maison hors de sa cité');
select throws_ok($$select pg_temp.found('a', 'Trapeza Alkmaion', -1)$$, '23514', null, 'un droit n''est pas négatif');
select throws_ok($$select pg_temp.found('a', 'T')$$, '23514', null, 'un nom de trois lettres au moins');
select is((select count(*) from game.banks where world_id = '01900000-0000-7000-8000-0000000726f0'), 0::bigint,
  'aucun refus n''a fondé de banque');
select lives_ok($$select pg_temp.found('a', 'Trapeza Alkmaion', 5000)$$, 'Alice fonde sa banque');
select is(
  (select concat_ws(':', a.kind, a.city_id = b.city_id, a.house_id is null, a.npc_purse, a.allow_negative, a.balance)
   from game.accounts a join game.banks b on b.id = a.bank_id where b.id = pg_temp.bank('a')),
  'treasury:t:t:f:f:0', 'son coffre est un compte de sa cité, jamais débiteur, vide');
select is((select founded_at from game.banks where id = pg_temp.bank('a')), now(), 'la base date la fondation');
select throws_ok($$select pg_temp.found('a', 'Trapeza Deutera')$$, '23505', null, 'une banque par maison');
select throws_ok($$select pg_temp.found('b', 'trapeza alkmaion')$$, '23505', null, 'un nom unique dans le monde, casse ignorée');
select lives_ok($$select pg_temp.found('b', 'Trapeza Philaios')$$, 'Bob fonde la sienne sans droit');
select is(pg_temp.balance('vault:b'), 0::bigint, 'son coffre est vide');
select lives_ok($$select pg_temp.found('c', 'Trapeza Kerykon', city => 'c2')$$, 'Chloé fonde la sienne à Elaia');
select is((select count(*) from game.accounts where city_id = '01900000-0000-7000-8000-0000000726c1' and kind = 'treasury'),
  4::bigint, 'Kallistè a son trésor, sa bourse et deux coffres');

-- Le service ne voit pas les coffres, qu'il verrouille par sa fonction ; un joueur ne la lance pas.
select is((select count(*)::integer from game.accounts where bank_id is not null and world_id = '01900000-0000-7000-8000-0000000726f0'),
  3, 'trois coffres');
select lives_ok($$select pg_temp.as_service($s$create temporary table seen as select count(*) as n from game.accounts
  where world_id = '01900000-0000-7000-8000-0000000726f0' and kind = 'treasury'$s$)$$, 'le service lit les comptes de cité');
select is((select n from seen), 2::bigint, 'mais n''y voit que les deux trésors, ni bourse ni coffre');
select is((select balance from game.lock_bank_vault(pg_temp.bank('a'))), 0::bigint, 'il verrouille un coffre par sa banque');
select ok(not has_function_privilege('authenticated', 'game.lock_bank_vault(uuid)', 'execute'), 'un joueur ne le verrouille pas');
select is((select count(*) from game.city_treasuries() where city_id = '01900000-0000-7000-8000-0000000726c1'), 1::bigint,
  'les comptes publics du trésor ne comptent pas les coffres');

-- Une banque ne se supprime pas et garde son identité, même pour le propriétaire.
select throws_ok($$update game.banks set name = 'Trapeza Nea' where id = pg_temp.bank('a')$$, '23001', 'a bank keeps its identity',
  'une banque garde son nom et sa maison');
select throws_ok($$delete from game.banks where id = pg_temp.bank('b')$$, '23001', null, 'une banque ne se supprime pas');

select * from finish();
rollback;
