begin;
select plan(20);

insert into config.versions (id, payload, note) values
  ('00000000-0000-7000-8000-0000000000c1', '{"v": 1}', 'un'),
  ('00000000-0000-7000-8000-0000000000c2', '{"v": 2}', 'deux'),
  ('00000000-0000-7000-8000-0000000000c3', '{"v": 3}', 'trois');
-- Une activation échue (a1), puis trois programmations à venir : a2 seule à sa clôture, a3 puis a4 à la suivante.
insert into config.activations (id, version_id, activate_at, created_at) values
  ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2020-01-01 04:00+00', '2019-12-31 10:00+00'),
  ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-0000000000c2', '2999-01-01 04:00+00', '2020-01-01 12:00+00'),
  ('00000000-0000-7000-8000-0000000000a3', '00000000-0000-7000-8000-0000000000c2', '2999-01-02 04:00+00', '2020-01-01 12:00+00'),
  ('00000000-0000-7000-8000-0000000000a4', '00000000-0000-7000-8000-0000000000c3', '2999-01-02 04:00+00', '2020-01-01 13:00+00');

-- Refus d'une annulation : code d'erreur et nom de contrainte, celui que l'API traduit en erreur métier.
create function pg_temp.refusal(activation text, at timestamptz default now()) returns text language plpgsql as $$
declare
  code text;
  name text;
begin
  insert into config.activation_cancellations (activation_id, cancelled_at)
    values (('00000000-0000-7000-8000-0000000000' || activation)::uuid, at);
  return 'acceptée';
exception when others then
  get stacked diagnostics code = returned_sqlstate, name = constraint_name;
  return code || ' ' || name;
end $$;

select is(config.active_version_at('2999-01-01 04:00+00'), '00000000-0000-7000-8000-0000000000c2'::uuid, 'avant annulation : la version programmée entre en vigueur à sa clôture');
select is(config.active_version_at('2999-01-02 04:00+00'), '00000000-0000-7000-8000-0000000000c3'::uuid, 'à égalité d''échéance, la dernière programmée l''emporte');

select is(pg_temp.refusal('a2'), 'acceptée', 'une programmation à venir s''annule');
select is(config.active_version_at('2999-01-01 04:00+00'), '00000000-0000-7000-8000-0000000000c1'::uuid, 'annulée : la version précédente reste en vigueur à cette clôture');
select is(pg_temp.refusal('a4'), 'acceptée', 'la dernière programmée d''une clôture s''annule');
select is(config.active_version_at('2999-01-02 04:00+00'), '00000000-0000-7000-8000-0000000000c2'::uuid, 'la programmation restante de la même clôture l''emporte');
select is(config.active_version_at('2020-06-01'), '00000000-0000-7000-8000-0000000000c1'::uuid, 'le passé ne change pas');

select is(pg_temp.refusal('a2'), '23505 activation_cancellations_pkey', 'une annulation ne se répète pas');
select is(pg_temp.refusal('a1'), '23514 activation_cancellations_before_activation', 'une activation déjà en vigueur ne s''annule pas');
select is(pg_temp.refusal('a1', '2019-12-31 11:00+00'), '23514 activation_cancellations_before_activation', 'même en antidatant l''annulation');
select is(pg_temp.refusal('ff'), '23503 activation_cancellations_activation_id_fkey', 'activation inconnue refusée');
select ok((select bool_and(cancelled_at between now() and clock_timestamp()) from config.activation_cancellations), 'l''instant d''annulation est l''horloge de la base');
select is((select count(*) from config.activation_cancellations), 2::bigint, 'les refus n''ont rien inscrit');

select throws_ok($$update config.activation_cancellations set cancelled_by = null$$, '23001', null, 'annulation non modifiable');
select throws_ok('delete from config.activation_cancellations', '23001', null, 'annulation non supprimable : on reprogramme');
select throws_ok('truncate config.activation_cancellations', '23001', null, 'annulations non vidables');

-- Contrôle d'accès, lu dans le catalogue.
select ok((select relrowsecurity from pg_class where oid = 'config.activation_cancellations'::regclass), 'règles par ligne actives');
select is((select count(*) from pg_policies where schemaname = 'config' and tablename = 'activation_cancellations' and roles <> '{oikos_service}'), 0::bigint, 'aucune règle pour les clients');
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
   where has_table_privilege(r, 'config.activation_cancellations', p)),
  0::bigint, 'aucun privilège pour anon, authenticated, service_role');
select is(
  (select string_agg(p, ' ' order by p) from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('oikos_service', 'config.activation_cancellations', p)),
  'insert select', 'le service lit et ajoute, rien d''autre');

select * from finish();
rollback;
