begin;
select plan(52);

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
select throws_like($$select pg_temp.close(20771, close_at => '2026-11-14 05:00+00')$$, '%"daily_closes_pkey"%', 'une clôture ne se joue qu''une fois par jour de jeu');
select lives_ok($$select pg_temp.close(20772)$$, 'le jour suivant a la sienne');
select lives_ok($$select pg_temp.close(20771, world => '01900000-0000-7000-8000-000000000002')$$, 'le même jour dans un autre monde est une autre clôture');
select throws_like($$select pg_temp.close(-1)$$, '%"daily_closes_game_day_check"%', 'jour de jeu négatif refusé');
select throws_like($$select pg_temp.close(20773, close_at => clock_timestamp() + interval '1 minute')$$, '%"daily_closes_not_early"%', 'une clôture ne se joue pas avant son heure');
select throws_like($$select pg_temp.close(20773, summary => '[]')$$, '%"daily_closes_summary_check"%', 'le résumé est un objet');
select throws_like($$select pg_temp.close(20773, version => game.uuid_v7())$$, '%"daily_closes_config_version_id_fkey"%', 'version de configuration inconnue refusée');
select throws_like($$select pg_temp.close(20773, world => game.uuid_v7())$$, '%"daily_closes_world_id_fkey"%', 'monde inconnu refusé');
-- Une clôture jouée ne se réécrit pas.
select throws_ok($$update game.daily_closes set summary = '{"x": 1}'$$, '23001', 'game.daily_closes is append-only', 'clôture non modifiable');
select throws_ok($$delete from game.daily_closes$$, '23001', 'game.daily_closes is append-only', 'clôture non supprimable');
-- La population des PNJ référence les clôtures (migration 34) : sans `cascade`, Postgres refuse avant la garde.
select throws_ok($$truncate game.daily_closes$$, '0A000', null, 'table des clôtures non vidable');
select throws_ok($$truncate game.daily_closes cascade$$, '23001', 'game.daily_closes is append-only', 'table des clôtures non vidable, même en cascade');

-- Accès : le service lit et insère, sans dater lui-même la clôture ; les clients n'ont rien.
select ok((select relrowsecurity from pg_class where oid = 'game.daily_closes'::regclass), 'règles par ligne actives sur game.daily_closes');
select is(
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type) from information_schema.table_privileges
   where table_schema = 'game' and table_name = 'daily_closes' and grantee in ('anon', 'authenticated', 'oikos_service')),
  'oikos_service:SELECT', 'droits sur toute la table des clôtures : liste figée, lecture seule');
select is(
  (select string_agg(column_name || ':' || privilege_type, ' ' order by column_name) from information_schema.column_privileges
   where table_schema = 'game' and table_name = 'daily_closes' and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'close_at:INSERT config_version_id:INSERT game_day:INSERT summary:INSERT world_id:INSERT', 'colonnes que le service insère : liste figée, sans finished_at');
select is(
  (select string_agg(policyname || ':' || cmd || ':' || roles::text, ' ' order by policyname) from pg_policies
   where schemaname = 'game' and tablename = 'daily_closes'),
  'service_all:ALL:{oikos_service}', 'règles par ligne des clôtures : liste figée');
select lives_ok($$select pg_temp.as_service($s$insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-000000000001', 20774, now(), '00000000-0000-7000-8000-0000000000c1')$s$)$$, 'le service enregistre une clôture');
select throws_ok($$select pg_temp.as_service($s$insert into game.daily_closes (world_id, game_day, close_at, config_version_id, finished_at)
  values ('01900000-0000-7000-8000-000000000001', 20775, now() + interval '1 day', '00000000-0000-7000-8000-0000000000c1', now() + interval '2 days')$s$)$$,
  '42501', 'permission denied for table daily_closes', 'le service ne date pas une clôture : pas de clôture future sous un faux horodatage');
select throws_like($$select pg_temp.as_service($s$insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-000000000001', 20775, now() + interval '1 day', '00000000-0000-7000-8000-0000000000c1')$s$)$$,
  '%"daily_closes_not_early"%', 'et sans horodatage, la base refuse sa clôture future');
select throws_ok($$select pg_temp.as_service($s$update game.daily_closes set close_at = now()$s$)$$, '42501', 'permission denied for table daily_closes', 'le service ne modifie pas une clôture');
set local role authenticated;
select throws_ok('select * from game.daily_closes', '42501', 'permission denied for table daily_closes', 'un joueur ne lit pas les clôtures');
reset role;

-- L'entretien d'une maison n'est prélevé qu'une fois par jour de jeu.
create function pg_temp.upkeep(meta jsonb, kind text default 'upkeep.daily') returns void language sql as $$
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', kind, meta)
$$;
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20771}')$$, 'écriture d''entretien acceptée');
select throws_like($$select pg_temp.upkeep('{"gameDay": 20771, "sites": [], "houseId": "00000000-0000-7000-8000-0000000000a1"}')$$,
  '%"ledger_entries_upkeep_once"%', 'pas de second entretien pour la même maison le même jour de jeu');
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20772}')$$, 'le jour suivant, si');
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000b1", "gameDay": 20771}')$$, 'une autre maison le même jour, si');
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20771}', 'site.acquire')$$,
  'une écriture d''une autre nature n''est pas concernée');
