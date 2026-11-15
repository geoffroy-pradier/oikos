-- Règles des sites lues par le client : salaire du jour de chaque cité (docs/specs/04-systemes-gestion.md,
-- 4.4 ; ticket 255). Le client annonce le prix d'une relance, qui comprend les salaires des travailleurs
-- du site : il lui faut la section `staff` de la configuration en vigueur, règle publique.
--
-- La fonction et la vue gardent leur forme : la migration 18 les recrée telles quelles (`create or
-- replace`) quand la suite est rejouée, ce qu'une colonne de plus rendrait impossible. La section
-- `staff` est donc rendue dans la colonne `sites`, sous la clé `staff`, quand la version la porte ; une
-- version publiée avant le personnel rend `sites` comme avant, et le client applique alors la valeur par
-- défaut du schéma partagé (aucun salaire). Le client précédent lit `sites` avec un schéma souple, qui
-- ignore une clé inconnue.
create or replace function game.site_rules() returns table (recipes jsonb, sites jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'recipes',
         case when v.payload ? 'staff' and jsonb_typeof(v.payload -> 'sites') = 'object'
           then (v.payload -> 'sites') || jsonb_build_object('staff', v.payload -> 'staff')
           else v.payload -> 'sites'
         end
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.site_rules() from public;
grant execute on function game.site_rules() to authenticated;
