begin;
select plan(30);

-- Qui paie chaque crédit d'une bourse des PNJ (migration 1300 ; ticket 655). Contrôle différé de l'écriture entière :
-- chaque essai est joué sous le rôle de service, comme le moteur et l'API, ou au nom du propriétaire, puis les
-- contrôles différés sont validés ; un refus annule l'essai entier. Bob (b1) a un site à Kallistè (101), Cléo (c1) un
-- site à Elaia (103).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000058b', 'bob-580@example.test'),
  ('00000000-0000-4000-8000-00000000058c', 'cleo-580@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000008b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000058b', 'Philaïdes', '{}'),
  ('00000000-0000-7000-8000-0000000008c1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-00000000058c', 'Alcméonides', '{}');
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000008bb', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000008b1'),
  ('00000000-0000-7000-8000-0000000008cc', '01900000-0000-7000-8000-000000000001', 'house', '00000000-0000-7000-8000-0000000008c1');
insert into game.sites (world_id, house_id, city_id, recipe_id) values
  ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000008b1', '01900000-0000-7000-8000-000000000101', 'grow_wheat'),
  ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000008c1', '01900000-0000-7000-8000-000000000103', 'grow_wheat');

-- Compte par nom : clé d'un compte système, `bob`, `cleo`, `escrow:bob`, ou `purse:101`, `purse:103`.
create function pg_temp.acc(name text) returns uuid language sql as $$
  select case
    when name = 'bob' then '00000000-0000-7000-8000-0000000008bb'::uuid
    when name = 'cleo' then '00000000-0000-7000-8000-0000000008cc'::uuid
    when name = 'escrow:bob' then '00000000-0000-7000-8000-0000000008be'::uuid
    when name like 'purse:%' then (select account_id from game.npc_purses()
                                     where city_id = ('01900000-0000-7000-8000-000000000' || substr(name, 7))::uuid)
    else (select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001' and system_key = name)
  end
$$;
-- Écriture `kind`, une ligne par instruction dans l'ordre donné (un crédit peut précéder son débit), puis contrôles
-- différés validés. Sous le service, ou au nom du propriétaire du schéma.
create function pg_temp.write(kind text, meta jsonb, names text[], amounts bigint[]) returns uuid language plpgsql as $$
declare
  entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', kind, meta)
    returning id into entry;
  for i in 1 .. cardinality(names) loop
    insert into game.ledger_lines (entry_id, account_id, amount) values (entry, pg_temp.acc(names[i]), amounts[i]);
  end loop;
  set constraints all immediate;
  set constraints all deferred;
  return entry;
end $$;
create function pg_temp.post(kind text, meta jsonb, names text[], amounts bigint[]) returns uuid language plpgsql as $$
declare
  entry uuid;
begin
  perform set_config('role', 'oikos_service', true);
  entry := pg_temp.write(kind, meta, names, amounts);
  perform set_config('role', 'none', true);
  return entry;
end $$;
create function pg_temp.post_as_owner(kind text, meta jsonb, names text[], amounts bigint[]) returns uuid language sql as $$
  select pg_temp.write(kind, meta, names, amounts)
$$;
grant execute on function pg_temp.acc(text), pg_temp.write(text, jsonb, text[], bigint[]) to oikos_service;
create function pg_temp.balance(name text) returns bigint language sql as $$
  select balance from game.accounts where id = pg_temp.acc(name)
$$;
-- `meta` d'entretien ou d'hébergement de la maison : un jour de jeu par écriture (une clôture par maison et par jour).
create function pg_temp.house(house text, day integer) returns jsonb language sql as $$
  select jsonb_build_object('houseId', case house when 'bob' then '00000000-0000-7000-8000-0000000008b1'
                                                  else '00000000-0000-7000-8000-0000000008c1' end,
                            'gameDay', day, 'siteId', '00000000-0000-7000-8000-0000000008b2')
$$;
create function pg_temp.income(city text, day integer) returns jsonb language sql as $$
  select jsonb_build_object('cityId', '01900000-0000-7000-8000-000000000' || city, 'gameDay', day)
$$;

select pg_temp.post('test.seed', '{}', array['faucet_starting_grant', 'bob', 'cleo'], array[-2000, 1000, 1000]);

-- Formes légitimes, sous le service.
select lives_ok($$select pg_temp.post('upkeep.daily', pg_temp.house('bob', 20771), array['purse:101', 'sink_upkeep', 'bob', 'bob'],
  array[4, 5, -5, -4])$$, 'clôture : la trésorerie de Bob, en deux lignes par nature, paie la bourse de la cité de son site, crédit écrit en premier');
select lives_ok($$select pg_temp.post('upkeep.restart', pg_temp.house('bob', 20772), array['bob', 'purse:101'], array[-7, 7])$$,
  'salaires d''une relance');
select lives_ok($$select pg_temp.post('lodging.daily', pg_temp.house('bob', 20773), array['bob', 'purse:101'], array[-3, 3])$$,
  'hébergement de la clôture');
select lives_ok($$select pg_temp.post('lodging.restart', pg_temp.house('bob', 20774), array['bob', 'purse:101'], array[-2, 2])$$,
  'hébergement d''une relance');
select lives_ok($$select pg_temp.post('upkeep.daily', pg_temp.house('cleo', 20775), array['cleo', 'purse:103', 'sink_upkeep'], array[-9, 6, 3])$$,
  'Cléo paie la bourse de la cité de son site à elle');
select lives_ok($$select pg_temp.post('upkeep.daily', pg_temp.house('cleo', 20776), array['cleo', 'sink_upkeep'], array[-1, 1])$$,
  'une écriture d''entretien sans bourse au crédit n''est pas contrôlée');
select lives_ok($$select pg_temp.post('npc.public_income', pg_temp.income('101', 20771), array['faucet_npc_public_income', 'purse:101'],
  array[-100, 100])$$, 'revenu public payé par son robinet');
select is(array[pg_temp.balance('purse:101'), pg_temp.balance('purse:103'), pg_temp.balance('bob'), pg_temp.balance('cleo')],
  array[116, 6, 979, 990]::bigint[], 'chaque crédit admis est au solde de sa bourse, à l''obole près');

-- Salaires et hébergement : une seule trésorerie, d'une maison qui a un site dans la cité de chaque bourse créditée.
select throws_like($$select pg_temp.post('upkeep.daily', pg_temp.house('cleo', 20777), array['cleo', 'purse:101'], array[-5, 5])$$,
  'the NPC purse of city 01900000-0000-7000-8000-000000000101 is paid wages and lodging only by the treasury of a house with a site there',
  'pas d''une maison sans site dans la cité de la bourse');
select throws_like($$select pg_temp.post('upkeep.daily', pg_temp.house('bob', 20778), array['bob', 'purse:101', 'purse:103'], array[-8, 4, 4])$$,
  'the NPC purse of city 01900000-0000-7000-8000-000000000103 is paid wages and lodging only by the treasury of a house with a site there',
  'ni à la bourse d''une autre cité dans la même écriture : la bourse refusée est nommée');
select throws_like($$select pg_temp.post('lodging.daily', pg_temp.house('bob', 20790), array['faucet_npc_public_income', 'purse:101'], array[-5, 5])$$,
  'the NPC purse of city 01900000-0000-7000-8000-000000000101 is paid wages and lodging only by the treasury of a house with a site there',
  'ni d''un robinet');
select throws_like($$select pg_temp.post('upkeep.daily', pg_temp.house('bob', 20779), array['bob', 'faucet_starting_grant', 'purse:101'],
  array[-5, -5, 10])$$,
  'the NPC purse of city 01900000-0000-7000-8000-000000000101 is paid wages and lodging only by the treasury of a house with a site there',
  'ni de la trésorerie d''une maison qui a un site, complétée par un robinet');
select throws_like($$select pg_temp.post('upkeep.restart', pg_temp.house('bob', 20780), array['bob', 'cleo', 'purse:101'], array[-3, -3, 6])$$,
  'the NPC purse of city 01900000-0000-7000-8000-000000000101 is paid wages and lodging only by the treasury of a house with a site there',
  'ni de deux trésoreries, dont celle d''une maison qui a un site');
-- Le séquestre de Bob n'est pas sa trésorerie. Ses propres contrôles (migrations 19 et 36), qui le refuseraient aussi,
-- sont suspendus le temps de l'essai pour que seul celui-ci puisse refuser.
insert into game.accounts (id, world_id, kind, house_id) values
  ('00000000-0000-7000-8000-0000000008be', '01900000-0000-7000-8000-000000000001', 'escrow', '00000000-0000-7000-8000-0000000008b1');
alter table game.ledger_lines disable trigger ledger_lines_escrow_debit, disable trigger ledger_lines_escrow_matches;
select pg_temp.post('test.seed', '{}', array['faucet_starting_grant', 'escrow:bob'], array[-10, 10]);
select throws_like($$select pg_temp.post('upkeep.daily', pg_temp.house('bob', 20782), array['escrow:bob', 'purse:101'], array[-3, 3])$$,
  'the NPC purse of city 01900000-0000-7000-8000-000000000101 is paid wages and lodging only by the treasury of a house with a site there',
  'ni du séquestre d''une maison qui a un site');
alter table game.ledger_lines enable trigger ledger_lines_escrow_debit, enable trigger ledger_lines_escrow_matches;
-- Un débit ajouté après une première validation vient avec un crédit, qui fait recontrôler l'écriture entière, même
-- s'il ne va à aucune bourse.
create table pg_temp.late (entry uuid);
select lives_ok($$insert into pg_temp.late select pg_temp.post('upkeep.daily', pg_temp.house('bob', 20781), array['bob', 'purse:101'],
  array[-1, 1])$$, 'une écriture légitime validée');
create function pg_temp.extend() returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  insert into game.ledger_lines (entry_id, account_id, amount) values
    ((select entry from pg_temp.late), pg_temp.acc('faucet_starting_grant'), -2),
    ((select entry from pg_temp.late), pg_temp.acc('bob'), 2);
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'none', true);
end $$;
grant select on pg_temp.late to oikos_service;
select throws_like('select pg_temp.extend()',
  'the NPC purse of city 01900000-0000-7000-8000-000000000101 is paid wages and lodging only by the treasury of a house with a site there',
  'ne reçoit pas après coup le débit d''un robinet');

