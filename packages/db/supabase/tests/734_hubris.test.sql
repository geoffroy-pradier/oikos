begin;
select plan(44);

-- Jeu d'essai : un monde à lui, une cité, Alice et Bob y ont une maison de joueur, une maison PNJ de secours y est
-- fondée ; Chloé n'a pas de maison ; Dion a une maison dans un second monde. Aucune clôture n'est enregistrée.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000734f0', 'hybris', 'Hybris'), ('01900000-0000-7000-8000-0000000734f9', 'ailleurs-734', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000734c1', '01900000-0000-7000-8000-0000000734f0', 'kalliste', 'Kallistè');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000734a' || n)::uuid, 'hubris-' || n || '@example.test' from unnest(array['a', 'b', 'c', 'd']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000734' || n || '1')::uuid, w::uuid, ('00000000-0000-4000-8000-0000000734a' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides', '01900000-0000-7000-8000-0000000734f0'), ('b', 'Philaïdes', '01900000-0000-7000-8000-0000000734f0'),
             ('d', 'Eumolpides', '01900000-0000-7000-8000-0000000734f9')) h (n, name, w);
insert into game.houses (id, world_id, user_id, name, blazon, kind) values
  ('00000000-0000-7000-8000-0000000734e1', '01900000-0000-7000-8000-0000000734f0', null, 'Greniers', '{}', 'npc');
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.move(house text, cause text, amount bigint, day int,
                             world text = '01900000-0000-7000-8000-0000000734f0') returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.hubris_ledger (world_id, house_id, amount, cause, game_day) values (%L, %L, %s, %L, %s)',
    world, '00000000-0000-7000-8000-0000000734' || house || '1', amount, cause, day))
$$;
create function pg_temp.gauge(house text) returns bigint language sql as $$
  select gauge from game.hubris where house_id = ('00000000-0000-7000-8000-0000000734' || house || '1')::uuid
$$;

-- Droits : aucun client ne lit ni n'écrit la jauge ou son journal ; le service lit et n'écrit qu'une ligne du journal.
select is(
  (select string_agg(r.rolname || ':' || t, ' ' order by r.rolname, t) from pg_roles r
   cross join unnest(array['game.hubris', 'game.hubris_ledger']) t
   where r.rolname in ('anon', 'authenticated', 'authenticator')
     and (has_table_privilege(r.oid, t, 'select, insert, update, delete, truncate, references, trigger')
          or has_any_column_privilege(r.oid, t, 'select, insert, update, references'))),
  null, 'ni un visiteur, ni un joueur connecté, ni le rôle de PostgREST n''a un droit sur la jauge ou son journal');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name in ('hubris', 'hubris_ledger') and privilege_type <> 'SELECT'),
  'hubris_ledger.amount:INSERT hubris_ledger.cause:INSERT hubris_ledger.game_day:INSERT hubris_ledger.house_id:INSERT '
    || 'hubris_ledger.world_id:INSERT',
  'le service n''écrit que les colonnes d''une ligne du journal');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_table_privilege(r.oid, 'public.my_hubris_tier', 'select, insert, update, delete, truncate, references, trigger')
     and not r.rolsuper and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'la vue du palier est lue par les seuls joueurs connectés');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.my_hubris_tier()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'et sa fonction exécutée par eux seuls');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'my_hubris_tier'),
  'house_id tier', 'la vue ne rend que la maison et son palier : aucune valeur de jauge');
select is(
  (select string_agg(distinct v.relname, ' ') from pg_depend d
   join pg_rewrite w on w.oid = d.objid join pg_class v on v.oid = w.ev_class
   where d.refobjid in ('game.hubris'::regclass, 'game.hubris_ledger'::regclass)),
  null, 'aucune vue ne lit la jauge ou son journal');
