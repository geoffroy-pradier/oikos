begin;
select plan(31);

-- Jeu d'essai : un monde à lui, deux cités, Alice et Bob citoyens de la première, chacun un champ (Alice deux),
-- un caboteur et du blé (Alice dans les deux cités) ; Alice a 500 de Charis envers Déméter, posée garde levée.
-- Chaque écriture passe sous le rôle de service, comme par l'API, puis les contrôles différés sont joués aussitôt
-- (`set constraints`). Tout le test est une transaction : `now()` n'y change pas, si bien qu'une recharge échue
-- est posée par le propriétaire.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c170', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000170f0', 'graces', 'Grâces');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000170f1', '01900000-0000-7000-8000-0000000170f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000170f2', '01900000-0000-7000-8000-0000000170f0', 'elaia', 'Elaia');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000170aa', 'graces-alice@example.test'),
  ('00000000-0000-4000-8000-0000000170ab', 'graces-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000170a1', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-4000-8000-0000000170aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000170b1', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-4000-8000-0000000170ab', 'Philaïdes', '{}');
alter table game.favor_ledger disable trigger favor_ledger_guard;
insert into game.favor_ledger (world_id, house_id, god_id, amount, kind) values
  ('01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170a1', 'demeter', 500, 'test.seed');
set constraints all immediate;
set constraints all deferred;
alter table game.favor_ledger enable trigger favor_ledger_guard;
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000170a1', '01900000-0000-7000-8000-0000000170f1'),
  ('00000000-0000-7000-8000-0000000170b1', '01900000-0000-7000-8000-0000000170f1');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000170a5', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170a1', '01900000-0000-7000-8000-0000000170f1', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000170c5', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170a1', '01900000-0000-7000-8000-0000000170f1', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000170b5', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170b1', '01900000-0000-7000-8000-0000000170f1', 'grow_wheat');
insert into game.ships (id, world_id, house_id, class_id, docked_city_id) values
  ('00000000-0000-7000-8000-0000000170a6', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170a1', 'coaster', '01900000-0000-7000-8000-0000000170f1'),
  ('00000000-0000-7000-8000-0000000170b6', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170b1', 'coaster', '01900000-0000-7000-8000-0000000170f1');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000170a3', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170a1', '01900000-0000-7000-8000-0000000170f1', 'wheat'),
  ('00000000-0000-7000-8000-0000000170a4', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170a1', '01900000-0000-7000-8000-0000000170f2', 'wheat'),
  ('00000000-0000-7000-8000-0000000170b3', '01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170b1', '01900000-0000-7000-8000-0000000170f1', 'wheat');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Le corps donné, sous le rôle de service, dans un bloc où `g` est l'invocation et `v` un voyage, puis les
-- contrôles différés ; à passer à `throws_ok` ou `lives_ok`, qui annulent un échec.
create function pg_temp.svc(body text) returns text language sql as $$
  select 'select pg_temp.as_service(' || quote_literal('do $d$ declare g uuid; v uuid; begin ' || body
    || ' set constraints all immediate; set constraints all deferred; end $d$') || ')'
$$;
-- Une maison (a ou b) invoque une grâce de Déméter : `spent` Charis, recharge dans un jour.
create function pg_temp.invoke(spent bigint, house text default 'a', grace text default 'demeter_harvest',
  effect text default 'blessed_harvest') returns text language sql as $$
  select format($s$insert into game.graces_used (world_id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, ready_at)
    values ('01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170%s1', %L, 'demeter', %L, 2000, %s,
      now() + interval '1 day') returning id into g;$s$, house, grace, effect, spent)
$$;
-- Ligne `grace` du journal de la Charis : `amount` retirés à une maison envers Déméter, rattachés à `g`.
create function pg_temp.spend(amount bigint, house text default 'a') returns text language sql as $$
  select format($s$insert into game.favor_ledger (world_id, house_id, god_id, amount, kind, grace_use_id)
    values ('01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170%s1', 'demeter', %s, 'grace', g);$s$,
    house, -amount)
$$;
-- `g` consommée par une récolte d'un champ (a5 ou c5 d'Alice, b5 de Bob), ou par un départ d'un caboteur (`v`).
create function pg_temp.collect(house text default 'a') returns text language sql as $$
  select format($s$update game.graces_used set consumed_at = now(), site_id = '00000000-0000-7000-8000-0000000170%s5'
    where id = g;$s$, house)
$$;
create function pg_temp.sail(house text default 'a') returns text language sql as $$
  select format($s$insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
    values ('01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170%1$s1', '00000000-0000-7000-8000-0000000170%1$s6',
      '01900000-0000-7000-8000-0000000170f1', '01900000-0000-7000-8000-0000000170f2', now() + interval '1 hour') returning id into v;
    update game.ships set docked_city_id = null where id = '00000000-0000-7000-8000-0000000170%1$s6';
    update game.graces_used set consumed_at = now(), voyage_id = v, saved_seconds = 600 where id = g;$s$, house)
$$;
-- Surplus de `quantity` blés de l'extrémité `production` vers un stock (a3, a4 ou b3), rattaché à `g`.
create function pg_temp.surplus(quantity integer, inventory text default 'a3', kind text default 'grace.surplus')
returns text language sql as $$
  select format($s$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind, grace_use_id)
    values ('01900000-0000-7000-8000-0000000170f0', 'wheat', %s, 'production', '00000000-0000-7000-8000-0000000170%s', %L, g);$s$,
    quantity, inventory, kind)
$$;
create function pg_temp.charis() returns bigint language sql as $$
  select charis from game.favor where house_id = '00000000-0000-7000-8000-0000000170a1' and god_id = 'demeter'
$$;

-- Droits, lus dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.graces_used'::regclass), 'règles par ligne actives');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and (table_name = 'graces_used' or column_name = 'grace_use_id') and grantee = 'oikos_service'
     and privilege_type <> 'SELECT'),
  'favor_ledger.grace_use_id:INSERT graces_used.charis_spent:INSERT graces_used.consumed_at:UPDATE graces_used.effect:INSERT '
    || 'graces_used.god_id:INSERT graces_used.grace_id:INSERT graces_used.house_id:INSERT graces_used.magnitude_bps:INSERT '
    || 'graces_used.ready_at:INSERT graces_used.saved_seconds:UPDATE graces_used.site_id:UPDATE graces_used.voyage_id:UPDATE '
    || 'graces_used.world_id:INSERT stock_ledger.grace_use_id:INSERT',
  'le service invoque sans choisir ni l''identifiant ni l''instant, puis ne fait que consommer : liste figée');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated']) r
  where has_any_column_privilege(r, 'game.graces_used', 'select, insert, update')), 'aucun accès client direct');
