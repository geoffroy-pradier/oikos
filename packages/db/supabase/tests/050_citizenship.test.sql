begin;
select plan(13);

-- Jeu d'essai : Alice et Bob ont chacun une maison métèque à Kallistè, dans le monde de test.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000050aa', 'cite-alice@example.test'),
  ('00000000-0000-4000-8000-0000000050ab', 'cite-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000050a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000050aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000050b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000050ab', 'Philaïdes', '{}');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;

-- Droits du service : il fonde une citoyenneté sans en choisir le statut ni la date, puis la promeut.
select is(
  (select string_agg(column_name || ':' || privilege_type, ' ' order by column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'citizenships' and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'city_id:INSERT house_id:INSERT since:UPDATE status:UPDATE',
  'le service écrit la maison et la cité à la fondation, le statut et la date à la promotion : liste figée');
select throws_ok(
  $$select pg_temp.as_service($s$insert into game.citizenships (house_id, city_id, status)
    values ('00000000-0000-7000-8000-0000000050b1', '01900000-0000-7000-8000-000000000101', 'citizen')$s$)$$,
  '42501', null, 'le service ne fonde pas une maison citoyenne');
select lives_ok(
  $$select pg_temp.as_service($s$insert into game.citizenships (house_id, city_id)
    values ('00000000-0000-7000-8000-0000000050a1', '01900000-0000-7000-8000-000000000101')$s$)$$,
  'le service fonde une citoyenneté');
select is(
  (select (status, since = now()) from game.citizenships where house_id = '00000000-0000-7000-8000-0000000050a1'),
  row('metic'::text, true), 'elle naît métèque, maintenant');
-- Même le propriétaire ne fonde pas une citoyenneté déjà citoyenne : la garde vaut pour tous.
select throws_ok(
  $$insert into game.citizenships (house_id, city_id, status)
    values ('00000000-0000-7000-8000-0000000050b1', '01900000-0000-7000-8000-000000000101', 'citizen')$$,
  '23001', 'a house is welcomed as a metic', 'une maison naît métèque');
insert into game.citizenships (house_id, city_id, since)
values ('00000000-0000-7000-8000-0000000050b1', '01900000-0000-7000-8000-000000000101', now() - interval '5 days');

-- Promotion.
select throws_ok(
  $$select pg_temp.as_service($s$update game.citizenships set status = 'citizen'
    where house_id = '00000000-0000-7000-8000-0000000050b1'$s$)$$,
  '23001', 'citizenship is granted now', 'une promotion est datée de sa transaction');
select throws_ok(
  $$select pg_temp.as_service($s$update game.citizenships set since = now()
    where house_id = '00000000-0000-7000-8000-0000000050b1'$s$)$$,
  '23001', 'the citizenship date only changes with its status', 'la date ne change pas sans le statut');
select lives_ok(
  $$select pg_temp.as_service($s$update game.citizenships set status = 'citizen', since = now()
    where house_id = '00000000-0000-7000-8000-0000000050b1'$s$)$$,
  'le service fait d''un métèque un citoyen');
select is(
  (select (status, since = now()) from game.citizenships where house_id = '00000000-0000-7000-8000-0000000050b1'),
  row('citizen'::text, true), 'citoyen depuis la promotion');
select throws_ok(
  $$select pg_temp.as_service($s$update game.citizenships set status = 'metic', since = now()
    where house_id = '00000000-0000-7000-8000-0000000050b1'$s$)$$,
  '23001', 'a citizen stays a citizen', 'un citoyen le reste');
select throws_ok(
  $$update game.citizenships set city_id = '01900000-0000-7000-8000-000000000103'
    where house_id = '00000000-0000-7000-8000-0000000050a1'$$,
  '23001', 'citizenship identity is immutable', 'une citoyenneté ne change pas de cité, même par le propriétaire');

-- Joueurs : lecture du statut de toute maison (public), aucune écriture.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000050aa", "role": "authenticated"}', true);
select is(
  (select string_agg(name || ':' || citizenship_status, ' ' order by name) from public.houses
   where id in ('00000000-0000-7000-8000-0000000050a1', '00000000-0000-7000-8000-0000000050b1')),
  'Alcméonides:metic Philaïdes:citizen', 'chaque joueur lit le statut de citoyenneté de toute maison');
select throws_ok(
  $$update game.citizenships set status = 'citizen', since = now()
    where house_id = '00000000-0000-7000-8000-0000000050a1'$$,
  '42501', null, 'un joueur ne se fait pas citoyen');
reset role;

select * from finish();
rollback;
