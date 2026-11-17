begin;
select plan(20);

-- Jeu d'essai : un monde à lui, quatre cités dont une absente de la configuration et une sans dieu
-- protecteur ; à Kallistè (Déméter, poids ×0,5) Alice et Bob citoyens, Chloé métèque ; à Elaia (Athéna,
-- publiée sans Charis) Dion citoyen. La Charis est posée par le propriétaire, garde levée le temps de
-- l'écrire ; l'offrande d'Alice, sous le rôle de service.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c152',
  '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7},
    "gods": [{"id": "demeter", "charisPerObole": 1, "charisPerUnit": {"wheat": 6}, "dailyDecayBps": 100, "cityCharisWeightBps": 5000},
             {"id": "athena"}, {"id": "apollo", "charisPerObole": 2}],
    "cities": [{"id": "kalliste", "population": {}, "patronGodId": "demeter"},
               {"id": "elaia", "population": {}, "patronGodId": "athena"}, {"id": "halos", "population": {}}]}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c152', now());
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000152f0', 'temples', 'Temples');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000152f1', '01900000-0000-7000-8000-0000000152f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000152f2', '01900000-0000-7000-8000-0000000152f0', 'elaia', 'Elaia'),
  ('01900000-0000-7000-8000-0000000152f3', '01900000-0000-7000-8000-0000000152f0', 'halos', 'Halos'),
  ('01900000-0000-7000-8000-0000000152f4', '01900000-0000-7000-8000-0000000152f0', 'delos', 'Délos');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000152a' || n)::uuid, 'temples-' || n || '@example.test' from unnest(array['a', 'b', 'c', 'd']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000152' || n || '1')::uuid, '01900000-0000-7000-8000-0000000152f0',
       ('00000000-0000-4000-8000-0000000152a' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Kérykes'), ('d', 'Eumolpides')) h (n, name);
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000152a1', '01900000-0000-7000-8000-0000000152f1'),
  ('00000000-0000-7000-8000-0000000152b1', '01900000-0000-7000-8000-0000000152f1'),
  ('00000000-0000-7000-8000-0000000152c1', '01900000-0000-7000-8000-0000000152f1'),
  ('00000000-0000-7000-8000-0000000152d1', '01900000-0000-7000-8000-0000000152f2');
update game.citizenships set status = 'citizen', since = now()
where house_id in ('00000000-0000-7000-8000-0000000152a1', '00000000-0000-7000-8000-0000000152b1', '00000000-0000-7000-8000-0000000152d1');
alter table game.favor_ledger disable trigger favor_ledger_guard;
insert into game.favor_ledger (world_id, house_id, god_id, amount, kind)
select '01900000-0000-7000-8000-0000000152f0', ('00000000-0000-7000-8000-0000000152' || n || '1')::uuid, god, amount, 'test.seed'
from (values ('a', 'demeter', 1001), ('a', 'apollo', 7), ('b', 'demeter', 2000), ('c', 'demeter', 500), ('d', 'athena', 300)) f (n, god, amount);
set constraints all immediate;
set constraints all deferred;
alter table game.favor_ledger enable trigger favor_ledger_guard;
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000152a2', '01900000-0000-7000-8000-0000000152f0', 'house', '00000000-0000-7000-8000-0000000152a1');
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000152f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a.id, case when a.kind = 'house' then 1000 else -1000 end from entry, game.accounts a
where a.world_id = '01900000-0000-7000-8000-0000000152f0' and (a.kind = 'house' or a.system_key = 'faucet_starting_grant');
-- Offrande de 30 oboles d'Alice à Apollon (60 Charis), sous le rôle de service.
set local role oikos_service;
do $$
declare e uuid; o uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000152f0', 'temple.offering') returning id into e;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select e, a.id, case when a.kind = 'house' then -30 else 30 end from game.accounts a
  where a.world_id = '01900000-0000-7000-8000-0000000152f0' and (a.kind = 'house' or a.system_key = 'sink_offerings');
  insert into game.offerings (world_id, house_id, city_id, god_id, oboles, charis, ledger_entry_id)
  values ('01900000-0000-7000-8000-0000000152f0', '00000000-0000-7000-8000-0000000152a1', '01900000-0000-7000-8000-0000000152f1',
          'apollo', 30, 60, e) returning id into o;
  insert into game.favor_ledger (world_id, house_id, god_id, amount, kind, offering_id)
  values ('01900000-0000-7000-8000-0000000152f0', '00000000-0000-7000-8000-0000000152a1', 'apollo', 60, 'offering', o);
end $$;
reset role;
set constraints all immediate;
set constraints all deferred;

-- Droits : lecture seule pour les joueurs connectés, rien pour un visiteur anonyme.
select is(
  (select string_agg(table_name || ':' || privilege_type, ' ' order by table_name, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('temple_rules', 'city_charis', 'my_favor') and grantee in ('anon', 'authenticated')),
  'city_charis:SELECT my_favor:SELECT temple_rules:SELECT', 'lecture seule des trois vues, et rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname || ':' || f, ' ' order by f, r.rolname) from pg_roles r, unnest(array['game.temple_rules()', 'game.city_charis()']) f
   where has_function_privilege(r.oid, f, 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated:game.city_charis() authenticated:game.temple_rules()', 'seuls les joueurs connectés exécutent les fonctions');
select is(
  (select string_agg(table_name || '.' || column_name, ' ' order by table_name, column_name) from information_schema.columns
   where table_schema = 'public' and table_name in ('temple_rules', 'city_charis', 'my_favor')),
  'city_charis.charis city_charis.city_id city_charis.god_id my_favor.charis my_favor.god_id my_favor.house_id temple_rules.gods '
    || 'temple_rules.graces temple_rules.oracle',
  'colonnes des vues : liste figée');

set local role anon;
select throws_ok('select * from public.my_favor', '42501', null, 'un visiteur anonyme ne lit pas de Charis');
select throws_ok('select * from public.temple_rules', '42501', null, 'ni les règles des temples');
select throws_ok('select * from public.city_charis', '42501', null, 'ni la Charis des cités');

-- Alice : les règles de la version en vigueur, sa seule Charis, celle des cités.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000152aa", "role": "authenticated"}';
select is((select gods -> 0 ->> 'cityCharisWeightBps' from public.temple_rules), '5000', 'les règles des temples sont celles de la version en vigueur');
select is((select jsonb_array_length(gods) from public.temple_rules), 3, 'tous les dieux, un dieu publié sans Charis compris');
select results_eq('select god_id, charis from public.my_favor order by god_id',
  $$values ('apollo', 67::bigint), ('demeter', 1001::bigint)$$, 'sa Charis par dieu, offrande comprise');
select is((select count(*) from game.favor), 2::bigint, 'pas celle des autres maisons, même par la table');
select results_eq('select god_id, charis from public.city_charis where city_id = ''01900000-0000-7000-8000-0000000152f1''',
  $$values ('demeter', 1500::bigint)$$, 'Charis de cité : ses citoyennes envers son dieu protecteur, ×0,5, arrondie vers zéro, sans les métèques');
select results_eq('select god_id, charis from public.city_charis where city_id = ''01900000-0000-7000-8000-0000000152f2''',
  $$values ('athena', 0::bigint)$$, 'un dieu publié sans Charis a un poids nul');
select is((select count(*) from public.city_charis where city_id in ('01900000-0000-7000-8000-0000000152f3', '01900000-0000-7000-8000-0000000152f4')),
  0::bigint, 'ni ligne pour une cité sans dieu protecteur, ni pour une cité absente de la configuration');
select throws_ok($$insert into game.favor (house_id, god_id, world_id) values
  ('00000000-0000-7000-8000-0000000152a1', 'athena', '01900000-0000-7000-8000-0000000152f0')$$, '42501', null, 'un joueur n''écrit pas de Charis');
select throws_ok('update public.my_favor set charis = 9999', '42501', null, 'ni par la vue');

-- Les comptes d'Alice : l'offrande est une nature à part, hors exploitation.
select results_eq('select nature, amount from public.my_cash_flows order by nature',
  $$values ('offerings', -30::bigint), ('other', 1000::bigint)$$, 'une offrande est rangée sous la nature `offerings`');
select results_eq('select operating_result, other, non_operating, cash_change from public.my_income_statement',
  $$values (0::bigint, 970::bigint, 970::bigint, 970::bigint)$$, 'hors exploitation, dans la colonne `other`');

-- Bob : la sienne seulement ; un compte sans maison : rien.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000152ab", "role": "authenticated"}';
select results_eq('select house_id, god_id, charis from public.my_favor',
  $$values ('00000000-0000-7000-8000-0000000152b1'::uuid, 'demeter', 2000::bigint)$$, 'Bob ne lit que sa Charis');
select is((select count(*) from public.my_cash_flows), 0::bigint, 'ni les comptes d''Alice');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000152ff", "role": "authenticated"}';
select is((select count(*) from public.my_favor), 0::bigint, 'un compte sans maison ne lit aucune Charis');

select * from finish();
rollback;
