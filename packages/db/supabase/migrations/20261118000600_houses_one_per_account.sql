-- Un compte a au plus une maison dans tout le jeu, tous mondes confondus (#604, docs/specs/11-architecture.md, 11.4).
-- Les commandes agissent pour « la » maison du compte authentifié : la base garantit qu'elle est unique.
-- La contrainte garde son nom, `houses_one_per_user`, que l'API traduit déjà en `HOUSE_ALREADY_EXISTS` : la version
-- précédente du code refuse donc une seconde maison dans un autre monde sous le même code.
-- Rejouable : sans effet si la contrainte porte déjà sur le seul compte. Aucune maison n'est supprimée : si un compte
-- en a déjà plusieurs, la migration échoue et ne change rien, et un humain décide de leur sort (`needs-human`).
do $$
declare
  user_col smallint := (
    select attnum from pg_catalog.pg_attribute
    where attrelid = 'game.houses'::regclass and attname = 'user_id'
  );
  accounts bigint;
begin
  if exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'game.houses'::regclass and conname = 'houses_one_per_user'
      and contype = 'u' and conkey = array[user_col]
  ) then
    return;
  end if;

  -- Aucune maison ne se fonde pendant le contrôle et le changement de contrainte.
  lock table game.houses in access exclusive mode;
  select count(*) into accounts
  from (select 1 from game.houses group by user_id having count(*) > 1) as several;
  if accounts > 0 then
    raise exception 'houses_one_per_user: % account(s) own several houses', accounts
      using errcode = 'unique_violation',
            hint = 'No house is deleted: decide which house each of these accounts keeps, then deploy again.';
  end if;

  -- L'unicité par compte implique l'ancienne, par monde et par compte, dont l'index ne sert plus.
  alter table game.houses drop constraint if exists houses_one_per_user;
  alter table game.houses add constraint houses_one_per_user unique (user_id);
end $$;
