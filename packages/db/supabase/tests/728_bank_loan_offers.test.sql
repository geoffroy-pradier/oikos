begin;
select plan(19);

-- Jeu d'essai : un monde à lui, une cité, un logement. Alice (a) tient la banque ; Bob (b) et Chloé (c) sont des maisons
-- de joueur, les Greniers (e) une maison PNJ ; Zénon (f) vit dans un autre monde.
insert into game.worlds (id, slug, name) values
  ('01900000-0000-7000-8000-0000000728f0', 'offres-728', 'Offres'),
  ('01900000-0000-7000-8000-0000000728f9', 'ailleurs-728', 'Ailleurs');
insert into game.cities (id, world_id, slug, name) values
  ('01900000-0000-7000-8000-0000000728c1', '01900000-0000-7000-8000-0000000728f0', 'k728', 'Kallistè'),
  ('01900000-0000-7000-8000-0000000728c9', '01900000-0000-7000-8000-0000000728f9', 'z728', 'Zakynthos');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000728a' || n)::uuid, 'offers-728-' || n || '@example.test'
from unnest(array['a', 'b', 'c', 'f']) n;
insert into game.houses (id, world_id, user_id, name, blazon, kind)
select ('00000000-0000-7000-8000-0000000728' || n || '1')::uuid, w::uuid,
       case when kind = 'player' then ('00000000-0000-4000-8000-0000000728a' || n)::uuid end, name, '{}', kind
from (values ('a', 'Alcméonides', 'player', '01900000-0000-7000-8000-0000000728f0'),
             ('b', 'Philaïdes', 'player', '01900000-0000-7000-8000-0000000728f0'),
             ('c', 'Kerykes', 'player', '01900000-0000-7000-8000-0000000728f0'),
             ('e', 'Greniers', 'npc', '01900000-0000-7000-8000-0000000728f0'),
             ('f', 'Zénonides', 'player', '01900000-0000-7000-8000-0000000728f9')) h (n, name, kind, w);
insert into game.citizenships (house_id, city_id)
select id, case world_id when '01900000-0000-7000-8000-0000000728f0' then '01900000-0000-7000-8000-0000000728c1'::uuid
                         else '01900000-0000-7000-8000-0000000728c9'::uuid end
from game.houses where world_id in ('01900000-0000-7000-8000-0000000728f0', '01900000-0000-7000-8000-0000000728f9');
insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
values ('01900000-0000-7000-8000-0000000728f0', '01900000-0000-7000-8000-0000000728c1',
        '00000000-0000-7000-8000-0000000728a1', 'Trapeza Alkmaion', 100, 800, 0);
insert into game.properties (id, world_id, city_id, size_id, lot) values
  ('01900000-0000-7000-8000-0000000728d1', '01900000-0000-7000-8000-0000000728f0', '01900000-0000-7000-8000-0000000728c1',
   'townhouse', 1);

create function pg_temp.house(n text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000000728' || n || '1')::uuid
$$;
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
-- Offre de la banque d'Alice à la maison `n`, au nom du service : un stock de 10 olives à Kallistè, ou le logement.
create function pg_temp.offer(n text, kind text = 'stock', principal bigint = 1000) returns void language plpgsql as $$
begin
  perform pg_temp.as_service(format(
    'insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days,
       collateral_kind, collateral_city_id, collateral_good_id, collateral_quantity, collateral_property_id)
     values (%L, (select id from game.banks where house_id = %L), %L, %s, 1200, 30, %L, %L, %L, %s, %L)',
    '01900000-0000-7000-8000-0000000728f0', pg_temp.house('a'), pg_temp.house(n), principal, kind,
    case kind when 'stock' then '01900000-0000-7000-8000-0000000728c1' end, case kind when 'stock' then 'olives' end,
    case kind when 'stock' then '10' else 'null' end,
    case kind when 'property' then '01900000-0000-7000-8000-0000000728d1' end));
end $$;
create function pg_temp.last_offer() returns uuid language sql as $$
  select id from game.bank_loan_offers where world_id = '01900000-0000-7000-8000-0000000728f0'
  order by created_at desc, id desc limit 1
$$;

-- 1. Naissance : ouverte, maintenant, d'un stock ou d'un logement de l'emprunteur.
select lives_ok($$select pg_temp.offer('b')$$, 'le service offre un prêt gagé sur un stock');
select results_eq($$select status, created_at = now(), closed_at is null from game.bank_loan_offers where id = pg_temp.last_offer()$$,
  $$values ('open', true, true)$$, 'une offre naît ouverte, maintenant');
