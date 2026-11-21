-- Palier d'Hybris (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; docs/specs/12-modele-donnees.md ; ticket 734).
-- Un joueur connecté lit le palier de chacune de ses maisons, jamais la valeur de la jauge ni rien d'une autre maison :
-- le palier est le nombre de bornes de `hubris.tiers`, dans la configuration en vigueur, que la jauge atteint. Une
-- maison sans ligne au journal, ou une version publiée avant l'Hybris, est au palier zéro.
-- Rejouable (`create or replace`, vue créée une fois, droits redonnés) ; le code précédent ne la lit pas.

create or replace function game.my_hubris_tier() returns table (house_id uuid, tier integer)
language sql stable security definer
set search_path = ''
as $$
  select h.id,
         (select count(*)::integer from jsonb_array_elements(v.payload -> 'hubris' -> 'tiers') b
          where jsonb_typeof(b) = 'number' and coalesce(x.gauge, 0) >= (b #>> '{}')::numeric)
  from game.houses h
  left join game.hubris x on x.house_id = h.id
  left join config.versions v
    on v.id = config.active_version_at(now()) and jsonb_typeof(v.payload -> 'hubris' -> 'tiers') = 'array'
  where h.id in (select game.current_house_ids()) and h.kind = 'player';
$$;
revoke all on function game.my_hubris_tier() from public, anon, authenticated, oikos_service, service_role;
grant execute on function game.my_hubris_tier() to authenticated;

-- Vue créée une fois (ADR 0006) : rejouée, la migration ne la recrée pas.
do $$
begin
  if to_regclass('public.my_hubris_tier') is null then
    create view public.my_hubris_tier with (security_invoker = true) as
      select house_id, tier from game.my_hubris_tier();
  end if;
end $$;
-- Les droits par défaut de Supabase donnent tout à `service_role` sur une vue de `public` : l'API ne lit pas celle-ci.
revoke all on public.my_hubris_tier from public, anon, authenticated, oikos_service, service_role;
grant select on public.my_hubris_tier to authenticated;
