begin;
select plan(34);

-- Jeu d'essai : un monde à lui, deux cités ; Alice et Bob citoyens de Kallistè, dotés de 1 000 oboles, Alice avec
-- 10 blés. Événements planifiés par le service au jour 100 (clôture enregistrée ensuite) : une sécheresse à
-- Kallistè, une tempête entre Kallistè et Elaia, une caravane à Elaia ; une sécheresse déjà commencée et une
-- autre planifiée par une autre transaction, posées par le propriétaire, garde levée. Les oracles et consultations
-- sont écrits sous le rôle de service, comme par le moteur et l'API, puis les contrôles différés sont joués aussitôt.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c200', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000200f0', 'pythie', 'Pythie');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000200f1', '01900000-0000-7000-8000-0000000200f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000200f2', '01900000-0000-7000-8000-0000000200f0', 'elaia', 'Elaia');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000200aa', 'pythie-alice@example.test'),
  ('00000000-0000-4000-8000-0000000200ab', 'pythie-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000200a1', '01900000-0000-7000-8000-0000000200f0', '00000000-0000-4000-8000-0000000200aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000200b1', '01900000-0000-7000-8000-0000000200f0', '00000000-0000-4000-8000-0000000200ab', 'Philaïdes', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000200a1', '01900000-0000-7000-8000-0000000200f1'),
  ('00000000-0000-7000-8000-0000000200b1', '01900000-0000-7000-8000-0000000200f1');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000200a2', '01900000-0000-7000-8000-0000000200f0', 'house', '00000000-0000-7000-8000-0000000200a1'),
  ('00000000-0000-7000-8000-0000000200b2', '01900000-0000-7000-8000-0000000200f0', 'house', '00000000-0000-7000-8000-0000000200b1');
with entry as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000200f0', 'test.seed') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select entry.id, a.id, case when a.kind = 'house' then 1000 else -2000 end from entry, game.accounts a
where a.world_id = '01900000-0000-7000-8000-0000000200f0' and (a.kind = 'house' or a.system_key = 'faucet_starting_grant');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000200a3', '01900000-0000-7000-8000-0000000200f0', '00000000-0000-7000-8000-0000000200a1', '01900000-0000-7000-8000-0000000200f1', 'wheat');
insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
values ('01900000-0000-7000-8000-0000000200f0', 'wheat', 10, 'production', '00000000-0000-7000-8000-0000000200a3', 'test');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Le corps donné, sous le rôle de service, dans un bloc où `e` est l'écriture et `o` l'offrande, puis les contrôles
-- différés ; à passer à `throws_ok` ou `lives_ok`, qui annulent un échec.
create function pg_temp.svc(body text) returns text language sql as $$
  select 'select pg_temp.as_service(' || quote_literal('do $d$ declare e uuid; o uuid; begin ' || body
    || ' set constraints all immediate; set constraints all deferred; end $d$') || ')'
$$;
create function pg_temp.event(model text) returns uuid language sql as $$
  select id from game.world_events where world_id = '01900000-0000-7000-8000-0000000200f0' and model = $1
  order by starts_at desc limit 1
$$;
create function pg_temp.oracle(model text) returns uuid language sql as $$
  select id from game.oracles where event_id = pg_temp.event(model)
$$;
create function pg_temp.write(event uuid, world text default 'f0', fr text default 'La terre aura soif.') returns text
language sql as $$
  select format($s$insert into game.oracles (world_id, event_id, text_fr, text_en)
    values ('01900000-0000-7000-8000-0000000200%s', %L, %L, 'The earth will thirst.');$s$, world, event, fr)
$$;
-- Consultation d'une maison payée `oboles` par une écriture `kind`, qui rend `oracles` (tableau SQL), Charis
-- d'Apollon `oboles` ; `payer` est la maison de l'offrande, `goods` des blés offerts en plus.
create function pg_temp.consult(oracles text, oboles integer default 60, kind text default 'temple.oracle',
  house text default 'a', payer text default 'a', goods integer default 0, consulted boolean default true)
returns text language sql as $$
  select format($s$insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000200f0', %L)
      returning id into e;
    insert into game.ledger_lines (entry_id, account_id, amount) values
      (e, '00000000-0000-7000-8000-0000000200%s2', %s),
      (e, (select id from game.accounts where world_id = '01900000-0000-7000-8000-0000000200f0'
             and system_key = 'sink_offerings'), %s);
    insert into game.offerings (world_id, house_id, city_id, god_id, oboles, charis, ledger_entry_id)
      values ('01900000-0000-7000-8000-0000000200f0', '00000000-0000-7000-8000-0000000200%s1',
        '01900000-0000-7000-8000-0000000200f1', 'apollo', %s, %s, e) returning id into o;
    insert into game.favor_ledger (world_id, house_id, god_id, amount, kind, offering_id)
      values ('01900000-0000-7000-8000-0000000200f0', '00000000-0000-7000-8000-0000000200%s1', 'apollo', %s, 'offering', o);
    %s %s$s$,
    kind, payer, -oboles, oboles, payer, oboles, oboles + goods * 6, payer, oboles + goods * 6,
    case when goods > 0 then format($g$insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id,
        to_system, kind, offering_id) values ('01900000-0000-7000-8000-0000000200f0', 'wheat', %s,
        '00000000-0000-7000-8000-0000000200a3', 'offering', 'temple.offering', o);$g$, goods) else '' end,
    case when consulted then format($c$insert into game.oracle_consultations (world_id, house_id, city_id, offering_id,
        oracle_ids) values ('01900000-0000-7000-8000-0000000200f0', '00000000-0000-7000-8000-0000000200%s1',
        '01900000-0000-7000-8000-0000000200f1', o, %s);$c$, house, oracles) else '' end)
