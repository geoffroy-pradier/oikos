-- Changement de rôle d'administration (docs/specs/15-back-office-olympe.md, 15.3 ; ticket 77).
-- Le rôle de service n'a toujours aucun droit d'écriture sur `admin.roles` : les commandes
-- `admin.grantRole` et `admin.revokeRole` passent par cette fonction, exécutée au nom du propriétaire,
-- qui porte les règles que la concurrence ne doit pas pouvoir contourner.

-- Accorde `new_role` à `target`, ou lui retire son rôle si `new_role` est null. Rend le rôle précédent.
-- Chaque refus porte un nom de contrainte : c'est lui que l'API traduit en erreur métier.
create or replace function admin.set_role(actor uuid, target uuid, new_role text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
begin
  -- Un seul changement de rôle à la fois : les contrôles ci-dessous voient les changements déjà validés.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('admin.roles'));
  -- Relu sous le verrou : un super-administrateur retiré à l'instant ne change plus rien.
  if not exists (select 1 from admin.roles where user_id = actor and role = 'super_admin') then
    raise exception 'only a super administrator changes roles'
      using errcode = 'check_violation', constraint = 'roles_changed_by_super_admin';
  end if;
  if not exists (select 1 from auth.users where id = target) then
    raise exception 'unknown account' using errcode = 'check_violation', constraint = 'roles_account_exists';
  end if;
  select role into previous from admin.roles where user_id = target;
  if new_role is null then
    delete from admin.roles where user_id = target;
  else
    insert into admin.roles (user_id, role, granted_by) values (target, new_role, actor)
    on conflict (user_id) do update
      set role = excluded.role, granted_by = excluded.granted_by, granted_at = pg_catalog.now();
  end if;
  -- Sans super-administrateur, plus personne ne pourrait gérer les rôles sans passer par la base.
  if not exists (select 1 from admin.roles where role = 'super_admin') then
    raise exception 'the last super administrator cannot be removed'
      using errcode = 'check_violation', constraint = 'roles_keep_one_super_admin';
  end if;
  return previous;
end;
$$;

-- Par défaut, toute fonction est exécutable par tous : seule l'API de jeu appelle celle-ci.
revoke all on function admin.set_role(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function admin.set_role(uuid, uuid, text) to oikos_service;
