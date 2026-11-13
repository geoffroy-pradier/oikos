begin;
select plan(15);

select has_schema('game');
select has_schema('config');
select has_schema('telemetry');
select has_schema('admin');

-- Les rôles clients n'ont aucun accès aux schémas internes.
select ok(not has_schema_privilege(r, s, 'usage'), format('%s : pas d''usage sur %s', r, s))
from unnest(array['anon', 'authenticated']) as r,
     unnest(array['game', 'config', 'telemetry', 'admin']) as s;

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

select * from finish();
rollback;
