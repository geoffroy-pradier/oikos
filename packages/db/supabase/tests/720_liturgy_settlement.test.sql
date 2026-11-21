begin;
select plan(49);

-- Jeu d'essai : un monde à lui, une cité, Kallistè. Alice (a), Bob (b), Chloé (c) et Phédon (f) y ont leur foyer et
-- une liturgie désignée au jour 100 ; Dion (d) a sa maison dans un autre monde. Trésoreries : Alice 2 000, Bob 300,
-- Chloé 0, Phédon 1 000. La liturgie d'Alice (dû 500) est à régler dans trois jours ; celles de Bob (500), de Chloé
-- (400) et de Phédon (600) sont échues depuis une heure. La clôture du jour 100 est enregistrée, pas celle du 103.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000720f0', 'liturgies-720', 'Liturgies'), ('01900000-0000-7000-8000-0000000720f9', 'ailleurs-720', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000720c1', '01900000-0000-7000-8000-0000000720f0', 'kalliste', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000720c9', '01900000-0000-7000-8000-0000000720f9', 'delphis', 'Delphis');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000720a' || n)::uuid, 'liturgy-720-' || n || '@example.test' from unnest(array['a', 'b', 'c', 'd', 'f']) n;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000000720' || n || '1')::uuid, ('01900000-0000-7000-8000-0000000720' || w)::uuid,
       ('00000000-0000-4000-8000-0000000720a' || n)::uuid, name, '{}'
from (values ('a', 'Alcméonides', 'f0'), ('b', 'Philaïdes', 'f0'), ('c', 'Bacchiades', 'f0'), ('d', 'Eumolpides', 'f9'),
             ('f', 'Pisistratides', 'f0')) h (n, name, w);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000000720' || n || '1')::uuid, ('01900000-0000-7000-8000-0000000720' || c)::uuid
from (values ('a', 'c1'), ('b', 'c1'), ('c', 'c1'), ('d', 'c9'), ('f', 'c1')) v (n, c);
insert into game.accounts (world_id, kind, house_id)
select world_id, 'house', id from game.houses where id::text like '00000000-0000-7000-8000-0000000720%';
do $$
declare v record; entry uuid;
begin
  for v in select * from (values ('a', 2000), ('b', 300), ('d', 900), ('f', 1000)) v (n, grant_oboles) loop
    insert into game.ledger_entries (world_id, kind)
    select world_id, 'house.starting_grant' from game.houses where id = ('00000000-0000-7000-8000-0000000720' || v.n || '1')::uuid
    returning id into entry;
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry, a.id, case when a.kind = 'house' then v.grant_oboles else -v.grant_oboles end
    from game.accounts a join game.houses h on a.world_id = h.world_id
    where h.id = ('00000000-0000-7000-8000-0000000720' || v.n || '1')::uuid
      and (a.house_id = h.id or a.system_key = 'faucet_starting_grant');
  end loop;
end $$;
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c720', '{}');
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
select pg_temp.as_service($s$
  insert into game.liturgies (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at)
  select '01900000-0000-7000-8000-0000000720f0', '01900000-0000-7000-8000-0000000720c1',
         ('00000000-0000-7000-8000-0000000720' || n || '1')::uuid, 3, 'festival', due, 100, 103, now() + due_in
  from (values ('a', 500, interval '3 days'), ('b', 500, interval '-1 hour'), ('c', 400, interval '-1 hour'),
               ('f', 600, interval '-1 hour')) v (n, due, due_in)$s$);
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000720f0', 100, now() - interval '3 days', '00000000-0000-7000-8000-00000000c720');

-- Règlement écrit comme l'écrit le code, au nom du service : l'écriture `moved` oboles de la trésorerie de la maison au
-- puits `sink` (par défaut ce qui est payé, vers `sink_liturgies`), puis la liturgie.
create function pg_temp.settle(house text, state text, p_paid bigint, p_splendor bigint = 0, p_god text = null,
  p_charis bigint = null, entry_kind text = null, moved bigint = null, sink text = 'sink_liturgies', p_day int = 103)
