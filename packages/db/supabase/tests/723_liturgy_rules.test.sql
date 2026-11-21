begin;
select plan(7);

-- Règles publiques des liturgies : quatre nombres de la configuration en vigueur, rien de ce qui suivrait la fortune.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000007230c1',
  '{"liturgies": {"housesPerCity": 3, "wealthFloor": 600000, "dueShareBps": 500, "minDue": 6000, "maxDue": 600000,
    "dueDays": 3, "genres": ["festival"], "honorGain": 40, "charisGain": 25, "evasionHonorLoss": 90, "maxSplendorBps": 5000}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000007230c1', now());
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000007230aa', 'liturgy-rules@example.test');

select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'liturgy_rules' and grantee in ('anon', 'authenticated')),
  'liturgy_rules:authenticated:SELECT', 'vue en lecture seule, rien pour un visiteur anonyme');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.liturgy_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction de lecture');

set local role anon;
select throws_ok('select * from public.liturgy_rules', '42501', null, 'anon ne lit pas les règles');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000007230aa", "role": "authenticated"}';
select results_eq('select rules from public.liturgy_rules',
  $$values ('{"honorGain": 40, "charisGain": 25, "evasionHonorLoss": 90, "maxSplendorBps": 5000}'::jsonb)$$,
  'quatre nombres : gains, perte, borne du faste');
select is((select count(*) from public.liturgy_rules where rules ? 'wealthFloor' or rules ? 'dueShareBps' or rules ? 'housesPerCity'),
  0::bigint, 'ni plancher, ni part due, ni nombre de maisons désignées');
select is((select has_table_privilege('authenticated', 'public.liturgy_rules', 'insert, update, delete')), false,
  'pas d''écriture par la vue');

reset role;
-- Version publiée avant #720 : pas de borne du faste, aucun faste (zéro) ; sans section, aucune ligne.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000007230c2', '{"liturgies": {"honorGain": 1, "charisGain": 2, "evasionHonorLoss": 3}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000007230c2', now());
select is((select rules ->> 'maxSplendorBps' from game.liturgy_rules()), '0', 'sans borne publiée : aucun faste');

select * from finish();
rollback;