-- Revenu public : son seul robinet le paie, quoi qu'il crédite.
select throws_like($$select pg_temp.post('npc.public_income', pg_temp.income('101', 20772), array['faucet_starting_grant', 'purse:101'],
  array[-100, 100])$$, 'NPC public income entry % is paid only by the NPC public income faucet', 'pas un autre robinet');
select throws_like($$select pg_temp.post('npc.public_income', pg_temp.income('101', 20773), array['bob', 'purse:101'], array[-100, 100])$$,
  'NPC public income entry % is paid only by the NPC public income faucet', 'ni la trésorerie d''une maison');
select throws_like($$select pg_temp.post('npc.public_income', pg_temp.income('101', 20774),
  array['faucet_npc_public_income', 'bob', 'purse:101'], array[-50, -50, 100])$$,
  'NPC public income entry % is paid only by the NPC public income faucet', 'ni son robinet complété par une maison');
select throws_like($$select pg_temp.post('npc.public_income', pg_temp.income('101', 20775), array['bob', 'cleo'], array[-1, 1])$$,
  'NPC public income entry % is paid only by the NPC public income faucet', 'ni une écriture qui ne crédite aucune bourse');

-- Au nom du propriétaire, chaque contournement est refusé de même.
select throws_like($$select pg_temp.post_as_owner('upkeep.daily', pg_temp.house('cleo', 20782), array['cleo', 'purse:101'], array[-5, 5])$$,
  'the NPC purse of city 01900000-0000-7000-8000-000000000101 is paid wages and lodging only by the treasury of a house with a site there',
  'propriétaire : pas d''une maison sans site dans la cité');
