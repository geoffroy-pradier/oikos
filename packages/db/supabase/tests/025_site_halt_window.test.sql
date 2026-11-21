begin;
select plan(8);

-- Jeu d'essai : la maison d'Alice et son champ. Le cycle du champ est avancé à l'heure réelle, donc
-- après le début de cette transaction, comme le laisse une récolte validée pendant une clôture.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'alice@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Alcméonides', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000002a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat');
alter table game.sites disable trigger sites_guard;
update game.sites set cycle_started_at = clock_timestamp() where world_id = '01900000-0000-7000-8000-000000000001';
alter table game.sites enable trigger sites_guard;
select ok((select cycle_started_at > now() from game.sites where world_id = '01900000-0000-7000-8000-000000000001'), 'le cycle du site est postérieur au début de la transaction');

-- Les règles valent pour le service, qui est celui qui arrête les sites : chaque instruction ci-dessous
-- est exécutée sous son rôle.
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;

-- Un arrêt est daté dans la transaction qui l'écrit : ni avant son début, ni après l'heure réelle.
select throws_ok($$select pg_temp.as_service($s$update game.sites set halted_at = now() - interval '1 microsecond' where world_id = '01900000-0000-7000-8000-000000000001'$s$)$$, '23001', 'a site halts now', 'pas d''arrêt avant le début de la transaction');
select throws_ok($$select pg_temp.as_service($s$update game.sites set halted_at = clock_timestamp() + interval '1 minute' where world_id = '01900000-0000-7000-8000-000000000001'$s$)$$, '23001', 'a site halts now', 'pas d''arrêt dans le futur');
select throws_like($$select pg_temp.as_service($s$update game.sites set halted_at = now() where world_id = '01900000-0000-7000-8000-000000000001'$s$)$$, '%"sites_cycle_not_after_halt"%', 'un arrêt au début de la transaction précéderait le cycle : refusé');
select lives_ok($$select pg_temp.as_service($s$update game.sites set halted_at = greatest(now(), cycle_started_at) where world_id = '01900000-0000-7000-8000-000000000001'$s$)$$, 'l''arrêt daté du début du cycle est admis, sans toucher au cycle');
select ok((select halted_at = cycle_started_at and halted_at > now() from game.sites where world_id = '01900000-0000-7000-8000-000000000001'), 'le site est à l''arrêt depuis le début de son cycle');
-- La règle du cycle tient toujours pour une écriture qui le change.
select throws_ok($$select pg_temp.as_service($s$update game.sites set halted_at = null, cycle_started_at = clock_timestamp() + interval '1 minute' where world_id = '01900000-0000-7000-8000-000000000001'$s$)$$, '23001',
  'a site cycle only moves forward, up to now', 'un cycle ne part toujours pas dans le futur');
-- Borne haute : l'heure réelle elle-même est admise (second champ, en marche).
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000002a2', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat');
select lives_ok($$select pg_temp.as_service($s$update game.sites set halted_at = clock_timestamp() where id = '00000000-0000-7000-8000-0000000002a2'$s$)$$,
  'un arrêt à l''heure réelle est admis');

select * from finish();
rollback;
