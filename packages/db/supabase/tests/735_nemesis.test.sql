begin;
select plan(33);

-- Jeu d'essai : un monde à lui, une cité ; Alice (a) et Bob (b), maisons de joueur ; les Greniers (e), maison PNJ ;
-- Dion (d) a une maison dans un second monde. Aucune clôture n'est enregistrée.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000735f0', 'nemesis-735', 'Némésis'), ('01900000-0000-7000-8000-0000000735f9', 'ailleurs-735', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000735c1', '01900000-0000-7000-8000-0000000735f0', 'k735', 'Kallistè');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000735a' || n)::uuid, 'nemesis-735-' || n || '@example.test' from unnest(array['a', 'b', 'd']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000735' || n || '1')::uuid, w::uuid,
       case when kind = 'player' then ('00000000-0000-4000-8000-0000000735a' || n)::uuid end, name, '{}', kind
from (values ('a', 'Alcméonides', 'player', '01900000-0000-7000-8000-0000000735f0'),
             ('b', 'Philaïdes', 'player', '01900000-0000-7000-8000-0000000735f0'),
             ('e', 'Greniers', 'npc', '01900000-0000-7000-8000-0000000735f0'),
             ('d', 'Eumolpides', 'player', '01900000-0000-7000-8000-0000000735f9')) h (n, name, kind, w);
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
create function pg_temp.hubris(n text, amount bigint, cause text, day int) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.hubris_ledger (world_id, house_id, amount, cause, game_day) values (%L, %L, %s, %L, %s)',
    '01900000-0000-7000-8000-0000000735f0', pg_temp.house(n), amount, cause, day))
$$;
create function pg_temp.close(day int) returns void language sql as $$
  insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-0000000735f0', day, now() - interval '1 hour', '00000000-0000-7000-8000-00000000c735')
$$;

-- Droits.
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where r.rolname in ('anon', 'authenticated', 'authenticator')
     and (has_table_privilege(r.oid, 'game.nemesis_omens', 'select, insert, update, delete, truncate, references, trigger')
          or has_any_column_privilege(r.oid, 'game.nemesis_omens', 'select, insert, update, references'))),
  null, 'aucun client n''a de droit sur les présages');
select is(
  (select string_agg(privilege_type || ':' || column_name, ' ' order by privilege_type, column_name)
   from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'nemesis_omens' and privilege_type <> 'SELECT'),
  'INSERT:due_day INSERT:house_id INSERT:model INSERT:omen_day INSERT:text_en INSERT:text_fr INSERT:world_id '
    || 'UPDATE:inventory_id UPDATE:ledger_entry_id UPDATE:magnitude_bps UPDATE:oboles UPDATE:outcome UPDATE:quantity '
    || 'UPDATE:relief UPDATE:resumes_at UPDATE:settled_day UPDATE:site_id UPDATE:voyage_id',
  'le service adresse un présage et écrit son issue, sans en choisir l''identifiant ni les dates');

-- Présages adressés par la clôture du jour 200.
select lives_ok(pg_temp.omen('a', 200, 'ship_lost'), 'le service adresse un présage à Alice');
select lives_ok(pg_temp.omen('b', 200, 'artisan_desertion'), 'et à Bob');
select throws_ok(pg_temp.omen('a', 201), '23505', null, 'un présage en attente au plus par maison');
select throws_ok(pg_temp.omen('e', 200), '23514', 'only a player house receives omens', 'une maison PNJ n''en reçoit pas');
select throws_ok(pg_temp.omen('d', 200), '23514', 'only a player house receives omens',
  'ni une maison d''un autre monde que celui du présage');
select throws_ok(pg_temp.omen('d', 200, 'plague', '01900000-0000-7000-8000-0000000735f9'),
  '23514', null, 'un modèle hors de la liste fermée est refusé');
