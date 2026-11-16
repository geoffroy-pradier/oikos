begin;
select plan(40);

-- Jeu d'essai, monde de test (Kallistè 101, Elaia 103) et un second monde à une cité, Kallistè aussi. Alice est
-- archonte de Kallistè ; ses décrets sont posés garde levée, déjà dépouillés : `t…` de taux, `p…` de droit de
-- port, `w` de grands travaux. Ceux qui sont déjà appliqués le sont à des dates passées.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000130aa', 'rates-a@example.test'),
  ('00000000-0000-4000-8000-0000000130ab', 'rates-b@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000130a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000130aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000130b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000130ab', 'Philaïdes', '{}');
insert into game.worlds (id, slug, name) values ('00000000-0000-7000-8000-000000013002', 'rates-2', 'Autre');
insert into game.cities (id, world_id, slug, name) values
  ('00000000-0000-7000-8000-000000013201', '00000000-0000-7000-8000-000000013002', 'kalliste', 'K2');
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values ('00000000-0000-7000-8000-00000001300e', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
        now() - interval '20 days', now() - interval '16 days', now() - interval '13 days', now() + interval '15 days', now());
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
values ('00000000-0000-7000-8000-00000001300f', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
        '00000000-0000-7000-8000-0000000130a1', '00000000-0000-7000-8000-00000001300e', now() - interval '13 days', now() + interval '15 days');
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;
create function pg_temp.decree(decree text, model text, params text, status text, closes interval,
  applied interval default null, city text default '01900000-0000-7000-8000-000000000101') returns void language sql as $$
  insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, status, proposed_at, voting_closes_at,
    quorum_bps, tallied_at, electorate, votes_for, votes_against, applied_at)
  values (('00000000-0000-7000-8000-0000000130d' || decree)::uuid, '01900000-0000-7000-8000-000000000001', city::uuid, model,
    params::jsonb, '00000000-0000-7000-8000-00000001300f', '00000000-0000-7000-8000-0000000130a1', status,
    now() - closes - interval '2 days', now() - closes, 0, now() - closes, 0, 0, 0, now() - applied)
$$;
alter table game.decrees disable trigger decrees_guard;
select pg_temp.decree('1', 'market_tax_rate', '{"rateBps": 700}', 'adopted', '1 hour');
select pg_temp.decree('2', 'port_dues', '{"coefficientBps": 15000}', 'adopted', '1 hour');
select pg_temp.decree('3', 'public_works', '{"amountOboles": 600}', 'adopted', '1 hour');
select pg_temp.decree('4', 'market_tax_rate', '{"rateBps": 900}', 'rejected', '1 hour');
alter table game.decrees enable trigger decrees_guard;

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.apply(decree text, set_clause text default 'status = ''applied'', applied_at = now()') returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format('update game.decrees set %s where id = %L', set_clause,
    '00000000-0000-7000-8000-0000000130d' || decree))
$$;
-- Règles de la configuration : taux de 5 %, Kallistè à ×1,2, bornes de 2 à 10 % et de ×0,5 à ×2.
create function pg_temp.rules(patch jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'marketTax', jsonb_build_object('rateBps', 500, 'burnShareBps', 5000),
    'ships', jsonb_build_object('portDues', jsonb_build_object('byClassOboles', '{}'::jsonb, 'burnShareBps', 5000,
      'cityCoefficientBps', jsonb_build_object('kalliste', 12000))),
    'decrees', jsonb_build_object('models', jsonb_build_object(
      'market_tax_rate', jsonb_build_object('minRateBps', 200, 'maxRateBps', 1000),
      'port_dues', jsonb_build_object('minCoefficientBps', 5000, 'maxCoefficientBps', 20000)))) || patch
$$;
-- Taux de Kallistè (101) ou d'une autre cité, « taux:coefficient ».
create function pg_temp.rates(rules jsonb, city text default '01900000-0000-7000-8000-000000000101') returns text language sql as $$
  select market_tax_rate_bps || ':' || port_dues_coefficient_bps
  from game.city_rates('01900000-0000-7000-8000-000000000001', rules) where city_id = city::uuid
$$;

-- Droits.
select is(
  (select string_agg(column_name || ':' || privilege_type, ' ' order by column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'decrees' and grantee = 'oikos_service' and privilege_type = 'UPDATE'),
  'applied_at:UPDATE electorate:UPDATE status:UPDATE tallied_at:UPDATE votes_against:UPDATE votes_for:UPDATE',
  'le service ne modifie d''un décret que son dépouillement et son application : liste figée');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.city_rates(uuid, jsonb)', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'oikos_service', 'seul le service calcule les taux sous des règles qu''il donne');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.city_rates_in_force()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés lisent les taux en vigueur');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'city_rates' and grantee in ('anon', 'authenticated', 'oikos_service')),
  'authenticated:SELECT', 'vue en lecture seule, rien pour un visiteur anonyme');

