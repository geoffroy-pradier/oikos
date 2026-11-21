begin;
select plan(30);

-- Jeu d'essai : un monde à lui, deux cités, Kallistè (k) et Halos (h). Alice (a) et Bob (b) ont leur foyer à Kallistè,
-- Chloé (c) à Halos ; Eudore (e) est une maison PNJ de Kallistè, Phédon (f) une maison de Kallistè dont le compte est
-- exclu, Glaucos (9) n'a pas de foyer. Dion (d) a sa maison dans un autre monde. Aucune clôture n'est enregistrée.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000719f0', 'liturgies', 'Liturgies'), ('01900000-0000-7000-8000-0000000719f9', 'ailleurs', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000719c1', '01900000-0000-7000-8000-0000000719f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000719c2', '01900000-0000-7000-8000-0000000719f0', 'halos', 'Halos'),
  ('01900000-0000-7000-8000-0000000719c9', '01900000-0000-7000-8000-0000000719f9', 'delphis', 'Delphis');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000719a' || n)::uuid, 'liturgy-' || n || '@example.test'
from unnest(array['a', 'b', 'c', 'd', 'e', 'f', '9', '8']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000719' || n || '1')::uuid, w::uuid,
       case when kind = 'npc' then null else ('00000000-0000-4000-8000-0000000719a' || n)::uuid end, name, '{}', kind
from (values ('a', 'Alcméonides', 'f0', 'player'), ('b', 'Philaïdes', 'f0', 'player'), ('c', 'Bacchiades', 'f0', 'player'),
             ('d', 'Eumolpides', 'f9', 'player'), ('e', 'Greniers', 'f0', 'npc'), ('f', 'Pisistratides', 'f0', 'player'),
             ('9', 'Néléides', 'f0', 'player')) h (n, name, w0, kind)
cross join lateral (select '01900000-0000-7000-8000-0000000719' || h.w0 as w) x;
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000000719' || n || '1')::uuid, ('01900000-0000-7000-8000-0000000719' || c)::uuid
from (values ('a', 'c1'), ('b', 'c1'), ('c', 'c2'), ('d', 'c9'), ('e', 'c1'), ('f', 'c1')) v (n, c);
-- Exclusion de Phédon, validée par une seconde personne (8), en vigueur.
insert into admin.sanctions (user_id, kind, reason, author_id, validated_by) values
  ('00000000-0000-4000-8000-0000000719af', 'ban', 'Fraude', '00000000-0000-4000-8000-0000000719a8', '00000000-0000-4000-8000-0000000719a9');
-- Exclusion de Bob seulement proposée : sans validation, elle n'agit pas (15.4).
insert into admin.sanctions (user_id, kind, reason, author_id) values
  ('00000000-0000-4000-8000-0000000719ab', 'ban', 'Soupçon', '00000000-0000-4000-8000-0000000719a8');
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c719', '{}');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Désignation écrite comme l'écrit le moteur : maison, cité, saison 3, dû, jour 100, échéance au jour 103.
create function pg_temp.assign(house text, city text, due int = 500, day int = 100, due_day int = 103, season int = 3) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.liturgies (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at) values (%L, %L, %L, %s, %L, %s, %s, %s, now() + interval ''3 days'')',
    '01900000-0000-7000-8000-0000000719f0', '01900000-0000-7000-8000-0000000719' || city, '00000000-0000-7000-8000-0000000719' || house || '1',
    season, 'festival', due, day, due_day))
$$;

-- Droits : le service écrit une désignation sans identifiant, date ni état, et ne supprime rien ; il ne modifie que
-- l'état et le règlement (#720, pgTAP 720).
select is(
  (select string_agg(column_name || ':' || privilege_type, ' ' order by column_name, privilege_type)
   from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'liturgies' and privilege_type = 'INSERT'),
  'city_id:INSERT designated_day:INSERT due:INSERT due_at:INSERT due_day:INSERT genre:INSERT house_id:INSERT season:INSERT world_id:INSERT',
  'le service n''écrit que les colonnes d''une désignation');
select ok(not has_table_privilege('oikos_service', 'game.liturgies', 'delete') and not has_table_privilege('oikos_service', 'game.liturgies', 'update'),
  'le service ne supprime pas une liturgie et ne modifie pas toute la ligne');
select is(pg_get_indexdef('game.liturgies_one_per_season'::regclass),
  'CREATE UNIQUE INDEX liturgies_one_per_season ON game.liturgies USING btree (house_id, season)', 'une liturgie au plus par maison et par saison');

