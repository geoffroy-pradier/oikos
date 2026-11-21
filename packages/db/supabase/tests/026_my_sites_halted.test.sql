begin;
select plan(6);

-- Jeu d'essai : Alice a un champ à l'arrêt depuis deux heures, Bob un champ qui tourne.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Philaïdes', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000002a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000002b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-000000000101', 'grow_wheat');
alter table game.sites disable trigger sites_guard;
update game.sites set created_at = now() - interval '1 day', cycle_started_at = now() - interval '1 day' where world_id = '01900000-0000-7000-8000-000000000001';
update game.sites set halted_at = now() - interval '2 hours' where id = '00000000-0000-7000-8000-0000000002a1';
alter table game.sites enable trigger sites_guard;

select is(
  (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'my_sites'),
  'id,house_id,city_id,recipe_id,cycle_started_at,halted_at', 'colonnes de la vue my_sites : liste figée, l''arrêt en dernier');

set local role anon;
select throws_ok('select halted_at from public.my_sites', '42501', null, 'anon ne lit pas l''arrêt d''un site');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select results_eq('select id, halted_at from public.my_sites',
  $$values ('00000000-0000-7000-8000-0000000002a1'::uuid, now() - interval '2 hours')$$, 'Alice lit l''arrêt de son champ, et de lui seul');
select throws_ok($$update public.my_sites set halted_at = null$$, '42501', null, 'elle ne relance pas son site en écrivant dans la vue');
select throws_ok('select halted_at, created_at from game.sites', '42501', null, 'les colonnes non accordées de ses sites restent illisibles');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select results_eq('select id, halted_at from public.my_sites',
  $$values ('00000000-0000-7000-8000-0000000002b1'::uuid, null::timestamptz)$$, 'Bob ne voit que son champ, qui tourne');

select * from finish();
rollback;
