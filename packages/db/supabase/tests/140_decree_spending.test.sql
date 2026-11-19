begin;
select plan(32);

-- Jeu d'essai, monde de test (Kallistè 101, Elaia 103). Alice est archonte de Kallistè ; ses décrets sont posés
-- garde levée, déjà adoptés : `1` et `3` de grands travaux (600), `2` de fête (300), `4` de taux, `5` de grands
-- travaux d'Elaia, `6` de grands travaux plus coûteux que le trésor. Le trésor de Kallistè reçoit 1 000 oboles.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000140aa', 'spending-a@example.test'),
  ('00000000-0000-4000-8000-0000000140ab', 'spending-b@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000140a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000140aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000140b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000140ab', 'Philaïdes', '{}');
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values ('00000000-0000-7000-8000-00000001400e', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
        now() - interval '20 days', now() - interval '16 days', now() - interval '13 days', now() + interval '15 days', now());
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
values ('00000000-0000-7000-8000-00000001400f', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
        '00000000-0000-7000-8000-0000000140a1', '00000000-0000-7000-8000-00000001400e', now() - interval '13 days', now() + interval '15 days');
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;
alter table game.decrees disable trigger decrees_guard;
insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, status, proposed_at, voting_closes_at,
  quorum_bps, tallied_at, electorate, votes_for, votes_against)
select ('00000000-0000-7000-8000-0000000140d' || d)::uuid, '01900000-0000-7000-8000-000000000001', city::uuid, model, params::jsonb,
  '00000000-0000-7000-8000-00000001400f', '00000000-0000-7000-8000-0000000140a1', 'adopted', now() - interval '3 days',
  now() - interval '1 hour', 0, now() - interval '1 hour', 0, 0, 0
from (values ('1', 'public_works', '{"amountOboles": 600}', '01900000-0000-7000-8000-000000000101'),
             ('2', 'festival', '{"amountOboles": 300, "days": 2, "goodIds": ["bread"]}', '01900000-0000-7000-8000-000000000101'),
             ('3', 'public_works', '{"amountOboles": 600}', '01900000-0000-7000-8000-000000000101'),
             ('4', 'market_tax_rate', '{"rateBps": 700}', '01900000-0000-7000-8000-000000000101'),
             ('5', 'public_works', '{"amountOboles": 600}', '01900000-0000-7000-8000-000000000103'),
             ('6', 'public_works', '{"amountOboles": 5000}', '01900000-0000-7000-8000-000000000101')) v (d, model, params, city);
