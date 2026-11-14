-- Comptes de la maison : flux de trésorerie, stocks valorisés, bilan (docs/specs/04-systemes-gestion.md,
-- 4.1 ; ticket 73). Lecture seule : trois vues `security_invoker` de `public` sur le grand livre, sous
-- règles par ligne. Rien n'est recopié : un flux est une somme de lignes du grand livre, qui fait foi.

-- Horloge du monde lue par les vues : le jour de jeu d'une écriture se déduit de l'heure de clôture et
-- du fuseau de la configuration en vigueur, comme le fait le moteur (`gameDayAt`, packages/sim). Même
-- montage que `market_rules` (migration 21) : le schéma `config` reste fermé, la fonction ne rend que
-- trois valeurs de la section `clock`, règles publiques. `season_days` servira au compte de résultat
-- par saison du même ticket : changer plus tard le type rendu imposerait de recréer les vues.
create or replace function game.clock_rules()
returns table (daily_close_hour integer, timezone text, season_days integer)
language sql stable security definer
set search_path = ''
as $$
  select (v.payload -> 'clock' ->> 'dailyCloseHour')::integer, v.payload -> 'clock' ->> 'timezone',
         (v.payload -> 'clock' ->> 'seasonDays')::integer
  from config.versions v
  where v.id = config.active_version_at(now());
$$;
revoke all on function game.clock_rules() from public;
grant execute on function game.clock_rules() to authenticated;

-- Un joueur lit le séquestre de sa maison comme sa trésorerie : le bilan le montre. (`my_treasury`
-- filtre elle-même la trésorerie : elle ne change pas.)
drop policy if exists accounts_read_own on game.accounts;
create policy accounts_read_own on game.accounts for select to authenticated
  using (kind in ('house', 'escrow') and house_id in (select game.current_house_ids()));
grant select (id) on game.accounts to authenticated;

-- Grand livre : un joueur ne lit que les lignes de ses propres comptes (trésorerie, séquestre), et
-- d'une écriture que sa nature et sa date, si l'une de ses lignes est à lui. Ni les autres lignes de
-- l'écriture (contrepartie, taxe), ni `meta` ne sont lisibles. La liste des comptes est calculée une
-- fois par requête (`array(...)`) : la règle sert alors de condition d'index sur `account_id`, au lieu
-- de filtrer tout le grand livre.
drop policy if exists ledger_lines_read_own on game.ledger_lines;
create policy ledger_lines_read_own on game.ledger_lines for select to authenticated
  using (account_id = any (array(
    select a.id from game.accounts a
    where a.kind in ('house', 'escrow') and a.house_id in (select game.current_house_ids()))));
drop policy if exists ledger_entries_read_own on game.ledger_entries;
create policy ledger_entries_read_own on game.ledger_entries for select to authenticated
  using (exists (select 1 from game.ledger_lines l where l.entry_id = ledger_entries.id));
grant select (entry_id, account_id, amount) on game.ledger_lines to authenticated;
grant select (id, kind, created_at) on game.ledger_entries to authenticated;

-- Échanges : le vendeur lit le prix et la quantité de ses propres ventes, pour séparer le brut de la
-- taxe (le grand livre ne lui crédite que le net). L'acheteur n'en a pas besoin : il paie le brut.
drop policy if exists trades_read_seller on game.trades;
create policy trades_read_seller on game.trades for select to authenticated
  using (exists (select 1 from game.orders o
                 where o.id = trades.sell_order_id and o.house_id in (select game.current_house_ids())));
grant select (ledger_entry_id, sell_order_id, price, quantity) on game.trades to authenticated;
create index if not exists trades_ledger_entry_idx on game.trades (ledger_entry_id);