$$;

-- Droits, lus dans le catalogue.
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('game.oracles'::regclass, 'game.oracle_consultations'::regclass)), 'règles par ligne actives');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' '
                     order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('oracles', 'oracle_consultations') and grantee = 'oikos_service'
     and privilege_type <> 'SELECT'),
  'oracle_consultations.city_id:INSERT oracle_consultations.house_id:INSERT oracle_consultations.offering_id:INSERT '
    || 'oracle_consultations.oracle_ids:INSERT oracle_consultations.world_id:INSERT oracles.event_id:INSERT '
    || 'oracles.rewrite_outcome:UPDATE oracles.rewritten_at:UPDATE oracles.source:UPDATE oracles.text_en:INSERT '
    || 'oracles.text_en:UPDATE oracles.text_fr:INSERT oracles.text_fr:UPDATE oracles.world_id:INSERT',
  'le service écrit un oracle en repli et sa réécriture, et une consultation, sans les dater : liste figée');
select ok(not exists (select 1 from pg_roles r, unnest(array['game.guard_oracle()', 'game.guard_oracle_consultation()']) f
  where has_function_privilege(r.oid, f::regprocedure, 'execute') and r.rolname in ('anon', 'authenticated', 'oikos_service')),
  'personne n''exécute les gardes');

-- Événements et oracles, planifiés dans la même transaction.
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000200f0', 70, now() - interval '30 days', '00000000-0000-7000-8000-00000000c200');
alter table game.world_events disable trigger world_events_guard;
insert into game.world_events (world_id, model, city_id, planned_day, start_day, end_day, starts_at, ends_at,
  magnitude_bps, seed, created_at) values
  ('01900000-0000-7000-8000-0000000200f0', 'good_year', '01900000-0000-7000-8000-0000000200f1', 70, 90, 92,
   now() + interval '1 day', now() + interval '2 days', 1000, repeat('ab', 32), now() - interval '1 day'),
  ('01900000-0000-7000-8000-0000000200f0', 'drought', '01900000-0000-7000-8000-0000000200f1', 70, 80, 82,
   now() - interval '1 hour', now() + interval '1 day', 1000, repeat('ab', 32), now());
set constraints game.world_events_played_close immediate;
alter table game.world_events enable trigger world_events_guard;
set constraints game.world_events_played_close deferred;
select pg_temp.as_service($$insert into game.world_events (world_id, model, city_id, other_city_id, good_id,
  planned_day, start_day, end_day, starts_at, ends_at, magnitude_bps, seed) values
  ('01900000-0000-7000-8000-0000000200f0', 'drought', '01900000-0000-7000-8000-0000000200f1', null, null, 100, 103, 104,
   now() + interval '3 days', now() + interval '4 days', 3000, repeat('cd', 32)),
  ('01900000-0000-7000-8000-0000000200f0', 'storm', '01900000-0000-7000-8000-0000000200f2', '01900000-0000-7000-8000-0000000200f1',
   null, 100, 103, 104, now() + interval '3 days', now() + interval '4 days', 3000, repeat('cd', 32)),
  ('01900000-0000-7000-8000-0000000200f0', 'caravan', '01900000-0000-7000-8000-0000000200f2', null, 'wine', 100, 103, 104,
   now() + interval '3 days', now() + interval '4 days', 3000, repeat('cd', 32))$$);
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000200f0', 100, now(), '00000000-0000-7000-8000-00000000c200');

