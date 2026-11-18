begin;
select plan(52);

-- Jeu d'essai : Alice et Bob ont chacun une maison, un site et un intendant en poste ; Chloé n'a pas de maison.
-- L'intendant de Bob a reçu des règles une fois (révision 1) ; un second intendant de Bob a été renvoyé.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000300aa', 'instructions-alice@example.test'),
  ('00000000-0000-4000-8000-0000000300ab', 'instructions-bob@example.test'),
  ('00000000-0000-4000-8000-0000000300ac', 'instructions-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000300a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000300aa', 'Bacchiades', '{}'),
  ('00000000-0000-7000-8000-0000000300b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000300ab', 'Cypsélides', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000300a3', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000300a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000300b3', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000300b1', '01900000-0000-7000-8000-000000000101', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000300b4', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000300b1', '01900000-0000-7000-8000-000000000101', 'grow_wheat');
insert into game.stewards (id, world_id, house_id, site_id, name) values
  ('00000000-0000-7000-8000-0000000300a5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000300a1', '00000000-0000-7000-8000-0000000300a3', 'Nikias'),
  ('00000000-0000-7000-8000-0000000300b5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000300b1', '00000000-0000-7000-8000-0000000300b3', 'Kléon'),
  ('00000000-0000-7000-8000-0000000300b6', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000300b1', '00000000-0000-7000-8000-0000000300b4', 'Lysias');
update game.stewards set rules_revision = 1 where id = '00000000-0000-7000-8000-0000000300b5';
update game.stewards set dismissed_at = now() where id = '00000000-0000-7000-8000-0000000300b6';

create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'oikos_service', true);
  -- Seules une lecture et une écriture qui rend sa ligne ont un résultat.
  if statement ~* '^\s*select|returning' then
    execute statement into result;
  else
    execute statement;
  end if;
  perform set_config('role', 'none', true);
  return result;
end $$;
-- Une consigne donnée par le service à l'intendant donné (Kléon par défaut), à la révision donnée.
create function pg_temp.submit(body text = 'vends le blé au-dessus de 12 drachmes', revision int = 1,
  steward text = '00000000-0000-7000-8000-0000000300b5') returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.steward_instructions (steward_id, rules_revision, text) values (%L, %s, %L) returning id', steward, revision, body));
$$;
create function pg_temp.propose(instruction text, rules text, simulation text, refusal text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.steward_proposals (instruction_id, rules, simulation, refusal) values (%L, %L, %L, %L)',
    instruction, rules, simulation, refusal));
$$;
create function pg_temp.pending(steward text = '00000000-0000-7000-8000-0000000300b5') returns text language sql as $$
  select id::text from game.steward_instructions where steward_id = steward::uuid and status = 'pending'
$$;

-- Droits, lus dans le catalogue.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('game.steward_instructions'::regclass, 'game.steward_proposals'::regclass)),
  'règles par ligne actives sur les deux tables');
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('steward_instructions', 'steward_proposals')),
  'steward_instructions:service_all:ALL:oikos_service steward_instructions:steward_instructions_read_own:SELECT:authenticated '
  'steward_proposals:service_all:ALL:oikos_service steward_proposals:steward_proposals_read_own:SELECT:authenticated',
  'une règle de lecture pour les joueurs, aucune d''écriture');
select is(
  (select string_agg(table_name || ':' || privilege_type || ':' || column_name, ' ' order by table_name, privilege_type, column_name)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('steward_instructions', 'steward_proposals')
     and grantee = 'oikos_service' and privilege_type in ('INSERT', 'UPDATE')),
  'steward_instructions:INSERT:rules_revision steward_instructions:INSERT:steward_id steward_instructions:INSERT:text '
  'steward_instructions:UPDATE:status '
  'steward_proposals:INSERT:instruction_id steward_proposals:INSERT:refusal steward_proposals:INSERT:rules steward_proposals:INSERT:simulation',
  'le service inscrit sans choisir ni identifiant, ni état, ni date, puis ne change que l''état d''une consigne');
select ok(not has_table_privilege('oikos_service', 'game.steward_instructions', 'delete')
  and not has_table_privilege('oikos_service', 'game.steward_proposals', 'update')
  and not has_table_privilege('oikos_service', 'game.steward_proposals', 'delete'),
  'il n''efface rien et ne modifie aucune proposition');
select ok(not has_table_privilege('authenticated', 'game.steward_instructions', 'insert')
  and not has_table_privilege('authenticated', 'game.steward_instructions', 'update')
  and not has_table_privilege('authenticated', 'game.steward_instructions', 'delete')
  and not has_table_privilege('authenticated', 'game.steward_proposals', 'insert')
  and not has_table_privilege('authenticated', 'game.steward_proposals', 'update')
  and not has_table_privilege('authenticated', 'game.steward_proposals', 'delete'),
  'un joueur n''écrit rien : il écrit par l''API');