returns void language plpgsql as $$
declare lit record; entry uuid;
begin
  perform set_config('role', 'oikos_service', true);
  select id, world_id, house_id into lit from game.liturgies where house_id = ('00000000-0000-7000-8000-0000000720' || house || '1')::uuid;
  if coalesce(moved, p_paid) > 0 then
    insert into game.ledger_entries (world_id, kind, meta)
    values (lit.world_id, coalesce(entry_kind, case state when 'performed' then 'liturgy.perform' else 'liturgy.levy' end),
            jsonb_build_object('liturgyId', lit.id))
    returning id into entry;
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry, id, -coalesce(moved, p_paid) from game.accounts where house_id = lit.house_id and kind = 'house'
    union all
    select entry, id, coalesce(moved, p_paid) from game.accounts where world_id = lit.world_id and system_key = sink;
  end if;
  update game.liturgies set status = state, splendor = p_splendor, paid = p_paid, god_id = p_god, charis_gained = p_charis,
    settled_day = p_day, ledger_entry_id = entry
  where id = lit.id;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.lit(house text) returns uuid language sql as $$
  select id from game.liturgies where house_id = ('00000000-0000-7000-8000-0000000720' || house || '1')::uuid
$$;
create function pg_temp.honor(house text, reason text, amount int, of_house text = null, day int = 103) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day) values (%L, %L, %s, %L, %L, %s)',
    '01900000-0000-7000-8000-0000000720f0', '00000000-0000-7000-8000-0000000720' || house || '1', amount, reason,
    pg_temp.lit(coalesce(of_house, house)), day))
$$;
create function pg_temp.charis(house text, god text, amount int, kind text = 'liturgy', of_house text = null) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.favor_ledger (world_id, house_id, god_id, amount, kind, liturgy_id, game_day) values (%L, %L, %L, %s, %L, %L, %s)',
    '01900000-0000-7000-8000-0000000720f0', '00000000-0000-7000-8000-0000000720' || house || '1', god, amount, kind,
    pg_temp.lit(coalesce(of_house, house)), case when kind = 'decay' then '103' else 'null' end))
$$;
create function pg_temp.treasury(house text) returns bigint language sql as $$
  select balance from game.accounts where house_id = ('00000000-0000-7000-8000-0000000720' || house || '1')::uuid and kind = 'house'
$$;

-- Le puits et les droits.
select is((select count(*)::integer from game.accounts where world_id = '01900000-0000-7000-8000-0000000720f0'
  and system_key = 'sink_liturgies' and not allow_negative), 1, 'chaque monde a son puits des liturgies, qui ne passe pas en négatif');
select is(
  (select string_agg(column_name, ' ' order by column_name) from information_schema.column_privileges
   where grantee = 'oikos_service' and table_schema = 'game' and table_name = 'liturgies' and privilege_type = 'UPDATE'),
  'charis_gained god_id ledger_entry_id paid settled_day splendor status', 'le service règle une liturgie sans en choisir l''instant');

-- Accomplissement d'Alice : dû 500 et faste 200, Charis 30 envers Athéna.
select throws_ok($$select pg_temp.settle('a', 'performed', 600, 200)$$, '23514', null,
  'ce qui est payé est le dû plus le faste');
select throws_ok($$select pg_temp.settle('a', 'performed', 700, 200, moved => 650)$$, '23001',
  'a liturgy is paid by its own entry, from its house treasury to sink_liturgies', 'l''écriture porte ce qui est payé');
select throws_ok($$select pg_temp.settle('a', 'performed', 700, 200, sink => 'sink_offerings')$$, '23001',
  'a liturgy is paid by its own entry, from its house treasury to sink_liturgies', 'vers le puits des liturgies, pas un autre');
