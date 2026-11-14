begin;
select plan(41);

-- Jeu d'essai : un second monde, et deux clôtures jouées à Kallistè (jours 20771 et 20772).
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000000c1', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  select '01900000-0000-7000-8000-000000000001', day, '2026-11-14 03:00+00', '00000000-0000-7000-8000-0000000000c1'
  from generate_series(20771, 20772) as day;
create function pg_temp.settle(class text, people integer, world uuid default '01900000-0000-7000-8000-000000000001',
  city uuid default '01900000-0000-7000-8000-000000000101'
) returns void language sql as $$
  insert into game.npc_population (world_id, city_id, class_id, population) values (world, city, class, people)
$$;
create function pg_temp.measure(class text, served float8, demanded float8, day integer default 20771) returns void language sql as $$
  insert into game.npc_vital_coverage (world_id, city_id, class_id, game_day, served, demanded)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', class, day, served, demanded)
$$;
-- Évolution d'une classe, vérifiée comme à la validation de la transaction (référence à la clôture jouée).
create function pg_temp.move(class text, people integer, day integer, coverage integer default 10000) returns void language plpgsql as $$
begin
  update game.npc_population set population = people, closed_day = day, coverage_bps = coverage
    where class_id = class and city_id = '01900000-0000-7000-8000-000000000101';
  set constraints all immediate;
  set constraints all deferred;
end $$;

-- État : une ligne par cité et par classe, en habitants entiers bornés.
select lives_ok($$select pg_temp.settle('thetes', 6000)$$, 'une classe naît avec sa population');
select throws_ok($$select pg_temp.settle('thetes', 1)$$, '23505', null, 'une seule population par cité et par classe');
select lives_ok($$select pg_temp.settle('zeugitai', 0)$$, 'une classe peut être vide');
select throws_like($$select pg_temp.settle('hippeis', -1)$$, '%"npc_population_population_check"%', 'population négative refusée');
select throws_like($$select pg_temp.settle('hippeis', 100000001)$$, '%"npc_population_population_check"%', 'au plus 100 millions d''habitants');
select throws_ok($$select pg_temp.settle('Hippeis', 5)$$, '23514', null, 'identifiant de classe mal formé refusé');
select throws_like($$select pg_temp.settle('hippeis', 5, world => '01900000-0000-7000-8000-000000000002')$$,
  '%"npc_population_city_same_world"%', 'la cité doit être du même monde');

-- Évolution : seulement par une clôture jouée, une fois par jour de jeu, jamais en arrière.
select throws_like($$update game.npc_population set population = 6100 where class_id = 'thetes' and world_id = '01900000-0000-7000-8000-000000000001'$$,
  '%once per game day%', 'pas d''évolution sans jour de clôture');
select throws_like($$select pg_temp.move('thetes', 6100, 20770)$$, '%"npc_population_played_close"%', 'pas d''évolution hors d''une clôture jouée');
select lives_ok($$select pg_temp.move('thetes', 6060, 20771)$$, 'la clôture du jour fait évoluer la classe');
select throws_like($$select pg_temp.move('thetes', 6120, 20771)$$, '%once per game day%', 'pas deux évolutions le même jour de jeu');
select lives_ok($$select pg_temp.move('thetes', 6000, 20772, 0)$$, 'la clôture suivante la fait évoluer de nouveau');
select throws_like($$select pg_temp.move('thetes', 6060, 20771)$$, '%once per game day%', 'jamais en arrière');
select throws_like($$update game.npc_population set closed_day = null, coverage_bps = null where class_id = 'thetes' and world_id = '01900000-0000-7000-8000-000000000001'$$,
  '%once per game day%', 'une clôture retenue ne s''efface pas');
select throws_like($$select pg_temp.move('zeugitai', 0, 20772, 10001)$$, '%"npc_population_coverage_bps_check"%', 'couverture au-delà de 100 % refusée');
select throws_like($$update game.npc_population set closed_day = 20772 where class_id = 'zeugitai' and world_id = '01900000-0000-7000-8000-000000000001'$$,
  '%"npc_population_closed_together"%', 'pas de clôture retenue sans sa couverture');

-- Mesure du jour : unités réelles, finies, jamais négatives ; une ligne par classe et par jour de jeu.
select lives_ok($$select pg_temp.measure('thetes', 12.5, 144)$$, 'une mesure du jour est acceptée');
select lives_ok($$select pg_temp.measure('thetes', 0, 0, day => 20772)$$, 'le jour suivant a la sienne, même nulle');
select throws_ok($$select pg_temp.measure('thetes', 1, 1)$$, '23505', null, 'une seule mesure par classe et par jour de jeu');
select throws_ok($$select pg_temp.measure('zeugitai', -0.5, 1)$$, '23514', null, 'unités servies négatives refusées');
select throws_ok($$select pg_temp.measure('zeugitai', 1, 'NaN')$$, '23514', null, 'besoin indéfini refusé');
select throws_ok($$select pg_temp.measure('zeugitai', 'Infinity', 1)$$, '23514', null, 'unités infinies refusées');

