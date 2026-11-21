begin;
select plan(14);

-- Jeu d'essai : un monde et Kallistè ; Alice y a une maison et un champ ; la maison PNJ « Greniers » y a un champ,
-- fondée par le service comme la clôture le fait.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000716f1', 'files-pnj', 'Files PNJ');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000716c1', '01900000-0000-7000-8000-0000000716f1', 'kalliste', 'Kallistè');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000716aa', 'files-a@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000716a1', '01900000-0000-7000-8000-0000000716f1', '00000000-0000-4000-8000-0000000716aa', 'Alcméonides', '{}');
insert into game.houses (id, world_id, user_id, name, blazon, kind) values
  ('00000000-0000-7000-8000-0000000716e1', '01900000-0000-7000-8000-0000000716f1', null, 'Greniers', '{}', 'npc');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000716b1', '01900000-0000-7000-8000-0000000716f1', '00000000-0000-7000-8000-0000000716a1',
   '01900000-0000-7000-8000-0000000716c1', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000716b9', '01900000-0000-7000-8000-0000000716f1', '00000000-0000-7000-8000-0000000716e1',
   '01900000-0000-7000-8000-0000000716c1', 'grow_wheat');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.as_player(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000716aa", "role": "authenticated"}', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
grant execute on function pg_temp.as_player(text) to authenticated;
-- La file d'un site, comme le moteur l'écrit : tick, rang, position, refus.
create function pg_temp.queue(site text, house text, tick int, rank int) returns text language sql as $$
  select format($s$insert into game.npc_site_queues (site_id, world_id, house_id, config_version_id, tick_index, rank,
      rule_position, error_code, refused)
    values (%L, '01900000-0000-7000-8000-0000000716f1', %L, '01900000-0000-7000-8000-0000000716d1', %s, %s, 0, null, '{}')
    on conflict (site_id) do update set tick_index = excluded.tick_index, rank = excluded.rank,
      rule_position = excluded.rule_position, error_code = excluded.error_code, refused = excluded.refused$s$,
    site, house, tick, rank);
$$;
grant execute on function pg_temp.queue(text, text, int, int) to authenticated, oikos_service;

-- Le service tient la file d'un site d'une maison PNJ, opération après opération.
select lives_ok($$select pg_temp.as_service(pg_temp.queue('00000000-0000-7000-8000-0000000716b9',
  '00000000-0000-7000-8000-0000000716e1', 40, 0))$$, 'le service inscrit la première opération d''un site PNJ');
select lives_ok($$select pg_temp.as_service(pg_temp.queue('00000000-0000-7000-8000-0000000716b9',
  '00000000-0000-7000-8000-0000000716e1', 40, 1))$$, 'puis le rang suivant du même tick');
select lives_ok($$select pg_temp.as_service(pg_temp.queue('00000000-0000-7000-8000-0000000716b9',
  '00000000-0000-7000-8000-0000000716e1', 41, 0))$$, 'puis le premier rang du tick suivant');
select throws_ok($$select pg_temp.as_service(pg_temp.queue('00000000-0000-7000-8000-0000000716b9',
  '00000000-0000-7000-8000-0000000716e1', 41, 0))$$, '23001', 'an NPC site operation follows the previous one',
  'un rang déjà mené ne se mène pas deux fois');
select throws_ok($$select pg_temp.as_service(pg_temp.queue('00000000-0000-7000-8000-0000000716b9',
  '00000000-0000-7000-8000-0000000716e1', 40, 5))$$, '23001', 'an NPC site operation follows the previous one',
  'ni un tick passé');
select throws_ok($$select pg_temp.as_service(pg_temp.queue('00000000-0000-7000-8000-0000000716b1',
  '00000000-0000-7000-8000-0000000716a1', 40, 0))$$, '23503', null, 'pas de file pour le site d''une maison de joueur');
select throws_ok($$select pg_temp.as_service(pg_temp.queue('00000000-0000-7000-8000-0000000716b1',
  '00000000-0000-7000-8000-0000000716e1', 40, 0))$$, '23503', null, 'ni pour le site d''une autre maison que la sienne');
select throws_ok($$select pg_temp.as_service($s$update game.npc_site_queues set house_id = '00000000-0000-7000-8000-0000000716a1'$s$)$$,
  '42501', null, 'le service ne change pas le site ni la maison d''une file');
select throws_ok($$select pg_temp.as_service($s$delete from game.npc_site_queues$s$)$$, '42501', null,
  'ni n''en efface aucune');
set local role oikos_service;
select set_config('t.q', (select tick_index || '/' || rank from game.npc_site_queues
  where site_id = '00000000-0000-7000-8000-0000000716b9'), true);
reset role;
select is(current_setting('t.q'), '41/0', 'le service lit la dernière opération du site');

-- Un joueur ne lit ni n'écrit la file d'aucun site, ni celle de la maison PNJ, ni une pour son propre site.
select throws_ok($$select pg_temp.as_player($s$select count(*) from game.npc_site_queues$s$)$$, '42501', null,
  'un joueur ne lit pas la file des sites PNJ');
select throws_ok($$select pg_temp.as_player(pg_temp.queue('00000000-0000-7000-8000-0000000716b9',
  '00000000-0000-7000-8000-0000000716e1', 99, 0))$$, '42501', null, 'ni ne fait avancer celle d''une maison PNJ');
select throws_ok($$select pg_temp.as_player(pg_temp.queue('00000000-0000-7000-8000-0000000716b1',
  '00000000-0000-7000-8000-0000000716a1', 1, 0))$$, '42501', null, 'ni n''en ouvre une pour son propre site');
set local role anon;
select throws_ok('select count(*) from game.npc_site_queues', '42501', null, 'un visiteur anonyme ne la lit pas');
reset role;

select * from finish();
rollback;
