begin;
select plan(36);

-- Jeu d'essai : un monde à lui, une cité, trois comptes : Alice et Bob y ont une maison, Chloé n'en a pas.
-- Charges, posées par le propriétaire, garde levée : un mandat fini d'Alice (A), un mandat fini de Bob (B) et un
-- mandat en cours de Bob (C). Aucune clôture du monde n'est enregistrée.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000704f0', 'honneur', 'Honneur');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000704f1', '01900000-0000-7000-8000-0000000704f0', 'kalliste', 'Kallistè');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000704a' || n)::uuid, 'honor-' || n || '@example.test' from unnest(array['a', 'b', 'c']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000704' || n || '1')::uuid, '01900000-0000-7000-8000-0000000704f0',
       ('00000000-0000-4000-8000-0000000704a' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes')) h (n, name);
-- Une élection non dépouillée par cité : chacune est dépouillée avant la suivante.
do $$
declare v record;
begin
  for v in select * from (values ('a', 90, -60), ('b', 59, -30), ('c', 29, 10)) v (n, d, e) loop
    insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
    values (('00000000-0000-7000-8000-0000000704e' || v.n)::uuid, '01900000-0000-7000-8000-0000000704f0',
            '01900000-0000-7000-8000-0000000704f1', 'archon', now() - (v.d + 3) * interval '1 day',
            now() - (v.d + 2) * interval '1 day', now() - (v.d + 1) * interval '1 day', now() + v.e * interval '1 day');
    update game.elections set tallied_at = now() where id = ('00000000-0000-7000-8000-0000000704e' || v.n)::uuid;
  end loop;
end $$;
alter table game.offices disable trigger offices_guard;
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select ('00000000-0000-7000-8000-0000000704' || n || '0')::uuid, world_id, city_id, office,
       ('00000000-0000-7000-8000-0000000704' || h || '1')::uuid, id, voting_closes_at, term_ends_at
from game.elections e join (values ('a', 'a'), ('b', 'b'), ('c', 'b')) v (n, h) on e.id = ('00000000-0000-7000-8000-0000000704e' || n)::uuid;
alter table game.offices enable trigger offices_guard;
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.credit(house text, office text, amount int, day int, reason text = 'archon_term') returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day) values (%L, %L, %s, %L, %L, %s)',
    '01900000-0000-7000-8000-0000000704f0', '00000000-0000-7000-8000-0000000704' || house || '1', amount, reason,
    '00000000-0000-7000-8000-0000000704' || office || '0', day))
$$;

-- Droits : le service lit et ajoute au journal sans choisir l'identifiant ni la date ; il ne touche jamais la Timè.
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name in ('honor', 'honor_ledger') and privilege_type <> 'SELECT'),
  'honor_ledger.amount:INSERT honor_ledger.game_day:INSERT honor_ledger.house_id:INSERT honor_ledger.reason:INSERT '
    || 'honor_ledger.reference:INSERT honor_ledger.world_id:INSERT',
  'le service n''écrit que les colonnes d''une ligne du journal');
select is(
  (select string_agg(table_name || ':' || privilege_type, ' ' order by table_name, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('house_honor', 'my_honor_entries') and grantee in ('anon', 'authenticated')),
  'house_honor:SELECT my_honor_entries:SELECT', 'lecture seule des deux vues, et rien pour un visiteur anonyme');
select is(
  (select string_agg(table_name || '.' || column_name, ' ' order by table_name, column_name) from information_schema.columns
   where table_schema = 'public' and table_name in ('house_honor', 'my_honor_entries')),
  'house_honor.dishonored house_honor.dishonored_until_day house_honor.honor house_honor.house_id my_honor_entries.amount my_honor_entries.created_at my_honor_entries.game_day '
    || 'my_honor_entries.house_id my_honor_entries.id my_honor_entries.reason my_honor_entries.reference',
  'colonnes des vues : liste figée');

alter table game.honor_ledger disable trigger honor_ledger_guard;
select throws_ok(
  $$insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day) values ('01900000-0000-7000-8000-0000000704f0',
    '00000000-0000-7000-8000-0000000704a1', 9007199254740991, 'test_seed', '00000000-0000-7000-8000-0000000704a0', 100),
    ('01900000-0000-7000-8000-0000000704f0', '00000000-0000-7000-8000-0000000704a1', 1, 'test_seed', '00000000-0000-7000-8000-0000000704b0', 100)$$,
  '23514', null, 'une Timè hors des entiers sûrs est refusée (garde levée, avant toute ligne en attente)');
alter table game.honor_ledger enable trigger honor_ledger_guard;

-- Crédit d'un mandat fini, par le service, dans la transaction d'une clôture pas encore enregistrée.
select lives_ok(pg_temp.credit('a', 'a', 25, 100), 'le service crédite la maison d''un mandat fini');
select is((select honor from game.honor where house_id = '00000000-0000-7000-8000-0000000704a1'), 25::bigint,
  'la Timè est le cumul du journal');
select throws_ok(pg_temp.credit('a', 'a', 25, 100), '23505', null, 'une seule ligne par motif et par référence');
select throws_ok(pg_temp.credit('a', 'a', 5, 101), '23505', null, 'même un autre jour, d''un autre montant');
select throws_ok(pg_temp.credit('b', 'c', 25, 100), '23001', 'an archon term is credited to its house once ended',
  'pas de crédit pour un mandat en cours');
select throws_ok(pg_temp.credit('a', 'b', 25, 100), '23001', 'an archon term is credited to its house once ended',
  'ni pour le mandat d''une autre maison');
select throws_ok(pg_temp.credit('b', 'a', 25, 100), '23001', 'an archon term is credited to its house once ended',
  'ni à une autre maison que celle du mandat');
