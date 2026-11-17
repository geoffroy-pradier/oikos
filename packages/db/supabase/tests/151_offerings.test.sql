begin;
select plan(31);

-- Jeu d'essai : un monde à lui, deux cités, Alice et Bob citoyens de la première, dotés de 1 000 oboles ;
-- Alice a 50 blés dans sa cité et 10 dans l'autre, Bob 5. Chaque offrande est écrite sous le rôle de
-- service, comme par l'API, puis les contrôles différés sont joués aussitôt (`set constraints`).
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c151', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000151f0', 'offrandes', 'Offrandes');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000151f1', '01900000-0000-7000-8000-0000000151f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000151f2', '01900000-0000-7000-8000-0000000151f0', 'elaia', 'Elaia');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000151aa', 'offrandes-alice@example.test'),
  ('00000000-0000-4000-8000-0000000151ab', 'offrandes-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000151a1', '01900000-0000-7000-8000-0000000151f0', '00000000-0000-4000-8000-0000000151aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000151b1', '01900000-0000-7000-8000-0000000151f0', '00000000-0000-4000-8000-0000000151ab', 'Philaïdes', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000151a1', '01900000-0000-7000-8000-0000000151f1'),
  ('00000000-0000-7000-8000-0000000151b1', '01900000-0000-7000-8000-0000000151f1');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000151a2', '01900000-0000-7000-8000-0000000151f0', 'house', '00000000-0000-7000-8000-0000000151a1'),
  ('00000000-0000-7000-8000-0000000151b2', '01900000-0000-7000-8000-0000000151f0', 'house', '00000000-0000-7000-8000-0000000151b1');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000151a3', '01900000-0000-7000-8000-0000000151f0', '00000000-0000-7000-8000-0000000151a1', '01900000-0000-7000-8000-0000000151f1', 'wheat'),
  ('00000000-0000-7000-8000-0000000151a4', '01900000-0000-7000-8000-0000000151f0', '00000000-0000-7000-8000-0000000151a1', '01900000-0000-7000-8000-0000000151f2', 'wheat'),
  ('00000000-0000-7000-8000-0000000151b3', '01900000-0000-7000-8000-0000000151f0', '00000000-0000-7000-8000-0000000151b1', '01900000-0000-7000-8000-0000000151f1', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
select '01900000-0000-7000-8000-0000000151f0', 'wheat', q, 'production', i, 'test'
from (values ('00000000-0000-7000-8000-0000000151a3'::uuid, 50), ('00000000-0000-7000-8000-0000000151a4', 10),
             ('00000000-0000-7000-8000-0000000151b3', 5)) s (i, q);
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000151f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a.id, case when a.kind = 'house' then 1000 else -2000 end from entry, game.accounts a
where a.world_id = '01900000-0000-7000-8000-0000000151f0' and (a.kind = 'house' or a.system_key = 'faucet_starting_grant');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Le corps donné, sous le rôle de service, dans un bloc où `e` est l'écriture et `o` l'offrande, puis les
-- contrôles différés de la transaction ; à passer à `throws_ok` ou `lives_ok`, qui annulent un échec.
create function pg_temp.svc(body text) returns text language sql as $$
  select 'select pg_temp.as_service(' || quote_literal('do $d$ declare e uuid; o uuid; begin ' || body
    || ' set constraints all immediate; set constraints all deferred; end $d$') || ')'
$$;
create function pg_temp.sys(key text) returns uuid language sql as $$
  select id from game.accounts where world_id = '01900000-0000-7000-8000-0000000151f0' and system_key = key
$$;
-- Écriture `kind` : `amount` oboles de la trésorerie d'Alice vers `sink`, `paid` arrivées.
create function pg_temp.pay(amount integer, sink text default 'sink_offerings', kind text default 'temple.offering',
  paid integer default null) returns text language sql as $$
  select format($s$insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000151f0', %L)
      returning id into e;
    insert into game.ledger_lines (entry_id, account_id, amount) values
      (e, '00000000-0000-7000-8000-0000000151a2', %s), (e, %L, %s);$s$,
    kind, -amount, pg_temp.sys(sink), coalesce(paid, amount))
$$;
-- Offrande d'une maison à Déméter dans une cité : `oboles` (payées par l'écriture `e`, s'il y en a) et `charis`.
create function pg_temp.make(oboles integer, charis bigint, house text default 'a', city text default 'f1')
returns text language sql as $$
  select format($s$insert into game.offerings (world_id, house_id, city_id, god_id, oboles, charis, ledger_entry_id)
    values ('01900000-0000-7000-8000-0000000151f0', '00000000-0000-7000-8000-0000000151%s1', '01900000-0000-7000-8000-0000000151%s',
      'demeter', %s, %s, e) returning id into o;$s$, house, city, oboles, charis)
$$;
-- `quantity` blés du stock `inventory` (a3, a4 ou b3) offerts par `o`.
create function pg_temp.give(quantity integer, inventory text default 'a3') returns text language sql as $$
  select format($s$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, offering_id)
    values ('01900000-0000-7000-8000-0000000151f0', 'wheat', %s, '00000000-0000-7000-8000-0000000151%s', 'offering',
      'temple.offering', o);$s$, quantity, inventory)
$$;
-- Ligne `kind` du journal de la Charis : `amount` envers Déméter pour une maison, rattachée à `o` si `named`.
create function pg_temp.favor(amount bigint, house text default 'a', kind text default 'offering', named boolean default true)
returns text language sql as $$
  select format($s$insert into game.favor_ledger (world_id, house_id, god_id, amount, kind, offering_id)
    values ('01900000-0000-7000-8000-0000000151f0', '00000000-0000-7000-8000-0000000151%s1', 'demeter', %s, %L,
      case when %L then o end);$s$, house, amount, kind, named)
$$;
create function pg_temp.charis(house text default 'a') returns bigint language sql as $$
  select charis from game.favor where house_id = ('00000000-0000-7000-8000-0000000151' || house || '1')::uuid and god_id = 'demeter'
$$;
create function pg_temp.stock(inventory text default 'a3') returns bigint language sql as $$
  select quantity from game.inventories where id = ('00000000-0000-7000-8000-0000000151' || inventory)::uuid
$$;

-- Droits, lus dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.offerings'::regclass), 'règles par ligne actives');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' '
                     order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and (table_name = 'offerings' or column_name = 'offering_id') and grantee = 'oikos_service'
     and privilege_type <> 'SELECT'),
  'favor_ledger.offering_id:INSERT offerings.charis:INSERT offerings.city_id:INSERT offerings.god_id:INSERT '
    || 'offerings.house_id:INSERT offerings.ledger_entry_id:INSERT offerings.oboles:INSERT offerings.world_id:INSERT '
    || 'oracle_consultations.offering_id:INSERT stock_ledger.offering_id:INSERT',
  'le service écrit une offrande sans en choisir ni l''identifiant ni la date, et y rattache stocks, Charis et '
    || 'consultation de la Pythie (#270) : liste figée');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated']) r
  where has_any_column_privilege(r, 'game.offerings', 'select, insert, update')), 'aucun accès client direct');
