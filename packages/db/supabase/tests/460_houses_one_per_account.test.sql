begin;
select plan(13);

-- Un compte ne fonde qu'une maison dans tout le jeu (#604) : Alice a sa maison dans l'Archipel et tente d'en fonder une
-- dans un second monde ; Bob, sans maison, fonde la sienne dans ce second monde ; Chloé a hérité deux maisons d'avant
-- la règle (posées ici en contournant le déclencheur).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000460a1', 'one-house-alice@example.test'),
  ('00000000-0000-4000-8000-0000000460b2', 'one-house-bob@example.test'),
  ('00000000-0000-4000-8000-0000000460c3', 'one-house-chloe@example.test');
insert into game.worlds (id, slug, name) values
  ('00000000-0000-7000-8000-000000046002', 'one-house-second', 'Second');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000460a1', '01900000-0000-7000-8000-000000000001',
   '00000000-0000-4000-8000-0000000460a1', 'Unique Alcmène', '{}');
alter table game.houses disable trigger houses_one_per_account;
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000460c1', '01900000-0000-7000-8000-000000000001',
   '00000000-0000-4000-8000-0000000460c3', 'Ancienne Cléo', '{}'),
  ('00000000-0000-7000-8000-0000000460c2', '00000000-0000-7000-8000-000000046002',
   '00000000-0000-4000-8000-0000000460c3', 'Seconde Cléo', '{}');
alter table game.houses enable trigger houses_one_per_account;

-- Forme : l'unicité par monde reste, le déclencheur s'y ajoute, sans privilège du propriétaire.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'game.houses'::regclass and conname = 'houses_one_per_user'),
  'UNIQUE (world_id, user_id)', 'l''unicité par monde et par compte est gardée');
select ok(
  not (select prosecdef from pg_proc where oid = 'game.houses_one_per_account()'::regprocedure),
  'le déclencheur s''exécute au nom de l''appelant');
select is(
  (select array_agg(a.grantee::regrole::text || ':' || a.privilege_type order by a.grantee)
   from pg_proc p, aclexplode(p.proacl) a where p.oid = 'game.houses_one_per_account()'::regprocedure),
  (select array[proowner::regrole::text || ':EXECUTE'] from pg_proc where oid = 'game.houses_one_per_account()'::regprocedure),
  'seul le propriétaire exécute la fonction : ni public, ni anon, ni joueur, ni service');

-- Écritures sous le rôle de service, comme l'API : chaque issue est relevée, puis comparée sous le propriétaire
-- (pgTAP vit dans `extensions`, que le service ne voit pas).
set local role oikos_service;
do $$
declare
  hit text;
  attempt record;
begin
  for attempt in
    select * from (values
      ('other_world', $q$insert into game.houses (world_id, user_id, name, blazon) values
        ('00000000-0000-7000-8000-000000046002', '00000000-0000-4000-8000-0000000460a1', 'Seconde Alcmène', '{}')$q$),
      ('same_world', $q$insert into game.houses (world_id, user_id, name, blazon) values
        ('01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000460a1', 'Autre Alcmène', '{}')$q$),
      ('bob', $q$insert into game.houses (id, world_id, user_id, name, blazon) values
        ('00000000-0000-7000-8000-0000000460b2', '00000000-0000-7000-8000-000000046002',
         '00000000-0000-4000-8000-0000000460b2', 'Unique Bérénice', '{}')$q$),
      ('chloe_third', $q$insert into game.houses (world_id, user_id, name, blazon)
        select id, '00000000-0000-4000-8000-0000000460c3', 'Troisième Cléo', '{}' from game.worlds
        where id = '00000000-0000-7000-8000-000000046002'$q$),
      ('chloe_rename', $q$update game.houses set name = 'Renommée Cléo'
        where id = '00000000-0000-7000-8000-0000000460c2'$q$)
    ) as t (label, statement)
  loop
    begin
      execute attempt.statement;
      hit := 'done';
    exception when unique_violation then
      get stacked diagnostics hit = constraint_name;
    end;
    perform set_config('one_house.' || attempt.label, hit, true);
  end loop;
end $$;
reset role;
select is(current_setting('one_house.other_world'), 'houses_one_per_user',
  'une seconde maison dans un autre monde est refusée, sous le nom que l''API traduit');
select is(current_setting('one_house.same_world'), 'houses_one_per_user',
  'une seconde maison dans le même monde est refusée');
select is(current_setting('one_house.bob'), 'done', 'un compte sans maison fonde la sienne dans le second monde');
select is(current_setting('one_house.chloe_third'), 'houses_one_per_user',
  'un compte hérité à deux maisons n''en fonde pas une troisième');
select is(current_setting('one_house.chloe_rename'), 'done', 'une maison héritée se renomme');

-- Le compte d'une maison ne change que sous le propriétaire (le service n'a pas ce droit de colonne).
select throws_ok($$update game.houses set user_id = '00000000-0000-4000-8000-0000000460a1'
  where id = '00000000-0000-7000-8000-0000000460b2'$$, '23505', null,
  'une maison ne passe pas à un compte qui en a déjà une');
select lives_ok($$update game.houses set user_id = user_id where id = '00000000-0000-7000-8000-0000000460c2'$$,
  'une maison héritée qui reste à son compte n''est pas revérifiée');
select is(
  (select array_agg(name order by name) from game.houses
   where user_id in ('00000000-0000-4000-8000-0000000460a1', '00000000-0000-4000-8000-0000000460c3')),
  array['Ancienne Cléo', 'Renommée Cléo', 'Unique Alcmène'], 'aucune maison ajoutée ni retirée');

-- Défense en profondeur : attachée par le propriétaire à une autre table, la fonction refuse de s'exécuter.
create temporary table owner_houses (id uuid, user_id uuid);
create trigger t before insert on owner_houses for each row execute function game.houses_one_per_account();
select throws_ok($$insert into owner_houses values (gen_random_uuid(), gen_random_uuid())$$, '42501',
  't only runs on game.houses', 'houses_one_per_account ne s''exécute que sur les maisons');
select is(
  (select pg_get_indexdef('game.houses_user_id_idx'::regclass)),
  'CREATE INDEX houses_user_id_idx ON game.houses USING btree (user_id, created_at, id)',
  'la maison d''un compte se lit par index, la plus ancienne d''abord');

select * from finish();
rollback;