select ok(not exists (select 1 from pg_roles r, unnest(array['game.guard_grace_use()', 'game.check_grace_settled()',
    'game.check_grace_stock_movement()']) f
  where has_function_privilege(r.oid, f, 'execute') and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')),
  'personne n''exécute les gardes des grâces');

-- Invocation : la Charis dépensée au journal, dans la même transaction.
select lives_ok(pg_temp.svc(pg_temp.invoke(150) || pg_temp.spend(150)), 'Alice invoque la récolte bénie pour 150 Charis');
select is(pg_temp.charis(), 350::bigint, 'sa Charis a baissé d''autant');
select lives_ok(pg_temp.svc(pg_temp.invoke(0, grace => 'free_grace')), 'une grâce gratuite n''a pas de ligne de Charis');
select throws_ok(pg_temp.svc(pg_temp.invoke(150, grace => 'other') ), '23001', 'a grace spends its Charis',
  'une invocation sans sa Charis au journal');
select throws_ok(pg_temp.svc(pg_temp.invoke(0, grace => 'other') || pg_temp.spend(1)), '23001',
  'a grace spends its own Charis, when invoked', 'ni Charis dépensée pour une grâce gratuite');
select throws_ok(pg_temp.svc(pg_temp.invoke(150, grace => 'other') || pg_temp.spend(149)), '23001',
  'a grace spends its own Charis, when invoked', 'pas une Charis de moins');
select throws_ok(pg_temp.svc(pg_temp.invoke(150, 'b', 'other') || pg_temp.spend(150, 'b')), '23514', null,
  'Bob, sans Charis, ne passe pas sous zéro');
select throws_ok(pg_temp.svc(pg_temp.invoke(150, 'b', 'other') || pg_temp.spend(150, 'a')), '23001',
  'a grace spends its own Charis, when invoked', 'ni la Charis d''Alice pour une grâce de Bob : rien ne se transfère');
select throws_ok(pg_temp.svc(pg_temp.invoke(0)), '23001', 'this grace is recharging',
  'une grâce en attente ne s''invoque pas une seconde fois');
select throws_ok(pg_temp.svc(replace(replace(pg_temp.invoke(0, grace => 'other'), 'ready_at)', 'ready_at, invoked_at)'),
    'interval ''1 day'')', 'interval ''1 day'', now() - interval ''1 hour'')')),
  '42501', null, 'ni antidatée : le service ne choisit pas l''instant');

-- Consommation : une récolte d'un site de la maison, avec son surplus venu de `production`.
select lives_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''demeter_harvest'';'
  || pg_temp.collect() || pg_temp.surplus(8)), 'la récolte du champ d''Alice consomme la grâce, 8 blés de plus');
