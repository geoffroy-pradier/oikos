begin;
select plan(12);

-- Jeu d'essai : Alice, métèque de Kallistè, a écrit cinq messages dans le canal de sa cité, il y a 40, 31, 29
-- et 2 jours et maintenant. La garde est levée le temps de les antidater.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000072aa', 'purge-alice@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000072a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000072aa', 'Alcméonides', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000072a1', '01900000-0000-7000-8000-000000000101');
alter table game.messages disable trigger messages_guard;
insert into game.messages (channel_id, house_id, body, created_at)
select c.id, '00000000-0000-7000-8000-0000000072a1', format('Il y a %s jours', age), now() - make_interval(days => age)
from game.channels c, unnest(array[40, 31, 29, 2, 0]) age
where c.city_id = '01900000-0000-7000-8000-000000000101';
alter table game.messages enable trigger messages_guard;

-- Appel sous le rôle de service ; les assertions restent au propriétaire.
create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('role', 'oikos_service', true);
  execute statement into result;
  perform set_config('role', 'none', true);
  return result;
end $$;
create function pg_temp.remaining() returns text language sql as $$
  select string_agg(body, ', ' order by created_at) from game.messages where house_id = '00000000-0000-7000-8000-0000000072a1'
$$;

select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.purge_messages(timestamptz)', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'oikos_service', 'seul le service lance la purge des messages : liste figée');
select ok((select prosecdef from pg_proc where oid = 'game.purge_messages(timestamptz)'::regprocedure),
  'elle s''exécute au nom du propriétaire, seul à pouvoir supprimer');
select throws_ok($$select pg_temp.as_service($s$select game.purge_messages(now() - interval '23 hours')$s$)$$,
  '23514', 'messages younger than one day cannot be purged', 'jamais un message de moins d''un jour');
select throws_ok($$select pg_temp.as_service($s$select game.purge_messages(null)$s$)$$,
  '23514', null, 'ni sans borne');
select is(pg_temp.remaining(), 'Il y a 40 jours, Il y a 31 jours, Il y a 29 jours, Il y a 2 jours, Il y a 0 jours',
  'un refus ne supprime rien');

select cmp_ok(pg_temp.as_service($$select game.purge_messages(now() - interval '30 days')$$)::bigint, '>=', 2::bigint,
  'le service purge au-delà de 30 jours, et compte ce qu''il supprime');
select is(pg_temp.remaining(), 'Il y a 29 jours, Il y a 2 jours, Il y a 0 jours',
  'les messages plus anciens que la conservation sont supprimés, et eux seuls');
select is(current_setting('oikos.message_purge', true), 'off', 'la garde se referme après la purge');
select is(pg_temp.as_service($$select game.purge_messages(now() - interval '30 days')$$)::bigint, 0::bigint,
  'une seconde purge ne trouve plus rien');

-- La purge n'ouvre aucune autre suppression.
select throws_ok($$select pg_temp.as_service($s$delete from game.messages$s$)$$, '42501', null,
  'le service ne supprime toujours rien en direct');
select throws_ok($$delete from game.messages where house_id = '00000000-0000-7000-8000-0000000072a1'$$, '23001',
  'a message is only removed by the retention purge', 'ni le propriétaire hors de la purge');
select is(pg_temp.remaining(), 'Il y a 29 jours, Il y a 2 jours, Il y a 0 jours', 'les messages récents restent');

select * from finish();
rollback;
