begin;
select plan(21);

-- Jeu d'essai isolé : aucun autre rôle que ceux posés ici (la transaction est annulée à la fin).
delete from admin.roles;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'chloe@example.test');
insert into admin.roles (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'super_admin');

-- L'API appelle la fonction sous le rôle de service, qui n'écrit jamais la table lui-même : chaque
-- instruction ci-dessous est exécutée sous ce rôle (les assertions restent au propriétaire).
create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'oikos_service', true);
  execute statement into result;
  perform set_config('role', 'none', true);
  return result;
end $$;
create function pg_temp.set_role(actor text, target text, new_role text) returns text language sql as $$
  select pg_temp.as_service(format('select admin.set_role(%L, %L, %L)',
    '00000000-0000-4000-8000-00000000000' || actor, '00000000-0000-4000-8000-00000000000' || target, new_role))
$$;

-- Refus d'un changement : code d'erreur et nom de contrainte, celui que l'API traduit en erreur métier.
create function pg_temp.refusal(actor text, target text, new_role text) returns text language plpgsql as $$
declare
  code text;
  name text;
begin
  perform pg_temp.set_role(actor, target, new_role);
  return 'accepté';
exception when others then
  get stacked diagnostics code = returned_sqlstate, name = constraint_name;
  return code || ' ' || name;
end $$;

select is(pg_temp.set_role('a', 'b', 'observer'), null::text, 'premier rôle : aucun rôle précédent');
select is((select role || ' par ' || granted_by from admin.roles where user_id = '00000000-0000-4000-8000-00000000000b'),
  'observer par 00000000-0000-4000-8000-00000000000a', 'rôle inscrit avec le compte qui l''accorde');
select is(pg_temp.set_role('a', 'b', 'super_admin'), 'observer', 'changement de rôle : rend le précédent');
select is((select count(*) from admin.roles where user_id = '00000000-0000-4000-8000-00000000000b'), 1::bigint, 'toujours un seul rôle par compte');
select is(pg_temp.set_role('b', 'c', null), null::text, 'retrait sans rôle : rien à retirer, aucun refus');

-- Deux super-administrateurs en place : nul ne change son propre rôle, mais l'un peut se retirer.
select is(pg_temp.refusal('b', 'b', 'observer'), '23514 roles_not_self_granted', 'nul ne change son propre rôle, même s''il reste un autre super-administrateur');
select is((select role from admin.roles where user_id = '00000000-0000-4000-8000-00000000000b'), 'super_admin', 'et son rôle est intact');
select is(pg_temp.set_role('a', 'a', null), 'super_admin', 'un super-administrateur se retire lui-même s''il en reste un autre');
select is((select count(*) from admin.roles where user_id = '00000000-0000-4000-8000-00000000000a'), 0::bigint, 'la ligne du rôle retiré a disparu');

-- Un seul super-administrateur reste : chaque refus porte son nom de contrainte et ne change rien.
create temp table roles_before as select * from admin.roles;
select is(pg_temp.refusal('a', 'c', 'observer'), '23514 roles_changed_by_super_admin', 'un super-administrateur retiré n''accorde plus rien');
select is(pg_temp.refusal('c', 'c', 'super_admin'), '23514 roles_changed_by_super_admin', 'un compte sans rôle ne nomme personne');
select is(pg_temp.refusal('b', 'b', null), '23514 roles_keep_one_super_admin', 'le dernier super-administrateur ne se retire pas');
select is(pg_temp.refusal('b', 'd', 'observer'), '23514 roles_account_exists', 'compte inconnu refusé');
select is(pg_temp.refusal('b', 'c', 'god'), '23514 roles_role_check', 'rôle hors liste refusé');
select results_eq('select * from admin.roles', 'select * from roles_before', 'les refus n''ont rien changé, ligne entière comparée');
select is((select count(*) from admin.roles), 1::bigint, 'il reste exactement le dernier super-administrateur');

select throws_ok($$select pg_temp.as_service('delete from admin.roles')$$, '42501', null, 'le service ne supprime pas un rôle à la main');
select throws_ok($$select pg_temp.as_service($s$update admin.roles set role = 'observer'$s$)$$, '42501', null, 'ni ne le modifie');
select throws_ok($$select pg_temp.as_service($s$insert into admin.roles (user_id, role) values ('00000000-0000-4000-8000-00000000000c', 'super_admin')$s$)$$,
  '42501', null, 'ni n''en inscrit un');

select ok(has_function_privilege('oikos_service', 'admin.set_role(uuid, uuid, text)', 'execute'), 'le service exécute la fonction');
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_function_privilege(r, 'admin.set_role(uuid, uuid, text)', 'execute')),
  0::bigint, 'aucun rôle de l''API de Supabase ne l''exécute');

select * from finish();
rollback;