-- Application : un décret adopté de taux passe à `applied` une fois, maintenant, sans rien changer d'autre.
select throws_ok(pg_temp.apply('1', 'status = ''applied'', applied_at = now() - interval ''1 day'''), '23001', null,
  'un décret s''applique maintenant, pas à une date choisie');
select throws_ok(pg_temp.apply('1', 'status = ''applied'''), '23001', null, 'ni sans date d''application');
select throws_ok(pg_temp.apply('1', 'status = ''applied'', applied_at = now(), votes_for = 9'), '23001', null,
  'ni en changeant son dépouillement');
select throws_ok(pg_temp.apply('1', 'status = ''applied'', applied_at = now(), params = ''{"rateBps": 800}'''), '42501', null,
  'ni ses paramètres');
select throws_ok(pg_temp.apply('3'), '23001', 'only a rate decree is applied', 'un décret de dépense n''est pas appliqué ici (#263)');
select throws_ok(pg_temp.apply('4'), '23001', null, 'un décret rejeté ne s''applique pas');
select throws_ok(pg_temp.apply('1', 'applied_at = now()'), '23001', null, 'un décret adopté n''a pas de date d''application');
select lives_ok(pg_temp.apply('1'), 'le décret adopté de taux de la taxe est appliqué');
select lives_ok(pg_temp.apply('2'), 'celui du droit de port aussi');
select is((select string_agg(status || ':' || (applied_at = now()), ' ' order by id) from game.decrees
           where id in ('00000000-0000-7000-8000-0000000130d1', '00000000-0000-7000-8000-0000000130d2')),
  'applied:true applied:true', 'appliqués, datés de la transaction');
select throws_ok(pg_temp.apply('1'), '23001', null, 'une seule fois : rejouée, l''application est refusée');
select throws_ok(pg_temp.apply('1', 'status = ''adopted'', applied_at = null'), '23001', null, '`applied` est un état final');
select throws_ok($$select pg_temp.as_service('update game.decrees set applied_at = now() where id = ''00000000-0000-7000-8000-0000000130d3''')$$,
  '23001', null, 'la date d''application ne se pose pas seule');

