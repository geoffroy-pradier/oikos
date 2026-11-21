begin;
select plan(21);

-- Jeu d'essai : un monde à lui, une cité ; Alice (a), Bob (b) et Chloé (c), maisons de joueur, 50 000 oboles chacune ; les
-- Greniers (e), maison PNJ ; Dion (d) a une maison dans un second monde. Aucune clôture n'est enregistrée.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000735f0', 'nemesis-735', 'Némésis'), ('01900000-0000-7000-8000-0000000735f9', 'ailleurs-735', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000735c1', '01900000-0000-7000-8000-0000000735f0', 'k735', 'Kallistè');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000735a' || n)::uuid, 'nemesis-735-' || n || '@example.test' from unnest(array['a', 'b', 'c', 'd']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000735' || n || '1')::uuid, w::uuid,
       case when kind = 'player' then ('00000000-0000-4000-8000-0000000735a' || n)::uuid end, name, '{}', kind
from (values ('a', 'Alcméonides', 'player', '01900000-0000-7000-8000-0000000735f0'),
             ('b', 'Philaïdes', 'player', '01900000-0000-7000-8000-0000000735f0'),
             ('c', 'Kerykes', 'player', '01900000-0000-7000-8000-0000000735f0'),
             ('e', 'Greniers', 'npc', '01900000-0000-7000-8000-0000000735f0'),
             ('d', 'Eumolpides', 'player', '01900000-0000-7000-8000-0000000735f9')) h (n, name, kind, w);
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where world_id = '01900000-0000-7000-8000-0000000735f0';
do $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-0000000735f0', 'house.starting_grant')
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  select entry, id, case when kind = 'house' then 50000 else -200000 end from game.accounts
  where world_id = '01900000-0000-7000-8000-0000000735f0' and (kind = 'house' or system_key = 'faucet_starting_grant');
end $$;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c735', '{}');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000735' || n || '1')::uuid
$$;
create function pg_temp.account(n text) returns uuid language sql as $$
  select id from game.accounts
  where case when length(n) = 1 then kind = 'house' and house_id = pg_temp.house(n)
             else world_id = '01900000-0000-7000-8000-0000000735f0' and system_key = n end
$$;
create function pg_temp.balance(n text) returns bigint language sql as $$
  select balance from game.accounts where id = pg_temp.account(n)
$$;
create function pg_temp.omen_id(n text) returns uuid language sql as $$
  select id from game.nemesis_omens where house_id = pg_temp.house(n) order by omen_day desc limit 1
$$;
-- Présage de la maison `n`, adressé au jour `day`, échu trois jours plus tard, au nom du service.
create function pg_temp.omen(n text, day int, model text = 'lawsuit', world text = '01900000-0000-7000-8000-0000000735f0')
returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.nemesis_omens (world_id, house_id, model, text_fr, text_en, omen_day, due_day)
     values (%L, %L, %L, ''Un songe'', ''A dream'', %s, %s)', world, pg_temp.house(n), model, day, day + 3))
$$;
-- Issue du dernier présage de `n`, au nom du service : `fields` est la liste des colonnes écrites.
create function pg_temp.settle(n text, fields text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)',
    format('update game.nemesis_omens set %s where id = %L', fields, pg_temp.omen_id(n)))
$$;
-- Amende de `amount` oboles de la trésorerie de `n` au compte `sink`, au nom du service, nommant le présage de `named`
-- (de `n` par défaut), et `extra` oboles de plus vers le même puits sur une troisième ligne.
create function pg_temp.fine(n text, amount bigint, sink text = 'sink_nemesis', named text = null, extra bigint = 0)
returns uuid language plpgsql as $$
declare entry uuid; omen uuid := pg_temp.omen_id(coalesce(named, n));
  treasury uuid := pg_temp.account(n); puits uuid := pg_temp.account(sink);
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_entries (world_id, kind, meta)
  values ('01900000-0000-7000-8000-0000000735f0', 'nemesis.fine', jsonb_build_object('nemesisId', omen))
  returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount)
  values (entry, treasury, -amount - extra), (entry, puits, amount);
  if extra > 0 then
    insert into game.ledger_lines (entry_id, account_id, amount) values (entry, puits, extra);
  end if;
  perform set_config('role', 'none', true);
  return entry;
end $$;
create function pg_temp.hubris(n text, amount bigint, cause text, day int) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.hubris_ledger (world_id, house_id, amount, cause, game_day) values (%L, %L, %s, %L, %s)',
    '01900000-0000-7000-8000-0000000735f0', pg_temp.house(n), amount, cause, day))
$$;
create function pg_temp.close(day int) returns void language sql as $$
  insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-0000000735f0', day, now() - interval '1 hour', '00000000-0000-7000-8000-00000000c735')
$$;

-- Le puits.
select is((select allow_negative from game.accounts
           where world_id = '01900000-0000-7000-8000-0000000735f0' and system_key = 'sink_nemesis'),
  false, 'le puits sink_nemesis existe dans le monde et ne devient jamais débiteur');

-- Procès d'Alice, présage du jour 200, frappé à la clôture du jour 203 : 4 000 oboles d'amende, baisse de 900 de la jauge.
select lives_ok(pg_temp.omen('a', 200), 'un présage de procès pour Alice');
select pg_temp.close(200);
select lives_ok(pg_temp.hubris('a', 1000, 'market_share', 203) || '; ' || pg_temp.hubris('a', -900, 'nemesis', 203),
  'sa jauge monte, puis redescend après la sanction');
