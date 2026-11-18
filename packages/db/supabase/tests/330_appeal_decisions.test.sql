begin;
select plan(24);

-- Jeu d'essai (ticket 529) : Alice, Bob et Chloé, joueurs ; Dion, modérateur auteur des sanctions ; Eudore,
-- modérateur qui tranche les appels et valide une exclusion. Alice : un silence contesté et rejeté, une suspension
-- contestée et accueillie (donc levée), un avertissement contesté pas encore tranché, un autre sans appel. Bob : une
-- suspension contestée et accueillie, une exclusion pas encore validée, contestée et rejetée. Chloé : une exclusion
-- validée, contestée, pas tranchée.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000330aa', 'decision-appel-alice@example.test'),
  ('00000000-0000-4000-8000-0000000330ab', 'decision-appel-bob@example.test'),
  ('00000000-0000-4000-8000-0000000330ac', 'decision-appel-chloe@example.test'),
  ('00000000-0000-4000-8000-0000000330ad', 'decision-appel-dion@example.test'),
  ('00000000-0000-4000-8000-0000000330ae', 'decision-appel-eudore@example.test');
insert into admin.sanctions (id, user_id, kind, starts_at, ends_at, reason, author_id, validated_by) values
  ('00000000-0000-7000-8000-000000033051', '00000000-0000-4000-8000-0000000330aa', 'silence', now() - interval '1 hour', now() + interval '1 day', 'Insultes', '00000000-0000-4000-8000-0000000330ad', null),
  ('00000000-0000-7000-8000-000000033052', '00000000-0000-4000-8000-0000000330aa', 'suspension', now() - interval '2 hours', now() + interval '3 days', 'Triche', '00000000-0000-4000-8000-0000000330ad', null),
  ('00000000-0000-7000-8000-000000033053', '00000000-0000-4000-8000-0000000330aa', 'warning', now() - interval '3 hours', now() + interval '7 days', 'Ton', '00000000-0000-4000-8000-0000000330ad', null),
  ('00000000-0000-7000-8000-000000033054', '00000000-0000-4000-8000-0000000330aa', 'warning', now() - interval '4 hours', now() + interval '7 days', 'Ton', '00000000-0000-4000-8000-0000000330ad', null),
  ('00000000-0000-7000-8000-000000033055', '00000000-0000-4000-8000-0000000330ab', 'suspension', now(), now() + interval '1 day', 'Spam', '00000000-0000-4000-8000-0000000330ad', null),
  ('00000000-0000-7000-8000-000000033056', '00000000-0000-4000-8000-0000000330ab', 'ban', now(), null, 'Récidive', '00000000-0000-4000-8000-0000000330ad', null),
  ('00000000-0000-7000-8000-000000033057', '00000000-0000-4000-8000-0000000330ac', 'ban', now(), null, 'Haine', '00000000-0000-4000-8000-0000000330ad', '00000000-0000-4000-8000-0000000330ae');
update admin.sanctions set appeal_body = 'Je conteste.'
where id in ('00000000-0000-7000-8000-000000033051', '00000000-0000-7000-8000-000000033052',
             '00000000-0000-7000-8000-000000033053', '00000000-0000-7000-8000-000000033055',
             '00000000-0000-7000-8000-000000033056', '00000000-0000-7000-8000-000000033057');
update admin.sanctions set appeal_decision = 'rejected', appeal_decided_by = '00000000-0000-4000-8000-0000000330ae'
where id in ('00000000-0000-7000-8000-000000033051', '00000000-0000-7000-8000-000000033056');
update admin.sanctions set appeal_decision = 'granted', appeal_decided_by = '00000000-0000-4000-8000-0000000330ae',
  lifted_by = '00000000-0000-4000-8000-0000000330ae', ends_at = now()
where id in ('00000000-0000-7000-8000-000000033052', '00000000-0000-7000-8000-000000033055');

-- Droits et forme, lus dans le catalogue.
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'my_appeal_decisions'
     and grantee in ('PUBLIC', 'anon', 'authenticated', 'oikos_service', 'service_role')),
  'my_appeal_decisions:authenticated:SELECT',
  'vue en lecture seule pour les joueurs connectés, rien pour un visiteur anonyme ni pour le service');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.my_appeal_decisions()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated',
  'seuls les joueurs connectés exécutent la lecture des décisions');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.my_appeal_decisions'::regclass),
  'la vue lit avec les droits du joueur');
select is(
  (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'my_appeal_decisions'),
  'sanction_id,decision,decided_at',
  'la vue rend la sanction, la décision et son instant, jamais l''auteur de la décision ni de la levée');
