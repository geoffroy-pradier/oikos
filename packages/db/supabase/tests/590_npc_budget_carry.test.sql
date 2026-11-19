begin;
select plan(14);

-- Budget non dépensé des PNJ reporté d'un tick au suivant (migration 6750 ; #675). La colonne s'ajoute à
-- `npc_demand_carry` : le moteur la tient, aucun client ne la lit ni ne l'écrit, et la version précédente du
-- moteur, qui ne la connaît pas, continue d'écrire ses reports sans la toucher. Monde et cité propres au test :
-- une base qui a déjà joué des ticks a des reports pour les cités du seed.
insert into game.worlds (id, slug, name) values ('00000000-0000-7000-8000-000000000590', 'report-590', 'Report');
insert into game.cities (id, world_id, slug, name) values ('00000000-0000-7000-8000-000000000591', '00000000-0000-7000-8000-000000000590', 'kalliste', 'Kallistè');

select col_type_is('game', 'npc_demand_carry', 'budget_carry', 'bigint', 'report de budget en oboles entières');
select col_not_null('game', 'npc_demand_carry', 'budget_carry', 'report de budget jamais nul');

-- Le moteur, sous le rôle de service.
set local role oikos_service;
select lives_ok($$insert into game.npc_demand_carry (world_id, city_id, good_id, carry)
  values ('00000000-0000-7000-8000-000000000590', '00000000-0000-7000-8000-000000000591', 'salt', 0.52)$$,
  'insertion de la version précédente du moteur : sans report de budget');
select is((select budget_carry from game.npc_demand_carry where city_id = '00000000-0000-7000-8000-000000000591' and good_id = 'salt'), 0::bigint,
  'report de budget nul par défaut');
select lives_ok($$update game.npc_demand_carry set budget_carry = 6, carry = 0.04 where city_id = '00000000-0000-7000-8000-000000000591' and good_id = 'salt'$$,
  'le moteur tient le report de budget');
select lives_ok($$update game.npc_demand_carry set carry = 0.56, updated_at = now() where city_id = '00000000-0000-7000-8000-000000000591' and good_id = 'salt'$$,
  'mise à jour de la version précédente du moteur : fraction de demande seule');
select is((select budget_carry from game.npc_demand_carry where city_id = '00000000-0000-7000-8000-000000000591' and good_id = 'salt'), 6::bigint,
  'la version précédente laisse le report de budget intact');
select throws_ok($$update game.npc_demand_carry set budget_carry = -1 where city_id = '00000000-0000-7000-8000-000000000591' and good_id = 'salt'$$,
  '23514', null, 'pas de report de budget négatif');
select throws_ok($$insert into game.npc_demand_carry (world_id, city_id, good_id, carry, budget_carry)
  values ('00000000-0000-7000-8000-000000000590', '00000000-0000-7000-8000-000000000591', 'fish', 0, -5)$$,
  '23514', null, 'ni à l''insertion');
reset role;

-- Un joueur connecté ne lit ni n'écrit aucun report, pas plus qu'un visiteur.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000059a", "role": "authenticated"}';
select throws_ok('select budget_carry from game.npc_demand_carry', '42501', null,
  'un joueur ne lit pas le report de budget');
select throws_ok($$update game.npc_demand_carry set budget_carry = 1000 where city_id = '00000000-0000-7000-8000-000000000591'$$, '42501', null,
  'un joueur ne modifie pas le report de budget');
select throws_ok($$insert into game.npc_demand_carry (world_id, city_id, good_id, carry, budget_carry)
  values ('00000000-0000-7000-8000-000000000590', '00000000-0000-7000-8000-000000000591', 'wine', 0, 1000)$$,
  '42501', null, 'un joueur ne crée pas de report de budget');
reset role;
set local role anon;
select throws_ok('select budget_carry from game.npc_demand_carry', '42501', null,
  'un visiteur ne lit pas le report de budget');
reset role;

select is((select budget_carry from game.npc_demand_carry where city_id = '00000000-0000-7000-8000-000000000591' and good_id = 'salt'), 6::bigint,
  'le report du moteur est intact après les essais des clients');

select * from finish();
rollback;
