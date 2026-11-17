-- Lectures de la modération par les joueurs (docs/specs/15-back-office-olympe.md, 15.1 ; 18 ; ticket 275) : une
-- maison lit ses signalements, un compte ses sanctions, et tout joueur connecté les motifs de signalement.
-- Rejouable (`create or replace`, règles recréées, vues créées sous condition, droits redonnés) ; le code
-- précédent ne lit ni ces fonctions ni ces vues.

-- Lectures des joueurs. Une maison lit ses signalements, jamais la maison qu'ils désignent.
drop policy if exists reports_read_own on game.reports;
create policy reports_read_own on game.reports for select to authenticated
  using (house_id in (select game.current_house_ids()));
grant select (id, message_id, house_id, reason, state, created_at) on game.reports to authenticated;

-- Un compte lit ses sanctions, sans leur auteur ni leur validation, et pas une exclusion encore à valider. Le
-- schéma `admin` reste fermé aux joueurs : la lecture passe par cette fonction du propriétaire, qui ne rend que
-- les lignes du compte connecté.
create or replace function game.my_sanctions()
returns table (id uuid, kind text, starts_at timestamptz, ends_at timestamptz, reason text, appeal_body text,
               appealed_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select s.id, s.kind, s.starts_at, s.ends_at, s.reason, s.appeal_body, s.appealed_at
  from admin.sanctions s
  where s.user_id = (select auth.uid()) and (s.kind <> 'ban' or s.validated_by is not null);
$$;
revoke all on function game.my_sanctions() from public, anon, oikos_service;
grant execute on function game.my_sanctions() to authenticated;

-- Motifs de signalement de la configuration en vigueur, lus par le client ; jamais les termes interdits. Nuls
-- pour une version publiée avant la modération : le client applique la valeur par défaut du schéma partagé.
create or replace function game.moderation_rules() returns table (report_reasons jsonb)
language sql stable security definer
set search_path = ''
as $$
  select v.payload -> 'moderation' -> 'reportReasons'
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.moderation_rules() from public, anon, oikos_service;
grant execute on function game.moderation_rules() to authenticated;

-- Vues créées sous condition (ADR 0006).
do $$
begin
  if to_regclass('public.my_reports') is null then
    create view public.my_reports with (security_invoker = true) as
      select id, message_id, house_id, reason, state, created_at from game.reports;
  end if;
  if to_regclass('public.my_sanctions') is null then
    create view public.my_sanctions with (security_invoker = true) as
      select id, kind, starts_at, ends_at, reason, appeal_body, appealed_at from game.my_sanctions();
  end if;
  if to_regclass('public.moderation_rules') is null then
    create view public.moderation_rules with (security_invoker = true) as
      select report_reasons from game.moderation_rules();
  end if;
end $$;
revoke all on public.my_reports, public.my_sanctions, public.moderation_rules from public, anon, authenticated;
grant select on public.my_reports, public.my_sanctions, public.moderation_rules to authenticated;