select throws_ok(pg_temp.credit('b', 'b', -25, 100), '23001', 'a completed archon term raises Timè', 'un mandat mené à son terme ne fait rien perdre');
select throws_ok(pg_temp.credit('b', 'b', 25, 100, 'moderation_ban'), '23001', 'unknown Timè reason',
  'un motif hors de la liste fermée est refusé (une sanction de la modération n''en est pas un)');
select throws_ok(pg_temp.credit('b', 'b', 0, 100), '23514', null, 'une variation nulle n''a pas de ligne');
select throws_ok(pg_temp.credit('b', 'b', 25, -1), '23514', null, 'un jour de jeu positif ou nul');
select throws_ok(
  $$select pg_temp.as_service('insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day, created_at)
    values (''01900000-0000-7000-8000-0000000704f0'', ''00000000-0000-7000-8000-0000000704b1'', 1, ''archon_term'',
            ''00000000-0000-7000-8000-0000000704b0'', 100, now() - interval ''1 day'')')$$,
  '42501', null, 'le service ne date pas une ligne');
select throws_ok(
  $$select pg_temp.as_service('insert into game.honor (house_id, world_id) values (''00000000-0000-7000-8000-0000000704b1'', ''01900000-0000-7000-8000-0000000704f0'')')$$,
  '42501', null, 'ni n''écrit la Timè elle-même');
select throws_ok($$select pg_temp.as_service('update game.honor_ledger set amount = 99')$$, '42501', null,
  'ni ne modifie le journal');
select throws_ok($$select pg_temp.as_service('delete from game.honor_ledger')$$, '42501', null, 'ni ne l''efface');

-- Même le propriétaire : journal en ajout seul, Timè seulement par lui.
select throws_ok('update game.honor_ledger set amount = 99', '23001', null, 'le journal est en ajout seul');
select throws_ok('delete from game.honor_ledger', '23001', null, 'ses lignes ne se suppriment pas');
select throws_ok($$update game.honor set honor = 9999 where house_id = '00000000-0000-7000-8000-0000000704a1'$$, '23001',
  'Timè changes only through its journal', 'la Timè ne change que par son journal');
select throws_ok($$insert into game.honor (house_id, world_id) values ('00000000-0000-7000-8000-0000000704b1', '01900000-0000-7000-8000-0000000704f0')$$,
  '23001', 'Timè changes only through its journal', 'ni ne se crée à la main');

-- Le crédit d'Alice attend sa clôture : validé sans elle, il est refusé.
select throws_ok('set constraints game.honor_ledger_on_close immediate', '23001', 'an archon term is credited by the close of its day',
  'à la validation, un crédit sans la clôture de son jour est refusé');

-- Une fois la clôture du jour enregistrée, le crédit de ce jour, ou d'un jour antérieur, n'est plus admis.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c704', '{}');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000704f0', 100, now() - interval '1 hour', '00000000-0000-7000-8000-00000000c704');
select throws_ok(pg_temp.credit('b', 'b', 25, 100), '23001', 'an archon term is credited before its close is recorded',
  'pas de crédit hors de la transaction de sa clôture');
select lives_ok(pg_temp.credit('b', 'b', 7, 101), 'celui de la clôture suivante passe');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000704f0', 101, now() - interval '1 minute', '00000000-0000-7000-8000-00000000c704');
select lives_ok('set constraints game.honor_ledger_on_close immediate',
  'à la validation, chaque crédit a la clôture de son jour, enregistrée dans la même transaction');
set constraints all deferred;

-- Visiteur anonyme : rien.
set local role anon;
select throws_ok('select * from public.house_honor', '42501', null, 'un visiteur anonyme ne lit pas la Timè des maisons');
select throws_ok('select * from public.my_honor_entries', '42501', null, 'ni un journal');

-- Alice : la Timè de chaque maison, publique, et ses seules lignes.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000704aa", "role": "authenticated"}';
select results_eq(
  $$select house_id, honor from public.house_honor where house_id::text like '00000000-0000-7000-8000-0000000704%' order by house_id$$,
  $$values ('00000000-0000-7000-8000-0000000704a1'::uuid, 25::bigint), ('00000000-0000-7000-8000-0000000704b1'::uuid, 7::bigint)$$,
  'la Timè de chaque maison est publique pour les joueurs connectés');
select results_eq('select house_id, amount, reason, reference, game_day from public.my_honor_entries',
  $$values ('00000000-0000-7000-8000-0000000704a1'::uuid, 25::bigint, 'archon_term', '00000000-0000-7000-8000-0000000704a0'::uuid, 100)$$,
  'Alice ne lit que les lignes de sa maison');
select is((select count(*) from game.honor_ledger), 1::bigint, 'pas celles de Bob, même par la table');
select throws_ok(
  $$insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day) values ('01900000-0000-7000-8000-0000000704f0',
    '00000000-0000-7000-8000-0000000704a1', 1, 'archon_term', '00000000-0000-7000-8000-0000000704b0', 102)$$,
  '42501', null, 'un joueur n''écrit pas au journal');
select throws_ok('update public.my_honor_entries set amount = 9999', '42501', null, 'ni par la vue de ses lignes');

-- Bob : ses lignes seulement ; un compte sans maison : aucune ligne, mais la Timè publique.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000704ab", "role": "authenticated"}';
select results_eq('select house_id, amount from public.my_honor_entries',
  $$values ('00000000-0000-7000-8000-0000000704b1'::uuid, 7::bigint)$$, 'Bob ne lit que sa ligne');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000704ac", "role": "authenticated"}';
select is((select count(*) from public.my_honor_entries), 0::bigint, 'un compte sans maison ne lit aucune ligne');

select * from finish();
rollback;
