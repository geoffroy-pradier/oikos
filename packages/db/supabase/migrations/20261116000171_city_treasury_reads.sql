-- Comptes publics du trésor des cités (docs/specs/05-economie.md, 5.6 ; 06-cites-politique-communaute.md, 6.2 :
-- « comptes publics visibles de tous » ; ticket 263). Tout joueur connecté lit le solde du trésor de chaque cité
-- et ses flux par jour de jeu et par nature ; un visiteur anonyme ne lit rien, et personne n'écrit par ces vues.
-- Le compte et ses lignes restent fermés aux joueurs : deux fonctions au nom du propriétaire n'en rendent que
-- ces agrégats. Rejouable (`create or replace` aux colonnes inchangées, vues créées une fois, ADR 0006) ; le
-- code précédent ne lit ni ces fonctions ni ces vues.

-- Solde du trésor de chaque cité, toutes cités et tous mondes confondus.
create or replace function game.city_treasuries()
returns table (city_id uuid, balance bigint)
language sql stable security definer
set search_path = ''
as $$
  select a.city_id, a.balance from game.accounts a where a.kind = 'treasury';
$$;

-- Flux du trésor de chaque cité, crédit positif, par jour de jeu (horloge en vigueur à la lecture, comme les
-- comptes de la maison : `my_cash_flows`) et par nature d'écriture : la part de la taxe de marché que garde la
-- cité (échanges de l'agora, achats des PNJ, revente d'un bien), celle du droit de port (départ d'un navire),
-- les grands travaux et les fêtes ; `other` pour toute nature d'écriture inconnue ici, pour que rien ne
-- disparaisse quand une mécanique en ajoute une. La somme des flux d'une cité est le solde de son trésor ; un
-- jour dont le net d'une nature est nul n'a pas de ligne.
create or replace function game.city_treasury_flows()
returns table (city_id uuid, game_day integer, nature text, amount bigint)
language sql stable security definer
set search_path = ''
as $$
  select a.city_id,
         ((e.created_at at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
           - date '1970-01-01',
         case
           when e.kind in ('market.trade', 'npc.purchase', 'property.sale') then 'market_tax'
           when e.kind = 'voyage.departure' then 'port_dues'
           when e.kind = 'city.public_works' then 'public_works'
           when e.kind = 'city.festival' then 'festival'
           else 'other'
         end,
         sum(l.amount)::bigint
  from game.accounts a
  join game.ledger_lines l on l.account_id = a.id
  join game.ledger_entries e on e.id = l.entry_id
  left join game.clock_rules() c on true
  where a.kind = 'treasury'
  group by 1, 2, 3
  having sum(l.amount) <> 0;
$$;
revoke all on function game.city_treasuries(), game.city_treasury_flows() from public, anon, oikos_service;
grant execute on function game.city_treasuries(), game.city_treasury_flows() to authenticated;

do $$
begin
  if to_regclass('public.city_treasury') is null then
    create view public.city_treasury with (security_invoker = true) as
      select city_id, balance from game.city_treasuries();
  end if;
  if to_regclass('public.city_treasury_flows') is null then
    create view public.city_treasury_flows with (security_invoker = true) as
      select city_id, game_day, nature, amount from game.city_treasury_flows();
  end if;
end $$;
revoke all on public.city_treasury, public.city_treasury_flows from public, anon;
grant select on public.city_treasury, public.city_treasury_flows to authenticated;
