-- Présages lus par leur joueur (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; 12-modele-donnees.md ; ticket 735).
-- Un joueur connecté lit les présages de ses maisons (`public.my_omens`), rendus par une fonction exécutée au nom du
-- propriétaire : leurs textes, le jour du présage et celui de l'échéance, puis l'issue, avec ce que la sanction a pris.
-- Le modèle de la sanction ne se lit qu'une fois réglée : avant, le présage ne le dit qu'à mots couverts. Jamais
-- l'ampleur ni la baisse de la jauge, qui diraient sa valeur ; rien d'une autre maison.
-- Un voyage perdu à Némésis se lit perdu (`my_voyages.cargo_lost`, migration 9961), comme une cargaison perdue en mer.
-- Rejouable (`create or replace` à signature égale, vue créée une fois, droits redonnés) ; le code précédent ne la lit
-- pas, et lit `cargo_lost` comme avant.

create or replace function game.my_omens()
returns table (id uuid, house_id uuid, text_fr text, text_en text, omen_day integer, due_day integer, outcome text,
               model text, settled_day integer, oboles bigint, city_id uuid, good_id text, quantity bigint,
               site_id uuid, resumes_at timestamptz, voyage_id uuid)
language sql stable security definer
set search_path = ''
as $$
  select o.id, o.house_id, o.text_fr, o.text_en, o.omen_day, o.due_day, o.outcome,
         case when o.outcome is not null then o.model end, o.settled_day, o.oboles, i.city_id, i.good_id,
         o.quantity, o.site_id, o.resumes_at, o.voyage_id
  from game.nemesis_omens o
  left join game.inventories i on i.id = o.inventory_id
  where o.house_id in (select game.current_house_ids());
$$;
revoke all on function game.my_omens() from public, anon, authenticated, oikos_service, service_role;
grant execute on function game.my_omens() to authenticated;

-- Vue créée une fois (ADR 0006) : rejouée, la migration ne la recrée pas, et une colonne pourra s'y ajouter en fin.
do $$
begin
  if to_regclass('public.my_omens') is null then
    create view public.my_omens with (security_invoker = true) as
      select id, house_id, text_fr, text_en, omen_day, due_day, outcome, model, settled_day, oboles, city_id, good_id,
             quantity, site_id, resumes_at, voyage_id
      from game.my_omens();
  end if;
end $$;
-- Les droits par défaut de Supabase donnent tout à `service_role` sur une vue de `public` : l'API ne lit pas celle-ci.
revoke all on public.my_omens from public, anon, authenticated, oikos_service, service_role;
grant select on public.my_omens to authenticated;

-- Issue d'un voyage (migration 9961) : perdu en mer ou à Némésis. Même signature, mêmes droits.
create or replace function game.voyage_cargo_lost(voyage_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when v.arrived_at is null then null
    else exists (select 1 from game.stock_ledger l
                 where l.voyage_id = v.id and l.from_system = 'in_transit' and l.to_system in ('lost_at_sea', 'nemesis'))
  end
  from game.voyages v
  where v.id = voyage_cargo_lost.voyage_id and v.house_id in (select game.current_house_ids());
$$;
revoke all on function game.voyage_cargo_lost(uuid) from public, anon;
grant execute on function game.voyage_cargo_lost(uuid) to authenticated;
