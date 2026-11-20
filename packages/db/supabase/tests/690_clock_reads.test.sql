begin;
select plan(7);

-- Jeu d'essai : la version en vigueur, et une suivante qui change l'heure de clôture dans une heure.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c691',
   '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}'),
  ('00000000-0000-7000-8000-00000000c692',
   '{"clock": {"tickMinutes": 10, "dailyCloseHour": 6, "timezone": "Europe/Athens", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values
  ('00000000-0000-7000-8000-00000000c691', now()),
  ('00000000-0000-7000-8000-00000000c692', now() + interval '1 hour');

select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_table_privilege(r.oid, 'public.clock_rules', 'select') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés lisent l''horloge : liste figée');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
           where table_schema = 'public' and table_name = 'clock_rules'), array['daily_close_hour', 'timezone'],
  'ni la durée des saisons ni rien d''autre de la configuration');

set local role anon;
select throws_ok('select * from public.clock_rules', '42501', null, 'un visiteur anonyme ne lit pas l''horloge');
set local role authenticated;
select is((select count(*) from public.clock_rules), 1::bigint, 'une seule ligne : la version en vigueur');
select is((select (daily_close_hour, timezone)::text from public.clock_rules), '(4,Europe/Paris)',
  'l''heure de clôture et le fuseau en vigueur, pas ceux de la version suivante');
reset role;

-- Fuseau illisible : nul, le client n'annonce alors aucune clôture.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c693',
   '{"clock": {"tickMinutes": 10, "dailyCloseHour": 4, "timezone": "Mars/Olympus", "seasonDays": 7}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c693', now());
set local role authenticated;
select is((select timezone from public.clock_rules), null, 'fuseau inconnu : nul, jamais une valeur inventée');
select is((select daily_close_hour from public.clock_rules), 4, 'l''heure de clôture reste lisible');
reset role;

select * from finish();
rollback;
