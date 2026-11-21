begin;
select plan(50);

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
-- Écriture de banque au nom du service : `kind`, nommant la banque de `named`, de `amount` oboles de `src` à `dst`
-- (et `extra` oboles de plus de `src` au puits du droit, pour une troisième ligne) ; contrôles différés joués aussitôt.
create function pg_temp.post(kind text, named text, src text, dst text, amount bigint, extra bigint = 0)
returns void language plpgsql as $$
declare entry uuid; bank uuid := pg_temp.bank(named); a_src uuid := pg_temp.account(src); a_dst uuid := pg_temp.account(dst);
  sink uuid := pg_temp.account('sink_bank_charter');
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000726f0', kind, jsonb_build_object('bankId', bank))
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, a_dst, amount), (entry, a_src, -amount - extra);
  if extra > 0 then
    insert into game.ledger_lines (entry_id, account_id, amount) values (entry, sink, extra);
  end if;
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
-- Lignes ajoutées après coup, au nom du service, à la dernière écriture `kind` de la banque de `named` déjà validée :
-- `amount` oboles de `src` à `dst` ; contrôles différés joués aussitôt.
create function pg_temp.append(kind text, named text, src text, dst text, amount bigint)
returns void language plpgsql as $$
declare entry uuid := (select e.id from game.ledger_entries e where e.kind = append.kind
                         and e.meta ->> 'bankId' = pg_temp.bank(named)::text order by e.id desc limit 1);
  a_src uuid := pg_temp.account(src); a_dst uuid := pg_temp.account(dst);
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, a_dst, amount), (entry, a_src, -amount);
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
-- Fondation comme l'écrit la commande, au nom du service : la banque, pour un droit `declared` (`fee` sinon), son
-- écriture de droit (`fee`), puis son capital ; contrôles différés joués aussitôt.
create function pg_temp.found(n text, name text, fee bigint, capital bigint, city text = 'c1', declared bigint = null)
returns void language plpgsql as $$
declare h uuid := pg_temp.house(n);
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
  values ('01900000-0000-7000-8000-0000000726f0', ('01900000-0000-7000-8000-0000000726' || city)::uuid, h, name, 100, 500,
          coalesce(declared, fee));
  perform set_config('role', 'none', true);
  if fee > 0 then
    perform pg_temp.post('bank.charter', n, n, 'sink_bank_charter', fee);
  end if;
  if capital > 0 then
    perform pg_temp.post('bank.capital_in', n, n, 'vault:' || n, capital);
  end if;
  set constraints all immediate;
  set constraints all deferred;
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
  (select string_agg(grantee || ':' || privilege_type || ':' || column_name, ' ' order by grantee, column_name)
   from information_schema.column_privileges where table_schema = 'game' and table_name = 'banks'
     and privilege_type in ('UPDATE', 'DELETE') and grantee in ('oikos_service', 'authenticated', 'anon')),
  'oikos_service:UPDATE:deposit_rate_bps oikos_service:UPDATE:loan_rate_bps',
  'personne ne modifie une banque, sauf le service ses taux (#727)');
select ok(not has_table_privilege('authenticated', 'game.banks', 'select')
          and not has_table_privilege('anon', 'game.banks', 'select'), 'les joueurs ne lisent pas la table');

-- Fondation : une maison de joueur, dans sa cité, une banque au plus ; le coffre naît avec elle.
select throws_ok($$select pg_temp.found('e', 'Trapeza Sitos', 0, 0)$$, '23514', 'a bank belongs to a player house, in its city',
  'une maison PNJ ne fonde pas de banque');
select throws_ok($$select pg_temp.found('a', 'Trapeza Alkmaion', 0, 0, city => 'c2')$$, '23514',
  'a bank belongs to a player house, in its city', 'ni une maison hors de sa cité');
select throws_ok($$select pg_temp.found('a', 'Trapeza Alkmaion', 1000, 0, declared => 999)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'le droit payé est celui de la banque');
select throws_ok($$select pg_temp.found('a', 'Trapeza Alkmaion', 0, 0, declared => 1000)$$, '23001',
  'a bank pays its charter fee by its own entry', 'un droit dû a son écriture');