select throws_ok(
  format($$select pg_temp.as_service(%L)$$, format(
    'insert into game.nemesis_omens (world_id, house_id, model, text_fr, text_en, omen_day, due_day)
     values (%L, %L, ''lawsuit'', ''x'', ''x'', 200, 200)', '01900000-0000-7000-8000-0000000735f9', pg_temp.house('d'))),
  '23514', null, 'l''échéance suit le jour du présage');
select throws_ok(
  format($$select pg_temp.as_service(%L)$$, format(
    'insert into game.nemesis_omens (world_id, house_id, model, text_fr, text_en, omen_day, due_day, created_at)
     values (%L, %L, ''lawsuit'', ''x'', ''x'', 200, 203, now() - interval ''1 day'')',
    '01900000-0000-7000-8000-0000000735f9', pg_temp.house('d'))),
  '42501', null, 'le service ne date pas un présage');
select throws_ok('set constraints game.nemesis_omens_on_close immediate', '23001',
  'an omen is written by the close of its day', 'à la validation, un présage sans la clôture de son jour est refusé');
select pg_temp.close(200);
select lives_ok('set constraints game.nemesis_omens_on_close immediate', 'avec elle, dans la même transaction, il passe');
set constraints all deferred;

-- Issues : rien avant l'échéance, rien hors de la transaction de la clôture du jour, rien deux fois.
select throws_ok(pg_temp.settle('b', 'outcome = ''averted'', settled_day = 202'), '23514', null,
  'pas d''issue avant l''échéance');
select throws_ok(pg_temp.settle('b', 'outcome = ''averted'', settled_day = 200'), '23001',
  'an omen is written before its close is recorded', 'ni par une clôture déjà enregistrée');
select throws_ok(pg_temp.settle('b', 'outcome = ''averted'', settled_day = 203, site_id = null, relief = 5'), '23514', null,
  'une sanction évitée ne prend rien, et la jauge ne bouge pas');
select lives_ok(pg_temp.settle('b', 'outcome = ''averted'', settled_day = 203'), 'la sanction de Bob est évitée à l''échéance');
select throws_ok(pg_temp.settle('b', 'outcome = ''struck'', settled_day = 203, relief = 5'), '23001',
  'an omen is settled once', 'une issue ne change plus');
select throws_ok($$select pg_temp.as_service('update game.nemesis_omens set settled_at = now() - interval ''1 day''')$$,
  '42501', null, 'le service ne date pas une issue');
select throws_ok('update game.nemesis_omens set text_fr = ''autre''', '23001', null,
  'même le propriétaire ne change pas un présage adressé');
select throws_ok('delete from game.nemesis_omens', '23001', null, 'ni ne le supprime');
select pg_temp.close(203);

-- Navire perdu d'Alice à la clôture du jour 204, au-delà de son échéance (une clôture manquée) : aucun voyage en mer,
-- rien de pris, la jauge redescend de 900.
select lives_ok(pg_temp.hubris('a', 1000, 'market_share', 204), 'la jauge d''Alice monte');
select throws_ok(pg_temp.hubris('a', 10, 'nemesis', 204), '23001', 'a Hybris relief lowers the gauge',
  'la cause nemesis ne fait que baisser la jauge');
select lives_ok(pg_temp.hubris('a', -900, 'nemesis', 204), 'et elle redescend après la sanction');
select throws_ok(pg_temp.settle('a', 'outcome = ''struck'', settled_day = 204'), '23514', null,
  'une sanction qui frappe fait redescendre la jauge');
select throws_ok(pg_temp.settle('a', 'outcome = ''struck'', settled_day = 204, relief = 900, oboles = 0'), '23514', null,
  'un navire perdu ne prend pas d''oboles');
select throws_ok(pg_temp.settle('a', 'outcome = ''struck'', settled_day = 204, relief = 900, magnitude_bps = 10'), '23514',
  null, 'ni n''a d''ampleur');
select lives_ok(pg_temp.settle('a', 'outcome = ''struck'', settled_day = 204, relief = 900'),
  'la sanction d''Alice frappe, sans voyage en mer à perdre');
select pg_temp.close(204);
select lives_ok('set constraints all immediate', 'à la validation : clôture du jour, jauge redescendue');
set constraints all deferred;
select is((select gauge from game.hubris where house_id = pg_temp.house('a')), 100::bigint, 'la jauge d''Alice est à 100');
select throws_ok(pg_temp.omen('b', 204), '23001', 'an omen is written before its close is recorded',
  'aucun présage d''un jour déjà clos');

-- Une sanction qui frappe sans faire redescendre la jauge est refusée à la validation.
select lives_ok(pg_temp.omen('b', 205, 'ship_lost'), 'un nouveau présage pour Bob');
select pg_temp.close(205);
select lives_ok(pg_temp.settle('b', 'outcome = ''struck'', settled_day = 208, relief = 7'), 'Bob est frappé…');
select pg_temp.close(208);
select throws_ok('set constraints game.nemesis_omens_on_close immediate', '23001',
  'a sanction lowers the Hybris gauge by its relief', '… mais sa jauge n''a pas redescendu : refusé à la validation');

select * from finish();
rollback;
