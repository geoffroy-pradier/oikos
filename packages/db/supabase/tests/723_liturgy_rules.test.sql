begin;
select plan(9);

-- Règles publiques des liturgies : quatre nombres de la configuration en vigueur, rien de ce qui suivrait la fortune.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000007230c1',
  '{"liturgies": {"housesPerCity": 3, "wealthFloor": 600000, "dueShareBps": 500, "minDue": 6000, "maxDue": 600000,
    "dueDays": 3, "genres": ["festival"], "honorGain": 40, "charisGain": 25, "evasionHonorLoss": 90, "maxSplendorBps": 5000}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000007230c1', now());
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000007230aa', 'liturgy-rules@example.test');

-- Droits figés, alignés sur `good_tiers` (#873) : ni les visiteurs, ni l'API, ni le rôle de service, même par héritage.
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_table_privilege(r.oid, 'public.liturgy_rules', 'select, insert, update, delete, truncate, references, trigger')
     and not r.rolsuper and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'vue lue par les seuls joueurs connectés : rien pour anon, oikos_service ni service_role');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.liturgy_rules()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'seuls les joueurs connectés exécutent la fonction : rien pour anon, oikos_service ni service_role');

set local role anon;
select throws_ok('select * from public.liturgy_rules', '42501', null, 'anon ne lit pas les règles');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000007230aa", "role": "authenticated"}';
-- Égalité exacte de l'objet : ni plancher, ni part due, ni nombre de maisons désignées n'en sortent.
select results_eq('select rules from public.liturgy_rules',
  $$values ('{"honorGain": 40, "charisGain": 25, "evasionHonorLoss": 90, "maxSplendorBps": 5000}'::jsonb)$$,
  'quatre nombres : gains, perte, borne du faste');
select is((select has_table_privilege('authenticated', 'public.liturgy_rules', 'insert, update, delete')), false,
  'pas d''écriture par la vue');

reset role;
-- Version suivante, activée dans une heure : elle ne prend pas effet avant son heure.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000007230c3',
  '{"liturgies": {"honorGain": 7, "charisGain": 8, "evasionHonorLoss": 9, "maxSplendorBps": 100}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000007230c3', now() + interval '1 hour');
set local role authenticated;
select results_eq('select rules from public.liturgy_rules',
  $$values ('{"honorGain": 40, "charisGain": 25, "evasionHonorLoss": 90, "maxSplendorBps": 5000}'::jsonb)$$,
  'une activation future est ignorée');

reset role;
-- Version publiée avant #720 : pas de borne du faste, aucun faste (zéro).
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000007230c2', '{"liturgies": {"honorGain": 1, "charisGain": 2, "evasionHonorLoss": 3}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000007230c2', now());
set local role authenticated;
select is((select rules ->> 'maxSplendorBps' from public.liturgy_rules), '0', 'sans borne publiée : aucun faste');

reset role;
-- Version en vigueur sans section `liturgies` : aucune ligne, plutôt que quatre nombres nuls.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000007230c4', '{"decrees": {}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000007230c4', now());
set local role authenticated;
select is((select count(*) from public.liturgy_rules), 0::bigint, 'sans section, aucune ligne');

reset role;
-- Section présente mais à JSON `null` : ce n'est pas un objet, aucune ligne (même garde que `decree_rules`).
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000007230c5', '{"liturgies": null}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-0000007230c5', now());
set local role authenticated;
select is((select count(*) from public.liturgy_rules), 0::bigint, 'section à JSON null, aucune ligne');

select * from finish();
rollback;