-- Limite connue : une fonction qui nommerait ces tables par du SQL dynamique, ou une procédure, échappe à cette analyse.
select is(
  (select string_agg(p.oid::regprocedure::text, ' ' order by p.oid::regprocedure::text) from pg_proc p
   where p.prosrc ~ 'game\.hubris(_ledger)?\M' and p.prokind = 'f'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'game.my_hubris_tier()', 'la seule fonction exécutable par un client qui lit la jauge est celle du palier');

-- Écritures du service, dans la transaction d'une clôture pas encore enregistrée.
select lives_ok(pg_temp.move('a', 'market_share', 40, 100), 'le service ajoute un gain à la jauge d''Alice');
select is(pg_temp.gauge('a'), 40::bigint, 'la jauge est le cumul du journal');
select lives_ok(pg_temp.move('a', 'offering', -15, 100), 'une baisse d''une autre cause, le même jour');
select is(pg_temp.gauge('a'), 25::bigint, 'la baisse s''y retranche');
select throws_ok(pg_temp.move('a', 'market_share', 1, 100), '23505', null, 'une ligne au plus par maison, cause et jour');
select throws_ok(pg_temp.move('a', 'decay', -26, 100), '23514', null, 'une jauge ne passe jamais sous zéro');
select is(pg_temp.gauge('a'), 25::bigint, 'et rien n''a changé');
select throws_ok(pg_temp.move('b', 'wealth', 9007199254740991, 100) || '; ' || pg_temp.move('b', 'liturgy_levied', 1, 100),
  '23514', null, 'ni au-delà du plus grand entier sûr');
select throws_ok(pg_temp.move('b', 'wealth', -5, 100), '23001', 'a Hybris gain raises the gauge', 'un gain ne fait pas baisser');
select throws_ok(pg_temp.move('b', 'liturgy_performed', 5, 100), '23001', 'a Hybris relief lowers the gauge',
  'une baisse ne fait pas monter');
select throws_ok(pg_temp.move('b', 'price_fixing', 5, 100), '23001', 'unknown Hybris cause',
  'une cause hors de la liste fermée est refusée (les ententes attendent leur détection)');
select throws_ok(pg_temp.move('b', 'wealth', 0, 100), '23514', null, 'une variation nulle n''a pas de ligne');
select throws_ok(pg_temp.move('e', 'wealth', 5, 100), '23514', 'only a player house has a Hybris gauge',
  'une maison PNJ de secours n''a pas de jauge');
select throws_ok(pg_temp.move('d', 'wealth', 5, 100), '23514', 'only a player house has a Hybris gauge',
  'ni une maison d''un autre monde que celui de la ligne');
select throws_ok(
  $$select pg_temp.as_service('insert into game.hubris_ledger (world_id, house_id, amount, cause, game_day, created_at)
    values (''01900000-0000-7000-8000-0000000734f0'', ''00000000-0000-7000-8000-0000000734b1'', 1, ''wealth'', 100, now() - interval ''1 day'')')$$,
  '42501', null, 'le service ne date pas une ligne');
select throws_ok(
  $$select pg_temp.as_service('insert into game.hubris (house_id, world_id) values (''00000000-0000-7000-8000-0000000734b1'', ''01900000-0000-7000-8000-0000000734f0'')')$$,
  '42501', null, 'ni n''écrit la jauge elle-même');
select throws_ok($$select pg_temp.as_service('update game.hubris_ledger set amount = 99')$$, '42501', null, 'ni ne modifie le journal');
select throws_ok($$select pg_temp.as_service('delete from game.hubris_ledger')$$, '42501', null, 'ni ne l''efface');

-- Même le propriétaire : journal en ajout seul, jauge seulement par lui.
select throws_ok('update game.hubris_ledger set amount = 99', '23001', null, 'le journal est en ajout seul');
select throws_ok('delete from game.hubris_ledger', '23001', null, 'ses lignes ne se suppriment pas');
select throws_ok($$update game.hubris set gauge = 0 where house_id = '00000000-0000-7000-8000-0000000734a1'$$, '23001',
  'Hybris changes only through its journal', 'la jauge ne change que par son journal');

-- Les lignes attendent la clôture de leur jour : validées sans elle, elles sont refusées.
select throws_ok('set constraints game.hubris_ledger_on_close immediate', '23001',
  'a Hybris movement is written by the close of its day', 'à la validation, une ligne sans la clôture de son jour est refusée');
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c734',
  '{"hubris": {"tiers": [10, 100, 1000]}}');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000734f0', 100, now() - interval '1 hour', '00000000-0000-7000-8000-00000000c734');
select throws_ok(pg_temp.move('b', 'wealth', 120, 100), '23001', 'a Hybris movement is written before its close is recorded',
  'pas de ligne hors de la transaction de sa clôture');
select lives_ok(pg_temp.move('b', 'wealth', 120, 101), 'celle de la clôture suivante passe');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000734f0', 101, now() - interval '1 minute', '00000000-0000-7000-8000-00000000c734');
select lives_ok('set constraints game.hubris_ledger_on_close immediate',
  'à la validation, chaque ligne a la clôture de son jour, enregistrée dans la même transaction');
set constraints all deferred;

-- Lectures : paliers 10, 100 et 1 000 en vigueur ; Alice est à 25, Bob à 120, Dion n'a pas de jauge.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c734', now());
set local role anon;
select throws_ok('select * from public.my_hubris_tier', '42501', null, 'un visiteur anonyme ne lit aucun palier');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000734aa", "role": "authenticated"}';
select results_eq('select house_id, tier from public.my_hubris_tier',
  $$values ('00000000-0000-7000-8000-0000000734a1'::uuid, 1)$$, 'Alice ne lit que le palier de sa maison');