-- Un seul événement d'application par décret.
select lives_ok($$select pg_temp.as_service('insert into game.domain_events (type, payload)
  values (''DecreeApplied'', ''{"decreeId": "00000000-0000-7000-8000-0000000130d1"}'')')$$, 'l''application est annoncée');
select throws_ok($$select pg_temp.as_service('insert into game.domain_events (type, payload)
  values (''DecreeApplied'', ''{"decreeId": "00000000-0000-7000-8000-0000000130d1"}'')')$$, '23505', null,
  'une seule fois par décret (index unique)');
select lives_ok($$select pg_temp.as_service('insert into game.domain_events (type, payload)
  values (''DecreeAdopted'', ''{"decreeId": "00000000-0000-7000-8000-0000000130d1"}'')')$$,
  'les autres événements du décret ne sont pas concernés');

-- Taux d'une cité : le dernier décret appliqué, sinon la configuration, borné par le monde.
select is(pg_temp.rates(pg_temp.rules()), '700:15000', 'Kallistè : le taux et le coefficient de ses décrets appliqués');
select is(pg_temp.rates(pg_temp.rules(), '01900000-0000-7000-8000-000000000103'), '500:10000',
  'Elaia, sans décret : le taux du monde et le coefficient ×1 de la configuration');
select is(pg_temp.rates(pg_temp.rules() || '{"marketTax": {"rateBps": 1500, "burnShareBps": 0}}', '01900000-0000-7000-8000-000000000103'),
  '1500:10000', 'les bornes sont celles des votes des cités : le taux du monde ne l''est pas');
select is(pg_temp.rates(pg_temp.rules() || '{"decrees": {"models": {"market_tax_rate": {"minRateBps": 200, "maxRateBps": 600},
  "port_dues": {"minCoefficientBps": 16000, "maxCoefficientBps": 20000}}}}'), '600:16000',
  'un décret devenu hors bornes est ramené à la borne la plus proche, au-dessus comme au-dessous');
select is(pg_temp.rates(pg_temp.rules() || '{"decrees": {"models": {}}}'), '500:12000',
  'un modèle que le monde ne borne plus : la valeur de la configuration, le décret reste sans effet');
select is(pg_temp.rates(pg_temp.rules() - 'decrees'), '500:12000', 'de même sans section des décrets');
select is(pg_temp.rates('{}'), '0:10000', 'version publiée avant la taxe et le transport : taux nul, coefficient ×1');
select is(pg_temp.rates(pg_temp.rules() || '{"decrees": {"models": {"market_tax_rate": {"minRateBps": 0, "maxRateBps": 0},
  "port_dues": {"minCoefficientBps": 0, "maxCoefficientBps": 0}}}}'), '0:0', 'des bornes nulles donnent un taux nul');
select is((select count(*) from game.city_rates('01900000-0000-7000-8000-000000000001', pg_temp.rules())), 4::bigint,
  'une ligne par cité du monde, et seulement de ce monde');
select is((select market_tax_rate_bps || ':' || port_dues_coefficient_bps from game.city_rates('00000000-0000-7000-8000-000000013002', pg_temp.rules())),
  '500:12000', 'la cité homonyme d''un autre monde ne lit pas les décrets de Kallistè');

-- Plusieurs décrets appliqués : le plus récemment appliqué l'emporte, puis la fin de vote la plus tardive, puis
-- l'identifiant ; un décret adopté, rejeté ou d'une autre cité ne compte pas.
alter table game.decrees disable trigger decrees_guard;
select pg_temp.decree('5', 'market_tax_rate', '{"rateBps": 300}', 'applied', '5 days', '4 days');
select pg_temp.decree('6', 'market_tax_rate', '{"rateBps": 950}', 'adopted', '10 minutes');
select pg_temp.decree('7', 'market_tax_rate', '{"rateBps": 250}', 'applied', '1 hour', '1 hour', '01900000-0000-7000-8000-000000000103');
alter table game.decrees enable trigger decrees_guard;
select is(pg_temp.rates(pg_temp.rules()), '700:15000', 'un décret appliqué plus tôt cède la place au plus récent');
select is(pg_temp.rates(pg_temp.rules(), '01900000-0000-7000-8000-000000000103'), '250:10000', 'chaque cité a ses propres décrets');
alter table game.decrees disable trigger decrees_guard;
select pg_temp.decree('8', 'market_tax_rate', '{"rateBps": 400}', 'applied', '30 minutes', '0 seconds');
select pg_temp.decree('9', 'market_tax_rate', '{"rateBps": 450}', 'applied', '2 hours', '0 seconds');
alter table game.decrees enable trigger decrees_guard;
select is(pg_temp.rates(pg_temp.rules()), '400:15000',
  'appliqués à la même clôture : celui dont le vote a fini le plus tard l''emporte');

-- Lecture des joueurs : les taux de chaque cité sous la version en vigueur, pour tous, sans écriture.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000013c001', pg_temp.rules());
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000013c001', now());
set local role anon;
select throws_ok('select * from public.city_rates', '42501', null, 'un visiteur anonyme ne lit pas les taux');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000130ab", "role": "authenticated"}';
select results_eq($$select market_tax_rate_bps, port_dues_coefficient_bps from public.city_rates
  where city_id in ('01900000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-000000013201') order by city_id$$,
  $$values (500, 12000), (400, 15000)$$, 'un joueur lit les taux en vigueur de chaque cité, toutes cités confondues');
select throws_ok('select * from game.city_rates(''01900000-0000-7000-8000-000000000001'', ''{}'')', '42501', null,
  'mais ne calcule pas des taux sous des règles de son choix');
select throws_ok($$insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by, voting_closes_at, quorum_bps)
  values ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'market_tax_rate', '{"rateBps": 0}',
  '00000000-0000-7000-8000-00000001300f', '00000000-0000-7000-8000-0000000130b1', now() + interval '1 day', 0)$$,
  '42501', null, 'ni n''écrit un décret de taux');
select throws_ok($$update game.decrees set status = 'applied', applied_at = now() where id = '00000000-0000-7000-8000-0000000130d6'$$,
  '42501', null, 'ni n''applique un décret');
select is((select status || ':' || (applied_at = now()) from public.decrees where id = '00000000-0000-7000-8000-0000000130d1'),
  'applied:true', 'il lit qu''un décret est appliqué, et quand');
reset role;
with v as (insert into config.versions (payload) values ('{}') returning id)
insert into config.activations (version_id, activate_at) select id, now() from v;
set local role authenticated;
select is((select market_tax_rate_bps || ':' || port_dues_coefficient_bps from public.city_rates where city_id = '01900000-0000-7000-8000-000000000101'),
  '0:10000', 'sous une version sans taxe ni bornes, le taux nul et le coefficient ×1 du schéma partagé');
reset role;

select * from finish();
rollback;
