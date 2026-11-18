begin;
select plan(17);

-- Jeu d'essai, dans une cité de la graine, à l'horloge Europe/Paris clôturant à 4 h : Alice est citoyenne
-- depuis la clôture de 04:00 heure d'été (le 29 mars 2026), Bob métèque depuis 03:59:59 (encore le jour de
-- jeu du 28 mars), Chloé n'a pas de maison. Citoyennetés posées par le propriétaire de la base, garde levée,
-- à des instants fixés.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c270', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c270', now());
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000270aa', 'citizenship-alice@example.test'),
  ('00000000-0000-4000-8000-0000000270ab', 'citizenship-bob@example.test'),
  ('00000000-0000-4000-8000-0000000270ac', 'citizenship-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon)
  select ('00000000-0000-7000-8000-0000000270' || h || '1')::uuid, '01900000-0000-7000-8000-000000000001',
         ('00000000-0000-4000-8000-0000000270a' || h)::uuid, n, '{}'
  from (values ('a', 'Alcméonides'), ('b', 'Philaïdes')) v (h, n);
create function pg_temp.h(name text) returns uuid language sql as $$ select ('00000000-0000-7000-8000-0000000270' || name || '1')::uuid $$;
grant execute on function pg_temp.h(text) to authenticated, anon;
alter table game.citizenships disable trigger citizenships_guard;
insert into game.citizenships (house_id, city_id, status, since) values
  (pg_temp.h('a'), '01900000-0000-7000-8000-000000000101', 'citizen', '2026-03-29 02:00:00+00'),
  (pg_temp.h('b'), '01900000-0000-7000-8000-000000000101', 'metic', '2026-03-29 01:59:59+00');
alter table game.citizenships enable trigger citizenships_guard;

-- Droits et colonnes, lus dans le catalogue.
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'my_citizenships' and grantee in ('anon', 'authenticated', 'public')),
  'authenticated:SELECT', 'vue en lecture seule pour les joueurs connectés, rien pour un visiteur anonyme');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'my_citizenships'),
  array['house_id', 'city_id', 'status', 'since', 'since_day'], 'la maison, sa cité, son statut, sa date et son jour de jeu');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'houses'),
  array['id', 'world_id', 'name', 'blazon', 'created_at', 'city_id', 'citizenship_status', 'is_mine'],
  'houses inchangée : le code précédent la lit encore (ADR 0006)');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.my_citizenships'::regclass),
  'la vue s''exécute avec les droits du joueur');

-- Visiteur anonyme : rien.
set local role anon;
select throws_ok('select * from public.my_citizenships', '42501', null, 'anon ne lit pas de citoyenneté');

-- Alice : sa seule maison, citoyenne du jour de la clôture de 04:00 (heure d'été).
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000270aa", "role": "authenticated"}';
select results_eq('select house_id, city_id, status, since, since_day from public.my_citizenships',
  $$values (pg_temp.h('a'), '01900000-0000-7000-8000-000000000101'::uuid, 'citizen', '2026-03-29 02:00:00+00'::timestamptz,
            date '2026-03-29' - date '1970-01-01')$$,
  'Alice lit sa citoyenneté, datée du jour de jeu ouvert par la clôture de 04:00');
select is((select count(*) from public.my_citizenships where house_id = pg_temp.h('b')), 0::bigint,
  'Alice ne lit pas la date de Bob, même en la demandant');

-- Bob : métèque depuis la veille en jour de jeu, une seconde avant la clôture.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000270ab", "role": "authenticated"}';
select results_eq('select house_id, status, since_day from public.my_citizenships',
  $$values (pg_temp.h('b'), 'metic', date '2026-03-28' - date '1970-01-01')$$,
  'Bob lit sa seule maison, métèque du jour de jeu de la veille à 03:59:59');
select throws_ok($$insert into public.my_citizenships (house_id, city_id, status) values
    ('00000000-0000-7000-8000-0000000270b1', '01900000-0000-7000-8000-000000000101', 'citizen')$$,
  '55000', null, 'la vue ne s''écrit pas (ni droit accordé, ni vue modifiable)');
select throws_ok($$update public.my_citizenships set status = 'citizen'$$, '55000', null, 'ni ne se modifie');
select throws_ok('delete from public.my_citizenships', '55000', null, 'ni ne s''efface');
select throws_ok($$update game.citizenships set status = 'citizen', since = now() where house_id = '00000000-0000-7000-8000-0000000270b1'$$,
  '42501', null, 'un joueur ne se fait pas citoyen');
select throws_ok($$update game.citizenships set since = '2020-01-01' where house_id = '00000000-0000-7000-8000-0000000270a1'$$,
  '42501', null, 'ni ne change la date d''un autre');
select throws_ok($$delete from game.citizenships where house_id = '00000000-0000-7000-8000-0000000270a1'$$,
  '42501', null, 'ni n''efface sa citoyenneté');

-- Chloé, sans maison : rien.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000270ac", "role": "authenticated"}';
select is((select count(*) from public.my_citizenships), 0::bigint, 'un joueur sans maison ne lit aucune citoyenneté');
reset role;

-- Sans horloge en vigueur : la date reste, le jour de jeu est nul ; un fuseau inconnu de la base aussi.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c271', '{}'),
  ('00000000-0000-7000-8000-00000000c272', '{"clock": {"dailyCloseHour": 4, "timezone": "Olympe/Sommet", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c271', now());
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000270aa", "role": "authenticated"}';
select results_eq('select status, since, since_day from public.my_citizenships',
  $$values ('citizen', '2026-03-29 02:00:00+00'::timestamptz, null::integer)$$, 'sans horloge : la date, sans jour de jeu');
reset role;
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c272', now());
set local role authenticated;
select results_eq('select since_day from public.my_citizenships', $$values (null::integer)$$,
  'fuseau inconnu de la base : jour de jeu nul, la lecture ne tombe pas');
reset role;

select * from finish();
rollback;