select ok(not has_table_privilege('anon', 'game.steward_instructions', 'select')
  and not has_table_privilege('anon', 'game.steward_proposals', 'select')
  and not has_table_privilege('anon', 'public.my_steward_instructions', 'select'), 'un visiteur anonyme ne lit rien');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'my_steward_instructions' and grantee in ('anon', 'authenticated')),
  'authenticated:SELECT', 'la vue en lecture seule');
select ok(not exists (select 1 from pg_roles r
  where (has_function_privilege(r.oid, 'game.guard_steward_instruction()', 'execute')
         or has_function_privilege(r.oid, 'game.guard_steward_proposal()', 'execute'))
    and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')), 'personne n''exécute les gardes');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.purge_steward_instructions(timestamptz)', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'oikos_service', 'seul le service lance la purge des consignes');

-- Consignes, sous le rôle de service.
select lives_ok(pg_temp.submit(), 'le service inscrit la consigne de Kléon');
select is((select status || ':' || (created_at = now())::text || ':' || coalesce(answered_at::text, '-')
           from game.steward_instructions where id = pg_temp.pending()::uuid),
  'pending:true:-', 'en attente, datée de sa transaction');
select throws_ok(pg_temp.submit('encore une'), '23505', null, 'une seule consigne en attente par intendant');
select lives_ok(pg_temp.submit('récolte', 0, '00000000-0000-7000-8000-0000000300a5'),
  'chaque intendant a la sienne : Nikias, d''une autre maison');
select throws_ok(pg_temp.submit('récolte', 1, '00000000-0000-7000-8000-0000000300b6'), '23001',
  'an instruction is given to a steward in post, at his current rules', 'pas à un intendant renvoyé');
update game.stewards set rules_revision = 2 where id = '00000000-0000-7000-8000-0000000300b5';
select throws_ok(format('select pg_temp.as_service(%L)',
  'insert into game.steward_instructions (steward_id, rules_revision, text) values (''00000000-0000-7000-8000-0000000300a5'', 7, ''x'')'),
  '23001', 'an instruction is given to a steward in post, at his current rules', 'ni à une révision qui n''est pas la sienne');
select throws_ok(pg_temp.submit(repeat('a', 501), 0, '00000000-0000-7000-8000-0000000300a5'), '23514', null, 'texte de 500 caractères au plus');
select throws_ok(pg_temp.submit(E'  \n ', 0, '00000000-0000-7000-8000-0000000300a5'), '23514', null, 'jamais blanc');
select throws_ok($$select pg_temp.as_service($s$insert into game.steward_instructions (steward_id, rules_revision, text, status)
  values ('00000000-0000-7000-8000-0000000300a5', 0, 'x', 'answered')$s$)$$, '42501', null, 'le service ne choisit pas l''état');
select throws_ok($$select pg_temp.as_service($s$insert into game.steward_instructions (steward_id, rules_revision, text, created_at)
  values ('00000000-0000-7000-8000-0000000300a5', 0, 'x', now() - interval '2 days')$s$)$$, '42501', null, 'ni n''antidate une consigne');

-- Réponse du moteur.
select throws_ok(format('select pg_temp.as_service(%L)', format(
  'update game.steward_instructions set status = %L where id = %L', 'answered', pg_temp.pending())),
  '23001', 'an instruction is answered once, by its proposal', 'pas de réponse sans proposition');
select throws_ok(pg_temp.propose(pg_temp.pending(), '[]', null, 'AMBIGUOUS'), '23514', null, 'des règles ou un refus, pas les deux');
select throws_ok(pg_temp.propose(pg_temp.pending(), null, null, null), '23514', null, 'jamais aucun des deux');
select throws_ok(pg_temp.propose(pg_temp.pending(), null, '[]', 'AMBIGUOUS'), '23514', null, 'pas de simulation sans règles');
select throws_ok(pg_temp.propose(pg_temp.pending(), '{}', null, null), '23514', null, 'des règles en liste');
select throws_ok(pg_temp.propose(pg_temp.pending(), null, null, 'pas un code'), '23514', null, 'un refus est un code');
select lives_ok(pg_temp.propose(pg_temp.pending(), '[{"kind": "sell", "goodId": "wheat", "minPriceOboles": 72, "keepUnits": 0}]',
  '[{"position": 0, "status": "idle"}]', null), 'le moteur propose des règles et leur simulation');
select lives_ok(format('select pg_temp.as_service(%L)', format(
  'update game.steward_instructions set status = %L where id = %L', 'answered', pg_temp.pending())),
  'puis la consigne est répondue');
select is((select answered_at = now() from game.steward_instructions
           where steward_id = '00000000-0000-7000-8000-0000000300b5'), true, 'datée de sa transaction');
select is((select count(*)::int from game.steward_instructions where status = 'pending'
           and steward_id = '00000000-0000-7000-8000-0000000300b5'), 0, 'Kléon n''a plus de consigne en attente');
select lives_ok(pg_temp.submit('récolte', 2), 'une consigne nouvelle peut suivre');
select throws_ok(format('select pg_temp.as_service(%L)', format(
  'insert into game.steward_proposals (instruction_id, refusal) select id, %L from game.steward_instructions where status = %L and steward_id = %L',
  'AMBIGUOUS', 'answered', '00000000-0000-7000-8000-0000000300b5')),
  '23001', 'a proposal answers a pending instruction of a steward in post', 'une consigne répondue ne reçoit pas de seconde réponse');
select throws_ok($$update game.steward_instructions set status = 'pending' where status = 'answered'$$,
  '23001', 'an instruction is answered once, by its proposal', 'ni ne revient en attente');
select throws_ok($$select pg_temp.as_service($s$update game.steward_instructions set text = null$s$)$$,
  '42501', null, 'le service n''efface pas un texte');
select throws_ok($$update game.steward_instructions set text = null where status = 'answered'$$,
  '23001', 'an instruction text is only erased by the retention purge', 'ni le propriétaire hors de la purge');
select throws_ok($$update game.steward_instructions set text = 'autre chose' where status = 'answered'$$,
  '23001', 'an instruction text is only erased by the retention purge', 'un texte ne se réécrit pas');
select throws_ok($$update game.steward_instructions set rules_revision = 5 where status = 'answered'$$,
  '23001', 'a steward instruction is immutable', 'ni sa révision');
select throws_ok($$delete from game.steward_instructions$$, '23001', 'a steward instruction is never removed', 'rien ne la supprime');
select throws_ok($$update game.steward_proposals set refusal = 'AMBIGUOUS', rules = null, simulation = null$$,
  '23001', 'a steward proposal does not change', 'une proposition ne change plus');
select throws_ok($$delete from game.steward_proposals$$, '23001', 'a steward proposal does not change', 'ni ne s''efface');

-- Purge de la conservation : la consigne de Nikias est antidatée de 40 jours, la garde levée le temps de l'écrire.
-- La première consigne de Kléon, répondue, est antidatée de deux jours.
alter table game.steward_instructions disable trigger steward_instructions_guard;
update game.steward_instructions set created_at = now() - interval '40 days'
  where steward_id = '00000000-0000-7000-8000-0000000300a5';
update game.steward_instructions set created_at = now() - interval '2 days'
  where steward_id = '00000000-0000-7000-8000-0000000300b5' and status = 'answered';
alter table game.steward_instructions enable trigger steward_instructions_guard;
select throws_ok($$select pg_temp.as_service($s$select game.purge_steward_instructions(now() - interval '23 hours')$s$)$$,
  '23514', 'instructions younger than one day cannot be purged', 'jamais une consigne de moins d''un jour');
select is(pg_temp.as_service($$select game.purge_steward_instructions(now() - interval '30 days')$$)::bigint, 1::bigint,
  'le service efface les textes au-delà de la conservation, et les compte');
select is((select string_agg(coalesce(text, '∅'), ', ' order by created_at) from game.steward_instructions
           where steward_id in ('00000000-0000-7000-8000-0000000300a5', '00000000-0000-7000-8000-0000000300b5')),
  '∅, vends le blé au-dessus de 12 drachmes, récolte', 'seul le texte ancien est effacé ; la consigne reste');
select is(current_setting('oikos.steward_instruction_purge', true), 'off', 'la garde se referme après la purge');

-- Lectures des joueurs : chacun les siennes.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000300ab", "role": "authenticated"}';
select is((select count(*)::int from game.steward_instructions), 2, 'Bob lit les consignes de son intendant');
select is((select count(*)::int from game.steward_proposals), 1, 'et leur proposition');
select is((select status || ':' || text || ':' || coalesce(refusal, '-') from public.my_steward_instructions
           where site_id = '00000000-0000-7000-8000-0000000300b3'),
  'pending:récolte:-', 'la fiche de son site montre la dernière consigne de Kléon');
select is((select count(*)::int from public.my_steward_instructions), 1, 'rien d''un intendant renvoyé ni d''une autre maison');
select throws_ok($$insert into game.steward_instructions (steward_id, rules_revision, text)
  values ('00000000-0000-7000-8000-0000000300b5', 2, 'x')$$, '42501', null, 'Bob n''écrit pas de consigne en direct');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000300aa", "role": "authenticated"}';
select is((select count(*)::int from game.steward_instructions where steward_id = '00000000-0000-7000-8000-0000000300b5'), 0,
  'Alice ne lit pas les consignes de Bob');
select is((select count(*)::int from game.steward_proposals), 0, 'ni ses propositions');
select is((select string_agg(steward_id::text, ' ') from public.my_steward_instructions),
  '00000000-0000-7000-8000-0000000300a5', 'sa fiche ne montre que Nikias');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000300ac", "role": "authenticated"}';
select is((select count(*)::int from game.steward_instructions) + (select count(*)::int from public.my_steward_instructions), 0,
  'Chloé, sans maison, ne lit rien');
reset role;

select * from finish();
rollback;
