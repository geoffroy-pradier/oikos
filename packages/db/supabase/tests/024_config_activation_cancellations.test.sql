begin;
select plan(25);

insert into config.versions (id, payload, note) values
  ('00000000-0000-7000-8000-0000000000c1', '{"v": 1}', 'un'),
  ('00000000-0000-7000-8000-0000000000c2', '{"v": 2}', 'deux'),
  ('00000000-0000-7000-8000-0000000000c3', '{"v": 3}', 'trois');
-- Une activation en vigueur dès maintenant (a1 : une activation ne s'insère pas dans le passé,
-- migration 37), puis trois programmations à venir : a2 seule à sa clôture, a3 puis a4 à la suivante.
insert into config.activations (id, version_id, activate_at) values
  ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', now()),
  ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-0000000000c2', '2999-01-01 04:00+00'),
  ('00000000-0000-7000-8000-0000000000a3', '00000000-0000-7000-8000-0000000000c2', '2999-01-02 04:00+00'),
  ('00000000-0000-7000-8000-0000000000a4', '00000000-0000-7000-8000-0000000000c3', '2999-01-02 04:00+00');

-- Deux programmations de la version 1 proches de leur échéance : dans trente secondes (a5), dans cinq minutes (a6).
-- La base ne programme plus à moins d'une minute (migration 38) : le propriétaire lève sa garde, le temps
-- de poser a5.
-- (Les contrôles différés en attente sont joués d'abord : une table qui en attend ne se modifie pas.)
set constraints all immediate;
alter table config.activations disable trigger activations_guard;
insert into config.activations (id, version_id, activate_at) values
  ('00000000-0000-7000-8000-0000000000a5', '00000000-0000-7000-8000-0000000000c1', now() + interval '30 seconds');
set constraints all immediate;
alter table config.activations enable trigger activations_guard;
set constraints all deferred;
insert into config.activations (id, version_id, activate_at) values
  ('00000000-0000-7000-8000-0000000000a6', '00000000-0000-7000-8000-0000000000c1', now() + interval '5 minutes');

-- Annulation tentée sous le rôle de service, comme le fait l'API (la garde lit `config.activations` avec
-- les droits de l'appelant). Rend « acceptée », ou le code d'erreur et le nom de contrainte du refus.
create function pg_temp.refusal(activation text, at timestamptz default now()) returns text language plpgsql as $$
declare
  code text;
  name text;
begin
  perform set_config('role', 'oikos_service', true);
  insert into config.activation_cancellations (activation_id, cancelled_by, cancelled_at)
    values (('00000000-0000-7000-8000-0000000000' || activation)::uuid, '00000000-0000-4000-8000-00000000000a', at);
  perform set_config('role', 'none', true);
  return 'acceptée';
exception when others then
  get stacked diagnostics code = returned_sqlstate, name = constraint_name;
  return code || ' ' || name;
end $$;

select is(config.active_version_at('2999-01-01 04:00+00'), '00000000-0000-7000-8000-0000000000c2'::uuid, 'avant annulation : la version programmée entre en vigueur à sa clôture');
select is(config.active_version_at('2999-01-02 04:00+00'), '00000000-0000-7000-8000-0000000000c3'::uuid, 'à égalité d''échéance, la dernière programmée l''emporte');

select is(pg_temp.refusal('a2', '2000-01-01'), 'acceptée', 'une programmation à venir s''annule, par le rôle de service');
select is(current_user::text, session_user::text, 'qui rend la main au propriétaire');
select is(config.active_version_at('2999-01-01 04:00+00'), '00000000-0000-7000-8000-0000000000c1'::uuid, 'annulée : la version précédente reste en vigueur à cette clôture');
select is(pg_temp.refusal('a4'), 'acceptée', 'la dernière programmée d''une clôture s''annule');
select is(config.active_version_at('2999-01-02 04:00+00'), '00000000-0000-7000-8000-0000000000c2'::uuid, 'la programmation restante de la même clôture l''emporte');
select is(config.active_version_at(now()), '00000000-0000-7000-8000-0000000000c1'::uuid, 'le présent ne change pas');

select is(pg_temp.refusal('a2'), '23505 activation_cancellations_pkey', 'une annulation ne se répète pas');
select is(pg_temp.refusal('a1'), '23514 activation_cancellations_before_activation', 'une activation déjà en vigueur ne s''annule pas');
select is(pg_temp.refusal('a1', now() - interval '1 day'), '23514 activation_cancellations_before_activation', 'même en antidatant l''annulation');
select is(pg_temp.refusal('ff'), '23503 activation_cancellations_activation_id_fkey', 'activation inconnue refusée');
select ok((select cancelled_at between now() and clock_timestamp() from config.activation_cancellations
            where activation_id = '00000000-0000-7000-8000-0000000000a2'),
  'l''instant d''annulation est l''horloge de la base, pas l''instant fourni (ici l''an 2000)');
select is(pg_temp.refusal('a5'), '23514 activation_cancellations_before_activation', 'à moins d''une minute de l''échéance, il est trop tard pour annuler');
select is(pg_temp.refusal('a6'), 'acceptée', 'à cinq minutes de l''échéance, on annule encore');
select throws_ok($$insert into config.activation_cancellations (activation_id) values ('00000000-0000-7000-8000-0000000000a3')$$,
  '23502', null, 'une annulation a toujours un auteur');
select is((select count(*) from config.activation_cancellations), 3::bigint, 'les refus n''ont rien inscrit');

-- Une programmation annulée se reprogramme : une nouvelle activation de la même version, non annulée.
insert into config.activations (id, version_id, activate_at) values
  ('00000000-0000-7000-8000-0000000000a7', '00000000-0000-7000-8000-0000000000c2', '2999-01-01 04:00+00');
select is(config.active_version_at('2999-01-01 04:00+00'), '00000000-0000-7000-8000-0000000000c2'::uuid, 'reprogrammée, la version annulée entre de nouveau en vigueur à sa clôture');

select throws_ok($$update config.activation_cancellations set cancelled_by = null$$, '23001', null, 'annulation non modifiable');
select throws_ok('delete from config.activation_cancellations', '23001', null, 'annulation non supprimable : on reprogramme');
-- Contrôles différés de la validation (migration 38) joués maintenant : une table qui en attend ne se
-- vide ni ne se modifie, ce qui masquerait le refus testé ici.
set constraints all immediate;
set constraints all deferred;
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
