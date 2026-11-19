begin;
select plan(16);

-- Jeu d'essai (ticket 616) : Alice (aa) et Bob (ab), joueurs ; Dion (ad), auteur des sanctions ; Eudore (ae), qui
-- valide et propose ; Phédon (af), qui tranche ou confirme. Une sanction se désigne par son motif ; une seule
-- transaction : `now()` y est un même instant.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000480aa', 'lift-guard-alice@example.test'),
  ('00000000-0000-4000-8000-0000000480ab', 'lift-guard-bob@example.test'),
  ('00000000-0000-4000-8000-0000000480ad', 'lift-guard-dion@example.test'),
  ('00000000-0000-4000-8000-0000000480ae', 'lift-guard-eudore@example.test'),
  ('00000000-0000-4000-8000-0000000480af', 'lift-guard-phedon@example.test');
insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id, validated_by) values
  ('00000000-0000-4000-8000-0000000480aa', 'ban', now() - interval '1 day', null, 'Ban-accueil', '00000000-0000-4000-8000-0000000480ad', '00000000-0000-4000-8000-0000000480ae'),
  ('00000000-0000-4000-8000-0000000480ab', 'ban', now() - interval '1 day', null, 'Ban-rejet', '00000000-0000-4000-8000-0000000480ad', '00000000-0000-4000-8000-0000000480ae');

-- Levées écrites par une transaction commencée après celle qui écrit ensuite : leur instant suit le `now()` de
-- celle-ci. Posées par le propriétaire, garde coupée le temps de l'insertion (annulé avec la transaction).
alter table admin.sanctions disable trigger sanctions_guard;
insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id, validated_by, lifted_by, lifted_at,
                             appeal_body, appealed_at) values
  ('00000000-0000-4000-8000-0000000480aa', 'suspension', now() - interval '1 hour', now() + interval '1 hour', 'Leve-appel', '00000000-0000-4000-8000-0000000480ad', null, '00000000-0000-4000-8000-0000000480ae', now() + interval '1 hour', 'Je conteste.', now()),
  ('00000000-0000-4000-8000-0000000480aa', 'silence', now() - interval '1 hour', now() + interval '1 hour', 'Leve-seul', '00000000-0000-4000-8000-0000000480ad', null, '00000000-0000-4000-8000-0000000480ae', now() + interval '1 hour', null, null),
  ('00000000-0000-4000-8000-0000000480ab', 'ban', now() - interval '1 day', now() + interval '1 hour', 'Ban-leve', '00000000-0000-4000-8000-0000000480ad', '00000000-0000-4000-8000-0000000480ae', '00000000-0000-4000-8000-0000000480af', now() + interval '1 hour', null, null);
alter table admin.sanctions enable trigger sanctions_guard;

create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'oikos_service', true);
  execute statement into result;
  perform set_config('role', 'none', true);
  return result;
end $$;

-- Appel accueilli sur une exclusion dont la levée est déjà proposée.
select is(pg_temp.as_service($$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000480ae'
  where reason in ('Ban-accueil', 'Ban-rejet') returning 'proposée'$$), 'proposée', 'Eudore propose deux levées');
select is(pg_temp.as_service($$update admin.sanctions set appeal_body = 'Je conteste.' where reason in ('Ban-accueil', 'Ban-rejet')
  returning (appealed_at = now() and lift_proposed_by is not null and lifted_at is null)::text$$), 'true',
  'l''exclu fait appel après la proposition, qui reste sans effet');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000480af' where reason = 'Ban-accueil'$s$)$$,
  '23514', 'a sanction under appeal is lifted by deciding its appeal', 'pendant l''appel, la proposition ne se confirme pas');
select is(pg_temp.as_service($$update admin.sanctions set appeal_decision = 'granted',
  appeal_decided_by = '00000000-0000-4000-8000-0000000480ae', lifted_by = '00000000-0000-4000-8000-0000000480ae'
  where reason = 'Ban-accueil'
  returning (lifted_at = now() and ends_at = now() and appeal_decided_at = now()
             and lift_proposed_by = '00000000-0000-4000-8000-0000000480ae')::text$$), 'true',
  'l''appel accueilli lève l''exclusion, même par qui en a proposé la levée ; la proposition reste inscrite');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000480af' where reason = 'Ban-accueil'$s$)$$,
  '23001', 'a sanction is lifted once, by an account', 'la proposition ne se confirme plus après l''appel accueilli');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000480af',
  appeal_decision = 'rejected', appeal_decided_by = '00000000-0000-4000-8000-0000000480af' where reason = 'Ban-accueil'$s$)$$,
  '23001', 'an appeal is decided once', 'ni l''appel ne se tranche de nouveau');

-- Appel rejeté : la proposition reste, et se confirme par une autre personne.
select is(pg_temp.as_service($$update admin.sanctions set appeal_decision = 'rejected',
  appeal_decided_by = '00000000-0000-4000-8000-0000000480af' where reason = 'Ban-rejet'
  returning (lifted_at is null and ends_at is null and lift_proposed_by is not null)::text$$), 'true',
  'un appel rejeté ne lève rien et laisse la proposition');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000480ae' where reason = 'Ban-rejet'$s$)$$,
  '23514', 'a confirmed exclusion is lifted by a second person, after a proposal', 'qui a proposé ne confirme toujours pas');
select is(pg_temp.as_service($$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000480af' where reason = 'Ban-rejet'
  returning (lifted_at = now() and ends_at = now())::text$$), 'true',
  'après le rejet, une autre personne confirme la levée');

-- Une levée ne se réécrit pas, même datée après le début de la transaction qui écrit.
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_decision = 'granted',
  appeal_decided_by = '00000000-0000-4000-8000-0000000480af', lifted_by = '00000000-0000-4000-8000-0000000480af'
  where reason = 'Leve-appel'$s$)$$,
  '23001', 'a sanction is lifted once, by an account', 'un appel accueilli ne réécrit pas une sanction déjà levée');
select is(pg_temp.as_service($$update admin.sanctions set appeal_decision = 'granted',
  appeal_decided_by = '00000000-0000-4000-8000-0000000480af' where reason = 'Leve-appel'
  returning (lifted_by = '00000000-0000-4000-8000-0000000480ae' and lifted_at = now() + interval '1 hour'
             and ends_at = lifted_at and appeal_decided_at = now())::text$$), 'true',
  'il s''inscrit sans lever de nouveau : la levée garde son auteur et son instant');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set appeal_body = 'Trop tard' where reason = 'Leve-seul'$s$)$$,
  '23514', 'an ended sanction is not appealed', 'une sanction levée ne s''appelle plus, même avant sa fin');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lift_proposed_by = '00000000-0000-4000-8000-0000000480ae' where reason = 'Ban-leve'$s$)$$,
  '23514', 'only a sanction not yet ended is lifted', 'la levée d''une exclusion levée ne se propose pas');
select throws_ok($$select pg_temp.as_service($s$update admin.sanctions set lifted_by = '00000000-0000-4000-8000-0000000480ad' where reason = 'Leve-seul'$s$)$$,
  '23001', 'a sanction is lifted once, by an account', 'ni elle ne se lève de nouveau sans appel');

-- La garde reste fermée à tous, sauf à son déclencheur.
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'admin.guard_sanction()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')),
  null, 'aucun client n''exécute la garde des sanctions');
select is((select tgenabled::text from pg_trigger where tgrelid = 'admin.sanctions'::regclass and tgname = 'sanctions_guard'),
  'O', 'la garde des sanctions est rétablie');

select * from finish();
rollback;
