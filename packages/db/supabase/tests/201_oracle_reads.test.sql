begin;
select plan(22);

-- Jeu d'essai : une version en vigueur qui porte la Pythie ; un monde à lui, deux cités ; Alice et Bob citoyens de
-- Kallistè, Chloé d'Elaia, dotés de 1 000 oboles. Trois événements à venir planifiés par le service avec leur oracle
-- (une sécheresse à Kallistè, une tempête entre les deux cités, une caravane à Elaia), puis Alice et Chloé consultent
-- la Pythie ; Bob, jamais. Écritures sous le rôle de service, comme par le moteur et l'API.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c201',
  '{"gods": [{"id": "apollo", "charisPerObole": 1}],
    "oracle": {"godId": "apollo", "consultationOboles": 60, "maxTextLength": 400}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c201', now());
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000201f0', 'pythie-lue', 'Pythie lue');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000201f1', '01900000-0000-7000-8000-0000000201f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000201f2', '01900000-0000-7000-8000-0000000201f0', 'elaia', 'Elaia');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000201aa', 'pythie-lue-alice@example.test'),
  ('00000000-0000-4000-8000-0000000201ab', 'pythie-lue-bob@example.test'),
  ('00000000-0000-4000-8000-0000000201ac', 'pythie-lue-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000201a1', '01900000-0000-7000-8000-0000000201f0', '00000000-0000-4000-8000-0000000201aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000201b1', '01900000-0000-7000-8000-0000000201f0', '00000000-0000-4000-8000-0000000201ab', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000201c1', '01900000-0000-7000-8000-0000000201f0', '00000000-0000-4000-8000-0000000201ac', 'Bacchiades', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000201a1', '01900000-0000-7000-8000-0000000201f1'),
  ('00000000-0000-7000-8000-0000000201b1', '01900000-0000-7000-8000-0000000201f1'),
  ('00000000-0000-7000-8000-0000000201c1', '01900000-0000-7000-8000-0000000201f2');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000201a2', '01900000-0000-7000-8000-0000000201f0', 'house', '00000000-0000-7000-8000-0000000201a1'),
  ('00000000-0000-7000-8000-0000000201b2', '01900000-0000-7000-8000-0000000201f0', 'house', '00000000-0000-7000-8000-0000000201b1'),
  ('00000000-0000-7000-8000-0000000201c2', '01900000-0000-7000-8000-0000000201f0', 'house', '00000000-0000-7000-8000-0000000201c1');
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000201f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a.id, case when a.kind = 'house' then 1000 else -3000 end from entry, game.accounts a
where a.world_id = '01900000-0000-7000-8000-0000000201f0' and (a.kind = 'house' or a.system_key = 'faucet_starting_grant');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.oracle(model text) returns uuid language sql as $$
  select o.id from game.oracles o join game.world_events e on e.id = o.event_id
  where e.world_id = '01900000-0000-7000-8000-0000000201f0' and e.model = $1
$$;
-- Consultation de la maison `house` (a, b ou c), de sa cité `city`, qui rend les oracles des modèles donnés.
create function pg_temp.consult(house text, city text, models text[]) returns void language sql as $f$
  select pg_temp.as_service(format($s$do $d$ declare e uuid; o uuid; begin
    insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000201f0', 'temple.oracle')
      returning id into e;
    insert into game.ledger_lines (entry_id, account_id, amount) values
      (e, '00000000-0000-7000-8000-0000000201%1$s2', -60),
      (e, (select id from game.accounts where world_id = '01900000-0000-7000-8000-0000000201f0'
             and system_key = 'sink_offerings'), 60);
    insert into game.offerings (world_id, house_id, city_id, god_id, oboles, charis, ledger_entry_id)
      values ('01900000-0000-7000-8000-0000000201f0', '00000000-0000-7000-8000-0000000201%1$s1',
        '01900000-0000-7000-8000-0000000201%2$s', 'apollo', 60, 60, e) returning id into o;
    insert into game.favor_ledger (world_id, house_id, god_id, amount, kind, offering_id)
      values ('01900000-0000-7000-8000-0000000201f0', '00000000-0000-7000-8000-0000000201%1$s1', 'apollo', 60, 'offering', o);
    insert into game.oracle_consultations (world_id, house_id, city_id, offering_id, oracle_ids)
      values ('01900000-0000-7000-8000-0000000201f0', '00000000-0000-7000-8000-0000000201%1$s1',
        '01900000-0000-7000-8000-0000000201%2$s', o, %3$L);
    set constraints all immediate; set constraints all deferred;
  end $d$$s$, house, city, (select array_agg(pg_temp.oracle(m) order by pg_temp.oracle(m)) from unnest(models) m)))
