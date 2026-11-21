-- Règles publiques des liturgies (docs/specs/06-cites-politique-communaute.md, 6.4 ; ticket 723).
-- L'écran d'accomplissement annonce la Timè et la Charis gagnées, le faste le plus haut et la Timè perdue d'une
-- dérobade : le client ne porte aucune constante d'équilibrage (règle 1), il les lit dans la configuration en vigueur.
-- Seuls ces quatre nombres sortent : ni le plancher de fortune, ni la part due, ni le nombre de maisons désignées, qui
-- diraient comment la désignation suit la fortune (4.1). Même montage que `property_rules` (migration 112).
-- Droits alignés sur `good_tiers` (migration 8730) : tout rôle client ou de service est révoqué explicitement, sur la
-- fonction comme sur la vue, puis seuls les joueurs connectés reçoivent l'exécution et la lecture.
-- Rejouable (`create or replace`, vue créée une fois, droits redonnés) ; le code précédent ne la lit pas.

create or replace function game.liturgy_rules() returns table (rules jsonb)
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'honorGain', v.payload -> 'liturgies' -> 'honorGain',
    'charisGain', v.payload -> 'liturgies' -> 'charisGain',
    'evasionHonorLoss', v.payload -> 'liturgies' -> 'evasionHonorLoss',
    'maxSplendorBps', coalesce(v.payload -> 'liturgies' -> 'maxSplendorBps', '0'::jsonb))
  from config.versions v
  where v.id = config.active_version_at(now()) and jsonb_typeof(v.payload -> 'liturgies') = 'object';
$$;
revoke all on function game.liturgy_rules() from public, anon, authenticated, oikos_service, service_role;
grant execute on function game.liturgy_rules() to authenticated;

do $$
begin
  if to_regclass('public.liturgy_rules') is null then
    create view public.liturgy_rules with (security_invoker = true) as
      select rules from game.liturgy_rules();
  end if;
end $$;
-- Les droits par défaut de Supabase donnent tout à `service_role` sur une vue de `public` : l'API ne lit pas celle-ci.
revoke all on public.liturgy_rules from public, anon, authenticated, oikos_service, service_role;
grant select on public.liturgy_rules to authenticated;
