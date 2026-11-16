-- Lectures des grâces par les joueurs (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; ticket 266) : les grâces de
-- la configuration en vigueur dans les règles des temples (publiques), et les grâces de sa propre maison, en attente
-- ou en recharge (privées). Rejouable (fonction nouvelle à type de retour `jsonb`, vues recréées sous condition,
-- règle recréée) ; le code précédent lit `temple_rules` par ses colonnes, inchangées, et ne lit pas `my_graces`.

-- Grâces de la configuration en vigueur, règles du jeu connues de tous les joueurs (tout champ qui y est ajouté
-- leur devient visible). Une version publiée avant les grâces n'en a aucune : une liste vide. Sans version, aucune
-- ligne. `game.temple_rules()` (migration 182) garde son type de retour (ADR 0006) : fonction à part.
create or replace function game.temple_graces() returns table (graces jsonb)
language sql stable security definer
set search_path = ''
as $$
  select coalesce(v.payload -> 'graces', '[]'::jsonb)
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.temple_graces() from public;
grant execute on function game.temple_graces() to authenticated;

-- Grâces de sa maison : règle par ligne et colonnes accordées une à une (ni le site ni le voyage qui l'a
-- consommée : `my_sites` et `my_voyages` les disent déjà).
drop policy if exists graces_used_read_own on game.graces_used;
create policy graces_used_read_own on game.graces_used for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, invoked_at, ready_at, consumed_at)
  on game.graces_used to authenticated;

-- `temple_rules` gagne la colonne `graces` une fois : une migration plus récente qui lui en ajoute une autre
-- (la Pythie, #270) ne la perd pas au rejeu de celle-ci (ADR 0006). `my_graces` est créée une fois : en attente
-- (`consumed_at` nul), ou consommée et encore en recharge jusqu'à `ready_at` ; une invocation rechargée et
-- consommée n'y figure plus.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'temple_rules' and column_name = 'graces') then
    create or replace view public.temple_rules with (security_invoker = true) as
      select r.gods, g.graces from game.temple_rules() r cross join game.temple_graces() g;
  end if;
  if to_regclass('public.my_graces') is null then
    create view public.my_graces with (security_invoker = true) as
      select id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, invoked_at, ready_at, consumed_at
      from game.graces_used
      where consumed_at is null or ready_at > now();
  end if;
end $$;
revoke all on public.temple_rules, public.my_graces from public, anon;
grant select on public.temple_rules, public.my_graces to authenticated;
