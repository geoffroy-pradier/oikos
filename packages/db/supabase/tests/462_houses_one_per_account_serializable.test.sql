begin isolation level serializable;
select plan(3);

-- Le déclencheur de #604 ne lit une fondation concurrente validée qu'en READ COMMITTED : sous un instantané de début de
-- transaction (serializable), il refuse toute maison nouvelle ou changeant de compte, en échec de sérialisation (40001).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000004620a1', 'isolation-462-alice@example.test'),
  ('00000000-0000-4000-8000-0000004620b2', 'isolation-462-bob@example.test');
alter table game.houses disable trigger houses_one_per_account;
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000004620a1', '01900000-0000-7000-8000-000000000001',
   '00000000-0000-4000-8000-0000004620a1', 'Isolée Alcmène', '{}');
alter table game.houses enable trigger houses_one_per_account;

select throws_ok($$insert into game.houses (world_id, user_id, name, blazon) values
    ('01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000004620b2', 'Isolée Bérénice', '{}')$$,
  '40001', 'houses_one_per_account requires READ COMMITTED', 'même une première maison est refusée hors de READ COMMITTED');
select throws_ok($$update game.houses set user_id = '00000000-0000-4000-8000-0000004620b2'
    where id = '00000000-0000-7000-8000-0000004620a1'$$,
  '40001', 'houses_one_per_account requires READ COMMITTED', 'un changement de compte aussi');
select lives_ok($$update game.houses set name = 'Renommée Alcmène', user_id = user_id where id = '00000000-0000-7000-8000-0000004620a1'$$,
  'une maison qui reste à son compte se met à jour');

select * from finish();
rollback;