-- Service : il crée une classe et fait évoluer ses valeurs ; ni clé, ni clôture à la création, ni suppression.
select is(
  (select string_agg(table_name || ':' || privilege_type, ' ' order by table_name, privilege_type) from information_schema.role_table_grants
   where table_schema = 'game' and table_name in ('npc_population', 'npc_vital_coverage') and grantee = 'oikos_service'),
  'npc_population:SELECT npc_vital_coverage:INSERT npc_vital_coverage:SELECT', 'droits de table du service : liste figée');
select is(
  (select string_agg(table_name || ':' || privilege_type || ':' || column_name, ' ' order by table_name, privilege_type, column_name)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('npc_population', 'npc_vital_coverage') and grantee = 'oikos_service'
     and privilege_type = 'UPDATE' or (table_schema = 'game' and table_name = 'npc_population' and grantee = 'oikos_service' and privilege_type = 'INSERT')),
  'npc_population:INSERT:city_id npc_population:INSERT:class_id npc_population:INSERT:population npc_population:INSERT:world_id '
  || 'npc_population:UPDATE:closed_day npc_population:UPDATE:coverage_bps npc_population:UPDATE:population '
  || 'npc_vital_coverage:UPDATE:demanded npc_vital_coverage:UPDATE:served', 'droits de colonne du service : liste figée');

-- Clients : la population se lit par la vue, sans le monde ; la mesure n'est pas exposée.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('game.npc_population'::regclass, 'game.npc_vital_coverage'::regclass)),
  'règles par ligne actives sur les deux tables');
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || roles::text, ' ' order by tablename, policyname) from pg_policies
   where schemaname = 'game' and tablename in ('npc_population', 'npc_vital_coverage')),
  'npc_population:npc_population_read:SELECT:{authenticated} npc_population:service_all:ALL:{oikos_service} '
  || 'npc_vital_coverage:service_all:ALL:{oikos_service}', 'règles par ligne : liste figée');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee, privilege_type)
   from information_schema.role_table_grants
   where table_schema in ('public', 'game') and table_name in ('city_population', 'npc_population', 'npc_vital_coverage')
     and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'city_population:authenticated:SELECT', 'la vue en lecture seule pour un joueur ; aucun droit de table, rien pour un visiteur');

set local role anon;
select throws_ok('select * from public.city_population', '42501', null, 'un visiteur anonyme ne lit pas la population');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$select * from public.city_population where city_id = '01900000-0000-7000-8000-000000000101' order by class_id$$,
  $$values ('01900000-0000-7000-8000-000000000101'::uuid, 'thetes', 6000, 20772, 0),
           ('01900000-0000-7000-8000-000000000101', 'zeugitai', 0, null, null)$$,
  'un joueur lit la population et la dernière couverture de chaque classe, colonnes figées');
select throws_ok($$update public.city_population set population = 1$$, '42501', null, 'un joueur ne modifie pas la population par la vue');
select throws_ok($$insert into public.city_population (city_id, class_id, population) values ('01900000-0000-7000-8000-000000000101', 'hippeis', 9)$$,
  '42501', null, 'ni n''en crée');
select throws_ok($$update game.npc_population set population = 1, closed_day = 20773, coverage_bps = 0$$, '42501', null, 'ni par la table');
select throws_ok($$select world_id from game.npc_population$$, '42501', null, 'il ne lit pas la table au-delà des colonnes de la vue');
select throws_ok($$select * from game.npc_vital_coverage$$, '42501', null, 'la mesure du jour n''est pas lisible par un joueur');
reset role;

-- Service, en actes : sous son rôle, il crée une classe sans clôture, la fait évoluer et cumule la mesure.
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
select lives_ok($q$select pg_temp.as_service($$insert into game.npc_population (world_id, city_id, class_id, population)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'hippeis', 1200)$$)$q$, 'le service crée une classe');
select throws_ok($q$select pg_temp.as_service($$insert into game.npc_population (world_id, city_id, class_id, population, closed_day, coverage_bps)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'metoikoi', 9, 20772, 0)$$)$q$,
  '42501', null, 'mais pas avec une clôture déjà retenue');
select lives_ok($q$select pg_temp.as_service($$update game.npc_population set population = 1212, closed_day = 20772, coverage_bps = 10000
  where class_id = 'hippeis' and city_id = '01900000-0000-7000-8000-000000000101'$$)$q$, 'il la fait évoluer à la clôture');
select throws_ok($q$select pg_temp.as_service($$update game.npc_population set class_id = 'metoikoi' where class_id = 'hippeis'$$)$q$,
  '42501', null, 'il ne change pas la classe d''un état');
select throws_ok($q$select pg_temp.as_service($$delete from game.npc_population$$)$q$, '42501', null, 'ni ne le supprime');
select lives_ok($q$select pg_temp.as_service($$insert into game.npc_vital_coverage (world_id, city_id, class_id, game_day, served, demanded)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'thetes', 20771, 1.5, 6)
  on conflict (city_id, class_id, game_day) do update
    set served = npc_vital_coverage.served + excluded.served, demanded = npc_vital_coverage.demanded + excluded.demanded$$)$q$,
  'il ajoute un tick à la mesure du jour');
select results_eq($$select served, demanded from game.npc_vital_coverage where class_id = 'thetes' and game_day = 20771
  and city_id = '01900000-0000-7000-8000-000000000101'$$, $$values (14::float8, 150::float8)$$, 'la mesure cumule les ticks du jour');

select * from finish();
rollback;
