begin;
select plan(36);

-- Jeu d'essai : un monde à lui (graine fixée), deux cités, deux maisons ; un site d'Alice à Kallistè. Les
-- événements sont planifiés sous le rôle de service, comme par le moteur ; ceux qui ont déjà commencé sont posés
-- par le propriétaire, garde levée le temps de l'insertion.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c160', '{"clock": {"dailyCloseHour": 4, "timezone": "Europe/Paris", "seasonDays": 7}}');
insert into game.worlds (id, slug, name, seed) values
  ('01900000-0000-7000-8000-0000000160f0', 'evenements', 'Événements', 'graine-fixee-du-banc');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000160e0', 'evenements-2', 'Autre');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000160f1', '01900000-0000-7000-8000-0000000160f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000160f2', '01900000-0000-7000-8000-0000000160f0', 'elaia', 'Elaia');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000160aa', 'evenements-alice@example.test'),
  ('00000000-0000-4000-8000-0000000160ab', 'evenements-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000160a1', '01900000-0000-7000-8000-0000000160f0', '00000000-0000-4000-8000-0000000160aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000160b1', '01900000-0000-7000-8000-0000000160f0', '00000000-0000-4000-8000-0000000160ab', 'Philaïdes', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000160a3', '01900000-0000-7000-8000-0000000160f0', '00000000-0000-7000-8000-0000000160a1', '01900000-0000-7000-8000-0000000160f1', 'grow_wheat');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.svc(statement text) returns text language sql as $$
  select 'select pg_temp.as_service(' || quote_literal(statement) || ')'
$$;
-- Événement `model` planifié au jour 100 dans Kallistè (et Elaia pour une tempête), de `starts` à `ends`.
create function pg_temp.plan(model text, start_day integer, starts timestamptz, ends timestamptz,
  other uuid default null, good text default null, planned integer default 100) returns text language sql as $$
  select format($s$insert into game.world_events (world_id, model, city_id, other_city_id, good_id, planned_day,
      start_day, end_day, starts_at, ends_at, magnitude_bps, seed)
    values ('01900000-0000-7000-8000-0000000160f0', %L, '01900000-0000-7000-8000-0000000160f1', %L, %L, %s, %s, %s,
      %L, %L, 3000, repeat('ab', 32))$s$, model, other, good, planned, start_day, start_day + 2, starts, ends)
$$;
create function pg_temp.yield(event uuid, quantity integer) returns text language sql as $$
  select pg_temp.svc(format($s$insert into game.event_effects (world_id, event_id, kind, site_id, good_id, quantity)
    values ('01900000-0000-7000-8000-0000000160f0', %L, 'site_yield', '00000000-0000-7000-8000-0000000160a3', 'wheat', %s)$s$,
    event, quantity))
$$;

-- Graine du monde : posée à la création, jamais modifiée, jamais lue par un joueur.
select is((select seed from game.worlds where id = '01900000-0000-7000-8000-0000000160f0'), 'graine-fixee-du-banc',
  'une graine donnée à la création est gardée');
select matches((select seed from game.worlds where id = '01900000-0000-7000-8000-0000000160e0'), '^[0-9a-f]{64}$',
  'sinon la base en tire une de 64 chiffres hexadécimaux');
select is((select count(distinct seed) from game.worlds), (select count(*) from game.worlds),
  'chaque monde a la sienne, mondes antérieurs compris');
select throws_ok($$update game.worlds set seed = 'autre-graine-du-monde' where id = '01900000-0000-7000-8000-0000000160f0'$$,
  '23001', 'the seed of a world never changes', 'même le propriétaire ne change pas une graine');
select lives_ok($$update game.worlds set name = 'Événements !' where id = '01900000-0000-7000-8000-0000000160f0'$$,
  'le reste du monde se modifie comme avant');
select throws_ok($$insert into game.worlds (slug, name, seed) values ('trop-courte', 'Courte', 'abc')$$,
  '23514', null, 'une graine trop courte est refusée');

-- Droits, lus dans le catalogue.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('game.world_events'::regclass, 'game.event_effects'::regclass)),
  'règles par ligne actives sur les deux tables');
select is(
  (select string_agg(table_name || '.' || column_name, ' ' order by table_name, column_name)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('world_events', 'event_effects') and grantee = 'oikos_service'
     and privilege_type <> 'SELECT'),
  'event_effects.delay_seconds event_effects.event_id event_effects.good_id event_effects.kind event_effects.quantity '
    || 'event_effects.site_id event_effects.voyage_id event_effects.world_id world_events.city_id world_events.end_day '
    || 'world_events.ends_at world_events.good_id world_events.magnitude_bps world_events.model world_events.other_city_id '
    || 'world_events.planned_day world_events.seed world_events.start_day world_events.starts_at world_events.world_id',
  'le service insère sans dater, et ne modifie rien : liste figée');
select ok(not exists (select 1 from pg_roles r, unnest(array['game.guard_world_seed()', 'game.guard_world_event()', 'game.guard_event_effect()']) f
  where has_function_privilege(r.oid, f::regprocedure, 'execute') and r.rolname in ('anon', 'authenticated', 'oikos_service')),
  'personne n''exécute les gardes');

