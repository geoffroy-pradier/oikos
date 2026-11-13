begin;
select plan(17);

insert into config.versions (id, payload, note) values
  ('00000000-0000-7000-8000-0000000000c1', '{"v": 1}', 'un'),
  ('00000000-0000-7000-8000-0000000000c2', '{"v": 2}', 'deux');

-- Versions immuables, journal d'activation en ajout seul.
select throws_ok($$update config.versions set payload = '{"v": 9}'$$, '23001', null, 'version non modifiable');
select throws_ok($$update config.versions set note = 'x'$$, '23001', null, 'même la note est figée');
select throws_ok('delete from config.versions', '23001', null, 'version non supprimable');
select throws_ok('truncate config.versions cascade', '23001', null, 'versions non vidables');
select throws_ok($$insert into config.versions (payload) values ('[1]')$$, '23514', null, 'le contenu est un objet');

select is(config.active_version_at('2030-01-01'), null, 'aucune version active avant la première activation');

insert into config.activations (id, version_id, activate_at, created_at) values
  ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2030-01-01 04:00+00', '2029-12-31 10:00+00'),
  -- Activation programmée de la version 2 à la clôture suivante.
  ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-0000000000c2', '2030-01-02 04:00+00', '2030-01-01 12:00+00');

select throws_ok($$update config.activations set activate_at = now()$$, '23001', null, 'activation non modifiable');
select throws_ok('delete from config.activations', '23001', null, 'activation non supprimable');
select throws_ok('truncate config.activations', '23001', null, 'activations non vidables');

select is(config.active_version_at('2030-01-01 03:59:59+00'), null, 'rien avant l''échéance');
select is(config.active_version_at('2030-01-01 04:00+00'), '00000000-0000-7000-8000-0000000000c1'::uuid,
  'version 1 active dès son échéance');
select is(config.active_version_at('2030-01-02 03:59:59+00'), '00000000-0000-7000-8000-0000000000c1'::uuid,
  'la version programmée n''est pas active avant son heure');
select is(config.active_version_at('2030-01-02 04:00+00'), '00000000-0000-7000-8000-0000000000c2'::uuid,
  'bascule à l''heure programmée');

-- Retour arrière : nouvelle activation de la version 1, sans toucher à l'historique.
insert into config.activations (version_id, activate_at, created_at) values
  ('00000000-0000-7000-8000-0000000000c1', '2030-01-03 04:00+00', '2030-01-02 09:00+00'),
  -- Deux décisions pour la même échéance : la plus récente l'emporte.
  ('00000000-0000-7000-8000-0000000000c2', '2030-01-04 04:00+00', '2030-01-03 09:00+00'),
  ('00000000-0000-7000-8000-0000000000c1', '2030-01-04 04:00+00', '2030-01-03 10:00+00');
select is(config.active_version_at('2030-01-03 12:00+00'), '00000000-0000-7000-8000-0000000000c1'::uuid,
  'retour arrière par une nouvelle activation');
select is(config.active_version_at('2030-01-04 12:00+00'), '00000000-0000-7000-8000-0000000000c1'::uuid,
  'à échéance égale, la décision la plus récente l''emporte');

-- Les clients ne lisent ni n'écrivent la configuration.
select is(
  (select count(*) from pg_class c, unnest(array['anon', 'authenticated']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where c.relnamespace = 'config'::regnamespace and c.relkind = 'r' and has_table_privilege(r, c.oid, p)),
  0::bigint, 'aucun droit client sur config');
select is(
  (select count(*) from pg_class where relnamespace = 'config'::regnamespace and relkind = 'r' and not relrowsecurity),
  0::bigint, 'règles par ligne actives sur toutes les tables de config');

select * from finish();
rollback;