select throws_ok($$select pg_temp.found('a', 'Trapeza Alkmaion', 0, 0, declared => -1)$$, '23514', null, 'un droit n''est pas négatif');
select throws_ok($$select pg_temp.found('a', 'T', 0, 0)$$, '23514', null, 'un nom de trois lettres au moins');
select is((select count(*) from game.banks where world_id = '01900000-0000-7000-8000-0000000726f0'), 0::bigint,
  'aucun refus n''a fondé de banque');
select lives_ok($$select pg_temp.found('a', 'Trapeza Alkmaion', 5000, 20000)$$,
  'Alice fonde sa banque : 5 000 de droit, 20 000 de capital');
select is(
  (select concat_ws(':', a.kind, a.city_id = b.city_id, a.house_id is null, a.npc_purse, a.allow_negative, a.balance)
   from game.accounts a join game.banks b on b.id = a.bank_id where b.id = pg_temp.bank('a')),
  'treasury:t:t:f:f:20000', 'son coffre est un compte de sa cité, jamais débiteur, qui tient le capital');
select is(array[pg_temp.balance('a'), pg_temp.balance('sink_bank_charter')], array[25000, 5000]::bigint[],
  'le droit est détruit par le puits, le capital quitte la trésorerie');
select is((select founded_at from game.banks where id = pg_temp.bank('a')), now(), 'la base date la fondation');
select throws_ok($$select pg_temp.found('a', 'Trapeza Deutera', 0, 0)$$, '23505', null, 'une banque par maison');
select throws_ok($$select pg_temp.found('b', 'trapeza alkmaion', 0, 0)$$, '23505', null, 'un nom unique dans le monde, casse ignorée');
select lives_ok($$select pg_temp.found('b', 'Trapeza Philaios', 0, 0)$$, 'Bob fonde la sienne sans droit ni capital');
select is(pg_temp.balance('vault:b'), 0::bigint, 'son coffre est vide');
select lives_ok($$select pg_temp.found('c', 'Trapeza Kerykon', 0, 1, city => 'c2')$$, 'Chloé fonde la sienne à Elaia, une obole au coffre');
select is((select count(*) from game.accounts where city_id = '01900000-0000-7000-8000-0000000726c1' and kind = 'treasury'),
  4::bigint, 'Kallistè a son trésor, sa bourse et deux coffres');
select throws_ok($$select pg_temp.post('bank.charter', 'b', 'b', 'sink_bank_charter', 10)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'une banque fondée sans droit n''en paie pas après coup');
select throws_ok($$select pg_temp.post('bank.charter', 'a', 'a', 'sink_bank_charter', 5000)$$, '23505', null,
  'même pour une banque qui l''a déjà payé');

-- Capital : de la trésorerie de la maison au coffre de sa banque, ou l'inverse ; le coffre n'est jamais débiteur.
select lives_ok($$select pg_temp.post('bank.capital_in', 'a', 'a', 'vault:a', 5000)$$, 'Alice verse 5 000 au coffre');
select lives_ok($$select pg_temp.post('bank.capital_out', 'a', 'vault:a', 'a', 7000)$$, 'puis en retire 7 000');
select is(array[pg_temp.balance('a'), pg_temp.balance('vault:a')], array[27000, 18000]::bigint[],
  'le capital passe d''un compte à l''autre, sans création ni destruction');
select throws_ok($$select pg_temp.post('bank.capital_out', 'a', 'vault:a', 'a', 18001)$$, '23514', null,
  'un coffre n''est jamais débiteur');
select lives_ok($$select pg_temp.post('bank.capital_out', 'a', 'vault:a', 'a', 18000)$$, 'il se vide jusqu''à zéro');
select lives_ok($$select pg_temp.post('bank.capital_in', 'a', 'a', 'vault:a', 18000)$$, 'et se remplit de nouveau');
select throws_ok($$select pg_temp.post('bank.capital_in', 'a', 'b', 'vault:a', 100)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'une autre maison ne verse pas au coffre d''Alice');
select throws_ok($$select pg_temp.post('bank.capital_out', 'a', 'vault:a', 'b', 100)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'ni n''en retire');
select throws_ok($$select pg_temp.post('bank.capital_in', 'b', 'a', 'vault:a', 100)$$, '23514',
  null, 'une écriture de la banque de Bob ne touche pas le coffre d''Alice');
