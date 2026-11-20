-- Horloge du monde lue par le client (docs/specs/10-ux-ui.md, en-tête de page ; ticket 690) : l'en-tête de chaque
-- écran donne l'heure de la prochaine clôture quotidienne. La vue ne rend que l'heure de clôture et le fuseau de la
-- configuration en vigueur, par `game.clock_rules()` (migrations 32 et 33), règles publiques comme celles des sites ;
-- ni la durée des saisons ni rien d'autre de la section `clock`.
-- Rejouable (`create or replace`, droits redonnés) ; le client précédent ne la lit pas.
create or replace view public.clock_rules with (security_invoker = true) as
  select daily_close_hour, timezone from game.clock_rules();
-- Les droits par défaut de Supabase donnent tout à `service_role` sur une vue de `public` : l'API ne lit pas celle-ci.
revoke all on public.clock_rules from public, anon, authenticated, oikos_service, service_role;
grant select on public.clock_rules to authenticated;
