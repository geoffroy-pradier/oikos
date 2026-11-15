begin;
select plan(42);

-- Jeu d'essai : deux maisons avec un compte chacune, un robinet et un puits.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000000aa', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000b1');
create function pg_temp.faucet() returns uuid language sql as
  $$select id from game.accounts where system_key = 'faucet_npc_purchases' and world_id = '01900000-0000-7000-8000-000000000001'$$;
-- Passe une écriture et force le contrôle différé, comme le ferait la validation de la transaction.
create function pg_temp.post(accounts uuid[], amounts bigint[]) returns void language plpgsql as $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'test') returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) select entry, a, m from unnest(accounts, amounts) as t(a, m);
  set constraints all immediate;
  set constraints all deferred;
end $$;

-- Ajoute une ligne isolée à une écriture déjà passée.
create function pg_temp.append_line() returns void language plpgsql as $$
begin
  insert into game.ledger_lines (entry_id, account_id, amount)
    select id, '00000000-0000-7000-8000-0000000000aa', 10 from game.ledger_entries limit 1;
  set constraints all immediate;
  set constraints all deferred;
end $$;

-- Écriture équilibrée : le robinet crée 600 oboles pour Alice, puis Alice en verse 250 à Bob.
select lives_ok($$select pg_temp.post(array[pg_temp.faucet(), '00000000-0000-7000-8000-0000000000aa'], array[-600, 600])$$, 'création de monnaie par un robinet');
select lives_ok($$select pg_temp.post(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-250, 250])$$, 'virement entre maisons');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000aa'), 350::bigint, 'solde d''Alice');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000bb'), 250::bigint, 'solde de Bob');
select is((select balance from game.accounts where id = pg_temp.faucet()), -600::bigint, 'le robinet porte la monnaie créée');
select is((select sum(balance) from game.accounts), 0::numeric, 'conservation : la somme de tous les soldes est nulle');
select is((select count(*) from game.account_balance_check where not ok), 0::bigint, 'vue de contrôle : solde = cumul des lignes');

-- Écritures refusées.
select throws_ok($$select pg_temp.post(array[pg_temp.faucet(), '00000000-0000-7000-8000-0000000000aa'], array[-100, 99])$$, '23514', null, 'somme non nulle refusée');
select throws_ok($$select pg_temp.post(array['00000000-0000-7000-8000-0000000000aa']::uuid[], array[5])$$, '23514', null, 'une seule ligne refusée');
select throws_ok($$select pg_temp.post(array['00000000-0000-7000-8000-0000000000aa', '00000000-0000-7000-8000-0000000000bb']::uuid[], array[-351, 351])$$, '23514', null, 'découvert refusé pour une maison');
select throws_ok($$insert into game.ledger_lines (entry_id, account_id, amount) select id, pg_temp.faucet(), 0 from game.ledger_entries limit 1$$, '23514', null, 'montant nul refusé');
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'game' and (table_name, column_name) in (('ledger_lines', 'amount'), ('accounts', 'balance')
     ) and data_type = 'bigint'),
  2::bigint, 'montants et quantités en entiers (bigint), aucun flottant');
select throws_ok('select pg_temp.append_line()', '23514', null, 'ligne ajoutée après coup à une écriture : déséquilibre refusé');
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000aa'), 350::bigint, 'les écritures refusées n''ont rien changé');

-- Les journaux sont en ajout seul et les soldes ne se modifient que par eux.
select throws_ok('update game.ledger_lines set amount = amount * 2', '23001', null, 'ligne non modifiable');
select throws_ok('delete from game.ledger_entries', '23001', null, 'écriture non supprimable');
select throws_ok($$update game.accounts set balance = 1000000 where kind = 'house'$$, '23001', null, 'solde non modifiable directement');
select throws_ok($$insert into game.accounts (world_id, kind, house_id, allow_negative) values ('01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1', true)$$, '23514', null, 'pas de découvert autorisé pour un compte de maison');

-- Un contrôle, un test.
select throws_ok($$do $do$ begin
    insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'test');
    set constraints all immediate;
  end $do$;$$, '23514', null, 'écriture sans ligne refusée');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
-- Le second monde a reçu ses comptes système à sa création (migration 13).
select throws_ok($$select pg_temp.post(array[(select id from game.accounts where system_key = 'faucet_npc_purchases' and world_id = '01900000-0000-7000-8000-000000000002'), '00000000-0000-7000-8000-0000000000aa']::uuid[], array[-10, 10])$$,
  '23514', null, 'compte d''un autre monde refusé dans une écriture');
select throws_ok($$select pg_temp.post(array[(select id from game.accounts where system_key = 'sink_upkeep' and world_id = '01900000-0000-7000-8000-000000000001'), '00000000-0000-7000-8000-0000000000aa'], array[-10, 10])$$,
  '23514', null, 'un puits ne crée pas de monnaie');
-- Une ligne écartée par ON CONFLICT DO NOTHING ne touche aucun solde.
insert into game.ledger_lines (id, entry_id, account_id, amount)
  select id, entry_id, '00000000-0000-7000-8000-0000000000aa', 1000000 from game.ledger_lines limit 1
  on conflict do nothing;
select is((select balance from game.accounts where id = '00000000-0000-7000-8000-0000000000aa'), 350::bigint, 'ON CONFLICT DO NOTHING ne crée pas de monnaie');
select throws_ok($$insert into game.accounts (world_id, kind, system_key, balance) values ('01900000-0000-7000-8000-000000000001', 'system', 'cheat', 5000000)$$,
  '23001', null, 'un compte naît à zéro');
