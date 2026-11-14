begin;
select plan(38);

-- Jeu d'essai : une version de configuration, un second monde, la maison d'Alice et son champ, vieilli
-- d'un jour (garde levée le temps de le poser) pour que « maintenant » diffère du début de son cycle.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000000c1', '{}');
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-000000000002', 'autre', 'Autre');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'alice@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000002a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat');
alter table game.sites disable trigger sites_guard;
update game.sites set created_at = now() - interval '1 day', cycle_started_at = now() - interval '1 day';
alter table game.sites enable trigger sites_guard;
create function pg_temp.close(day integer, world uuid default '01900000-0000-7000-8000-000000000001',
  close_at timestamptz default '2026-11-14 03:00+00', version uuid default '00000000-0000-7000-8000-0000000000c1', summary jsonb default '{}'
) returns void language sql as $$
  insert into game.daily_closes (world_id, game_day, close_at, config_version_id, summary) values (world, day, close_at, version, summary)
$$;
create function pg_temp.as_service(statement text) returns text language plpgsql as $$
declare
  seen text;
begin
  perform set_config('role', 'oikos_service', true);
  seen := current_user;
  execute statement;
  perform set_config('role', 'none', true);
  return seen;
end $$;

-- Une clôture par monde et par jour de jeu.
select lives_ok($$select pg_temp.close(20771)$$, 'une clôture jouée est enregistrée');
select throws_ok($$select pg_temp.close(20771, close_at => '2026-11-14 05:00+00')$$, '23505', null, 'une clôture ne se joue qu''une fois par jour de jeu');
select lives_ok($$select pg_temp.close(20772)$$, 'le jour suivant a la sienne');
select lives_ok($$select pg_temp.close(20771, world => '01900000-0000-7000-8000-000000000002')$$, 'le même jour dans un autre monde est une autre clôture');
select throws_ok($$select pg_temp.close(-1)$$, '23514', null, 'jour de jeu négatif refusé');
select throws_ok($$select pg_temp.close(20773, close_at => clock_timestamp() + interval '1 minute')$$, '23514', null, 'une clôture ne se joue pas avant son heure');
select throws_ok($$select pg_temp.close(20773, summary => '[]')$$, '23514', null, 'le résumé est un objet');
select throws_ok($$select pg_temp.close(20773, version => game.uuid_v7())$$, '23503', null, 'version de configuration inconnue refusée');
select throws_ok($$select pg_temp.close(20773, world => game.uuid_v7())$$, '23503', null, 'monde inconnu refusé');
-- Une clôture jouée ne se réécrit pas.
select throws_ok($$update game.daily_closes set summary = '{"x": 1}'$$, '23001', 'game.daily_closes is append-only', 'clôture non modifiable');
select throws_ok($$delete from game.daily_closes$$, '23001', null, 'clôture non supprimable');
select throws_ok($$truncate game.daily_closes$$, '23001', null, 'table des clôtures non vidable');

-- Accès : le service lit et insère, rien d'autre ; les clients n'ont rien.
select ok((select relrowsecurity from pg_class where oid = 'game.daily_closes'::regclass), 'règles par ligne actives sur game.daily_closes');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type) from information_schema.role_table_grants
   where table_schema = 'game' and table_name = 'daily_closes' and grantee in ('anon', 'authenticated', 'oikos_service')),
  'oikos_service:INSERT oikos_service:SELECT', 'droits sur les clôtures : liste figée');
select is(
  (select string_agg(policyname || ':' || cmd || ':' || roles::text, ' ' order by policyname) from pg_policies
   where schemaname = 'game' and tablename = 'daily_closes'),
  'service_all:ALL:{oikos_service}', 'règles par ligne des clôtures : liste figée');