alter table game.decrees enable trigger decrees_guard;
with e as (insert into game.ledger_entries (world_id, kind) values ('01900000-0000-7000-8000-000000000001', 'test.treasury') returning id)
insert into game.ledger_lines (entry_id, account_id, amount)
select e.id, a.id, case when a.kind = 'treasury' then 1000 else -1000 end from e, game.accounts a
where (a.kind = 'treasury' and not a.npc_purse and a.city_id = '01900000-0000-7000-8000-000000000101')
   or (a.world_id = '01900000-0000-7000-8000-000000000001' and a.system_key = 'faucet_npc_purchases');
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-0000000140c1', '{}');

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Paiement d'un décret : `amount` du trésor d'une cité (Kallistè par défaut) à un puits, en une écriture.
create function pg_temp.pay(decree text, amount bigint, kind text default 'city.public_works', sink text default 'sink_public_works',
  city text default '01900000-0000-7000-8000-000000000101') returns text language sql as $$
  select format($f$with e as (insert into game.ledger_entries (world_id, kind, meta)
      values ('01900000-0000-7000-8000-000000000001', %L, jsonb_build_object('decreeId', %L)) returning id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select e.id, a.id, case when a.kind = 'treasury' then -%s else %s end from e, game.accounts a
    where (a.kind = 'treasury' and not a.npc_purse and a.city_id = %L) or (a.world_id = '01900000-0000-7000-8000-000000000001' and a.system_key = %L);$f$,
    kind, '00000000-0000-7000-8000-0000000140d' || decree, amount, amount, city, sink)
$$;
-- Règlement d'un décret au jour de jeu `day`, puis, si `close`, la clôture de ce jour.
create function pg_temp.settle(decree text, status text, day integer, close boolean default true) returns text language sql as $$
  select format($f$update game.decrees set status = %L, applied_at = %s, settled_day = %s where id = %L;$f$,
    status, case status when 'applied' then 'now()' else 'null' end, day, '00000000-0000-7000-8000-0000000140d' || decree)
    || case when close then format($f$insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
      values ('01900000-0000-7000-8000-000000000001', %s, now() - interval '1 minute', '00000000-0000-7000-8000-0000000140c1');$f$, day)
    else '' end
$$;
create function pg_temp.check(statement text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', statement || ' set constraints all immediate')
$$;
create function pg_temp.refused() returns text language sql as $$
  select 'the treasury of city 01900000-0000-7000-8000-000000000101 pays only the spending of its applied decrees'
$$;
create function pg_temp.balance(account text) returns bigint language sql as $$
  select balance from game.accounts where world_id = '01900000-0000-7000-8000-000000000001'
    and (system_key = account or (kind = 'treasury' and not npc_purse and city_id::text = account))
$$;

-- Catalogue : le puits des fêtes existe dans chaque monde.
select is((select count(*) from game.accounts where system_key = 'sink_festivals' and not allow_negative),
  (select count(*) from game.worlds), 'un puits des fêtes par monde, jamais débiteur');

-- Garde des décrets : un décret de dépense est réglé une fois, au jour d'une clôture que la transaction écrit.
select throws_ok(pg_temp.check(pg_temp.settle('1', 'applied', 40000)), '23001',
  'a spending decree is applied with its payment, and lapses without one', 'pas d''application sans paiement');
select throws_ok(pg_temp.check($s$with e as (insert into game.ledger_entries (world_id, kind, meta) values
    ('01900000-0000-7000-8000-000000000001', 'city.public_works', '{"decreeId": "00000000-0000-7000-8000-0000000140d1"}') returning id)
  insert into game.ledger_lines (entry_id, account_id, amount) select e.id, a.id, case when a.system_key = 'sink_public_works'
    then 600 else -600 end from e, game.accounts a where a.world_id = '01900000-0000-7000-8000-000000000001'
    and a.system_key in ('sink_public_works', 'faucet_npc_purchases');$s$ || pg_temp.settle('1', 'applied', 40000)), '23001',
  'a spending decree is applied with its payment, and lapses without one', 'ni avec une écriture qui ne débite pas le trésor de sa cité');
select throws_ok(pg_temp.check(pg_temp.pay('1', 600)
  || 'update game.decrees set status = ''applied'', applied_at = now() where id = ''00000000-0000-7000-8000-0000000140d1'';'),
  '23001', 'a spending decree is settled once, now, on its close', 'ni sans jour de règlement');
select throws_ok(pg_temp.check(pg_temp.pay('1', 600) || replace(pg_temp.settle('1', 'applied', 40000), 'now()', 'now() - interval ''1 day''')),
  '23001', 'a spending decree is settled once, now, on its close', 'ni à une date choisie');
select throws_ok(pg_temp.check(pg_temp.settle('3', 'lapsed', 40000, false)), '23503', null,
  'ni pour un jour dont la clôture n''est pas écrite avec lui (contrôle différé)');
select lives_ok($$select pg_temp.as_service($s$insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
  values ('01900000-0000-7000-8000-000000000001', 39990, now() - interval '1 day', '00000000-0000-7000-8000-0000000140c1')$s$)$$,
  'une clôture plus ancienne est déjà écrite');
select throws_ok(pg_temp.check(pg_temp.settle('3', 'lapsed', 39990, false)), '23001',
  'a spending decree is settled before its close is recorded', 'ni au jour d''une clôture déjà écrite');
select throws_ok(pg_temp.check(pg_temp.pay('3', 600) || pg_temp.settle('3', 'lapsed', 40000)), '23001',
  'a spending decree is applied with its payment, and lapses without one', 'un décret payé ne devient pas caduc');
select throws_ok(pg_temp.check(pg_temp.settle('4', 'lapsed', 40000)), '23001', 'a decree is applied once, now',
  'un décret de taux ne devient pas caduc');
select throws_ok(pg_temp.check(replace(pg_temp.settle('4', 'applied', 40000), 'settled_day = 40000', 'settled_day = 40000, votes_for = 2')),
  '23001', 'a decree is applied once, now', 'le règlement ne change pas le dépouillement');
select throws_ok(pg_temp.check(pg_temp.settle('4', 'applied', 40000)), '23001', 'a decree is applied once, now',
  'un décret de taux n''a pas de jour de règlement');

-- Le trésor ne paie que la dépense d'un décret de sa cité appliqué, au puits de son modèle, au plus le montant voté.
select throws_ok(pg_temp.check(pg_temp.pay('1', 600, 'test.spend')), '23514', pg_temp.refused(), 'pas de débit du trésor hors d''une dépense');
select throws_ok(pg_temp.check(pg_temp.pay('1', 600)), '23514', pg_temp.refused(), 'ni pour un décret qui n''est pas appliqué');
select throws_ok(pg_temp.check(pg_temp.pay('1', 601) || pg_temp.settle('1', 'applied', 40000)), '23514', pg_temp.refused(),
  'ni plus que le montant voté');
select throws_ok(pg_temp.check(pg_temp.pay('1', 600, 'city.public_works', 'sink_festivals') || pg_temp.settle('1', 'applied', 40000)),
  '23514', pg_temp.refused(), 'ni vers le puits d''un autre modèle');
select throws_ok(pg_temp.check(pg_temp.pay('2', 300) || pg_temp.settle('2', 'applied', 40000)), '23001', null,
  'une fête ne se paie pas comme des grands travaux');
select throws_ok(pg_temp.check(pg_temp.pay('5', 600) || pg_temp.settle('5', 'applied', 40000)), '23001',
  'a spending decree is applied with its payment, and lapses without one', 'ni le décret d''une autre cité');
select throws_ok(pg_temp.check(pg_temp.pay('6', 5000) || pg_temp.settle('6', 'applied', 40000)), '23514',
  'new row for relation "accounts" violates check constraint "accounts_no_overdraft"', 'le trésor n''est jamais débiteur');
select is(pg_temp.balance('01900000-0000-7000-8000-000000000101'), 1000::bigint, 'rien n''est sorti du trésor');

-- Une clôture règle trois décrets : grands travaux payés, fête payée, grands travaux devenus caducs.
select lives_ok(pg_temp.check(pg_temp.pay('1', 600) || pg_temp.settle('1', 'applied', 40000, false)
  || pg_temp.pay('2', 300, 'city.festival', 'sink_festivals') || pg_temp.settle('2', 'applied', 40000, false)
  || pg_temp.settle('3', 'lapsed', 40000)), 'appliqués avec leur paiement, ou caducs, à la clôture qui les règle');
select is((select string_agg(status || ':' || coalesce((applied_at = now())::text, '-') || ':' || settled_day, ' ' order by id)
           from game.decrees where id between '00000000-0000-7000-8000-0000000140d1' and '00000000-0000-7000-8000-0000000140d3'),
  'applied:true:40000 applied:true:40000 lapsed:-:40000', 'datés de la transaction, au jour de la clôture');
select is(array[pg_temp.balance('01900000-0000-7000-8000-000000000101'), pg_temp.balance('sink_public_works'),
  pg_temp.balance('sink_festivals')], array[100, 600, 300]::bigint[], 'du trésor aux puits, somme nulle');
select throws_ok(pg_temp.check(pg_temp.pay('1', 50)), '23505', null, 'une seule dépense par décret (index unique)');
select throws_ok(pg_temp.check(pg_temp.settle('1', 'lapsed', 40001)), '23001', null, '`applied` est final');
select throws_ok(pg_temp.check(pg_temp.settle('3', 'applied', 40001)), '23001', null, '`lapsed` aussi');
select lives_ok($$select pg_temp.as_service('insert into game.domain_events (type, payload)
  values (''DecreeLapsed'', ''{"decreeId": "00000000-0000-7000-8000-0000000140d3"}'')')$$, 'la caducité est annoncée');
select throws_ok($$select pg_temp.as_service('insert into game.domain_events (type, payload)
  values (''DecreeLapsed'', ''{"decreeId": "00000000-0000-7000-8000-0000000140d3"}'')')$$, '23505', null,
  'une seule fois par décret (index unique)');
select is((select count(*) from game.account_balance_check where not ok), 0::bigint,
  'solde = cumul des lignes pour tous les comptes');

-- Joueur : il lit le règlement des décrets, ne le modifie pas, et ne lit toujours pas le compte du trésor.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000140ab", "role": "authenticated"}';
select is((select string_agg(status || ':' || coalesce(settled_day::text, '-'), ' ' order by id) from public.decrees
           where id between '00000000-0000-7000-8000-0000000140d1' and '00000000-0000-7000-8000-0000000140d4'),
  'applied:40000 applied:40000 lapsed:40000 adopted:-', 'un joueur lit l''état et le jour du règlement de chaque décret');
select throws_ok($$update game.decrees set status = 'lapsed', settled_day = 40000 where id = '00000000-0000-7000-8000-0000000140d6'$$,
  '42501', null, 'mais ne règle aucun décret');
select is((select count(*) from game.accounts where kind = 'treasury'), 0::bigint, 'ni ne lit le compte du trésor');
reset role;

select * from finish();
rollback;