select throws_ok($$update game.accounts set kind = 'system', house_id = null, system_key = 'was_house', allow_negative = true where id = '00000000-0000-7000-8000-0000000000aa'$$,
  '23001', null, 'un compte de maison ne devient pas compte système');
select throws_ok($$update game.accounts set world_id = '01900000-0000-7000-8000-000000000002' where id = pg_temp.faucet()$$,
  '23001', null, 'un compte ne change pas de monde');
select throws_ok($$update game.accounts set allow_negative = true where id = '00000000-0000-7000-8000-0000000000bb'$$,
  '23001', null, 'le droit au découvert ne se modifie pas');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000c', 'chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', 'Eupatrides', '{}');
select throws_ok($$insert into game.accounts (world_id, kind, house_id) values ('01900000-0000-7000-8000-000000000002', 'house', '00000000-0000-7000-8000-0000000000c1')$$,
  '23503', null, 'compte d''une maison d''un autre monde refusé');
select throws_ok('delete from game.ledger_lines', '23001', null, 'ligne non supprimable');
select throws_ok('truncate game.ledger_lines', '23001', null, 'lignes non vidables');
select throws_ok('truncate game.ledger_entries cascade', '23001', null, 'écritures non vidables');
select is(
  (select count(*) from pg_class where relnamespace = 'game'::regnamespace and relrowsecurity
     and relname in ('accounts', 'ledger_entries', 'ledger_lines')),
  3::bigint, 'règles par ligne actives sur les trois tables');

-- Suite de la relecture des stocks : contrôles de la monnaie restés sans test.
select throws_ok($$insert into game.accounts (world_id, kind, house_id) values ('01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000000a1')$$, '23505', null, 'un seul compte par maison');
select throws_ok($$insert into game.accounts (world_id, kind, system_key, allow_negative) values ('01900000-0000-7000-8000-000000000001', 'system', 'faucet_npc_purchases', true)$$, '23505', null, 'clé système unique par monde');
select throws_ok($$insert into game.accounts (world_id, kind, system_key) values ('01900000-0000-7000-8000-000000000001', 'bank', 'x_y')$$, '23514', null, 'nature de compte inconnue refusée');
select throws_ok($$insert into game.accounts (world_id, kind, system_key) values ('01900000-0000-7000-8000-000000000001', 'system', 'Bad Key')$$, '23514', null, 'clé système mal formée refusée');
select throws_ok($$insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'Bad Kind')$$, '23514', null, 'nature d''écriture mal formée refusée');
select throws_ok($$insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', 'test', '[]')$$, '23514', null, 'les métadonnées sont un objet');
select throws_ok($$update game.ledger_entries set kind = 'autre'$$, '23001', null, 'écriture non modifiable');
select throws_ok($$update game.accounts set id = game.uuid_v7() where id = '00000000-0000-7000-8000-0000000000bb'$$, '23001', null, 'identifiant de compte immuable');
alter table game.accounts disable trigger accounts_guard;
update game.accounts set balance = balance + 9 where id = '00000000-0000-7000-8000-0000000000bb';
alter table game.accounts enable trigger accounts_guard;
select results_eq(
  $$select account_id, balance - lines_total from game.account_balance_check where not ok$$,
  $$values ('00000000-0000-7000-8000-0000000000bb'::uuid, 9::bigint)$$, 'la vue de contrôle désigne le compte en écart et son montant');

-- Droits clients sur la monnaie. Aucun droit à l'échelle d'une table, lecture comprise ; aucune écriture
-- ni référence à l'échelle d'une colonne ; aucune colonne lisible par un visiteur, ni de la vue de
-- contrôle par un joueur. Restent à un joueur les colonnes figées dans 002, sous les règles par ligne
-- que prouvent 009 et 027. Une table partitionnée un jour (`relkind 'p'`) reste couverte, partitions
-- comprises, sans aucune colonne lisible sur une partition (lue directement, elle échappe aux règles de
-- sa table) ; une relation renommée ou disparue fait échouer le test au lieu de le vider.
create temporary table money_relations on commit drop as
select c.oid, c.relname, c.relkind, c.oid = r.root as is_root
from unnest(array['accounts', 'ledger_entries', 'ledger_lines', 'account_balance_check']) n
cross join lateral (select to_regclass('game.' || n) as root) r
cross join lateral (select r.root union select p.relid from pg_partition_tree(r.root) p) t(oid)
join pg_class c on c.oid = t.oid;
select is(
  (select string_agg(relname, ' ' order by relname) from money_relations
   where relname in ('accounts', 'ledger_entries', 'ledger_lines', 'account_balance_check') and relkind in ('r', 'p', 'v')),
  'account_balance_check accounts ledger_entries ledger_lines', 'monnaie : les quatre relations contrôlées sont toutes trouvées (table, table partitionnée ou vue)');
select is(
  (select count(*) from money_relations c, unnest(array['anon', 'authenticated']) r,
          unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
   where c.relkind in ('r', 'p', 'v')
     and (has_table_privilege(r, c.oid, p)
          or (p in ('insert', 'update', 'references') and has_any_column_privilege(r, c.oid, p))
          or (p = 'select' and (r = 'anon' or c.relname = 'account_balance_check' or not c.is_root) and has_any_column_privilege(r, c.oid, p)))),
  0::bigint, 'monnaie : aucune écriture cliente, de table ou de colonne ; aucune table lisible en entier ; rien pour un visiteur ni sur une partition');

select * from finish();
rollback;
