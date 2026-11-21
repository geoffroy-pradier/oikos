begin;
select plan(32);

-- Jeu d'essai : un monde et Kallistè ; Alice y a une maison et un champ ; la maison PNJ « Greniers » y a deux champs,
-- sa trésorerie et un stock de blé, fondée par le service comme la clôture le fait.
insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000000717f1', 'retrait-pnj', 'Retrait PNJ');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000717c1', '01900000-0000-7000-8000-0000000717f1', 'kalliste', 'Kallistè');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000717aa', 'retrait-a@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000717a1', '01900000-0000-7000-8000-0000000717f1', '00000000-0000-4000-8000-0000000717aa', 'Alcméonides', '{}');
insert into game.houses (id, world_id, user_id, name, blazon, kind) values
  ('00000000-0000-7000-8000-0000000717e1', '01900000-0000-7000-8000-0000000717f1', null, 'Greniers', '{}', 'npc');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000717b1', '01900000-0000-7000-8000-0000000717f1', '00000000-0000-7000-8000-0000000717a1',
   '01900000-0000-7000-8000-0000000717c1', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000717b8', '01900000-0000-7000-8000-0000000717f1', '00000000-0000-7000-8000-0000000717e1',
   '01900000-0000-7000-8000-0000000717c1', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000717b9', '01900000-0000-7000-8000-0000000717f1', '00000000-0000-7000-8000-0000000717e1',
   '01900000-0000-7000-8000-0000000717c1', 'grow_wheat');
-- Des sites nés hier, l'un d'eux à l'arrêt depuis une heure (garde des sites levée le temps de l'écriture).
alter table game.sites disable trigger sites_guard;
update game.sites set created_at = now() - interval '1 day', cycle_started_at = now() - interval '1 day'
  where world_id = '01900000-0000-7000-8000-0000000717f1';
