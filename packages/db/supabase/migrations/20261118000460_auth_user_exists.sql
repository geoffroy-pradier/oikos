-- Compte encore présent dans Supabase Auth (#565, docs/specs/11-architecture.md, 11.4).
-- Un jeton d'accès reste valide jusqu'à son expiration, même si son compte a été effacé entre-temps
-- (remise à zéro locale, suppression par l'administration) : l'API vérifie que le compte existe encore
-- avant toute écriture, et refuse sinon en `UNAUTHENTICATED`.
-- Un compte effacé en douceur par Supabase Auth (`deleted_at`) est tenu pour absent : il ne se connecte plus.
--
-- Le service n'a aucun droit sur le schéma `auth` : cette fonction ne lui rend qu'un booléen, jamais une
-- adresse ni une autre colonne du compte. Personne d'autre ne l'exécute : un joueur ne sonde pas les comptes.

create or replace function game.auth_user_exists(target uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users where id = target and deleted_at is null)
$$;

revoke execute on function game.auth_user_exists(uuid) from public, anon, authenticated;
grant execute on function game.auth_user_exists(uuid) to oikos_service;