select lives_ok($$select pg_temp.offer('c', 'property')$$, 'le service offre un prêt gagé sur un logement');
select throws_ok($$select pg_temp.as_service(format(
  'insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days, collateral_kind,
     collateral_property_id) values (%L, (select id from game.banks limit 1), %L, 1000, 1200, 30, %L, %L)',
  '01900000-0000-7000-8000-0000000728f0', pg_temp.house('b'), 'stock', '01900000-0000-7000-8000-0000000728d1'))$$,
  '23514', null, 'une garantie de stock nomme sa cité, son bien et sa quantité, et rien d''autre');
select throws_ok($$select pg_temp.offer('a')$$, '23514', null, 'une banque ne prête pas à sa propre maison');
select throws_ok($$select pg_temp.offer('e')$$, '23514', null, 'une maison PNJ ne reçoit pas d''offre');
select throws_ok($$select pg_temp.offer('f')$$, '23503', null, 'une offre ne sort pas du monde de la banque');
select throws_ok($$select pg_temp.offer('b', 'stock', 0)$$, '23514', null, 'un principal nul ne s''offre pas');
select throws_ok($$select pg_temp.as_service(format(
  'insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days, collateral_kind,
     collateral_property_id, status) values (%L, (select id from game.banks limit 1), %L, 1000, 1200, 30, %L, %L, %L)',
  '01900000-0000-7000-8000-0000000728f0', pg_temp.house('c'), 'property', '01900000-0000-7000-8000-0000000728d1',
  'accepted'))$$, '42501', null, 'le service ne choisit pas l''état d''une offre');

-- 2. Retrait : une fois, daté de la transaction ; l'acceptation n'appartient qu'au prêt (migration 0301).
select lives_ok($$select pg_temp.as_service(format(
  'update game.bank_loan_offers set status = %L where id = %L', 'withdrawn', pg_temp.last_offer()))$$,
  'le service retire une offre ouverte');
select results_eq($$select status, closed_at = now() from game.bank_loan_offers where id = pg_temp.last_offer()$$,
  $$values ('withdrawn', true)$$, 'le retrait ferme l''offre à l''instant de la transaction');
select throws_ok($$select pg_temp.as_service(format(
  'update game.bank_loan_offers set status = %L where id = %L', 'open', pg_temp.last_offer()))$$,
  '23001', null, 'une offre fermée ne rouvre pas');
select throws_ok($$select pg_temp.as_service(format(
  'update game.bank_loan_offers set status = %L where borrower_house_id = %L', 'accepted', pg_temp.house('b')))$$,
  '23001', null, 'le service n''accepte pas une offre sans son prêt');
select throws_ok($$select pg_temp.as_service(format(
  'update game.bank_loan_offers set principal = 1 where borrower_house_id = %L', pg_temp.house('b')))$$,
  '42501', null, 'le service ne change pas les conditions d''une offre');
select throws_ok($$update game.bank_loan_offers set rate_bps = 0 where borrower_house_id = '00000000-0000-7000-8000-0000000728b1'$$,
  '23001', null, 'même le propriétaire de la base ne change pas les conditions d''une offre');
select throws_ok($$delete from game.bank_loan_offers where borrower_house_id = '00000000-0000-7000-8000-0000000728b1'$$,
  '23001', null, 'une offre ne se supprime pas');
select throws_ok($$select pg_temp.as_service(format(
  'delete from game.bank_loan_offers where borrower_house_id = %L', pg_temp.house('b')))$$,
  '42501', null, 'le service ne supprime pas d''offre');

-- 3. Aucun joueur ni visiteur ne lit la table avant les lectures de la migration 0304, ni n'y écrit.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000728ab", "role": "authenticated"}', true);
select throws_ok($$insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days,
  collateral_kind, collateral_property_id) values ('01900000-0000-7000-8000-0000000728f0',
  '01900000-0000-7000-8000-0000000728f0', '00000000-0000-7000-8000-0000000728b1', 1, 0, 1, 'property',
  '01900000-0000-7000-8000-0000000728d1')$$, '42501', null, 'un joueur n''écrit pas d''offre');
reset role;
set local role anon;
select throws_ok($$select count(*) from game.bank_loan_offers$$, '42501', null, 'un visiteur ne lit pas les offres');
reset role;

select * from finish();
rollback;
