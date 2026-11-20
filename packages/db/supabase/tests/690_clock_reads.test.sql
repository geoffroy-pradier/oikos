begin;
select plan(18);

-- Exposition : la vue et la fonction qu'elle lit, droits figés.
select is((select reloptions from pg_class where oid = 'public.clock_rules'::regclass), array['security_invoker=true'],
  'la vue lit au nom du joueur (`security_invoker`)');
select is(
  (select string_agg(pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ' ' order by 1)
   from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.clock_rules'::regclass and a.grantee <> c.relowner),
  'authenticated:SELECT', 'un seul droit hors propriétaire : la lecture par les joueurs connectés (liste figée)');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_table_privilege(r.oid, 'public.clock_rules', 'select, insert, update, delete, truncate, references, trigger')
     and not r.rolsuper and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'aucun autre rôle client ou de service n''y a un droit, même hérité');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.clock_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'la fonction sous-jacente n''est exécutable que par les joueurs connectés');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'game.clock_rules()'::regprocedure),
  'la fonction lit la configuration au nom de son propriétaire, chemin de recherche vide');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
           where table_schema = 'public' and table_name = 'clock_rules'), array['daily_close_hour', 'timezone'],
  'ni la durée des saisons ni rien d''autre de la configuration');

-- Aucune version en vigueur (base de test après la graine) : aucune ligne. Sautée si la base en a déjà une.
select case when config.active_version_at(now()) is null
  then is((select count(*) from public.clock_rules), 0::bigint, 'sans version en vigueur, aucune ligne')
  else skip('une version est déjà en vigueur dans cette base', 1) end;

-- La version en vigueur, et une suivante qui change l'heure de clôture dans une heure.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c691',
   '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}'),
  ('00000000-0000-7000-8000-00000000c692',
   '{"clock": {"tickMinutes": 10, "dailyCloseHour": 6, "timezone": "Europe/Athens", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values
  ('00000000-0000-7000-8000-00000000c691', now()),
  ('00000000-0000-7000-8000-00000000c692', now() + interval '1 hour');

set local role anon;
select throws_ok('select * from public.clock_rules', '42501', null, 'un visiteur anonyme ne lit pas l''horloge');
set local role service_role;
select throws_ok('select * from public.clock_rules', '42501', null, 'ni `service_role` (le service de jeu, sans droit non plus, lit la configuration directement)');
set local role authenticated;
select is((select count(*) from public.clock_rules), 1::bigint, 'une seule ligne : la version en vigueur');
select is((select (daily_close_hour, timezone)::text from public.clock_rules), '(4,Europe/Paris)',
  'l''heure de clôture et le fuseau en vigueur, pas ceux de la version suivante');
-- Vue faite d'une fonction, donc non modifiable (55000) ; et sans droit d'écriture (liste figée ci-dessus).
select throws_ok($$insert into public.clock_rules values (5, 'UTC')$$, '55000', null, 'un joueur n''écrit pas par la vue');
select throws_ok($$update public.clock_rules set daily_close_hour = 5$$, '55000', null, 'ni ne la modifie');
select throws_ok('delete from public.clock_rules', '55000', null, 'ni n''en supprime');
reset role;

-- Deux versions activées au même instant : la décision enregistrée en dernier l'emporte.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c693',
   '{"clock": {"tickMinutes": 10, "dailyCloseHour": 5, "timezone": "Europe/Athens", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c693', now());
set local role authenticated;
select is((select (daily_close_hour, timezone)::text from public.clock_rules), '(5,Europe/Athens)',
  'à égalité d''échéance, une seule ligne : celle de la dernière activation enregistrée');
reset role;

-- Fuseau que la base ne connaît pas : nul, le client n'annonce alors aucune clôture.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c694',
   '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Mars/Olympus", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c694', now());
set local role authenticated;
select is((select (daily_close_hour, timezone)::text from public.clock_rules), '(4,)',
  'fuseau inconnu : nul, jamais une valeur inventée ; l''heure de clôture reste lisible');
reset role;

-- Version sans section d'horloge : une ligne de valeurs nulles, sans erreur.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c695', '{}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c695', now());
set local role authenticated;
select is((select (daily_close_hour, timezone)::text from public.clock_rules), '(,)',
  'sans horloge en vigueur : heure et fuseau nuls, le client n''annonce rien');
select is((select count(*) from public.clock_rules), 1::bigint, 'et toujours une seule ligne');
reset role;

select * from finish();
rollback;
