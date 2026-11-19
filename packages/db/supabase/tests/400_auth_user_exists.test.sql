begin;
select plan(14);

-- Compte encore présent dans Supabase Auth (#565) : Alice (a1) existe, Bob (b2) a été effacé en douceur,
-- Chloé (c3) est effacée pendant le test, et un quatrième identifiant n'a jamais existé.
insert into auth.users (id, email, deleted_at) values
  ('00000000-0000-4000-8000-0000000400a1', 'exists-alice@example.test', null),
  ('00000000-0000-4000-8000-0000000400b2', 'exists-bob@example.test', now()),
  ('00000000-0000-4000-8000-0000000400c3', 'exists-chloe@example.test', null);

-- Forme : lecture seule, au nom du propriétaire, sans chemin de recherche détournable.
select is(
  (select provolatile from pg_proc where oid = 'game.auth_user_exists(uuid)'::regprocedure), 's',
  'la fonction ne fait que lire');
select ok(
  (select prosecdef from pg_proc where oid = 'game.auth_user_exists(uuid)'::regprocedure),
  'la fonction lit auth.users au nom du propriétaire');
select is(
  (select proconfig from pg_proc where oid = 'game.auth_user_exists(uuid)'::regprocedure), array['search_path=""'],
  'chemin de recherche vide');

-- Droits : le service seul l'exécute, et n'en tire aucun droit sur les comptes eux-mêmes.
select ok(has_function_privilege('oikos_service', 'game.auth_user_exists(uuid)', 'execute'),
  'le service vérifie un compte');
select ok(not has_function_privilege('authenticated', 'game.auth_user_exists(uuid)', 'execute'),
  'un joueur ne sonde pas les comptes');
select ok(not has_function_privilege('anon', 'game.auth_user_exists(uuid)', 'execute'),
  'un visiteur ne sonde pas les comptes');
select ok(not has_table_privilege('oikos_service', 'auth.users', 'select'),
  'le service ne lit toujours pas auth.users');

-- Réponses calculées sous le rôle de service, comme l'API, puis comparées sous le propriétaire : le service ne voit
-- pas les fonctions de pgTAP (schéma `extensions` sous Supabase).
set local role oikos_service;
do $$
begin
  perform set_config('auth_user_exists.alice', game.auth_user_exists('00000000-0000-4000-8000-0000000400a1')::text, true);
  perform set_config('auth_user_exists.bob', game.auth_user_exists('00000000-0000-4000-8000-0000000400b2')::text, true);
  perform set_config('auth_user_exists.unknown', game.auth_user_exists('00000000-0000-4000-8000-0000000400d4')::text, true);
  perform set_config('auth_user_exists.nil', coalesce(game.auth_user_exists(null)::text, 'null'), true);
end $$;
reset role;
select is(current_setting('auth_user_exists.alice')::boolean, true, 'compte présent');
select is(current_setting('auth_user_exists.bob')::boolean, false, 'compte effacé en douceur : absent');
select is(current_setting('auth_user_exists.unknown')::boolean, false, 'compte inconnu : absent');
select is(current_setting('auth_user_exists.nil'), 'false', 'identifiant nul : absent, sans erreur');

-- Le compte effacé pour de bon cesse d'exister pour l'API, dans la même session.
delete from auth.users where id = '00000000-0000-4000-8000-0000000400c3';
set local role oikos_service;
do $$
begin
  perform set_config('auth_user_exists.chloe', game.auth_user_exists('00000000-0000-4000-8000-0000000400c3')::text, true);
end $$;
reset role;
select is(current_setting('auth_user_exists.chloe')::boolean, false, 'compte supprimé : absent');

-- Un joueur connecté, même sur son propre compte, n'appelle pas la fonction : refus de droit, pas un booléen.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000400a1", "role": "authenticated"}';
select throws_ok($$select game.auth_user_exists('00000000-0000-4000-8000-0000000400a1')$$, '42501', null,
  'un joueur ne sonde pas son propre compte');
reset role;
set local role anon;
select throws_ok($$select game.auth_user_exists('00000000-0000-4000-8000-0000000400a1')$$, '42501', null,
  'un visiteur ne sonde aucun compte');
reset role;

select * from finish();
rollback;
