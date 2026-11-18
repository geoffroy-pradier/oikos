-- Citoyenneté de la maison du joueur avec sa date (docs/specs/06-cites-politique-communaute.md, 6.2 ;
-- docs/specs/10-ux-ui.md ; docs/specs/12-modele-donnees.md ; ticket 420). L'onglet Cité dit depuis quand la
-- maison est métèque ou citoyenne. `public.houses`, recréée sans condition par la migration 2, garde ses
-- colonnes (ADR 0006) : la date passe par une vue nouvelle. Le code précédent ne lit pas cette vue.
--
-- Vue `security_invoker`, sans fonction nouvelle : elle ne lit que ce que le joueur connecté lit déjà dans
-- `game` (`citizenships`, `current_house_ids()`, `clock_rules()`), et ne rend que les lignes de ses propres
-- maisons. Le statut et la date de toute autre maison n'en sortent pas ; un visiteur anonyme ne lit rien.
-- Le jour de jeu est calculé comme les autres lectures datées (`my_cash_flows`) à l'horloge en vigueur
-- (jour civil local dont la clôture a ouvert l'instant, en jours depuis 1970-01-01) ; nul sans horloge.
-- Créée une fois (ADR 0006) : rejouable, et une colonne de plus passera par une vue nouvelle.
do $$
begin
  if to_regclass('public.my_citizenships') is null then
    create view public.my_citizenships with (security_invoker = true) as
      select z.house_id, z.city_id, z.status, z.since,
             (((z.since at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
               - date '1970-01-01')::integer as since_day
      from game.citizenships z
      left join game.clock_rules() c on true
      where z.house_id in (select game.current_house_ids());
  end if;
end $$;
revoke all on public.my_citizenships from public, anon;
grant select on public.my_citizenships to authenticated;