-- Flux de trésorerie : par compte (`treasury`, `escrow`), jour de jeu et nature, en oboles, crédit
-- positif. Chaque ligne du grand livre y est comptée une fois et en entier : la somme des flux d'un
-- compte sur une période est la variation de son solde, quelles que soient les données.
--  - `sales` est le brut des ventes (prix × quantité de l'échange) et `taxes` l'écart entre ce brut et
--    le net crédité ; sans échange lisible pour l'écriture, la vente est comptée pour son net.
--  - `escrow` : monnaie retenue pour un achat en attente ou rendue ; un achat servi plus tard est un
--    flux `purchases` du séquestre, pas de la trésorerie.
--  - `other` : toute nature d'écriture inconnue ici. Rien ne disparaît quand une commande en ajoute une.
-- Le jour de jeu est le rang du jour civil local ouvert par la clôture (jours depuis 1970-01-01, comme
-- `daily_closes.game_day`), lu avec l'horloge en vigueur à la lecture ; nul sans configuration active.
create or replace view public.my_cash_flows with (security_invoker = true) as
  select house_id, account, game_day, nature, sum(amount)::bigint as amount
  from (
    select a.house_id,
           case a.kind when 'house' then 'treasury' else a.kind end as account,
           ((e.created_at at time zone c.timezone) - make_interval(hours => c.daily_close_hour))::date
             - date '1970-01-01' as game_day,
           f.nature, f.amount
    from game.accounts a
    join game.ledger_lines l on l.account_id = a.id
    join game.ledger_entries e on e.id = l.entry_id
    left join game.clock_rules() c on true
    left join lateral (
      select sum(t.price * t.quantity) as gross from game.trades t where t.ledger_entry_id = e.id
    ) sale on l.amount > 0 and e.kind in ('market.trade', 'npc.purchase')
    cross join lateral (values
      (case
         when e.kind in ('market.trade', 'npc.purchase') then case when l.amount > 0 then 'sales' else 'purchases' end
         when e.kind in ('market.escrow_hold', 'market.escrow_release') then 'escrow'
         when e.kind in ('upkeep.daily', 'upkeep.restart') then 'upkeep'
         when e.kind = 'site.acquire' then 'acquisitions'
         when e.kind = 'house.starting_grant' then 'grant'
         else 'other'
       end, coalesce(sale.gross, l.amount)),
      ('taxes', l.amount - sale.gross)
    ) f (nature, amount)
    where a.kind in ('house', 'escrow') and f.amount <> 0
  ) flows
  group by house_id, account, game_day, nature
  having sum(amount) <> 0;

-- Stocks valorisés au dernier prix de référence observé du marché de leur cité (migration 24), daté.
-- Un bien jamais échangé dans la cité n'a ni prix ni valeur : nul, jamais un prix inventé. Un stock
-- vide n'a pas de ligne. La quantité comprend la part réservée par les ventes en attente.
create or replace view public.my_valued_stocks with (security_invoker = true) as
  select i.house_id, i.city_id, i.good_id, i.quantity,
         p.price as unit_price, i.quantity * p.price as value, p.observed_at as priced_at
  from game.inventories i
  left join game.observed_prices p on p.city_id = i.city_id and p.good_id = i.good_id
  where i.quantity > 0;

-- Bilan : une ligne par maison. Trésorerie, séquestre (nul tant que la maison n'en a pas ouvert),
-- valeur des stocks qui ont un prix, et nombre de stocks sans prix, que cette valeur ignore.
create or replace view public.my_balance_sheet with (security_invoker = true) as
  select a.house_id, a.balance as treasury,
         coalesce((select e.balance from game.accounts e where e.house_id = a.house_id and e.kind = 'escrow'), 0) as escrow,
         coalesce(s.stock_value, 0)::bigint as stock_value, s.unpriced_stocks
  from game.accounts a
  cross join lateral (
    select sum(v.value) as stock_value, count(*) filter (where v.value is null) as unpriced_stocks
    from public.my_valued_stocks v
    where v.house_id = a.house_id
  ) s
  where a.kind = 'house';

grant select on public.my_cash_flows, public.my_valued_stocks, public.my_balance_sheet to authenticated;