select throws_ok($$select pg_temp.settle('a', 'performed', 700, 200, entry_kind => 'liturgy.levy')$$, '23001',
  'a liturgy is paid by its own entry, from its house treasury to sink_liturgies', 'par une écriture de sa nature');
select throws_ok($$select pg_temp.settle('a', 'performed', 700, 200, 'athena')$$, '23514', null,
  'un dieu sans Charis, ou une Charis sans dieu, est refusé');
select throws_ok($$select pg_temp.settle('a', 'levied', 500)$$, '23001', 'a liturgy is levied once due',
  'une liturgie qui n''est pas échue n''est pas prélevée');
select throws_ok($$select pg_temp.settle('f', 'performed', 600)$$, '23001', 'a liturgy is performed before it falls due',
  'une liturgie échue ne s''accomplit plus');
select throws_ok(pg_temp.honor('a', 'liturgy_performed', 10), '23001', 'a liturgy is credited to its house when performed',
  'pas de Timè pour une liturgie encore désignée');
select throws_ok(pg_temp.charis('a', 'athena', 30), '23001', 'a performed liturgy adds its own Charis, when performed',
  'ni de Charis');
select lives_ok($$select pg_temp.settle('a', 'performed', 700, 200, 'athena', 30)$$, 'Alice accomplit sa liturgie avec faste');
select is(pg_temp.treasury('a'), 1300::bigint, 'sa trésorerie paie le dû et le faste');
select is((select balance from game.accounts where world_id = '01900000-0000-7000-8000-0000000720f0' and system_key = 'sink_liturgies'),
  700::bigint, 'que le puits détruit');
select is((select settled_at from game.liturgies where id = pg_temp.lit('a')), now(), 'la base date le règlement');
select throws_ok($$select pg_temp.settle('a', 'performed', 500)$$, '23001', 'a liturgy is settled once', 'une liturgie se règle une fois');
select throws_ok($$update game.liturgies set due = 1 where id = pg_temp.lit('a')$$, '23001', null,
  'son dû ne change pas, même pour le propriétaire');
select throws_ok($$delete from game.liturgies where id = pg_temp.lit('a')$$, '23001', null, 'elle ne se supprime pas');

-- Timè et Charis de l'accomplissement : une fois, pour sa maison, au montant fixé.
select throws_ok(pg_temp.honor('a', 'liturgy_performed', -10), '23001', 'a performed liturgy raises Timè', 'un gain, jamais une perte');
select throws_ok(pg_temp.honor('b', 'liturgy_performed', 10, 'a'), '23001', 'a liturgy is credited to its house when performed',
  'à sa seule maison');
select lives_ok(pg_temp.honor('a', 'liturgy_performed', 10), 'Alice gagne sa Timè');
select throws_ok(pg_temp.honor('a', 'liturgy_performed', 10), '23505', null, 'une seule fois');
select throws_ok(pg_temp.charis('a', 'athena', 31), '23001', 'a performed liturgy adds its own Charis, when performed',
  'la Charis est celle que la liturgie a fixée');
select throws_ok(pg_temp.charis('a', 'demeter', 30), '23001', 'a performed liturgy adds its own Charis, when performed',
  'envers son dieu');
select throws_ok(pg_temp.charis('b', 'athena', 30, 'liturgy', 'a'), '23001', 'a performed liturgy adds its own Charis, when performed',
  'à sa seule maison');
select throws_ok(pg_temp.charis('a', 'athena', -1, 'decay'), '23001', 'only a liturgy movement names a liturgy',
  'une autre nature ne nomme pas de liturgie');
select lives_ok(pg_temp.charis('a', 'athena', 30), 'Alice gagne sa Charis');
select throws_ok(pg_temp.charis('a', 'athena', 30), '23505', null, 'une seule fois');