-- Une seule écriture admise de la maison et du jour : sinon la même clé s'écrirait de deux façons.
select throws_like(format($$select pg_temp.upkeep('%s')$$, meta), '%"ledger_entries_upkeep_meta"%', format('entretien mal identifié refusé : %s', meta))
from unnest(array['{}', '{"gameDay": 20773}', '{"houseId": "00000000-0000-7000-8000-0000000000a1"}', '{"houseId": 1, "gameDay": "20773"}',
  '{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20771.0}', '{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20771.5}',
  '{"houseId": "00000000-0000-7000-8000-0000000000A1", "gameDay": 20771}', '{"houseId": "{00000000-0000-7000-8000-0000000000a1}", "gameDay": 20771}',
  '{"houseId": "000000000000700080000000000000a1", "gameDay": 20771}', '{"houseId": "maison", "gameDay": 20773}',
  '{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": -1}', '{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 12345678901}']) as meta;
select lives_ok($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 2.0773e4}')$$, 'un jour entier écrit autrement est le même nombre');
select throws_like($$select pg_temp.upkeep('{"houseId": "00000000-0000-7000-8000-0000000000a1", "gameDay": 20773}')$$, '%"ledger_entries_upkeep_once"%', 'donc la même clé');

-- Arrêt d'un site : il naît en marche, s'arrête maintenant, et l'instant de l'arrêt ne change pas. Les
-- refus valent pour le service comme pour le propriétaire. Fuseau de session à changement d'heure :
-- la durée d'un arrêt ne doit pas en dépendre.
set local timezone = 'Europe/Paris';
select throws_ok($$insert into game.sites (world_id, house_id, city_id, recipe_id, halted_at) values ('01900000-0000-7000-8000-000000000001',
  '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat', now())$$, '23001', 'a site starts now', 'un site naît en marche');
select throws_ok($$select pg_temp.as_service($s$update game.sites set halted_at = now() - interval '1 second'$s$)$$, '23001', 'a site halts now', 'un arrêt n''est pas antidaté');
select lives_ok($$select pg_temp.as_service('update game.sites set halted_at = now()')$$, 'le service arrête un site maintenant');
select throws_ok($$select pg_temp.as_service($s$update game.sites set halted_at = now() - interval '1 hour'$s$)$$, '23001', 'a halt keeps its instant', 'l''instant d''un arrêt ne change pas');
-- 200 jours passent à l'arrêt, changement d'heure compris (garde levée pour antidater l'arrêt et le cycle).
alter table game.sites disable trigger sites_guard;
update game.sites set halted_at = now() - interval '4800 hours', created_at = now() - interval '9000 hours', cycle_started_at = now() - interval '9000 hours';
alter table game.sites enable trigger sites_guard;
select throws_like($$select pg_temp.as_service($s$update game.sites set cycle_started_at = now() - interval '1 hour'$s$)$$, '%"sites_cycle_not_after_halt"%', 'à l''arrêt, le cycle ne dépasse pas l''instant de l''arrêt');
select throws_like($$select pg_temp.as_service($s$update game.sites set recipe_id = 'grow_olives', cycle_started_at = now()$s$)$$, '%"sites_cycle_not_after_halt"%', 'un site à l''arrêt ne change pas de recette');
select lives_ok($$update game.sites set cycle_started_at = now() - interval '4801 hours'$$, 'une récolte avance le cycle jusqu''avant l''arrêt');
-- Reprise : le cycle avance exactement de la durée de l'arrêt, ni plus ni moins.
select throws_ok($$select pg_temp.as_service('update game.sites set halted_at = null')$$, '23001', 'a site resumes with its cycle shifted by the halt', 'pas de reprise qui récolterait le temps de l''arrêt');
select throws_ok($$select pg_temp.as_service('update game.sites set halted_at = null, cycle_started_at = now()')$$, '23001', 'a site resumes with its cycle shifted by the halt', 'ni de reprise qui efface le cycle entamé');
select lives_ok($$select pg_temp.as_service($s$update game.sites set halted_at = null,
  cycle_started_at = cycle_started_at + extract(epoch from now() - halted_at) * interval '1 second'$s$)$$,
  'le service relance un site en décalant son cycle de la durée de l''arrêt');
select is((select extract(epoch from now() - cycle_started_at) from game.sites where id = '00000000-0000-7000-8000-0000000002a1'), 3600::numeric,
  '4 801 heures de cycle avant la reprise, dont 4 800 à l''arrêt : une heure comptée, à la seconde, quel que soit le fuseau');

select * from finish();
rollback;