select throws_ok($$select pg_temp.post('bank.capital_in', 'a', 'a', 'vault:a', 100, extra => 10)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee', 'deux lignes, pas trois');
select throws_ok($$select pg_temp.post('bank.capital_out', 'a', 'a', 'vault:a', 100)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'un retrait sort du coffre, il n''y entre pas');
select throws_ok($$select pg_temp.post('bank.capital_in', 'a', 'faucet_starting_grant', 'a', 100)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'une écriture de capital ne crée pas de monnaie');
select throws_ok($$select pg_temp.post('house.starting_grant', 'a', 'faucet_starting_grant', 'vault:a', 100)$$, '23514',
  'the vault of bank ' || pg_temp.bank('a') || ' moves only by its own bank entries', 'un robinet ne crédite pas un coffre');
select throws_ok($$select pg_temp.post('city.public_works', 'a', 'vault:a', 'sink_public_works', 100)$$, '23514',
  'the vault of bank ' || pg_temp.bank('a') || ' moves only by its own bank entries', 'ni un puits ne le débite');
select throws_ok($$select pg_temp.as_service($s$insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000726f0', 'bank.capital_in', '{"bankId": "ABC"}')$s$)$$, '23514', null,
  'une écriture de banque nomme sa banque');
-- Une écriture de banque validée ne gagne pas de lignes, même équilibrées : le contrôle de l'écriture entière se rejoue.
select throws_ok($$select pg_temp.append('bank.capital_in', 'a', 'vault:a', 'b', 300)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'ligne ajoutée après coup à un versement : refusée');
select throws_ok($$select pg_temp.append('bank.capital_out', 'a', 'vault:a', 'b', 100)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'ligne ajoutée après coup à un retrait : refusée');
select throws_ok($$select pg_temp.append('bank.charter', 'a', 'sink_bank_charter', 'b', 10)$$, '23001',
  'a bank entry moves money between its house treasury and its vault, or pays its charter fee',
  'ligne ajoutée après coup au droit de fondation : refusée');
select is(array[pg_temp.balance('a'), pg_temp.balance('b'), pg_temp.balance('vault:a')], array[27000, 50000, 18000]::bigint[],
  'aucun refus n''a rien changé');

-- Le service ne voit pas les coffres, qu'il verrouille par sa fonction ; un joueur ne la lance pas.
select is((select count(*)::integer from game.accounts where bank_id is not null and world_id = '01900000-0000-7000-8000-0000000726f0'),
  3, 'trois coffres');
select lives_ok($$select pg_temp.as_service($s$create temporary table seen as select count(*) as n from game.accounts
  where world_id = '01900000-0000-7000-8000-0000000726f0' and kind = 'treasury'$s$)$$, 'le service lit les comptes de cité');
select is((select n from seen), 2::bigint, 'mais n''y voit que les deux trésors, ni bourse ni coffre');
select is((select balance from game.lock_bank_vault(pg_temp.bank('a'))), 18000::bigint, 'il verrouille un coffre par sa banque');
select ok(not has_function_privilege('authenticated', 'game.lock_bank_vault(uuid)', 'execute'), 'un joueur ne le verrouille pas');
select is((select count(*) from game.city_treasuries() where city_id = '01900000-0000-7000-8000-0000000726c1'), 1::bigint,
  'les comptes publics du trésor ne comptent pas les coffres');

-- Une banque ne se supprime pas et garde son identité, même pour le propriétaire.
select throws_ok($$update game.banks set name = 'Trapeza Nea' where id = pg_temp.bank('a')$$, '23001', 'a bank keeps its identity',
  'une banque garde son nom et sa maison');
select throws_ok($$delete from game.banks where id = pg_temp.bank('b')$$, '23001', null, 'une banque ne se supprime pas');

select * from finish();
rollback;
