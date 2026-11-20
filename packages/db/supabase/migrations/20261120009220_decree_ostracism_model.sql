-- Modèle de décret `ostracism` (docs/specs/06-cites-politique-communaute.md, 6.3 et 6.4 ; ticket 722).
-- L'archonte en charge propose l'ostracisme comme tout décret ; adopté, il ouvre un vote où chaque citoyen
-- inscrit un nom (migration 9221). Le décret n'a aucun paramètre : les règles du vote sont celles de la
-- configuration de la clôture qui l'ouvre.
-- Rejouable : la contrainte du catalogue garde son nom (un test d'intégration la compare à `DECREE_MODELS`) et
-- n'est remplacée que si elle ignore encore le modèle. Le code précédent ne propose pas ce modèle.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'game.decrees'::regclass and conname = 'decrees_model_check'
                   and pg_get_constraintdef(oid) like '%''ostracism''%') then
    alter table game.decrees drop constraint if exists decrees_model_check;
    alter table game.decrees add constraint decrees_model_check
      check (model in ('market_tax_rate', 'port_dues', 'public_works', 'festival', 'ostracism'));
  end if;
end $$;

-- Au plus un décret d'ostracisme au vote par cité : deux propositions simultanées ne passent pas toutes deux.
create unique index if not exists decrees_one_ostracism_proposed_idx on game.decrees (city_id)
  where model = 'ostracism' and status = 'proposed';
