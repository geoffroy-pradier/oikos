-- Règles des intendants lues par le client (docs/specs/04-systemes-gestion.md, 4.4 ; ticket 278) : postes,
-- salaire et nombre de règles, pour annoncer le coût d'une embauche et borner le formulaire des règles.
-- La fonction et la vue gardent leur forme (ADR 0006) : la section `stewards` de la version en vigueur est rendue
-- dans la colonne `sites`, sous la clé `stewards`, sans ses noms, comme le salaire du jour sous `staff`
-- (migration 61). Une version publiée avant les intendants n'a pas la clé : le client lit « aucun poste ». Le
-- client précédent lit `sites` avec un schéma souple, qui ignore une clé inconnue. Rejouable (`create or replace`).
create or replace function game.site_rules() returns table (recipes jsonb, sites jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'recipes',
         case when jsonb_typeof(v.payload -> 'sites') = 'object'
           then (v.payload -> 'sites')
             || case when v.payload ? 'staff'
                  then jsonb_build_object('staff', v.payload -> 'staff') else '{}'::jsonb end
             || case when jsonb_typeof(v.payload -> 'stewards') = 'object'
                  then jsonb_build_object('stewards', (v.payload -> 'stewards') - 'names') else '{}'::jsonb end
           else v.payload -> 'sites'
         end
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.site_rules() from public;
grant execute on function game.site_rules() to authenticated;