select throws_ok(pg_temp.settle('a', 'outcome = ''struck'', settled_day = 203, magnitude_bps = 800, relief = 900'),
  '23514', null, 'un procès frappé a son amende, même nulle');
select throws_ok(pg_temp.settle('a', 'outcome = ''struck'', settled_day = 203, magnitude_bps = 800, relief = 900, oboles = 4000'),
  '23514', null, 'une amende non nulle a son écriture');
select throws_ok(pg_temp.settle('a', 'outcome = ''struck'', settled_day = 203, magnitude_bps = 800, relief = 900, oboles = 4000, '
    || 'ledger_entry_id = null, resumes_at = now()'),
  '23514', null, 'un procès n''arrête aucun atelier');
select lives_ok(pg_temp.settle('a', 'outcome = ''struck'', settled_day = 203, magnitude_bps = 800, relief = 900, oboles = 4000, '
    || 'ledger_entry_id = ' || quote_literal(pg_temp.fine('a', 4000))),
  'le procès d''Alice frappe, payé par son écriture');
select pg_temp.close(203);
select lives_ok('set constraints all immediate', 'à la validation : clôture du jour, jauge redescendue, amende payée');
set constraints all deferred;
select is(array[pg_temp.balance('a'), pg_temp.balance('sink_nemesis')], array[46000, 4000]::bigint[],
  'l''amende passe de la trésorerie d''Alice au puits');

-- L'écriture d'une amende : celle du présage, deux lignes exactement, vers le puits, même avec des lignes ajoutées tard.
create function pg_temp.check_now(statement text) returns void language plpgsql as $$
begin
  execute statement;
  set constraints all immediate;
end $$;
select throws_ok($$select pg_temp.check_now('select pg_temp.fine(''a'', 10)')$$, '23505', null,
  'une écriture d''amende par présage');
select throws_ok(
  $$select pg_temp.check_now(format('insert into game.ledger_lines (entry_id, account_id, amount) values (%L, %L, -1), (%L, %L, 1)',
    (select ledger_entry_id from game.nemesis_omens where house_id = pg_temp.house('a')), pg_temp.account('a'),
    (select ledger_entry_id from game.nemesis_omens where house_id = pg_temp.house('a')), pg_temp.account('sink_nemesis')))$$,
  '23001', 'a fine moves its amount from the house treasury to sink_nemesis, by its own entry',
  'une ligne ajoutée après coup refait juger l''écriture entière : refusée');
select throws_ok(
  $$select pg_temp.check_now('select pg_temp.fine(''b'', 10, named => ''a'')')$$,
  '23505', null, 'une amende ne nomme qu''un présage, une fois');
select throws_ok(
  $$select pg_temp.check_now('insert into game.ledger_entries (world_id, kind) values (''01900000-0000-7000-8000-0000000735f0'', ''nemesis.fine'')')$$,
  '23514', null, 'une écriture nemesis.* nomme son présage');
select throws_ok(
  $$select pg_temp.check_now('insert into game.ledger_entries (world_id, kind, meta) values (''01900000-0000-7000-8000-0000000735f0'', ''nemesis.other'', ''{"nemesisId": "00000000-0000-7000-8000-000000000000"}'')')$$,
  '23514', null, 'et aucune autre nature nemesis.* n''existe');

-- Bob : une amende qui nomme un présage en attente, ou d'une autre maison, ou vers un autre puits.
select lives_ok(pg_temp.omen('b', 204), 'un présage de procès pour Bob');
select pg_temp.close(204);
select throws_ok($$select pg_temp.check_now('select pg_temp.fine(''a'', 10, named => ''b'')')$$, '23001',
  'a fine moves its amount from the house treasury to sink_nemesis, by its own entry',
  'une amende ne nomme qu''un procès frappé, de la trésorerie de sa maison');
select lives_ok(pg_temp.hubris('b', 5, 'wealth', 207) || '; ' || pg_temp.hubris('b', -1, 'nemesis', 207) || '; ' || pg_temp.settle('b', 'outcome = ''struck'', '
    || 'settled_day = 207, magnitude_bps = 500, relief = 1, oboles = 100, ledger_entry_id = '
    || quote_literal(pg_temp.fine('b', 100, 'sink_offerings'))), 'Bob est frappé…');
select pg_temp.close(207);
select throws_ok('set constraints game.ledger_lines_nemesis_fine, game.ledger_entries_nemesis_fine immediate', '23001',
  'a fine moves its amount from the house treasury to sink_nemesis, by its own entry', '… mais son amende va à un autre puits');
set constraints all deferred;

-- Chloé : un procès qui nomme une écriture d'une autre nature.
select lives_ok(pg_temp.omen('c', 208), 'un présage de procès pour Chloé');
select pg_temp.close(208);
select lives_ok(pg_temp.hubris('c', 5, 'wealth', 211) || '; ' || pg_temp.hubris('c', -1, 'nemesis', 211) || '; ' || pg_temp.settle('c', 'outcome = ''struck'', '
    || 'settled_day = 211, magnitude_bps = 500, relief = 1, oboles = 100, ledger_entry_id = '
    || quote_literal((select id from game.ledger_entries where world_id = '01900000-0000-7000-8000-0000000735f0'
                      and kind = 'house.starting_grant'))), 'Chloé est frappée…');
select pg_temp.close(211);
select throws_ok('set constraints game.nemesis_omens_fine immediate', '23001', 'a fine is paid by its own entry',
  '… mais son amende nomme une autre écriture que la sienne : refusé à la validation');

select * from finish();
rollback;