select throws_like($$select pg_temp.post_as_owner('lodging.restart', pg_temp.house('bob', 20791), array['faucet_starting_grant', 'purse:101'], array[-5, 5])$$,
  'the NPC purse of city 01900000-0000-7000-8000-000000000101 is paid wages and lodging only by the treasury of a house with a site there',
  'propriétaire : ni d''un robinet');
select throws_like($$select pg_temp.post_as_owner('npc.public_income', pg_temp.income('101', 20776), array['bob', 'purse:101'],
  array[-100, 100])$$, 'NPC public income entry % is paid only by the NPC public income faucet',
  'propriétaire : ni un revenu public payé par une maison');

-- Le contrôle porte sur l'écriture entière, à la validation.
select ok((select tgdeferrable and tginitdeferred and tgconstraint <> 0 and tgtype & 4 = 4 and tgtype & 1 = 1
           from pg_trigger where tgname = 'ledger_lines_npc_purse_payer' and tgrelid = 'game.ledger_lines'::regclass),
  'contrainte différée, contrôlée après chaque insertion');
select matches((select pg_get_triggerdef(oid) from pg_trigger where tgname = 'ledger_lines_npc_purse_payer'), 'WHEN \(\(new\.amount > 0\)\)',
  'à chaque ligne de crédit : toute écriture équilibrée en a une');
select ok(not has_function_privilege('oikos_service', 'game.check_npc_purse_payer()', 'execute')
  and not has_function_privilege('authenticated', 'game.check_npc_purse_payer()', 'execute'),
  'ni le service ni un joueur n''exécutent la fonction du contrôle');
create table pg_temp.stray (entry_id uuid, amount bigint);
create trigger stray_payer after insert on pg_temp.stray for each row execute function game.check_npc_purse_payer();
select throws_ok($$insert into pg_temp.stray values (null, 1)$$, '42501', 'stray_payer only runs on game.ledger_lines',
  'la fonction, au nom du propriétaire, ne contrôle aucune autre table');
select is(array[pg_temp.balance('purse:101'), pg_temp.balance('purse:103'), pg_temp.balance('bob'), pg_temp.balance('cleo')],
  array[117, 6, 978, 990]::bigint[], 'aucun essai refusé n''a laissé de trace (l''obole de l''écriture validée en plus)');
select is((select count(*) from game.ledger_lines where entry_id = (select entry from pg_temp.late)), 2::bigint,
  'la ligne ajoutée après coup est annulée');
select lives_ok($$select pg_temp.post('npc.public_income', pg_temp.income('103', 20771), array['faucet_npc_public_income', 'purse:103'],
  array[-1, 1])$$, 'la bourse d''Elaia reçoit son propre revenu public');

select * from finish();
rollback;
