begin;
select plan(10);

insert into config.versions (id, payload, note) values
  ('00000000-0000-7000-8000-0000000000c1', '{"v": 1}', 'un');

-- Instruction jouée sous le rôle donné (le service, comme l'API ; sinon le propriétaire). Rend
-- « acceptée », ou le code d'erreur et le nom de contrainte du refus. `set constraints all immediate`
-- joue sur-le-champ les contrôles différés, qu'une transaction ferait à sa validation.
create function pg_temp.attempt(statement text, as_role text default 'oikos_service') returns text
language plpgsql as $$
declare
  code text;
  name text;
begin
  perform set_config('role', as_role, true);
  execute statement;
  perform set_config('role', 'none', true);
  return 'acceptée';
exception when others then
  get stacked diagnostics code = returned_sqlstate, name = constraint_name;
  perform set_config('role', 'none', true);
  return trim(code || ' ' || name);
end $$;
create function pg_temp.schedule(id text, at text) returns text language sql as $$
  select format('insert into config.activations (id, version_id, activate_at) values (%L, %L, %s)',
                '00000000-0000-7000-8000-0000000000' || id, '00000000-0000-7000-8000-0000000000c1', at)
$$;
create function pg_temp.cancel(id text) returns text language sql as $$
  select format('insert into config.activation_cancellations (activation_id, cancelled_by) values (%L, %L)',
                '00000000-0000-7000-8000-0000000000' || id, '00000000-0000-4000-8000-00000000000a')
$$;
-- Contrôles différés joués sur-le-champ (tous, ou celui nommé), puis remis à la validation.
create function pg_temp.commit_checks(checks text default 'all') returns text language plpgsql as $$
declare
  outcome text;
begin
  outcome := pg_temp.attempt('set constraints ' || checks || ' immediate');
  set constraints all deferred;
  return outcome;
end $$;

-- À l'inscription : pas de programmation à moins d'une minute de son échéance, même marge que l'annulation.
select is(pg_temp.attempt(pg_temp.schedule('a1', $$now() + interval '30 seconds'$$)), '23514 activations_scheduled_ahead',
  'le service ne programme pas à moins d''une minute de l''échéance');
select is(pg_temp.attempt(pg_temp.schedule('a1', $$clock_timestamp() + interval '59 seconds'$$), 'none'),
  '23514 activations_scheduled_ahead', 'le propriétaire non plus');
select is(pg_temp.attempt(pg_temp.schedule('a2', $$now() + interval '5 minutes'$$)), 'acceptée',
  'à cinq minutes de l''échéance, on programme');
select is(pg_temp.attempt(pg_temp.cancel('a2')), 'acceptée', 'et on annule');
select is(pg_temp.commit_checks(), 'acceptée', 'à la validation, l''échéance est toujours à venir : rien n''est refusé');

-- Les contrôles à la validation sont différés : ils jouent à la fin de la transaction, pas à l'instruction.
select is(
  (select string_agg(tgname || ' ' || tgdeferrable || ' ' || tginitdeferred, ', ' order by tgname) from pg_trigger
   where tgname in ('activations_ahead_at_commit', 'activation_cancellations_before_activation_at_commit')),
  'activation_cancellations_before_activation_at_commit true true, activations_ahead_at_commit true true',
  'contrôles de la programmation et de l''annulation différés à la validation');

-- Une validation tardive : l'échéance passe entre l'inscription et la validation. Pour la simuler sans
-- attendre une minute, le propriétaire lève, dans cette transaction, les gardes de l'inscription. Chaque
-- cas joue son contrôle dans la même sous-transaction que son inscription : un refus n'y laisse rien en
-- attente pour le cas suivant.
alter table config.activations disable trigger activations_guard;
alter table config.activation_cancellations disable trigger activation_cancellations_guard;
create function pg_temp.late(statement text, checks text) returns text language sql as $$
  select statement || '; select pg_sleep(0.1); set constraints ' || checks || ' immediate'
$$;
select is(pg_temp.attempt(pg_temp.late(pg_temp.schedule('a3', $$clock_timestamp() + interval '50 milliseconds'$$),
    'config.activations_ahead_at_commit')),
  '23514 activations_scheduled_ahead', 'une programmation validée après son échéance est refusée');
-- a4 : activation immédiate, annulée sans la garde ; seul le contrôle de l'annulation est joué.
select is(pg_temp.attempt(pg_temp.late(pg_temp.schedule('a4', 'now()') || '; ' || pg_temp.cancel('a4'),
    'config.activation_cancellations_before_activation_at_commit'), 'none'),
  '23514 activation_cancellations_before_activation', 'une annulation validée après l''entrée en vigueur est refusée');
-- Activation immédiate : son effet est daté du début de sa transaction, ici dix secondes plus tôt.
select is(pg_temp.attempt(format(
    'insert into config.activations (version_id, activate_at, created_at) values (%L, now() - interval ''10 seconds'', now() - interval ''10 seconds''); '
    || 'set constraints config.activations_ahead_at_commit immediate', '00000000-0000-7000-8000-0000000000c1'), 'none'),
  '23514 activations_not_backdated', 'une activation immédiate validée plus de cinq secondes après sa date est refusée');
select is(pg_temp.attempt(pg_temp.schedule('a5', 'now()') || '; set constraints config.activations_ahead_at_commit immediate'),
  'acceptée', 'une activation immédiate validée aussitôt est acceptée');

select * from finish();
rollback;
