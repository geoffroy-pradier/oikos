begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test');
insert into admin.roles (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'super_admin');

select lives_ok($$insert into admin.roles (user_id, role, granted_by)
  values ('00000000-0000-4000-8000-00000000000b', 'observer', '00000000-0000-4000-8000-00000000000a')$$, 'rôle accordé par un administrateur');
select throws_ok($$insert into admin.roles (user_id, role) values ('00000000-0000-4000-8000-00000000000b', 'support')$$,
  '23505', null, 'un seul rôle par compte');
select throws_ok($$update admin.roles set role = 'god' where user_id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', null, 'rôle hors liste refusé');
select throws_ok($$update admin.roles set granted_by = user_id where user_id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', null, 'on ne s''accorde pas un rôle à soi-même');
select throws_ok($$insert into admin.roles (user_id, role) values (game.uuid_v7(), 'observer')$$,
  '23503', null, 'rôle pour un compte inconnu refusé');
select throws_ok($$insert into admin.roles (user_id) values (game.uuid_v7())$$, '23502', null, 'le rôle est obligatoire');

-- Les six rôles de la spécification 15.3, ni plus ni moins : la liste est lue dans la contrainte elle-même.
select is(
  (select array_agg(m[1] order by m[1]) from pg_constraint c,
     regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') as m
   where c.conrelid = 'admin.roles'::regclass and c.conname = 'roles_role_check'),
  array['community_manager', 'game_designer', 'moderator', 'observer', 'super_admin', 'support'],
  'liste des rôles conforme à la spécification 15.3');
select lives_ok(format($$update admin.roles set role = %L where user_id = '00000000-0000-4000-8000-00000000000b'$$, r), format('rôle %s admis', r))
from unnest(array['game_designer', 'community_manager', 'moderator', 'support']) as r;

-- Un joueur connecté ne lit pas la table et ne peut pas s'y inscrire.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select throws_ok('select * from admin.roles', '42501', null, 'lecture refusée à un joueur');
select throws_ok($$insert into admin.roles (user_id, role) values ('00000000-0000-4000-8000-00000000000b', 'super_admin')$$,
  '42501', null, 'un joueur ne se nomme pas administrateur');
reset role;

select * from finish();
rollback;
