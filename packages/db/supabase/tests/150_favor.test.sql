begin;
select plan(22);

-- Jeu d'essai : un monde à lui, sa cité, Alice et Bob. Le déclin est écrit sous le rôle de service, comme par
-- le moteur, puis les contrôles différés sont joués aussitôt (`set constraints`). La Charis de départ d'Alice
-- est posée par le propriétaire, garde levée le temps de l'écrire : aucune offrande n'existe encore ici.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c150', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000150f0', 'charis', 'Charis');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000150aa', 'charis-alice@example.test'),
  ('00000000-0000-4000-8000-0000000150ab', 'charis-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000150a1', '01900000-0000-7000-8000-0000000150f0', '00000000-0000-4000-8000-0000000150aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000150b1', '01900000-0000-7000-8000-0000000150f0', '00000000-0000-4000-8000-0000000150ab', 'Philaïdes', '{}');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Les instructions données, sous le rôle de service, puis les contrôles différés de la transaction ; à passer
-- à `throws_ok` ou `lives_ok`, qui annulent un échec.
create function pg_temp.svc(body text) returns text language sql as $$
  select 'select pg_temp.as_service(' || quote_literal(body || ' set constraints all immediate; set constraints all deferred;') || ')'
$$;
-- Ligne `kind` du journal : `amount` envers Déméter pour Alice, au jour `day`.
create function pg_temp.favor(amount bigint, kind text default 'decay', day integer default null) returns text language sql as $$
  select format($s$insert into game.favor_ledger (world_id, house_id, god_id, amount, kind, game_day)
    values ('01900000-0000-7000-8000-0000000150f0', '00000000-0000-7000-8000-0000000150a1', 'demeter', %s, %L, %s);$s$,
    amount, kind, coalesce(day::text, 'null'))
$$;
create function pg_temp.record(day integer) returns text language sql as $$
  select format($s$insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
    values ('01900000-0000-7000-8000-0000000150f0', %s, '2026-11-14 03:00+00', '00000000-0000-7000-8000-00000000c150');$s$, day)
$$;
create function pg_temp.charis() returns bigint language sql as $$
  select charis from game.favor where house_id = '00000000-0000-7000-8000-0000000150a1' and god_id = 'demeter'
$$;

-- Droits, lus dans le catalogue.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('game.favor'::regclass, 'game.favor_ledger'::regclass)),
  'règles par ligne actives');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('favor', 'favor_ledger') and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'favor.charis:UPDATE favor_ledger.amount:INSERT favor_ledger.game_day:INSERT favor_ledger.god_id:INSERT '
    || 'favor_ledger.grace_use_id:INSERT favor_ledger.house_id:INSERT favor_ledger.kind:INSERT favor_ledger.offering_id:INSERT favor_ledger.world_id:INSERT',
  'le service écrit au journal sans en choisir ni l''identifiant ni la date : liste figée');
select ok(not exists (select 1 from unnest(array['game.favor', 'game.favor_ledger']) t, unnest(array['anon', 'authenticated']) r
  where has_any_column_privilege(r, t, 'insert, update')
     or ((r = 'anon' or t = 'game.favor_ledger') and has_any_column_privilege(r, t, 'select'))),
  'aucune écriture client, ni lecture du journal ; la Charis se lit par une vue (migration 182)');
select ok(not exists (select 1 from pg_roles r,
    unnest(array['game.guard_favor_movement()', 'game.apply_favor_movement()', 'game.guard_favor()']) f
  where has_function_privilege(r.oid, f, 'execute') and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')),
  'personne n''exécute les gardes ni l''application du journal');

alter table game.favor_ledger disable trigger favor_ledger_guard;
select lives_ok(pg_temp.favor(130, 'test.seed'), 'Charis de départ, posée garde levée');
select lives_ok(replace(pg_temp.favor(9007199254740900, 'test.seed'), '0000000150a1', '0000000150b1'), 'Bob, près de la borne');
select throws_ok(replace(pg_temp.favor(100, 'test.seed'), '0000000150a1', '0000000150b1'), '23514', null,
  'la Charis ne dépasse pas les entiers sûrs');
set constraints all immediate;
set constraints all deferred;
alter table game.favor_ledger enable trigger favor_ledger_guard;
select is(pg_temp.charis(), 130::bigint, 'la Charis est le cumul de son journal, créée au premier mouvement');

-- Le déclin : une perte par jour de jeu, dans la transaction qui enregistre la clôture de ce jour.
select lives_ok(pg_temp.svc(pg_temp.favor(-1, day => 20000) || pg_temp.record(20000)), 'la clôture d''un jour retire son déclin');
select is(pg_temp.charis(), 129::bigint, 'la Charis a décliné');
select throws_ok(pg_temp.svc(pg_temp.favor(-1, day => 20000)), '23001', 'a decay is written before its close is recorded',
  'pas une seconde fois, une fois la clôture enregistrée');
select throws_ok(pg_temp.svc(pg_temp.favor(-1, day => 20001) || pg_temp.favor(-1, day => 20001) || pg_temp.record(20001)),
  '23505', null, 'ni deux fois dans la même clôture');
select throws_ok(pg_temp.svc(pg_temp.favor(-1, day => 20001)), '23503', null, 'ni sans enregistrer la clôture de son jour');
select throws_ok(pg_temp.svc(pg_temp.favor(1, day => 20001) || pg_temp.record(20001)), '23001',
  'a decay removes Charis on a game day', 'un déclin ne fait pas gagner de Charis');
select throws_ok(pg_temp.svc(pg_temp.favor(-1) || pg_temp.record(20001)), '23001', 'a decay removes Charis on a game day',
  'et il a son jour');
select throws_ok(pg_temp.svc(pg_temp.favor(-130, day => 20001) || pg_temp.record(20001)), '23514', null,
  'une Charis ne passe pas sous zéro');
select throws_ok(pg_temp.svc(pg_temp.favor(5, 'miracle')), '23001', 'unknown Charis movement', 'une nature inconnue est refusée');

-- La Charis ne change que par son journal, qui ne se modifie pas.
select throws_ok(pg_temp.svc($s$update game.favor set charis = 1;$s$), '23001', 'Charis changes only through its journal',
  'le service ne modifie pas la Charis à la main');
select throws_ok($$insert into game.favor (house_id, god_id, world_id, charis) values
  ('00000000-0000-7000-8000-0000000150b1', 'demeter', '01900000-0000-7000-8000-0000000150f0', 5)$$, '23001',
  'Charis changes only through its journal', 'le propriétaire non plus, hors du journal');
select throws_ok($$delete from game.favor$$, '23001', null, 'on ne supprime pas une Charis');
select throws_ok($$update game.favor_ledger set amount = 1$$, '23001', null, 'le journal ne se modifie pas');
select throws_ok(pg_temp.svc($s$delete from game.favor_ledger;$s$), '42501', null, 'le service ne supprime rien');

select * from finish();
rollback;
