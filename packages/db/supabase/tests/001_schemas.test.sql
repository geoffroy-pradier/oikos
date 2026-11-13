begin;
select plan(28);

select has_schema('game');
select has_schema('config');
select has_schema('telemetry');
select has_schema('admin');

-- `anon` n'a accès à aucun schéma interne ; `authenticated` ne lit que `game`, à travers les vues de `public`.
select ok(not has_schema_privilege('anon', s, 'usage'), format('anon : pas d''usage sur %s', s))
from unnest(array['game', 'config', 'telemetry', 'admin']) as s;
select ok(not has_schema_privilege('authenticated', s, 'usage'), format('authenticated : pas d''usage sur %s', s))
from unnest(array['config', 'telemetry', 'admin']) as s;

-- `public` est réservé aux vues : aucune table, et les clients ne peuvent rien y créer.
select is(
  (select count(*) from pg_tables where schemaname = 'public'),
  0::bigint,
  'public ne contient aucune table'
);
select ok(not has_schema_privilege('anon', 'public', 'create'), 'anon ne crée rien dans public');
select ok(
  not has_schema_privilege('authenticated', 'public', 'create'),
  'authenticated ne crée rien dans public'
);

-- Aucun rôle client ne crée quoi que ce soit dans un schéma interne.
select ok(not has_schema_privilege(r, s, 'create'), format('%s : pas de création dans %s', r, s))
from unnest(array['anon', 'authenticated']) as r,
     unnest(array['game', 'config', 'telemetry', 'admin']) as s;

-- Privilèges par défaut : un objet ajouté dans `public` n'est accessible à aucun rôle client
-- tant qu'une migration ne l'accorde pas explicitement.
create view public.probe_view as select 1 as x;
create function public.probe_fn() returns int language sql as 'select 1';
create sequence public.probe_seq;
select ok(not has_table_privilege(r, 'public.probe_view', 'select'), format('%s : vue non lisible par défaut', r))
from unnest(array['anon', 'authenticated']) as r;
select ok(
  not has_function_privilege(r, 'public.probe_fn()', 'execute'),
  format('%s : fonction non exécutable par défaut', r)
)
from unnest(array['anon', 'authenticated']) as r;
select ok(
  not has_sequence_privilege(r, 'public.probe_seq', 'usage'),
  format('%s : séquence non utilisable par défaut', r)
)
from unnest(array['anon', 'authenticated']) as r;

select * from finish();
rollback;
