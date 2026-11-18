begin;
select plan(31);

-- Jeu d'essai : Alice (aa) et Bob (ab), joueurs ; Dion (ad), Eudore (ae) et Phédon (af), de l'équipe. Une seule
-- transaction : `now()` y est un même instant ; une sanction se désigne par son motif.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000340aa', 'mlift-alice@example.test'),
  ('00000000-0000-4000-8000-0000000340ab', 'mlift-bob@example.test'),
  ('00000000-0000-4000-8000-0000000340ad', 'mlift-dion@example.test'),
  ('00000000-0000-4000-8000-0000000340ae', 'mlift-eudore@example.test'),
  ('00000000-0000-4000-8000-0000000340af', 'mlift-phedon@example.test');
-- Sanctions posées par le propriétaire, à des instants que le service ne choisit pas.
insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id, validated_by) values
  ('00000000-0000-4000-8000-0000000340aa', 'ban', now() - interval '1 day', null, 'Ban-propose', '00000000-0000-4000-8000-0000000340ad', null),
  ('00000000-0000-4000-8000-0000000340aa', 'ban', now() - interval '1 day', null, 'Ban-garde', '00000000-0000-4000-8000-0000000340ad', null),
  ('00000000-0000-4000-8000-0000000340aa', 'ban', now() - interval '1 day', null, 'Ban-valide', '00000000-0000-4000-8000-0000000340ad', '00000000-0000-4000-8000-0000000340ae'),
  ('00000000-0000-4000-8000-0000000340ab', 'ban', now() - interval '1 day', null, 'Ban-appel', '00000000-0000-4000-8000-0000000340ad', '00000000-0000-4000-8000-0000000340ae'),
  ('00000000-0000-4000-8000-0000000340aa', 'silence', now() - interval '1 hour', now() + interval '1 day', 'Silence', '00000000-0000-4000-8000-0000000340ad', null),
  ('00000000-0000-4000-8000-0000000340aa', 'warning', now() - interval '1 hour', now() + interval '7 days', 'Avert', '00000000-0000-4000-8000-0000000340ad', null),
  ('00000000-0000-4000-8000-0000000340ab', 'suspension', now() - interval '1 hour', now() + interval '1 day', 'Sous-appel', '00000000-0000-4000-8000-0000000340ad', null),
  ('00000000-0000-4000-8000-0000000340aa', 'warning', now() - interval '3 days', now() - interval '2 days', 'Fini', '00000000-0000-4000-8000-0000000340ad', null);

create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'oikos_service', true);
  execute statement into result;
  perform set_config('role', 'none', true);
  return result;
end $$;
select pg_temp.as_service($$update admin.sanctions set appeal_body = 'Je conteste.' where reason in ('Sous-appel', 'Ban-appel') returning 1$$);

-- Droits : le service propose une levée sans la dater ; aucun joueur n'écrit une sanction.
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'admin' and table_name = 'sanctions' and privilege_type = 'UPDATE'),
  'appeal_body appeal_decided_by appeal_decision lift_proposed_by lifted_by validated_by',
  'le service écrit qui propose une levée et qui lève, jamais leurs instants');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lift_proposed_at = now() where reason = 'Ban-valide'$s$)$$,
  '42501', null, 'le service ne date pas une proposition de levée');
select throws_ok($$insert into admin.sanctions (user_id, kind, reason, author_id, lift_proposed_by) values
  ('00000000-0000-4000-8000-0000000340aa', 'ban', 'x', '00000000-0000-4000-8000-0000000340ad', '00000000-0000-4000-8000-0000000340ae')$$,
  '23001', 'a sanction is pronounced now, without appeal', 'une sanction naît sans proposition de levée');

-- Retirer une exclusion proposée : par tout autre compte que l'exclu, son auteur compris ; elle finit à cet instant.
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340aa' where reason = 'Ban-propose'$s$)$$,
  '23514', 'new row for relation "sanctions" violates check constraint "sanctions_lift_shape"', 'le compte exclu ne retire pas son exclusion');
select is(pg_temp.as_service($$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ad' where reason = 'Ban-propose'
  returning (lifted_at = now() and ends_at = now() and validated_by is null)::text$$), 'true',
  'l''auteur retire sa proposition : elle prend une fin, sans validation');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set validated_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Ban-propose'$s$)$$,
  '23514', 'a withdrawn exclusion is not confirmed', 'une exclusion retirée ne se valide plus');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Ban-propose'$s$)$$,
  '23001', 'a sanction is lifted once, by an account', 'ni ne se retire deux fois');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Ban-garde'$s$)$$,
  '23001', 'a lift is proposed once, alone, on a confirmed exclusion', 'une exclusion proposée se retire, sa levée ne se propose pas');
select is(
  (select count(*) from jsonb_array_elements(pg_temp.as_service($$select admin.moderation_queue(0, 50)::text$$)::jsonb -> 'pendingExclusions') e
   where e ->> 'reason' in ('Ban-propose', 'Ban-garde')),
  1::bigint, 'une exclusion retirée quitte la file des exclusions à valider');