select lives_ok($$select pg_temp.as_service($s$insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-000000000001', 20774, now(), '00000000-0000-7000-8000-0000000000c1')$s$)$$, 'le service enregistre une clôture');
select throws_ok($$select pg_temp.as_service($s$update game.daily_closes set close_at = now()$s$)$$, '42501', null, 'le service ne modifie pas une clôture');
set local role authenticated;
select throws_ok('select * from game.daily_closes', '42501', null, 'un joueur ne lit pas les clôtures');
reset role;

-- L'entretien d'une maison n'est prélevé qu'une fois par jour de jeu.
create function pg_temp.upkeep(meta jsonb, kind text default 'upkeep.daily') returns void language sql as $$
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', kind, meta)
$$;
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20771}')$$, 'écriture d''entretien acceptée');
select throws_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20771, "sites": []}')$$,
  '23505', null, 'pas de second entretien pour la même maison le même jour de jeu');
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20772}')$$, 'le jour suivant, si');
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000b1", "gameDay": 20771}')$$, 'une autre maison le même jour, si');
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20771}', 'site.acquire')$$,
  'une écriture d''une autre nature n''est pas concernée');
select throws_ok(format($$select pg_temp.upkeep('%s')$$, meta), '23514', null, format('entretien sans maison ni jour de jeu refusé : %s', meta))
from unnest(array['{}', '{"gameDay": 20773}', '{"houseId": "00000000-0000-7000-8000-0000000000a1"}', '{"houseId": 1, "gameDay": "20773"}']) as meta;

-- Arrêt d'un site : il naît en marche, s'arrête maintenant, et l'instant de l'arrêt ne change pas.
select throws_ok($$insert into game.sites (world_id, house_id, city_id, recipe_id, halted_at) values ('01900000-0000-7000-8000-000000000001',
  '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat', now())$$, '23001', 'a site starts now', 'un site naît en marche');
select throws_ok($$update game.sites set halted_at = now() - interval '1 second'$$, '23001', 'a site halts now', 'un arrêt n''est pas antidaté');
select lives_ok($$select pg_temp.as_service('update game.sites set halted_at = now()')$$, 'le service arrête un site maintenant');
select throws_ok($$update game.sites set halted_at = now() - interval '1 hour'$$, '23001', 'a halt keeps its instant', 'l''instant d''un arrêt ne change pas');
-- Deux heures passent à l'arrêt (garde levée pour antidater l'arrêt).
alter table game.sites disable trigger sites_guard;
update game.sites set halted_at = now() - interval '2 hours';
alter table game.sites enable trigger sites_guard;
select throws_ok($$update game.sites set cycle_started_at = now() - interval '1 hour'$$, '23514', null, 'à l''arrêt, le cycle ne dépasse pas l''instant de l''arrêt');
select throws_ok($$update game.sites set recipe_id = 'grow_olives', cycle_started_at = now()$$, '23514', null, 'un site à l''arrêt ne change pas de recette');
select lives_ok($$update game.sites set cycle_started_at = now() - interval '3 hours'$$, 'une récolte avance le cycle jusqu''avant l''arrêt');
-- Reprise : le cycle avance exactement de la durée de l'arrêt, ni plus ni moins.
select throws_ok($$update game.sites set halted_at = null$$, '23001', 'a site resumes with its cycle shifted by the halt', 'pas de reprise qui récolterait le temps de l''arrêt');
select throws_ok($$update game.sites set halted_at = null, cycle_started_at = now()$$, '23001', null, 'ni de reprise qui efface le cycle entamé');
select lives_ok($$select pg_temp.as_service('update game.sites set halted_at = null, cycle_started_at = cycle_started_at + (now() - halted_at)')$$,
  'le service relance un site en décalant son cycle de la durée de l''arrêt');
select is((select cycle_started_at from game.sites where id = '00000000-0000-7000-8000-0000000002a1'), now() - interval '1 hour',
  'trois heures de cycle avant la reprise, dont deux à l''arrêt : une heure comptée');

select * from finish();
rollback;
