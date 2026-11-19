begin;
select plan(7);

-- Un compte n'a qu'une maison dans tout le jeu (#604) : Alice a sa maison dans l'Archipel, puis tente d'en fonder une
-- dans un second monde ; Bob, sans maison, fonde la sienne dans ce second monde.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000460a1', 'one-house-alice@example.test'),
  ('00000000-0000-4000-8000-0000000460b2', 'one-house-bob@example.test');
insert into game.worlds (id, slug, name) values
  ('00000000-0000-7000-8000-000000046002', 'one-house-second', 'Second');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000460a1', '01900000-0000-7000-8000-000000000001',
   '00000000-0000-4000-8000-0000000460a1', 'Unique Alcmène', '{}');

-- Forme : la contrainte garde son nom, que l'API traduit en `HOUSE_ALREADY_EXISTS`, et ne porte plus que le compte.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'game.houses'::regclass and conname = 'houses_one_per_user'),
  'UNIQUE (user_id)', 'une maison par compte, tous mondes confondus');
select is(
  (select count(*)::int from pg_constraint
   where conrelid = 'game.houses'::regclass and contype = 'u' and conkey @> array[
     (select attnum from pg_attribute where attrelid = 'game.houses'::regclass and attname = 'user_id')]),
  1, 'aucune autre unicité portant sur le compte');

-- Écritures sous le rôle de service, comme l'API : chaque issue est relevée, puis comparée sous le propriétaire
-- (pgTAP vit dans `extensions`, que le service ne voit pas).
set local role oikos_service;
do $$
declare
  hit text;
begin
  -- Alice, dans un autre monde : refusée par la contrainte.
  begin
    insert into game.houses (world_id, user_id, name, blazon) values
      ('00000000-0000-7000-8000-000000046002', '00000000-0000-4000-8000-0000000460a1', 'Seconde Alcmène', '{}');
    hit := 'inserted';
  exception when unique_violation then
    get stacked diagnostics hit = constraint_name;
  end;
  perform set_config('one_house.other_world', hit, true);
  -- Alice, dans son propre monde : refusée de même.
  begin
    insert into game.houses (world_id, user_id, name, blazon) values
      ('01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000460a1', 'Autre Alcmène', '{}');
    hit := 'inserted';
  exception when unique_violation then
    get stacked diagnostics hit = constraint_name;
  end;
  perform set_config('one_house.same_world', hit, true);
  -- Bob, sans maison, fonde la sienne dans le second monde.
  insert into game.houses (id, world_id, user_id, name, blazon) values
    ('00000000-0000-7000-8000-0000000460b2', '00000000-0000-7000-8000-000000046002',
     '00000000-0000-4000-8000-0000000460b2', 'Unique Bérénice', '{}');
  perform set_config('one_house.bob', 'inserted', true);
end $$;
reset role;
select is(current_setting('one_house.other_world'), 'houses_one_per_user',
  'une seconde maison dans un autre monde est refusée');
select is(current_setting('one_house.same_world'), 'houses_one_per_user',
  'une seconde maison dans le même monde est refusée');
select is(current_setting('one_house.bob'), 'inserted',
  'un compte sans maison fonde la sienne dans le second monde');
select throws_ok(
  $$update game.houses set user_id = '00000000-0000-4000-8000-0000000460a1'
    where id = '00000000-0000-7000-8000-0000000460b2'$$,
  '23505', null, 'une maison ne passe pas à un compte qui en a déjà une');
select is(
  (select count(*)::int from game.houses where user_id = '00000000-0000-4000-8000-0000000460a1'),
  1, 'Alice n''a toujours qu''une maison');

select * from finish();
rollback;