-- Deux événements déjà commencés, posés par le propriétaire, garde levée ; leur clôture de planification (jour 70)
-- est contrôlée aussitôt, pour que la garde se rétablisse (pas d'ALTER avec un contrôle en attente).
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000160f0', 70, now() - interval '30 days', '00000000-0000-7000-8000-00000000c160');
alter table game.world_events disable trigger world_events_guard;
select lives_ok(pg_temp.plan('drought', 90, now() - interval '1 hour', now() + interval '1 day', null, null, 70), 'sécheresse en cours');
select lives_ok(pg_temp.plan('caravan', 80, now() - interval '3 days', now() - interval '1 day', null, 'wine', 70), 'caravane passée');
set constraints game.world_events_played_close immediate;
alter table game.world_events enable trigger world_events_guard;
set constraints game.world_events_played_close deferred;

-- Planification, sous le rôle de service.
select throws_ok(pg_temp.svc(pg_temp.plan('drought', 100, now() + interval '1 day', now() + interval '2 days')),
  '23514', null, 'un événement commence après le jour qui le planifie');
select lives_ok(pg_temp.svc(pg_temp.plan('drought', 102, now() + interval '1 day', now() + interval '3 days')),
  'la clôture planifie une sécheresse à venir');
select throws_ok(pg_temp.svc(pg_temp.plan('drought', 102, now() + interval '1 day', now() + interval '3 days')),
  '23505', null, 'un seul événement d''un modèle commence un jour donné : rejouer ne planifie rien deux fois');
select throws_ok(pg_temp.svc(pg_temp.plan('good_year', 102, now() - interval '1 minute', now() + interval '3 days')),
  '23001', null, 'un événement n''est jamais planifié une fois commencé');
select throws_ok(pg_temp.svc(pg_temp.plan('storm', 102, now() + interval '1 day', now() + interval '3 days')),
  '23514', null, 'une tempête a une route');
select lives_ok(pg_temp.svc(pg_temp.plan('storm', 102, now() + interval '1 day', now() + interval '3 days',
  '01900000-0000-7000-8000-0000000160f2')), 'une tempête sur la route de Kallistè à Elaia');
select throws_ok(pg_temp.svc(pg_temp.plan('caravan', 102, now() + interval '1 day', now() + interval '3 days')),
  '23514', null, 'une caravane a un bien');
select throws_ok(pg_temp.svc(pg_temp.plan('eclipse', 103, now() + interval '1 day', now() + interval '3 days')),
  '23514', null, 'un modèle hors du catalogue est refusé');
select throws_ok(pg_temp.svc(replace(replace(pg_temp.plan('drought', 103, now() + interval '1 day', now() + interval '3 days'),
  'seed)', 'seed, created_at)'), '32))', '32), now())')), '42501', null, 'le service ne date pas un événement');
select throws_ok(pg_temp.svc($$update game.world_events set magnitude_bps = 0$$), '42501', null,
  'le service ne modifie pas un événement');
select throws_ok($$delete from game.world_events$$, '23001', null, 'personne ne le supprime');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000160f0', 100, now(), '00000000-0000-7000-8000-00000000c160');
select throws_ok(pg_temp.svc(pg_temp.plan('good_year', 103, now() + interval '1 day', now() + interval '3 days')),
  '23001', 'a world event is planned before its close is recorded', 'une clôture enregistrée ne planifie plus rien');

-- Effets : une récolte d'un site de la cité, du signe du modèle.
select lives_ok(pg_temp.yield((select id from game.world_events where start_day = 90), -12),
  'la sécheresse retire 12 blés à une récolte de Kallistè');
select throws_ok(pg_temp.yield((select id from game.world_events where start_day = 90), 12),
  '23001', 'an event effect follows its event', 'une sécheresse n''ajoute rien');
select throws_ok(pg_temp.yield((select id from game.world_events where model = 'storm'), -12),
  '23001', 'an event effect follows its event', 'une tempête ne touche pas une récolte');
select throws_ok(pg_temp.svc(format($s$insert into game.event_effects (world_id, event_id, kind, voyage_id, delay_seconds)
    values ('01900000-0000-7000-8000-0000000160f0', %L, 'voyage_delay', game.uuid_v7(), 60)$s$,
    (select id from game.world_events where model = 'storm'))),
  '23001', 'an event effect follows its event', 'un retard vise un départ de la route pendant la tempête');
select throws_ok(pg_temp.svc($$update game.event_effects set quantity = -1$$), '42501', null,
  'le service ne modifie pas un effet');

-- Lecture des joueurs : les événements commencés, sans graine ; rien des effets.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000160ab", "role": "authenticated"}';
select results_eq(
  $$select model, start_day, good_id from public.world_events where world_id = '01900000-0000-7000-8000-0000000160f0' order by start_day$$,
  $$values ('caravan', 80, 'wine'), ('drought', 90, null)$$,
  'un joueur lit les événements commencés, en cours ou passés, et pas ceux à venir');
select is((select count(*) from game.world_events where start_day >= 100), 0::bigint,
  'ni en lisant la table elle-même');
select throws_ok($$select seed from game.world_events$$, '42501', null, 'la graine d''un événement est illisible');
select throws_ok($$select planned_day from game.world_events$$, '42501', null, 'sa date de planification aussi');
select throws_ok($$select seed from game.worlds$$, '42501', null, 'la graine du monde est illisible');
select throws_ok($$select * from game.event_effects$$, '42501', null, 'les effets ne sont pas lisibles');
select throws_ok($$insert into game.world_events (world_id, model, city_id, planned_day, start_day, end_day, starts_at,
    ends_at, magnitude_bps, seed) values ('01900000-0000-7000-8000-0000000160f0', 'drought',
    '01900000-0000-7000-8000-0000000160f1', 100, 104, 105, now() + interval '1 day', now() + interval '2 days', 0,
    repeat('ab', 32))$$, '42501', null, 'un joueur ne planifie rien');
reset role;
set local role anon;
select throws_ok($$select * from public.world_events$$, '42501', null, 'un visiteur anonyme ne lit rien');
reset role;

select * from finish();
rollback;