update game.sites set halted_at = now() - interval '1 hour' where id = '00000000-0000-7000-8000-0000000717b9';
alter table game.sites enable trigger sites_guard;
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000717d1', '01900000-0000-7000-8000-0000000717f1', 'house', '00000000-0000-7000-8000-0000000717e1');
insert into game.inventories (id, world_id, house_id, city_id, good_id) values
  ('00000000-0000-7000-8000-0000000717d2', '01900000-0000-7000-8000-0000000717f1', '00000000-0000-7000-8000-0000000717e1',
   '01900000-0000-7000-8000-0000000717c1', 'wheat');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.as_player(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000717aa", "role": "authenticated"}', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
grant execute on function pg_temp.as_player(text) to authenticated;
-- Une écriture équilibrée entre deux comptes, comme le moteur en passe.
create function pg_temp.move(from_account uuid, to_account uuid, amount bigint) returns void language plpgsql as $$
declare entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-0000000717f1', 'test.move', '{}')
    returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values (entry, from_account, -amount), (entry, to_account, amount);
end $$;
create function pg_temp.system(key text) returns uuid language sql as $$
  select id from game.accounts where world_id = '01900000-0000-7000-8000-0000000717f1' and system_key = key;
$$;

-- Fermeture : seul un site d'une maison PNJ se ferme, maintenant, et rien d'autre ne change avec lui.
select lives_ok($$select pg_temp.as_service($s$update game.sites set closed_at = now()
  where id = '00000000-0000-7000-8000-0000000717b8'$s$)$$, 'le service ferme un site de la maison PNJ');
select throws_ok($$select pg_temp.as_service($s$update game.sites set closed_at = now()
  where id = '00000000-0000-7000-8000-0000000717b1'$s$)$$, '23514', 'only a site of an NPC house closes',
  'jamais le site d''une maison de joueur');
select throws_ok($$select pg_temp.as_service($s$update game.sites set closed_at = now() - interval '1 second'
  where id = '00000000-0000-7000-8000-0000000717b9'$s$)$$, '23001', 'a site closes now', 'une fermeture n''est pas antidatée');
select throws_ok($$select pg_temp.as_service($s$update game.sites set closed_at = now(), recipe_id = 'grow_olives',
  cycle_started_at = now() where id = '00000000-0000-7000-8000-0000000717b9'$s$)$$, '23001', 'a closed site does not change',
  'ni ne change la recette en fermant');
select throws_ok($$insert into game.sites (world_id, house_id, city_id, recipe_id, closed_at) values
  ('01900000-0000-7000-8000-0000000717f1', '00000000-0000-7000-8000-0000000717e1', '01900000-0000-7000-8000-0000000717c1',
   'grow_wheat', now())$$, '23001', 'a site starts open', 'un site naît ouvert');
select throws_ok($$select pg_temp.as_service($s$update game.sites set cycle_started_at = now()
  where id = '00000000-0000-7000-8000-0000000717b8'$s$)$$, '23001', 'a closed site does not change',
  'un site fermé ne récolte pas');
select throws_ok($$select pg_temp.as_service($s$update game.sites set recipe_id = 'grow_olives', cycle_started_at = now()
  where id = '00000000-0000-7000-8000-0000000717b8'$s$)$$, '23001', 'a closed site does not change',
  'ni ne change de recette');
select throws_ok($$select pg_temp.as_service($s$update game.sites set halted_at = now()
  where id = '00000000-0000-7000-8000-0000000717b8'$s$)$$, '23001', 'a closed site does not change',
  'ni ne s''arrête');

-- Réouverture : à la même recette, sur un cycle neuf commencé maintenant ; le temps fermé n'est pas récolté.
select throws_ok($$select pg_temp.as_service($s$update game.sites set closed_at = null
  where id = '00000000-0000-7000-8000-0000000717b8'$s$)$$, '23001', 'a site reopens with its recipe, on a new cycle unless halted',
  'pas de réouverture qui garde le cycle d''avant la fermeture');
select throws_ok($$select pg_temp.as_service($s$update game.sites set closed_at = null, cycle_started_at = now(),
  recipe_id = 'grow_olives' where id = '00000000-0000-7000-8000-0000000717b8'$s$)$$, '23001',
  'a site reopens with its recipe, on a new cycle unless halted', 'ni sous une autre recette');
select lives_ok($$select pg_temp.as_service($s$update game.sites set closed_at = null, cycle_started_at = now()
  where id = '00000000-0000-7000-8000-0000000717b8'$s$)$$, 'le service rouvre le site sur un cycle neuf');
select ok((select closed_at is null and cycle_started_at = now() from game.sites where id = '00000000-0000-7000-8000-0000000717b8'),
  'le site rouvert tourne depuis maintenant');
-- Un site à l'arrêt se ferme et se rouvre sans toucher à son arrêt ni à son cycle, que la relance décalera.
select lives_ok($$select pg_temp.as_service($s$update game.sites set closed_at = now()
  where id = '00000000-0000-7000-8000-0000000717b9'$s$)$$, 'le service ferme un site à l''arrêt');
select throws_ok($$select pg_temp.as_service($s$update game.sites set closed_at = null, cycle_started_at = now()
  where id = '00000000-0000-7000-8000-0000000717b9'$s$)$$, '23001', 'a site reopens with its recipe, on a new cycle unless halted',
  'un site à l''arrêt ne repart pas sur un cycle neuf à sa réouverture');
select lives_ok($$select pg_temp.as_service($s$update game.sites set closed_at = null
  where id = '00000000-0000-7000-8000-0000000717b9'$s$)$$, 'il se rouvre à l''arrêt, cycle inchangé');

-- Mémoire du retrait : une clôture suit la précédente, et seulement pour une maison PNJ.
select lives_ok($$select pg_temp.as_service($s$insert into game.npc_house_retreats (house_id, world_id, game_day, trade_seq, sales)
  values ('00000000-0000-7000-8000-0000000717e1', '01900000-0000-7000-8000-0000000717f1', 20700, 12, '[[1, 2]]')$s$)$$,
  'le service inscrit la mémoire du retrait de la maison PNJ');
select throws_ok($$select pg_temp.as_service($s$insert into game.npc_house_retreats (house_id, world_id, game_day, trade_seq)
  values ('00000000-0000-7000-8000-0000000717a1', '01900000-0000-7000-8000-0000000717f1', 20700, 0)$s$)$$, '23503', null,
  'pas de mémoire du retrait pour une maison de joueur');
select throws_ok($$select pg_temp.as_service($s$update game.npc_house_retreats set trade_seq = 13
  where house_id = '00000000-0000-7000-8000-0000000717e1'$s$)$$, '23001', 'an NPC house retreat follows the previous close',
  'une clôture rejouée ne compte rien de plus');
select throws_ok($$select pg_temp.as_service($s$update game.npc_house_retreats set game_day = 20701, trade_seq = 11
  where house_id = '00000000-0000-7000-8000-0000000717e1'$s$)$$, '23001', 'an NPC house retreat follows the previous close',
  'le rang des échanges comptés ne recule pas');

-- Dissolution : il ne reste rien à la maison, ni site ouvert, ni ordre ouvert, ni stock, ni solde. Chaque cas ne laisse
-- qu'une seule de ces choses à la maison.
create function pg_temp.dissolve() returns text language sql as $$
  select $s$select pg_temp.as_service($q$update game.npc_house_retreats set game_day = 20701, dissolved_at = now()
    where house_id = '00000000-0000-7000-8000-0000000717e1'$q$)$s$;
$$;
select throws_ok(pg_temp.dissolve(), '23514', 'an NPC house dissolves with nothing left',
  'pas de dissolution avec un site ouvert');
select pg_temp.as_service($s$update game.sites set closed_at = now() where house_id = '00000000-0000-7000-8000-0000000717e1'$s$);
insert into game.orders (id, world_id, city_id, house_id, good_id, side, price, quantity, remaining) values
  ('00000000-0000-7000-8000-0000000717d3', '01900000-0000-7000-8000-0000000717f1', '01900000-0000-7000-8000-0000000717c1',
   '00000000-0000-7000-8000-0000000717e1', 'wheat', 'buy', 1, 1, 1);
select throws_ok(pg_temp.dissolve(), '23514', 'an NPC house dissolves with nothing left',
  'ni avec un ordre ouvert');
update game.orders set status = 'cancelled' where id = '00000000-0000-7000-8000-0000000717d3';
insert into game.stock_ledger (world_id, good_id, quantity, kind, from_system, to_inventory_id)
  values ('01900000-0000-7000-8000-0000000717f1', 'wheat', 3, 'test.harvest', 'production', '00000000-0000-7000-8000-0000000717d2');
select throws_ok(pg_temp.dissolve(), '23514', 'an NPC house dissolves with nothing left',
  'ni avec un stock');
insert into game.stock_ledger (world_id, good_id, quantity, kind, from_inventory_id, to_system)
  values ('01900000-0000-7000-8000-0000000717f1', 'wheat', 3, 'test.harvest', '00000000-0000-7000-8000-0000000717d2', 'production');
select pg_temp.move(pg_temp.system('faucet_npc_house_grant'), '00000000-0000-7000-8000-0000000717d1', 50);
select throws_ok(pg_temp.dissolve(), '23514', 'an NPC house dissolves with nothing left',
  'ni avec une trésorerie');
select pg_temp.move('00000000-0000-7000-8000-0000000717d1', pg_temp.system('sink_npc_house_surplus'), 50);
select throws_ok($$select pg_temp.as_service($s$update game.npc_house_retreats set game_day = 20701,
  dissolved_at = now() - interval '1 second' where house_id = '00000000-0000-7000-8000-0000000717e1'$s$)$$, '23001',
  'an NPC house dissolves now', 'une dissolution n''est pas antidatée');
select lives_ok(pg_temp.dissolve(), 'sans rien, la maison PNJ se dissout');
select throws_ok($$select pg_temp.as_service($s$update game.npc_house_retreats set game_day = 20702
  where house_id = '00000000-0000-7000-8000-0000000717e1'$s$)$$, '23001', 'a dissolved NPC house is final',
  'une dissolution est définitive');
select throws_ok($$select pg_temp.as_service($s$delete from game.npc_house_retreats$s$)$$, '42501', null,
  'le service n''efface aucune mémoire du retrait');

-- Un joueur ne lit ni n'écrit la mémoire du retrait, ni la fermeture d'un site, pas même du sien.
select throws_ok($$select pg_temp.as_player($s$select count(*) from game.npc_house_retreats$s$)$$, '42501', null,
  'un joueur ne lit pas la mémoire du retrait');
select throws_ok($$select pg_temp.as_player($s$update game.npc_house_retreats set above_days = 0$s$)$$, '42501', null,
  'ni ne l''écrit');
select throws_ok($$select pg_temp.as_player($s$select closed_at from game.sites$s$)$$, '42501', null,
  'ni ne lit la fermeture des sites');
select throws_ok($$select pg_temp.as_player($s$update game.sites set closed_at = now()
  where id = '00000000-0000-7000-8000-0000000717b1'$s$)$$, '42501', null, 'ni ne ferme son propre site');
set local role anon;
select throws_ok('select count(*) from game.npc_house_retreats', '42501', null, 'un visiteur anonyme ne la lit pas');
reset role;

select * from finish();
rollback;
