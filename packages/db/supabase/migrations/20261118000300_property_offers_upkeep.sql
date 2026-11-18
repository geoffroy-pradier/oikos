-- Offres ouvertes avec l'entretien impayé du bien (docs/specs/04-systemes-gestion.md, 4.5 ;
-- docs/specs/12-modele-donnees.md ; ticket 403). Un bien revendu garde son impayé, et un bien loué ne loge
-- pas son locataire tant que l'entretien n'est pas payé : l'acheteur et le locataire le voient avant de
-- prendre l'offre. `game.property_offers()` garde son type de retour (ADR 0006) : la donnée passe par une
-- fonction et une vue nouvelles. Rejouable (`create or replace` au type inchangé, vue créée une fois) ; le
-- code précédent lit toujours `property_offers`, inchangée.

-- Les colonnes de `property_offers`, puis l'impayé : s'il y en a un, et le jour de jeu où une clôture l'a
-- constaté, calculé comme les autres lectures datées (`my_cash_flows`) à l'horloge en vigueur (jour civil
-- local dont la clôture a ouvert l'instant, en jours depuis 1970-01-01) ; nul sans horloge en vigueur.
-- Jamais la maison qui offre, ni l'instant exact de l'impayé. Au nom du propriétaire de la base, la
-- fonction ne rend que ces colonnes ; créée sans condition, elle garde ce type de retour (ADR 0006).
create or replace function game.property_offers_upkeep()
returns table (property_id uuid, city_id uuid, size_id text, lot integer, condition integer, kind text,
  price_oboles bigint, listed_at timestamptz, upkeep_unpaid boolean, upkeep_unpaid_day integer)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.city_id, p.size_id, p.lot, p.condition, o.kind, o.price_oboles, o.created_at,
         p.upkeep_unpaid_since is not null,
         (((p.upkeep_unpaid_since at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
           - date '1970-01-01')::integer
  from game.property_listings o
  join game.properties p on p.id = o.property_id
  left join game.clock_rules() c on true
  where o.closed_at is null;
$$;
revoke all on function game.property_offers_upkeep() from public;
grant execute on function game.property_offers_upkeep() to authenticated;

-- Vue créée une fois (ADR 0006). Elle ne lit que la fonction ci-dessus, au type figé : une colonne de plus
-- passera par une fonction nouvelle.
do $$
begin
  if to_regclass('public.property_offers_upkeep') is null then
    create view public.property_offers_upkeep with (security_invoker = true) as
      select property_id, city_id, size_id, lot, condition, kind, price_oboles, listed_at, upkeep_unpaid, upkeep_unpaid_day
      from game.property_offers_upkeep();
  end if;
end $$;
revoke all on public.property_offers_upkeep from public, anon;
grant select on public.property_offers_upkeep to authenticated;