select lives_ok(pg_temp.svc(pg_temp.write(pg_temp.event('drought')) || pg_temp.write(pg_temp.event('storm'))
  || pg_temp.write(pg_temp.event('caravan'))), 'la planification écrit l''oracle de repli de chaque événement');
select is((select string_agg(source || ':' || coalesce(rewrite_outcome, '-'), ' ') from game.oracles o
           join game.world_events e on e.id = o.event_id where e.world_id = '01900000-0000-7000-8000-0000000200f0'),
  'fallback:- fallback:- fallback:-', 'en repli, jamais réécrits');
select throws_ok(pg_temp.svc(pg_temp.write(pg_temp.event('drought'))), '23505', null, 'un seul oracle par événement');
select throws_ok(pg_temp.svc(pg_temp.write(pg_temp.event('good_year'))), '23001',
  'an oracle is written as a fallback with its event', 'pas d''oracle pour un événement d''une autre transaction');
select throws_ok(pg_temp.svc(replace(pg_temp.write((select id from game.world_events where start_day = 80)), '200f0', '200f9')),
  '23001', 'an oracle is written as a fallback with its event', 'ni dans un autre monde que son événement');
select throws_ok(pg_temp.svc(pg_temp.write((select id from game.world_events where start_day = 80), fr => '')), '23514', null,
  'ni un texte vide');
select throws_ok(pg_temp.svc(replace(replace(pg_temp.write((select id from game.world_events where start_day = 80)),
  'text_en)', 'text_en, source)'), 'thirst.'')', 'thirst.'', ''ai'')')), '42501', null, 'le service n''écrit pas un oracle déjà réécrit');
select lives_ok(pg_temp.svc(pg_temp.write((select id from game.world_events where start_day = 80))),
  'un événement déjà commencé, planifié dans la même transaction, a aussi le sien');

-- Réécriture : une fois, maintenant, avant que l'événement commence ; les textes ne changent que si elle réussit.
select lives_ok(pg_temp.svc(format($$update game.oracles set text_fr = 'Le ciel d''airain.', text_en = 'A brazen sky.',
    source = 'ai', rewritten_at = now(), rewrite_outcome = 'ok' where id = %L;$$, pg_temp.oracle('drought'))),
  'une réécriture conforme remplace le repli');
select throws_ok(pg_temp.svc(format($$update game.oracles set text_fr = 'Encore.', rewritten_at = now(),
    rewrite_outcome = 'ok', source = 'ai' where id = %L;$$, pg_temp.oracle('drought'))), '23001',
  'an oracle is rewritten once, now, before its event starts', 'une seule fois');
select throws_ok(pg_temp.svc(format($$update game.oracles set text_fr = 'Trois jours.', rewritten_at = now(),
    rewrite_outcome = 'invalid' where id = %L;$$, pg_temp.oracle('storm'))), '23001',
  'an oracle is rewritten once, now, before its event starts', 'une réécriture rejetée ne change pas le texte');
select throws_ok(pg_temp.svc(format($$update game.oracles set source = 'ai', rewritten_at = now(),
    rewrite_outcome = 'invalid' where id = %L;$$, pg_temp.oracle('storm'))), '23514', null,
  'ni ne fait passer le repli pour une réécriture');
select throws_ok(pg_temp.svc(format($$update game.oracles set rewritten_at = now() - interval '1 minute',
    rewrite_outcome = 'invalid' where id = %L;$$, pg_temp.oracle('storm'))), '23001',
  'an oracle is rewritten once, now, before its event starts', 'l''essai est daté de sa transaction');