select is(pg_get_function_result('game.my_sanctions()'::regprocedure),
  'TABLE(id uuid, kind text, starts_at timestamp with time zone, ends_at timestamp with time zone, reason text, appeal_body text, appealed_at timestamp with time zone)',
  'le type rendu par game.my_sanctions() reste figé (ADR 0006)');
select is(
  (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'my_sanctions'),
  'id,kind,starts_at,ends_at,reason,appeal_body,appealed_at',
  'la vue des sanctions garde ses colonnes');

-- Visiteur anonyme.
set local role anon;
select throws_ok('select * from public.my_appeal_decisions', '42501', null, 'anon ne lit pas de décision par la vue');
select throws_ok('select * from game.my_appeal_decisions()', '42501', null, 'ni par la fonction');
reset role;

-- Alice : ses deux décisions, datées par la base, et celles-là seules.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000330aa", "role": "authenticated"}';
select results_eq(
  $$select sanction_id, decision, decided_at = now() from public.my_appeal_decisions order by sanction_id$$,
  $$values ('00000000-0000-7000-8000-000000033051'::uuid, 'rejected'::text, true),
           ('00000000-0000-7000-8000-000000033052'::uuid, 'granted'::text, true)$$,
  'un compte lit la décision sur ses appels tranchés, ni un appel en attente ni une sanction sans appel');
select results_eq(
  $$select s.ends_at = d.decided_at from public.my_sanctions s join public.my_appeal_decisions d on d.sanction_id = s.id
    where d.decision = 'granted'$$,
  $$values (true)$$,
  'un appel accueilli lève la sanction : sa fin est l''instant de la décision');
select results_eq(
  $$select s.ends_at > now() from public.my_sanctions s join public.my_appeal_decisions d on d.sanction_id = s.id
    where d.decision = 'rejected'$$,
  $$values (true)$$,
  'un appel rejeté laisse courir la sanction');
select is((select count(*) from game.my_appeal_decisions()), 2::bigint, 'la fonction ne rend que les lignes du compte connecté');
select throws_ok('select appeal_decided_by from admin.sanctions', '42501', null, 'l''auteur de la décision ne se lit pas en direct');
select throws_ok($$insert into public.my_appeal_decisions (sanction_id, decision, decided_at)
  values ('00000000-0000-7000-8000-000000033053', 'granted', now())$$, '55000', null, 'aucune décision écrite par la vue');
select throws_ok($$update public.my_appeal_decisions set decision = 'granted'$$, '55000', null, 'ni modifiée');
select throws_ok($$delete from public.my_appeal_decisions$$, '55000', null, 'ni effacée');
select throws_ok($$update admin.sanctions set appeal_decision = 'granted'$$, '42501', null, 'ni écrite en direct');
reset role;
select is(
  (select appeal_decision from admin.sanctions where id = '00000000-0000-7000-8000-000000033053'), null,
  'l''appel en attente n''a pas été tranché par le joueur');

-- Bob : sa suspension levée, pas la décision sur l'exclusion encore à valider.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000330ab", "role": "authenticated"}';
select results_eq($$select sanction_id, decision from public.my_appeal_decisions$$,
  $$values ('00000000-0000-7000-8000-000000033055'::uuid, 'granted'::text)$$,
  'un autre joueur ne lit que sa décision, et pas celle d''une exclusion pas encore validée');
select is((select count(*) from public.my_appeal_decisions where sanction_id = '00000000-0000-7000-8000-000000033051'),
  0::bigint, 'ni celle d''Alice, même désignée');

-- Chloé : appel pas encore tranché.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000330ac", "role": "authenticated"}';
select is((select count(*) from public.my_appeal_decisions), 0::bigint, 'un appel en attente n''a pas de décision');

-- Dion, auteur des sanctions, et Eudore, qui a tranché, n'en lisent aucune par cette vue.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000330ad", "role": "authenticated"}';
select is((select count(*) from public.my_appeal_decisions), 0::bigint, 'l''auteur d''une sanction ne lit pas la décision');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000330ae", "role": "authenticated"}';
select is((select count(*) from public.my_appeal_decisions), 0::bigint, 'ni celui qui l''a tranchée');

-- Un joueur connecté sans identité lisible ne lit rien.
set local request.jwt.claims to '{"role": "authenticated"}';
select is((select count(*) from public.my_appeal_decisions), 0::bigint, 'sans identité, aucune décision');
reset role;

select * from finish();
rollback;