-- Désignations du jour 100 : Alice, Bob et Chloé, chacune dans la cité de son foyer.
select lives_ok(pg_temp.assign('a', 'c1', 700), 'Alice est désignée à Kallistè');
select lives_ok(pg_temp.assign('b', 'c1', 600), 'Bob aussi : son exclusion proposée, pas encore validée, n''agit pas');
select lives_ok(pg_temp.assign('c', 'c2', 450), 'Chloé à Halos');
select throws_ok(pg_temp.assign('a', 'c1', 900), '23505', null, 'deux fois la même saison : refusé');
select lives_ok(pg_temp.assign('a', 'c1', 900, 100, 103, 4), 'une autre saison : une autre liturgie');
select throws_ok(pg_temp.assign('e', 'c1'), '23514', null, 'une maison PNJ n''est jamais désignée');
select throws_ok(pg_temp.assign('f', 'c1'), '23514', null, 'ni une maison exclue');
select throws_ok(pg_temp.assign('9', 'c1'), '23514', null, 'ni une maison sans foyer');
select throws_ok(pg_temp.assign('c', 'c1', 500, 100, 103, 5), '23514', null, 'ni une maison hors de la cité de son foyer');
select throws_ok(pg_temp.assign('b', 'c1', 0, 100, 103, 6), '23514', null, 'un dû nul est refusé');
select throws_ok(pg_temp.assign('b', 'c1', 500, 100, 100, 6), '23514', null, 'une échéance qui ne suit pas la désignation est refusée');
select throws_ok($$select pg_temp.as_service('insert into game.liturgies (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at, status)
  values (''01900000-0000-7000-8000-0000000719f0'', ''01900000-0000-7000-8000-0000000719c1'', ''00000000-0000-7000-8000-0000000719b1'', 7, ''festival'', 5, 100, 103, now(), ''performed'')')$$,
  '42501', null, 'le service ne choisit pas l''état');
select throws_ok($$update game.liturgies set due = 1$$, '23001', null, 'une liturgie ne change pas de dû, même pour le propriétaire');

-- À la validation, chaque désignation a la clôture de son jour, enregistrée dans la même transaction.
select throws_ok('set constraints game.liturgies_on_close immediate', '23001', 'a liturgy is assigned by the close of its day',
  'sans la clôture de son jour, une désignation est refusée');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000719f0', 100, now() - interval '1 hour', '00000000-0000-7000-8000-00000000c719');
select lives_ok('set constraints game.liturgies_on_close immediate', 'avec elle, les désignations sont admises');
set constraints all deferred;
select throws_ok(pg_temp.assign('b', 'c1', 500, 100, 103, 8), '23001', 'a liturgy is assigned before its close is recorded',
  'pas de désignation après l''enregistrement de la clôture de son jour');

-- Lectures. Bob lit les liturgies de son monde, sans le dû, et son seul dû.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000719ab", "role": "authenticated"}', true);
select is((select string_agg(right(house_id::text, 2) || ':' || season || ':' || genre || ':' || status, ' ' order by house_id, season)
  from public.city_liturgies), 'a1:3:festival:assigned a1:4:festival:assigned b1:3:festival:assigned c1:3:festival:assigned',
  'Bob lit les liturgies des cités de son monde : maison, saison, genre, état');
select is((select string_agg(right(house_id::text, 2) || ':' || due, ' ') from public.my_liturgies), 'b1:600', 'il ne lit que le dû de sa maison');
select throws_ok('select due from game.liturgies', '42501', null, 'il ne lit pas le dû d''une autre maison dans la table');
-- L'identifiant (préfixé par l'instant d'insertion) et la date diraient l'ordre d'insertion : ni l'un ni l'autre.
select throws_ok('select id from game.liturgies', '42501', null, 'ni l''identifiant d''une liturgie');
select throws_ok('select created_at from game.liturgies', '42501', null, 'ni sa date');
select is((select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'city_liturgies'
  and column_name ~ '(^due$|wealth|fortune|^id$|created_at)'), 0, 'la vue publique n''a ni dû, ni fortune, ni identifiant, ni date');
select throws_ok($$insert into game.liturgies (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at)
  values ('01900000-0000-7000-8000-0000000719f0', '01900000-0000-7000-8000-0000000719c1', '00000000-0000-7000-8000-0000000719b1', 9, 'festival', 1, 200, 201, now())$$,
  '42501', null, 'un joueur n''écrit pas de liturgie');
-- Dion, d'un autre monde, ne lit rien ; Alice lit ses deux dûs.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000719ad", "role": "authenticated"}', true);
select is((select count(*)::integer from public.city_liturgies) + (select count(*)::integer from public.my_liturgies), 0,
  'une maison d''un autre monde ne lit aucune de ces liturgies');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000719aa", "role": "authenticated"}', true);
select is((select string_agg(season || ':' || due, ' ' order by season) from public.my_liturgies), '3:700 4:900', 'Alice lit ses dûs');
reset role;
set local role anon;
select throws_ok('select * from public.city_liturgies', '42501', null, 'un visiteur anonyme ne lit pas les liturgies');
select throws_ok('select * from public.my_liturgies', '42501', null, 'ni les siennes');
reset role;

select * from finish();
rollback;
