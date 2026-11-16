begin;
select plan(24);

-- Jeu d'essai, monde de test (Kallistè 101, Elaia 103) et un second monde à lui, avec sa cité. Deux joueurs, chacun
-- avec sa maison dans un monde différent. Les chroniques sont écrites sous le rôle de service, comme par le moteur.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c180', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000180e0', 'chronique-2', 'Autre monde');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000180e1', '01900000-0000-7000-8000-0000000180e0', 'nesos', 'Nèsos');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id) values
  ('01900000-0000-7000-8000-000000000001', 20500, now() - interval '1 day', '00000000-0000-7000-8000-00000000c180'),
  ('01900000-0000-7000-8000-0000000180e0', 20500, now() - interval '1 day', '00000000-0000-7000-8000-00000000c180');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000180aa', 'chronique-alice@example.test'),
  ('00000000-0000-4000-8000-0000000180ab', 'chronique-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000180a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000180aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000180b1', '01900000-0000-7000-8000-0000000180e0', '00000000-0000-4000-8000-0000000180ab', 'Philaïdes', '{}');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Chronique de `city` (dans `world`) au jour `day`, sous le rôle de service.
create function pg_temp.write(world text, city text, day integer, source text default 'fallback',
  text_fr text default 'Journée calme.', columns text default '', values_ text default '') returns text language sql as $$
  select format($s$select pg_temp.as_service(%L)$s$, format($i$insert into game.chronicle_articles
      (world_id, city_id, game_day, facts, text_fr, text_en, source%s)
    values (%L, %L, %s, '{"goods": [], "configChange": false}', %L, 'A quiet day.', %L%s)$i$,
    columns, world, city, day, text_fr, source, values_))
$$;

-- Droits, lus dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'game.chronicle_articles'::regclass), 'règles par ligne actives');
select is(
  (select string_agg(column_name || ':' || privilege_type, ' ' order by column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'chronicle_articles' and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'city_id:INSERT facts:INSERT game_day:INSERT source:INSERT text_en:INSERT text_fr:INSERT world_id:INSERT',
  'le service insère sans dater, et ne modifie rien : liste figée');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'chronicle_articles' and grantee = 'authenticated'),
  'city_id created_at game_day id source text_en text_fr world_id',
  'un joueur connecté ne fait que lire, et pas les faits');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'chronicle_articles' and grantee in ('anon', 'authenticated', 'oikos_service')),
  'authenticated:SELECT', 'vue en lecture seule, rien pour un visiteur anonyme');

-- Écriture par le service : une chronique par cité et par clôture, après une clôture enregistrée.
select lives_ok(pg_temp.write('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 20500),
  'le moteur écrit la chronique de Kallistè, de repli');
select lives_ok(pg_temp.write('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000103', 20500, 'ai',
  'La gazette d''Elaia.'), 'et celle d''Elaia, réécrite par l''IA');
select throws_ok(pg_temp.write('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 20500, 'ai'),
  '23505', null, 'une seule par cité et par clôture : rejouer n''écrit rien de plus');
select throws_ok(pg_temp.write('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 20501),
  '23503', null, 'pas de chronique d''une clôture qui n''est pas enregistrée');
select throws_ok(pg_temp.write('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-0000000180e1', 20500),
  '23503', null, 'une cité d''un autre monde est refusée');
select lives_ok(pg_temp.write('01900000-0000-7000-8000-0000000180e0', '01900000-0000-7000-8000-0000000180e1', 20500),
  'et celle d''une cité d''un autre monde');
select throws_ok(pg_temp.write('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000104', 20500, 'oracle'),
  '23514', null, 'une source inconnue est refusée');
select throws_ok(pg_temp.write('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000104', 20500, 'ai', ''),
  '23514', null, 'un texte vide est refusé');
select throws_ok(pg_temp.write('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000104', 20500,
  'fallback', 'Journée calme.', ', created_at', ', now() - interval ''1 year'''), '42501', null, 'le service ne date pas une chronique');
select throws_ok($$select pg_temp.as_service('update game.chronicle_articles set text_fr = ''Autre''')$$, '42501', null,
  'le service ne réécrit pas une chronique');
select throws_ok($$delete from game.chronicle_articles$$, '23001', null, 'personne ne la supprime');
select throws_ok($$update game.chronicle_articles set source = 'ai'$$, '23001', null, 'ni ne la modifie');

-- Lecture d'un joueur connecté : toutes les chroniques, de son monde comme d'un autre ; jamais les faits ; rien
-- en écriture, ni par la vue ni par la table.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000180aa", "role": "authenticated"}';
select results_eq($$select city_id, game_day, source, text_fr from public.chronicle_articles
    where game_day = 20500 order by city_id$$,
  $$values ('01900000-0000-7000-8000-000000000101'::uuid, 20500, 'fallback', 'Journée calme.'),
           ('01900000-0000-7000-8000-000000000103'::uuid, 20500, 'ai', 'La gazette d''Elaia.'),
           ('01900000-0000-7000-8000-0000000180e1'::uuid, 20500, 'fallback', 'Journée calme.')$$,
  'Alice lit les chroniques de toutes les cités');
select throws_ok($$select facts from game.chronicle_articles$$, '42501', null, 'mais pas leurs faits');
select throws_ok($$insert into public.chronicle_articles (world_id, city_id, game_day, text_fr, text_en, source)
    values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000104', 20500, 'Faux.', 'Fake.', 'ai')$$,
  '42501', null, 'un joueur n''écrit pas de chronique par la vue');
select throws_ok($$insert into game.chronicle_articles (world_id, city_id, game_day, facts, text_fr, text_en, source)
    values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000104', 20500, '{}', 'Faux.', 'Fake.', 'ai')$$,
  '42501', null, 'ni par la table');
select throws_ok($$update public.chronicle_articles set text_fr = 'Faux.'$$, '42501', null, 'ne modifie pas celle d''un autre');
select throws_ok($$delete from public.chronicle_articles$$, '42501', null, 'ne supprime rien');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000180ab", "role": "authenticated"}';
select is((select count(*) from public.chronicle_articles where game_day = 20500), 3::bigint,
  'Bob, d''un autre monde, lit les mêmes chroniques');
reset role;
set local role anon;
select throws_ok($$select * from public.chronicle_articles$$, '42501', null, 'un visiteur anonyme ne lit rien');
reset role;

select * from finish();
rollback;