-- Lever sans appel une sanction autre qu'une exclusion : seule, par tout autre compte que le sanctionné.
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340aa' where reason = 'Avert'$s$)$$,
  '23514', 'new row for relation "sanctions" violates check constraint "sanctions_lift_shape"', 'le compte sanctionné ne lève pas sa sanction');
select is(pg_temp.as_service($$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ad' where reason = 'Silence'
  returning (lifted_at = now() and ends_at = now() and appeal_decision is null)::text$$), 'true',
  'l''auteur lève un silence sans appel : il finit maintenant');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Silence'$s$)$$,
  '23001', 'a sanction is lifted once, by an account', 'une sanction se lève une fois');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Fini'$s$)$$,
  '23514', 'only a sanction not yet ended is lifted', 'une sanction finie ne se lève pas');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Sous-appel'$s$)$$,
  '23514', 'a sanction under appeal is lifted by deciding its appeal', 'une sanction sous appel se lève en tranchant l''appel');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Avert'$s$)$$,
  '23001', 'a lift is proposed once, alone, on a confirmed exclusion', 'seule une exclusion validée attend une proposition de levée');
select throws_ok($$update admin.sanctions set ends_at = now() + interval '1 day' where reason = 'Avert'$$,
  '23001', 'a sanction is lifted once, by an account', 'une fin ne change que par une levée');

-- Lever une exclusion validée : une proposition, puis la levée par une autre personne (double validation, 15.4).
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340af' where reason = 'Ban-valide'$s$)$$,
  '23514', 'a confirmed exclusion is lifted by a second person, after a proposal', 'pas de levée sans proposition');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000340aa' where reason = 'Ban-valide'$s$)$$,
  '23514', 'new row for relation "sanctions" violates check constraint "sanctions_lift_proposal_shape"', 'le compte exclu ne propose pas sa levée');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000340ae',
  lifted_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Ban-valide'$s$)$$,
  '23001', 'a lift is proposed once, alone, on a confirmed exclusion', 'proposer ne lève rien dans la même écriture');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000340af' where reason = 'Ban-appel'$s$)$$,
  '23514', 'a sanction under appeal is lifted by deciding its appeal', 'une exclusion sous appel se lève en tranchant l''appel');
select is(pg_temp.as_service($$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Ban-valide'
  returning (lift_proposed_at = now() and lifted_at is null and ends_at is null)::text$$), 'true',
  'une proposition de levée est datée par la base et ne lève rien');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000340af' where reason = 'Ban-valide'$s$)$$,
  '23001', 'a lift is proposed once, alone, on a confirmed exclusion', 'une levée se propose une fois');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Ban-valide'$s$)$$,
  '23514', 'a confirmed exclusion is lifted by a second person, after a proposal', 'qui propose ne confirme pas sa proposition');
select is(pg_temp.as_service($$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ad' where reason = 'Ban-valide'
  returning (lifted_at = now() and ends_at = now() and lift_proposed_by is not null)::text$$), 'true',
  'une seconde personne lève l''exclusion validée : elle finit maintenant');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_body = 'Trop tard' where reason = 'Ban-valide'$s$)$$,
  '23514', 'an ended sanction is not appealed', 'une exclusion levée ne s''appelle plus');

-- Les joueurs : rien n'est écrit en direct ; une sanction levée se lit avec sa fin, une exclusion retirée jamais.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000340ab", "role": "authenticated"}';
select throws_ok($$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Sous-appel'$$,
  '42501', null, 'un joueur ne lève rien en direct');
select throws_ok($$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000340ae' where reason = 'Ban-appel'$$,
  '42501', null, 'ni ne propose une levée');
select is((select count(*) from public.my_sanctions where reason in ('Ban-valide', 'Silence', 'Ban-propose')), 0::bigint,
  'Bob ne lit pas les sanctions levées ou retirées d''Alice');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000340aa", "role": "authenticated"}';
select results_eq(
  $$select reason, ends_at = now() from public.my_sanctions where reason in ('Ban-valide', 'Silence', 'Ban-propose', 'Ban-garde') order by reason$$,
  $$values ('Ban-valide'::text, true), ('Silence', true)$$,
  'Alice lit ses sanctions levées avec leur fin, pas ses exclusions proposées, retirées ou non');
reset role;

-- La garde de la naissance d'un signalement n'a plus de branche de mise à jour ; les changements restent tenus.
select ok(pg_get_functiondef('game.guard_report()'::regprocedure) !~ '(tg_op|message_purge)',
  'game.guard_report() ne tient plus que la naissance d''un signalement');
select is((select string_agg(tgname || ':' || (tgtype & 16 <> 0)::text, ' ' order by tgname) from pg_trigger
   where tgrelid = 'game.reports'::regclass and not tgisinternal),
  'reports_change_guard:true reports_guard:false', 'seule la garde des changements est appelée à la mise à jour');

select * from finish();