select ok(not exists (select 1 from pg_roles r, unnest(array['game.guard_offering()', 'game.check_offering_settled()',
    'game.check_offering_stock_movement()']) f
  where has_function_privilege(r.oid, f, 'execute') and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')),
  'personne n''exécute les gardes des offrandes');

-- Une offrande de monnaie et de biens : la monnaie au puits, les biens à l'extrémité `offering`, la Charis au journal.
select lives_ok(pg_temp.svc(pg_temp.pay(30) || pg_temp.make(30, 90) || pg_temp.give(10) || pg_temp.favor(90)),
  'offrande de 30 oboles et 10 blés, 90 Charis');
select is((select row(pg_temp.charis(), pg_temp.stock(), balance, (select balance from game.accounts where id = pg_temp.sys('sink_offerings')))::text
           from game.accounts where id = '00000000-0000-7000-8000-0000000151a2'),
  '(90,40,970,30)', 'la Charis, le stock, la trésorerie et le puits ont bougé ensemble');
select is((select string_agg(to_system || ':' || quantity || ':' || kind, ' ') from game.stock_ledger
           where offering_id is not null and world_id = '01900000-0000-7000-8000-0000000151f0'),
  'offering:10:temple.offering', 'les blés vont à l''extrémité `offering`, rattachés à leur offrande');
select lives_ok(pg_temp.svc(pg_temp.make(0, 30) || pg_temp.give(5) || pg_temp.favor(30)), 'offrande de biens seuls, sans écriture');
select lives_ok(pg_temp.svc(pg_temp.pay(10) || pg_temp.make(10, 10) || pg_temp.favor(10)), 'offrande de monnaie seule');
select is(pg_temp.charis(), 130::bigint, 'la Charis est le cumul de son journal');
select is((select sum(amount) from game.favor_ledger where house_id = '00000000-0000-7000-8000-0000000151a1'), 130::numeric,
  'et le journal en garde chaque ligne');

-- Une offrande mal réglée ne laisse rien.
select throws_ok(pg_temp.svc(pg_temp.pay(30) || pg_temp.make(30, 90) || pg_temp.favor(91)), '23001',
  'an offering adds its own Charis, when it is made', 'pas plus de Charis que l''offrande n''en rapporte');
select throws_ok(pg_temp.svc(pg_temp.pay(30) || pg_temp.make(30, 90) || pg_temp.favor(90, 'b')), '23001',
  'an offering adds its own Charis, when it is made', 'ni la Charis d''une offrande à une autre maison : rien ne se transfère');
select throws_ok(pg_temp.svc(pg_temp.pay(30) || pg_temp.make(30, 90)), '23001', 'an offering adds its Charis',
  'une offrande sans sa Charis au journal');
select throws_ok(pg_temp.svc(pg_temp.pay(30, 'sink_upkeep') || pg_temp.make(30, 90) || pg_temp.favor(90)), '23001',
  'an offering pays its oboles to sink_offerings', 'des oboles versées à un autre puits');
select throws_ok(pg_temp.svc(pg_temp.pay(29) || pg_temp.make(30, 90) || pg_temp.favor(90)), '23001',
  'an offering pays its oboles to sink_offerings', 'une obole de moins que l''offrande');
select throws_ok(pg_temp.svc(pg_temp.pay(30, kind => 'property.renovate') || pg_temp.make(30, 90) || pg_temp.favor(90)), '23001',
  'an offering pays its oboles to sink_offerings', 'une écriture d''une autre nature');
select throws_ok(pg_temp.svc(pg_temp.make(30, 90) || pg_temp.favor(90)), '23514', null, 'des oboles sans écriture');
select throws_ok(pg_temp.svc(pg_temp.make(0, 5) || pg_temp.favor(5)), '23001', 'an offering gives oboles or goods',
  'une offrande vide');
select throws_ok(pg_temp.svc(pg_temp.make(0, 0) || pg_temp.give(1) || pg_temp.favor(1)), '23514', null,
  'une offrande qui ne rapporte rien');
select throws_ok(pg_temp.svc(pg_temp.make(0, 6, city => 'f2') || pg_temp.give(1, 'a4') || pg_temp.favor(6)), '23001',
  'an offering is made in the city of its house', 'pas dans une autre cité que celle de la maison');
select throws_ok(pg_temp.svc(pg_temp.make(0, 6) || pg_temp.give(1, 'a4') || pg_temp.favor(6)), '23001',
  'an offering takes goods from its house stock in its city, when it is made', 'ni des biens d''une autre cité');
select throws_ok(pg_temp.svc(pg_temp.make(0, 6) || pg_temp.give(1, 'b3') || pg_temp.favor(6)), '23001',
  'an offering takes goods from its house stock in its city, when it is made', 'ni des biens d''une autre maison');
select throws_ok(pg_temp.svc(pg_temp.make(0, 12) || pg_temp.give(1) || pg_temp.give(1) || pg_temp.favor(12)), '23505', null,
  'chaque bien une fois par offrande');
select throws_ok(pg_temp.svc(pg_temp.make(0, 600) || pg_temp.give(100) || pg_temp.favor(600)), '23514', null,
  'pas plus de blés que le stock n''en a');
select throws_ok(pg_temp.svc($s$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind)
  values ('01900000-0000-7000-8000-0000000151f0', 'wheat', 1, '00000000-0000-7000-8000-0000000151a3', 'offering', 'test');$s$),
  '23514', null, 'un bien ne va à l''extrémité `offering` que par une offrande');
select throws_ok(pg_temp.svc($s$insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
  values ('01900000-0000-7000-8000-0000000151f0', 'wheat', 1, 'offering', '00000000-0000-7000-8000-0000000151a3', 'test');$s$),
  '23514', null, 'et rien n''en revient');
select is(row(pg_temp.charis(), pg_temp.stock(), pg_temp.stock('a4'), pg_temp.stock('b3'))::text, '(130,35,10,5)',
  'aucune offrande refusée n''a rien laissé');

-- Une offrande ne se modifie ni ne se supprime ; le journal n'admet sa Charis que par elle.
select throws_ok($$update game.offerings set charis = 1$$, '23001', null, 'une offrande ne se modifie pas');
select throws_ok($$delete from game.offerings$$, '23001', null, 'ni ne se supprime');
select throws_ok(pg_temp.svc(pg_temp.make(0, 6) || pg_temp.give(1) || pg_temp.favor(6) || pg_temp.favor(-1, kind => 'decay', named => true)),
  '23001', 'only an offering movement names an offering', 'seule une ligne d''offrande nomme une offrande');

select * from finish();
rollback;
