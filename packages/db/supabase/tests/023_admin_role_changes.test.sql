begin;
select plan(19);

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

select is(pg_temp.set_role('a', 'b', 'observer'), null::text, 'premier rôle : aucun rôle précédent');
select is((select role || ' par ' || granted_by from admin.roles where user_id = '00000000-0000-4000-8000-00000000000b'),
  'observer par 00000000-0000-4000-8000-00000000000a', 'rôle inscrit avec le compte qui l''accorde');
select is(pg_temp.set_role('a', 'b', 'super_admin'), 'observer', 'changement de rôle : rend le précédent');
select is((select count(*) from admin.roles where user_id = '00000000-0000-4000-8000-00000000000b'), 1::bigint, 'toujours un seul rôle par compte');
select is(pg_temp.set_role('b', 'c', null), null::text, 'retrait sans rôle : rien à retirer, aucun refus');
select is(pg_temp.set_role('b', 'a', null), 'super_admin', 'retrait : rend le rôle retiré');
select is((select count(*) from admin.roles where user_id = '00000000-0000-4000-8000-00000000000a'), 0::bigint, 'la ligne du rôle retiré a disparu');

select throws_ok($$select pg_temp.set_role('a', 'c', 'observer')$$, '23514', 'only a super administrator changes roles',
  'un super-administrateur retiré n''accorde plus rien');
select throws_ok($$select pg_temp.set_role('c', 'c', 'super_admin')$$, '23514', 'only a super administrator changes roles',
  'un compte sans rôle ne se nomme pas');
select throws_ok($$select pg_temp.set_role('b', 'b', null)$$, '23514', 'the last super administrator cannot be removed',
  'le dernier super-administrateur ne se retire pas');
select throws_ok($$select pg_temp.set_role('b', 'b', 'observer')$$, '23514', null, 'ni ne change son propre rôle');
select throws_ok($$select pg_temp.set_role('b', 'd', 'observer')$$, '23514', 'unknown account', 'compte inconnu refusé');
select throws_ok($$select pg_temp.set_role('b', 'c', 'god')$$, '23514', null, 'rôle hors liste refusé');
select is((select string_agg(role, ',') from admin.roles), 'super_admin', 'les refus n''ont rien changé');

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