select lives_ok(pg_temp.svc(format($$update game.oracles set rewritten_at = now(), rewrite_outcome = 'invalid'
    where id = %L;$$, pg_temp.oracle('storm'))), 'une réécriture rejetée est notée, et le repli reste');
select throws_ok(pg_temp.svc(format($$update game.oracles set rewritten_at = now(), rewrite_outcome = 'timeout'
    where event_id = %L;$$, (select id from game.world_events where start_day = 80))), '23001',
  'an oracle is rewritten once, now, before its event starts', 'pas de réécriture d''un événement commencé');
select throws_ok(pg_temp.svc(format($$update game.oracles set event_id = %L where id = %L;$$,
    pg_temp.event('caravan'), pg_temp.oracle('storm'))), '42501', null, 'le service ne change pas l''événement d''un oracle');
select throws_ok($$delete from game.oracles$$, '23001', null, 'personne ne supprime un oracle');

-- Consultations : une offrande de monnaie à Apollon, payée par une écriture `temple.oracle`, qui rend des oracles
-- d'événements à venir de la cité de la maison.
select lives_ok(pg_temp.svc(pg_temp.consult(format('array[%L, %L]::uuid[]', pg_temp.oracle('drought'), pg_temp.oracle('storm')))),
  'Alice consulte : la sécheresse de sa cité et la tempête sur une de ses routes');
select is((select row(balance, (select charis from game.favor where house_id = '00000000-0000-7000-8000-0000000200a1'
                                and god_id = 'apollo'))::text
           from game.accounts where id = '00000000-0000-7000-8000-0000000200a2'),
  '(940,60)', 'les oboles sont détruites et la Charis d''Apollon accrue, dans la même transaction');
select lives_ok(pg_temp.svc(pg_temp.consult('''{}''', house => 'b', payer => 'b')),
  'une consultation qui ne rend aucun oracle est payée quand même');
select throws_ok(pg_temp.svc(pg_temp.consult(format('array[%L]::uuid[]', pg_temp.oracle('caravan')))), '23001',
  'a consultation reveals distinct oracles of upcoming events of its city', 'pas l''oracle d''une autre cité');
select throws_ok(pg_temp.svc(pg_temp.consult(format('array[%L]::uuid[]',
    (select o.id from game.oracles o join game.world_events e on e.id = o.event_id where e.start_day = 80)))), '23001',
  'a consultation reveals distinct oracles of upcoming events of its city', 'ni celui d''un événement commencé');
select throws_ok(pg_temp.svc(pg_temp.consult(format('array[%L, %L]::uuid[]', pg_temp.oracle('storm'), pg_temp.oracle('storm')))),
  '23001', 'a consultation reveals distinct oracles of upcoming events of its city', 'ni deux fois le même');
select throws_ok(pg_temp.svc(pg_temp.consult(format('array[%L]::uuid[]', gen_random_uuid()))), '23001',
  'a consultation reveals distinct oracles of upcoming events of its city', 'ni un oracle inconnu');
select throws_ok(pg_temp.svc(pg_temp.consult('''{}''', kind => 'temple.offering')), '23001',
  'an offering pays its oboles to sink_offerings', 'une consultation est payée par une écriture `temple.oracle`');
select throws_ok(pg_temp.svc(pg_temp.consult('''{}''', consulted => false)),
  '23001', 'an offering pays its oboles to sink_offerings', 'et une écriture `temple.oracle` paie une consultation');
select throws_ok(pg_temp.svc(pg_temp.consult('''{}''', goods => 2)), '23001', 'a consultation is paid in money only',
  'une consultation ne se paie pas en biens');
select throws_ok(pg_temp.svc(pg_temp.consult('''{}''', house => 'a', payer => 'b')), '23001',
  'a consultation is paid by an offering of its house, now', 'ni par l''offrande d''une autre maison');
select throws_ok(pg_temp.svc(replace(replace(pg_temp.consult('''{}'''), 'oracle_ids)', 'oracle_ids, created_at)'),
    'o, ''{}'');', 'o, ''{}'', now());')), '42501', null, 'le service ne date pas une consultation');
select throws_ok(pg_temp.svc($$update game.oracle_consultations set oracle_ids = '{}';$$), '42501', null,
  'le service ne modifie pas une consultation');
select throws_ok($$delete from game.oracle_consultations$$, '23001', null, 'personne ne la supprime');

select * from finish();
rollback;
