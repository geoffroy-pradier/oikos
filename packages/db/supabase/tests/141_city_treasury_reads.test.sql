begin;
select plan(13);

-- Jeu d'essai, monde de test (Kallistè 101, Elaia 103). Le trésor de Kallistè reçoit et paie par des écritures
-- de chaque nature, datées autour de la clôture de 4 h (Europe/Paris) ; une maison y a aussi des lignes, que les
-- comptes publics ne montrent pas. Les contrôles différés du grand livre ne tournent pas : tout est annulé.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000141aa', 'treasury-a@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000141a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000141aa', 'Alcméonides', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000141ac', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000141a1');
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-0000000141c1', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000000141c1', now());
-- Une écriture : `amount` au trésor de Kallistè (débit s'il est négatif), `house` à la maison, le reste au robinet.
create function pg_temp.entry(kind text, at timestamptz, amount bigint, house bigint default 0, meta jsonb default '{}')
returns void language plpgsql as $$
declare
  entry_id uuid;
begin
  insert into game.ledger_entries (world_id, kind, created_at, meta) values ('01900000-0000-7000-8000-000000000001', kind, at, meta)
    returning ledger_entries.id into entry_id;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry_id, a.id, v.amount from (values
      ((select t.id from game.accounts t where t.kind = 'treasury' and t.city_id = '01900000-0000-7000-8000-000000000101'), amount),
      ('00000000-0000-7000-8000-0000000141ac'::uuid, house),
      ((select s.id from game.accounts s where s.world_id = '01900000-0000-7000-8000-000000000001'
         and s.system_key = case when amount > 0 then 'faucet_npc_purchases' else 'sink_public_works' end), -amount - house)
    ) v (account_id, amount) join game.accounts a on a.id = v.account_id
  where v.amount <> 0
  order by v.amount desc;
end $$;
-- Jour de jeu du 10 novembre 2026 ; celui du 11 est le suivant.
create function pg_temp.day(offset_days integer default 0) returns integer language sql as $$
  select date '2026-11-10' - date '1970-01-01' + offset_days
$$;
grant execute on function pg_temp.day(integer) to authenticated;
select pg_temp.entry('market.trade', '2026-11-10 12:00Z', 30, 570);
select pg_temp.entry('npc.purchase', '2026-11-11 02:59Z', 20, 380);
select pg_temp.entry('property.sale', '2026-11-11 03:00Z', 5, 95,
  '{"propertyId": "00000000-0000-7000-8000-0000000141e1", "listingId": "00000000-0000-7000-8000-0000000141e2"}');
select pg_temp.entry('voyage.departure', '2026-11-11 04:00Z', 7);
select pg_temp.entry('city.public_works', '2026-11-11 05:00Z', -40);
select pg_temp.entry('city.festival', '2026-11-11 06:00Z', -10);
select pg_temp.entry('test.other', '2026-11-11 07:00Z', 3);
select pg_temp.entry('market.trade', '2026-11-11 08:00Z', 4, 76);
select pg_temp.entry('city.public_works', '2026-11-10 13:00Z', 1);
select pg_temp.entry('city.public_works', '2026-11-10 14:00Z', -1);

-- Droits : seuls les joueurs connectés lisent, et seulement ces agrégats.
select is(
  (select string_agg(r.rolname || ':' || p.proname, ' ' order by r.rolname, p.proname) from pg_roles r
   cross join pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'game' and p.proname in ('city_treasuries', 'city_treasury_flows')
     and has_function_privilege(r.oid, p.oid, 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated:city_treasuries authenticated:city_treasury_flows', 'seuls les joueurs connectés calculent les comptes publics');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('city_treasury', 'city_treasury_flows')
     and grantee in ('anon', 'authenticated', 'oikos_service')),
  'city_treasury:authenticated:SELECT city_treasury_flows:authenticated:SELECT', 'vues en lecture seule, rien pour un visiteur anonyme');

set local role anon;
select throws_ok('select * from public.city_treasury', '42501', null, 'un visiteur anonyme ne lit pas le trésor');
select throws_ok('select * from public.city_treasury_flows', '42501', null, 'ni ses flux');
reset role;

-- Un joueur connecté, quelle que soit sa cité, lit le trésor de chaque cité et ses flux.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000141aa", "role": "authenticated"}';
select results_eq($$select city_id, balance from public.city_treasury
  where city_id in ('01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000103') order by city_id$$,
  $$values ('01900000-0000-7000-8000-000000000101'::uuid, 19::bigint), ('01900000-0000-7000-8000-000000000103'::uuid, 0::bigint)$$,
  'le solde du trésor de chaque cité, trésor vide compris');
select results_eq($$select game_day, nature, amount from public.city_treasury_flows
  where city_id = '01900000-0000-7000-8000-000000000101' order by game_day, nature$$,
  $$values (pg_temp.day(), 'market_tax', 50::bigint), (pg_temp.day(1), 'festival', -10::bigint),
           (pg_temp.day(1), 'market_tax', 9::bigint), (pg_temp.day(1), 'other', 3::bigint),
           (pg_temp.day(1), 'port_dues', 7::bigint), (pg_temp.day(1), 'public_works', -40::bigint)$$,
  'par jour de jeu (clôture à 4 h, bord compris) et par nature ; un net nul n''a pas de ligne');
select is((select sum(amount) from public.city_treasury_flows where city_id = '01900000-0000-7000-8000-000000000101'),
  (select balance from public.city_treasury where city_id = '01900000-0000-7000-8000-000000000101')::numeric,
  'la somme des flux est le solde : les lignes de la maison n''y sont pas');
select is((select count(*) from public.city_treasury_flows where city_id <> '01900000-0000-7000-8000-000000000101'), 0::bigint,
  'une cité sans mouvement n''a pas de flux');
select is((select count(*) from game.accounts where kind = 'treasury'), 0::bigint, 'le compte du trésor reste fermé');
select is((select count(*) from game.ledger_lines l where l.account_id <> '00000000-0000-7000-8000-0000000141ac'), 0::bigint,
  'et ses lignes aussi : un joueur ne lit que celles de sa maison');
select throws_ok($$insert into public.city_treasury (city_id, balance) values ('01900000-0000-7000-8000-000000000101', 1)$$,
  '55000', null, 'personne n''écrit par la vue du solde, faite d''une fonction (et sans droit d''écriture)');
select throws_ok($$delete from public.city_treasury_flows$$, '55000', null, 'ni par celle des flux');
reset role;

-- Sans horloge en vigueur, les flux restent lisibles, sans jour de jeu.
with v as (insert into config.versions (payload) values ('{}') returning id)
insert into config.activations (version_id, activate_at) select id, now() from v;
set local role authenticated;
select is((select count(*) from public.city_treasury_flows where game_day is null and city_id = '01900000-0000-7000-8000-000000000101'),
  5::bigint, 'sans configuration d''horloge, une ligne par nature, sans jour');
reset role;

select * from finish();
rollback;