select throws_ok('select gauge from game.hubris', '42501', null, 'ni la jauge, même la sienne, par la table');
select throws_ok('select amount from game.hubris_ledger', '42501', null, 'ni son journal');
select results_eq('select house_id, tier from game.my_hubris_tier()',
  $$values ('00000000-0000-7000-8000-0000000734a1'::uuid, 1)$$, 'la fonction appelée seule ne rend pas davantage');
select throws_ok($$insert into game.hubris_ledger (world_id, house_id, amount, cause, game_day) values
  ('01900000-0000-7000-8000-0000000734f0', '00000000-0000-7000-8000-0000000734a1', -25, 'offering', 102)$$,
  '42501', null, 'un joueur n''écrit pas au journal, pas même une baisse de sa jauge');
select is(has_table_privilege('authenticated', 'public.my_hubris_tier', 'insert, update, delete'), false,
  'ni par la vue de son palier');

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000734ab", "role": "authenticated"}';
select results_eq('select house_id, tier from public.my_hubris_tier',
  $$values ('00000000-0000-7000-8000-0000000734b1'::uuid, 2)$$, 'Bob lit le sien, et pas celui d''Alice');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000734ac", "role": "authenticated"}';
select is((select count(*) from public.my_hubris_tier), 0::bigint, 'un compte sans maison ne lit aucun palier');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000734ad", "role": "authenticated"}';
select results_eq('select house_id, tier from public.my_hubris_tier',
  $$values ('00000000-0000-7000-8000-0000000734d1'::uuid, 0)$$, 'une maison sans jauge est au palier zéro');

-- Une borne est atteinte à sa valeur exacte ; une version sans Hybris met tout palier à zéro.
reset role;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c735', '{"hubris": {"tiers": [25, 26]}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c735', now());
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000734aa", "role": "authenticated"}';
select results_eq('select tier from public.my_hubris_tier', $$values (1)$$, 'une jauge égale à une borne atteint son palier');
reset role;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c736', '{"decrees": {}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c736', now());
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000734ab", "role": "authenticated"}';
select results_eq('select tier from public.my_hubris_tier', $$values (0)$$,
  'une version publiée avant l''Hybris : palier zéro');

select * from finish();
rollback;