select is((select quantity from game.inventories where id = '00000000-0000-7000-8000-0000000170a3'), 8::bigint,
  'le surplus entre au stock par le journal');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''demeter_harvest'';'
  || pg_temp.collect() || pg_temp.surplus(8)), '23001', 'a grace is consumed once, now', 'une grâce ne se consomme qu''une fois');
select throws_ok(pg_temp.svc(pg_temp.invoke(0)), '23001', 'this grace is recharging', 'consommée, elle se recharge');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''free_grace'';'
  || pg_temp.collect('b') || pg_temp.surplus(1, 'b3')), '23001', 'a grace is consumed by an action of its house',
  'pas par une récolte de Bob');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''free_grace'';' || pg_temp.collect('c')),
  '23001', 'a blessed collect yields its surplus', 'une récolte qui n''ajoute rien ne la consomme pas');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''free_grace'';'
  || pg_temp.collect('c') || pg_temp.surplus(1, 'b3')), '23001',
  'a grace surplus enters its house stock in the site city, when consumed', 'un surplus versé à Bob');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''free_grace'';'
  || pg_temp.collect('c') || pg_temp.surplus(1, 'a4')), '23001',
  'a grace surplus enters its house stock in the site city, when consumed', 'ou dans une autre cité que celle du site');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''free_grace'';' || pg_temp.surplus(1)),
  '23001', 'a grace surplus enters its house stock in the site city, when consumed', 'ni sans consommer la grâce');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''free_grace'';'
  || pg_temp.collect('c') || pg_temp.surplus(1, kind => 'site.collect')), '23514', null, 'un surplus porte sa propre nature');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''free_grace'';'
  || pg_temp.collect() || pg_temp.surplus(1)), '23505', null, 'une récolte ne consomme qu''une grâce');
select throws_ok(pg_temp.svc('select id into g from game.graces_used where grace_id = ''free_grace'';'
  || 'update game.graces_used set consumed_at = now(), site_id = ''00000000-0000-7000-8000-0000000170a5'', magnitude_bps = 10000 where id = g;'),
  '42501', null, 'son ampleur ne change pas à la consommation');

-- Vent favorable : consommé par un départ de cet instant, d'un navire de la maison.
select lives_ok(pg_temp.svc(pg_temp.invoke(0, grace => 'wind', effect => 'fair_wind') || pg_temp.sail()),
  'le départ du caboteur d''Alice consomme son vent favorable');
select throws_ok(pg_temp.svc(pg_temp.invoke(0, grace => 'wind2', effect => 'fair_wind') || pg_temp.sail('b')), '23001',
  'a grace is consumed by an action of its house', 'pas par un départ de Bob');

-- Recharges échues, posées par le propriétaire : une invocation passée consommée, une autre encore en attente.
set constraints all immediate;
set constraints all deferred;
alter table game.graces_used disable trigger graces_used_guard;
insert into game.graces_used (world_id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, invoked_at, ready_at,
  consumed_at, site_id) values
  ('01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170a1', 'old_grace', 'demeter', 'blessed_harvest',
   2000, 0, '2026-01-01', '2026-01-02', '2026-01-01', '00000000-0000-7000-8000-0000000170a5'),
  ('01900000-0000-7000-8000-0000000170f0', '00000000-0000-7000-8000-0000000170a1', 'stale', 'demeter', 'blessed_harvest',
   2000, 0, '2026-01-01', '2026-01-02', null, null);
set constraints all immediate;
set constraints all deferred;
alter table game.graces_used enable trigger graces_used_guard;
select lives_ok(pg_temp.svc(pg_temp.invoke(0, grace => 'old_grace')), 'une grâce rechargée se réinvoque');
select throws_ok(pg_temp.svc(pg_temp.invoke(0, grace => 'stale')), '23505', null,
  'une grâce en attente, même rechargée, ne s''invoque pas : l''index refuse aussi deux invocations concurrentes');
select throws_ok($$delete from game.graces_used where grace_id = 'old_grace'$$, '23001', null,
  'une invocation ne se supprime pas, même par le propriétaire');

select * from finish();
rollback;