-- Prélèvement d'office : Bob (300 pour 500 dus), Chloé (rien), Phédon (600 en entier), par la clôture du jour 103.
select throws_ok(pg_temp.honor('b', 'liturgy_evaded', 40), '23001', 'an evaded liturgy lowers Timè', 'une dérobade fait perdre de la Timè');
select throws_ok(pg_temp.honor('a', 'liturgy_evaded', -40), '23001', 'an evaded liturgy is charged to its house once due',
  'pas pour une liturgie accomplie');
select lives_ok(pg_temp.honor('b', 'liturgy_evaded', -40), 'Bob perd sa Timè à l''échéance, avant le prélèvement');
select throws_ok($$select pg_temp.settle('b', 'levied', 200)$$, '23001', 'a levy takes the whole due, or all the treasury holds',
  'un prélèvement partiel laisse la trésorerie vide');
select throws_ok($$select pg_temp.settle('b', 'levied', 0)$$, '23001', 'a levy takes the whole due, or all the treasury holds',
  'un prélèvement nul aussi');
select throws_ok($$select pg_temp.settle('b', 'levied', 600)$$, '23514', null, 'jamais plus que le dû');
select throws_ok($$select pg_temp.settle('b', 'levied', 300, 1)$$, '23514', null, 'jamais de faste');
select lives_ok($$select pg_temp.settle('b', 'levied', 300)$$, 'la trésorerie de Bob est prélevée pour ce qu''elle couvre');
select is(pg_temp.treasury('b'), 0::bigint, 'elle est vide, sans dette');
select lives_ok($$select pg_temp.settle('c', 'levied', 0)$$, 'une trésorerie vide : rien de prélevé, sans écriture');
select lives_ok($$select pg_temp.settle('f', 'levied', 600)$$, 'Phédon est prélevé en entier');
select is(pg_temp.treasury('f'), 400::bigint, 'il garde le reste');
select throws_ok('set constraints game.liturgies_levy_on_close immediate', '23001', 'a liturgy is levied by the close of its day',
  'sans la clôture de son jour, un prélèvement est refusé');
select throws_ok('set constraints game.honor_ledger_on_close immediate', '23001', 'an evaded liturgy is charged by the close of its day',
  'ni la perte de Timè d''une dérobade');
insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
values ('01900000-0000-7000-8000-0000000720f0', 103, now() - interval '1 hour', '00000000-0000-7000-8000-00000000c720');
select lives_ok('set constraints game.liturgies_levy_on_close, game.honor_ledger_on_close immediate',
  'avec elle, prélèvements et pertes sont admis');
set constraints all deferred;

-- Lectures : Bob lit l'état des liturgies de son monde, et ses seuls flux ; ni le faste, ni ce qui est payé d'une autre.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000720ab", "role": "authenticated"}', true);
select is((select string_agg(right(house_id::text, 2) || ':' || status, ' ' order by house_id) from public.city_liturgies),
  'a1:performed b1:levied c1:levied f1:levied', 'Bob lit l''état de chaque liturgie de son monde');
select throws_ok('select paid, splendor from game.liturgies', '42501', null, 'pas ce qui est payé ni le faste d''une autre maison');
select throws_ok('select god_id, charis_gained, ledger_entry_id, settled_at, settled_day from game.liturgies', '42501', null,
  'ni le dieu, la Charis, l''écriture ou la date d''un règlement');
select is((select string_agg(nature || ':' || amount, ' ') from public.my_cash_flows where nature = 'liturgies'), 'liturgies:-300',
  'ses flux de trésorerie, nature liturgies, ne disent que son prélèvement');
select throws_ok($$update game.liturgies set status = 'performed'$$, '42501', null, 'un joueur ne règle pas de liturgie');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000720aa", "role": "authenticated"}', true);
select is((select sum(other)::integer from public.my_income_statement), -700,
  'pour Alice, la liturgie est hors exploitation, dans les autres mouvements du compte de résultat');
reset role;

select * from finish();
rollback;