$f$;
create function pg_temp.as_player(who text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', format('{"sub": "00000000-0000-4000-8000-0000000201%s", "role": "authenticated"}', who), true);
$$;

select pg_temp.as_service($$insert into game.world_events (world_id, model, city_id, other_city_id, good_id,
  planned_day, start_day, end_day, starts_at, ends_at, magnitude_bps, seed) values
  ('01900000-0000-7000-8000-0000000201f0', 'drought', '01900000-0000-7000-8000-0000000201f1', null, null, 100, 103, 104,
   now() + interval '3 days', now() + interval '4 days', 3000, repeat('cd', 32)),
  ('01900000-0000-7000-8000-0000000201f0', 'storm', '01900000-0000-7000-8000-0000000201f1', '01900000-0000-7000-8000-0000000201f2',
   null, 100, 103, 104, now() + interval '3 days', now() + interval '4 days', 3000, repeat('cd', 32)),
  ('01900000-0000-7000-8000-0000000201f0', 'caravan', '01900000-0000-7000-8000-0000000201f2', null, 'wine', 100, 103, 104,
   now() + interval '3 days', now() + interval '4 days', 3000, repeat('cd', 32));
  insert into game.oracles (world_id, event_id, text_fr, text_en)
  select world_id, id, 'Oracle ' || model, 'Oracle ' || model from game.world_events
  where world_id = '01900000-0000-7000-8000-0000000201f0'$$);
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000201f0', 100, now(), '00000000-0000-7000-8000-00000000c201');
select pg_temp.consult('a', 'f1', array['drought', 'storm']);
select pg_temp.consult('c', 'f2', array['storm', 'caravan']);
select pg_temp.as_service(format($$update game.oracles set text_fr = 'Le ciel d''airain.', text_en = 'A brazen sky.',
  source = 'ai', rewritten_at = now(), rewrite_outcome = 'ok' where id = %L$$, pg_temp.oracle('drought')));

-- Droits, lus dans le catalogue.
select is(
  (select string_agg(table_name || ':' || privilege_type, ' ' order by table_name, privilege_type)
   from information_schema.table_privileges
   where table_schema = 'public' and table_name in ('temple_rules', 'my_oracles') and grantee in ('anon', 'authenticated')),
  'my_oracles:SELECT temple_rules:SELECT', 'lecture seule des deux vues, et rien pour un visiteur anonyme');
select is(
  (select string_agg(table_name || '.' || column_name, ' ' order by table_name, ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name in ('temple_rules', 'my_oracles')),
  'my_oracles.id my_oracles.text_fr my_oracles.text_en my_oracles.source my_oracles.house_id my_oracles.consulted_at '
    || 'temple_rules.gods temple_rules.graces temple_rules.oracle',
  'colonnes des vues : ni événement, ni essai de réécriture');
select is(
  (select string_agg(table_name || '.' || column_name, ' ' order by table_name, column_name)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('oracles', 'oracle_consultations') and grantee = 'authenticated'),
  'oracle_consultations.city_id oracle_consultations.created_at oracle_consultations.house_id oracle_consultations.id '
    || 'oracle_consultations.oracle_ids oracles.id oracles.source oracles.text_en oracles.text_fr',
  'un joueur ne lit que ces colonnes, et n''écrit rien : liste figée');
select ok(not has_function_privilege('anon', 'game.temple_oracle()', 'execute'), 'un visiteur anonyme n''exécute pas la fonction');

-- Les règles des temples disent le prix de la consultation, pour tous les joueurs connectés.
reset role;
select pg_temp.as_player('ab');
select is((select oracle ->> 'consultationOboles' from public.temple_rules), '60', 'le prix de la consultation en vigueur');

-- Alice lit les oracles qu'elle a consultés, dans leur dernier texte, et rien d'autre.
reset role;
select pg_temp.as_player('aa');
select results_eq($$select text_en, source from public.my_oracles order by text_en$$,
  $$values ('A brazen sky.', 'ai'), ('Oracle storm', 'fallback')$$,
  'Alice lit la sécheresse, réécrite depuis sa consultation, et la tempête');
select is((select count(*) from public.my_oracles where consulted_at = now()), 2::bigint, 'datés de sa consultation');
select is((select count(*) from game.oracles), 2::bigint, 'la table elle-même ne lui rend que ces deux oracles');
select is((select count(*) from game.oracle_consultations), 1::bigint, 'et sa seule consultation');
select throws_ok($$select event_id from game.oracles$$, '42501', null, 'l''événement d''un oracle est illisible');
select throws_ok($$select rewrite_outcome from game.oracles$$, '42501', null, 'l''essai de réécriture aussi');
select throws_ok($$select offering_id from game.oracle_consultations$$, '42501', null, 'et l''offrande d''une consultation');
select is((select count(*) from public.world_events where world_id = '01900000-0000-7000-8000-0000000201f0'), 0::bigint,
  'les événements à venir restent illisibles : seul l''oracle est vendu');
select results_eq($$select account, nature, amount from public.my_cash_flows order by nature$$,
  $$values ('treasury', 'offerings', -60::bigint), ('treasury', 'other', 1000::bigint)$$,
  'la consultation se lit dans les comptes, en offrandes');
select throws_ok($$update game.oracles set text_fr = 'x'$$, '42501', null, 'Alice ne réécrit pas un oracle');
select throws_ok($$insert into game.oracle_consultations (world_id, house_id, city_id, offering_id, oracle_ids)
    select world_id, house_id, city_id, id, '{}' from game.offerings$$, '42501', null, 'ni ne consulte sans l''API');

-- Bob, de la même cité, n'a rien consulté : il ne lit aucun oracle, même ceux qu'Alice a payés.
reset role;
select pg_temp.as_player('ab');
select is((select count(*) from public.my_oracles), 0::bigint, 'Bob ne lit aucun oracle');
select is((select count(*) from game.oracles), 0::bigint, 'ni dans la table');
select is((select count(*) from game.oracle_consultations), 0::bigint, 'ni la consultation d''Alice');

-- Chloé lit les oracles de sa propre consultation : la tempête partagée, la caravane, pas la sécheresse.
reset role;
select pg_temp.as_player('ac');
select results_eq($$select text_en from public.my_oracles order by text_en$$,
  $$values ('Oracle caravan'), ('Oracle storm')$$, 'Chloé lit la caravane et la tempête de sa cité');
reset role;

set local role anon;
select throws_ok($$select * from public.my_oracles$$, '42501', null, 'un visiteur anonyme ne lit aucun oracle');
reset role;
select is((select count(*) from game.oracles where world_id = '01900000-0000-7000-8000-0000000201f0'), 3::bigint,
  'le propriétaire voit les trois oracles');

select * from finish();
rollback;
