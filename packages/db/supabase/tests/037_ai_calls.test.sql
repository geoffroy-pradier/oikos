begin;
select plan(9);

-- Journal des appels de la passerelle IA (migration 50, ticket 268).
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;

select lives_ok($$select pg_temp.as_service($q$
  insert into telemetry.ai_calls (usage, model, input_tokens, output_tokens, cost_micro_euros, outcome, duration_ms, called_at)
  values ('oracle', 'small', 1000, 200, 270, 'ok', 12, now() - interval '40 days'),
         ('oracle', 'small', 0, 0, 0, 'capped', 0, now())$q$)$$,
  'le service journalise un appel');
select throws_ok($$insert into telemetry.ai_calls (usage, model, input_tokens, output_tokens, cost_micro_euros, outcome, duration_ms, called_at)
  values ('mentor', 'small', 0, 0, 0, 'ok', 0, now())$$, '23514', null, 'un usage inconnu est refusé');
select throws_ok($$insert into telemetry.ai_calls (usage, model, input_tokens, output_tokens, cost_micro_euros, outcome, duration_ms, called_at)
  values ('oracle', 'small', 0, 0, -1, 'ok', 0, now())$$, '23514', null, 'un coût négatif est refusé');
select throws_ok($$select pg_temp.as_service('update telemetry.ai_calls set cost_micro_euros = 0')$$,
  '42501', null, 'le service ne réécrit aucun coût');
select throws_ok($$update telemetry.ai_calls set cost_micro_euros = 0$$, '23001', 'telemetry.ai_calls is append-only',
  'le propriétaire non plus : ajout seul');

select throws_ok($$select telemetry.purge_ai_calls(now() - interval '31 days')$$, '23514',
  'AI calls of the last 32 days cannot be purged', 'le mois en cours n''est jamais purgé');
select lives_ok($$select pg_temp.as_service('select telemetry.purge_ai_calls(now() - interval ''35 days'')')$$,
  'le service purge par la fonction du propriétaire');
select is((select count(*) from telemetry.ai_calls where called_at < now() - interval '35 days'), 0::bigint,
  'les appels plus anciens que la rétention sont partis, les récents restent');

select is(
  (select count(*) from unnest(array['anon', 'authenticated']) r
   where has_table_privilege(r, 'telemetry.ai_calls', 'select')
      or has_function_privilege(r, 'telemetry.purge_ai_calls(timestamptz)', 'execute')),
  0::bigint, 'aucun droit client sur le journal ni sur sa purge');

select * from finish();
rollback;
