begin;
select plan(40);

-- Jeu d'essai, monde de test. Kallistè (101) : Alice (archonte), Bob, citoyens depuis dix jours ; Chloé, métèque ;
-- Eudore, citoyen à l'instant. Elaia (103) : Dion. Ampelos (104) : Phaon et Glaucos. Décrets posés garde levée :
-- O, ostracisme adopté de Kallistè ; P, ostracisme au vote ; W, grands travaux adoptés ; X, Y, Z ostracismes
-- adoptés de Kallistè, Elaia et Ampelos, dont les votes, ouverts il y a trois jours, sont clos depuis une heure.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000007220a' || u)::uuid, 'ostracism-' || u || '@example.test'
from unnest(array['a', 'b', 'c', 'd', 'e', 'f', '0']) u;
insert into game.houses (id, world_id, user_id, name, blazon)
select ('00000000-0000-7000-8000-0000007220' || u || '1')::uuid, '01900000-0000-7000-8000-000000000001',
       ('00000000-0000-4000-8000-0000007220a' || u)::uuid, n, '{}'
from (values ('a', 'Alcméonides'), ('b', 'Philaïdes'), ('c', 'Bouzyges'), ('d', 'Étéoboutades'), ('e', 'Eunides'),
  ('f', 'Phytalides'), ('0', 'Glaucides')) as v (u, n);
insert into game.citizenships (house_id, city_id)
select ('00000000-0000-7000-8000-0000007220' || u || '1')::uuid, ('01900000-0000-7000-8000-000000000' || c)::uuid
from (values ('a', '101'), ('b', '101'), ('c', '101'), ('d', '103'), ('e', '101'), ('f', '104'), ('0', '104')) as v (u, c);
update game.citizenships set status = 'citizen', since = now() where house_id = '00000000-0000-7000-8000-0000007220e1';
alter table game.citizenships disable trigger citizenships_guard;
update game.citizenships set status = 'citizen', since = now() - interval '10 days'
where house_id::text like '00000000-0000-7000-8000-0000007220%' and right(house_id::text, 2) in ('a1', 'b1', 'd1', 'f1', '01');
alter table game.citizenships enable trigger citizenships_guard;
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
alter table game.decrees disable trigger decrees_guard;
alter table game.ostracisms disable trigger ostracisms_guard;
alter table game.ostraca disable trigger ostraca_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values ('00000000-0000-7000-8000-00000072200a', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
  now() - interval '8 days', now() - interval '4 days', now() - interval '1 day', now() + interval '27 days', now());
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select id, world_id, city_id, office, '00000000-0000-7000-8000-0000007220a1', id, voting_closes_at, term_ends_at
from game.elections where id = '00000000-0000-7000-8000-00000072200a';
insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at, quorum_bps,
  status, tallied_at, electorate, votes_for, votes_against)
select ('00000000-0000-7000-8000-0000007220d' || d)::uuid, '01900000-0000-7000-8000-000000000001', ('01900000-0000-7000-8000-000000000' || c)::uuid,
       m, case m when 'ostracism' then '{}'::jsonb else '{"amountOboles": 600}' end, '00000000-0000-7000-8000-00000072200a',
       '00000000-0000-7000-8000-0000007220a1', now() - interval '6 days', now() - interval '4 days', 0, s,
       case s when 'adopted' then now() - interval '4 days' end, case s when 'adopted' then 0 end,
       case s when 'adopted' then 0 end, case s when 'adopted' then 0 end
from (values ('0', '101', 'ostracism', 'adopted'), ('1', '101', 'ostracism', 'proposed'), ('2', '101', 'public_works', 'adopted'),
  ('7', '101', 'ostracism', 'adopted'), ('8', '103', 'ostracism', 'adopted'), ('9', '104', 'ostracism', 'adopted')) as v (d, c, m, s);
insert into game.ostracisms (id, world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days)
select ('00000000-0000-7000-8000-0000007220e' || d)::uuid, '01900000-0000-7000-8000-000000000001', ('01900000-0000-7000-8000-000000000' || c)::uuid,
       ('00000000-0000-7000-8000-0000007220d' || d)::uuid, now() - interval '3 days', now() - interval '1 hour', q, 7
from (values ('7', '101', 5000), ('8', '103', 5000), ('9', '104', 0)) as v (d, c, q);
-- X : Alice et Bob nomment Bob (Eudore, devenu citoyen après la fin du vote, n'est pas compté). Z : égalité.
insert into game.ostraca (ostracism_id, house_id, target_house_id, cast_at)
select ('00000000-0000-7000-8000-0000007220e' || o)::uuid, ('00000000-0000-7000-8000-0000007220' || h || '1')::uuid,
       ('00000000-0000-7000-8000-0000007220' || t || '1')::uuid, now() - interval '2 days'
from (values ('7', 'a', 'b'), ('7', 'b', 'b'), ('9', 'f', '0'), ('9', '0', 'f')) as v (o, h, t);
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;
alter table game.decrees enable trigger decrees_guard;
alter table game.ostracisms enable trigger ostracisms_guard;
alter table game.ostraca enable trigger ostraca_guard;

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.id(kind text, key text) returns uuid language sql as $$
  select ('00000000-0000-7000-8000-0000007220' || kind || key)::uuid
$$;
-- Ouverture du vote du décret `decree` dans la cité `city`, clos dans trois jours.
create function pg_temp.open(decree text, city text default '101') returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.ostracisms (world_id, city_id, decree_id, voting_closes_at, quorum_bps, ostracism_days) '
    'values (%L, %L, %L, now() + interval ''3 days'', 3000, 7)',
    '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000' || city, pg_temp.id('d', decree)))
$$;
create function pg_temp.ostracism(decree text) returns uuid language sql as $$
  select id from game.ostracisms where decree_id = pg_temp.id('d', decree)
$$;
create function pg_temp.cast_(house text, target text, decree text default '0') returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.ostraca (ostracism_id, house_id, target_house_id) values (%L, %L, %L)',
    pg_temp.ostracism(decree), pg_temp.id(house, '1'), pg_temp.id(target, '1')))
$$;
-- Dépouillement : citoyens, bulletins, issue, maison ostracisée et fin (en jours après maintenant).
create function pg_temp.tally(decree text, electorate int, ballots int, outcome text, house text default null,
  days int default null) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'update game.ostracisms set tallied_at = now(), electorate = %s, ballots = %s, outcome = %L, ostracized_house_id = %L, '
    'ends_at = now() + %L::interval where id = %L', electorate, ballots, outcome,
    case when house is not null then pg_temp.id(house, '1') end, days || ' days', pg_temp.ostracism(decree)))
$$;

select ok(relrowsecurity, format('règles par ligne actives sur game.%s', relname))
from pg_class where oid in ('game.ostracisms'::regclass, 'game.ostraca'::regclass) order by relname;
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('ostracisms', 'ostraca') and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'ostraca.house_id:INSERT ostraca.ostracism_id:INSERT ostraca.target_house_id:INSERT '
    || 'ostracisms.ballots:UPDATE ostracisms.city_id:INSERT ostracisms.decree_id:INSERT ostracisms.electorate:UPDATE '
    || 'ostracisms.ends_at:UPDATE ostracisms.ostracism_days:INSERT ostracisms.ostracized_house_id:UPDATE ostracisms.outcome:UPDATE '
    || 'ostracisms.quorum_bps:INSERT ostracisms.tallied_at:UPDATE ostracisms.voting_closes_at:INSERT ostracisms.world_id:INSERT',
  'le service ne choisit ni identifiant, ni date d''ouverture, ni bulletin déjà daté : liste figée');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'game' and table_name in ('ostracisms', 'ostraca') and grantee in ('anon', 'authenticated', 'oikos_service')
     and privilege_type <> 'SELECT'),
  null, 'aucune suppression, aucune écriture de table entière, rien pour les joueurs');

-- Ouverture.
select throws_ok(pg_temp.open('0'), '23505', null, 'un seul vote non dépouillé par cité : X l''est encore');
select throws_ok(pg_temp.open('1'), '23514', null, 'un décret encore au vote n''ouvre rien');
select throws_ok(pg_temp.open('2'), '23514', null, 'un décret adopté d''un autre modèle non plus');
select throws_ok(pg_temp.open('0', '103'), '23514', null, 'le vote est celui de la cité du décret');
select throws_ok(
  $$select pg_temp.as_service('insert into game.ostracisms (world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days)
    values (''01900000-0000-7000-8000-000000000001'', ''01900000-0000-7000-8000-000000000101'', ''00000000-0000-7000-8000-0000007220d0'',
    now() - interval ''1 day'', now() + interval ''1 day'', 0, 7)')$$,
  '42501', null, 'le service ne date pas l''ouverture');

-- Dépouillement de X, Y, Z : la base recompte bulletins et citoyens devenus citoyens avant la fin du vote.
select throws_ok(pg_temp.tally('7', 3, 2, 'ostracized', 'b', 7), '23001', null, 'Eudore, citoyen après la fin du vote, n''est pas compté');
select throws_ok(pg_temp.tally('7', 2, 2, 'tie'), '23001', null, 'Bob seul en tête : pas d''égalité');
select throws_ok(pg_temp.tally('7', 2, 2, 'ostracized', 'a', 7), '23001', null, 'c''est Bob le plus nommé, pas Alice');
select throws_ok(pg_temp.tally('7', 2, 2, 'ostracized', 'b', 9), '23001', null, 'pas plus de jours que le vote n''en fixe');
select throws_ok(pg_temp.tally('7', 2, 2, 'ostracized', 'b', 0), '23514', null, 'l''ostracisme finit après le dépouillement');
select throws_ok(pg_temp.tally('7', 2, 2, 'ostracized', 'b'), '23514', null, 'un ostracisé a une fin');
select lives_ok(pg_temp.tally('7', 2, 2, 'ostracized', 'b', 7), 'deux bulletins sur deux citoyens, Bob seul en tête : ostracisé');
select throws_ok(pg_temp.tally('7', 2, 2, 'ostracized', 'b', 7), '23001', null, 'un vote n''est dépouillé qu''une fois');
select throws_ok(pg_temp.tally('8', 1, 0, 'tie'), '23001', null, 'aucun bulletin sur un citoyen, quorum de 50 % : pas d''égalité');
select lives_ok(pg_temp.tally('8', 1, 0, 'no_quorum'), 'mais quorum manqué');
select throws_ok(pg_temp.tally('9', 2, 2, 'ostracized', '0', 7), '23001', null, 'Phaon et Glaucos à égalité : personne n''est ostracisé');
select lives_ok(pg_temp.tally('9', 2, 2, 'tie'), 'égalité, malgré le quorum nul');
select is((select string_agg(right(decree_id::text, 1) || ':' || outcome || ':' || coalesce(right(ostracized_house_id::text, 2), '-')
     || ':' || (tallied_at = now()), ' ' order by decree_id) from game.ostracisms),
  '7:ostracized:b1:true 8:no_quorum:-:true 9:tie:-:true', 'issues écrites, datées du dépouillement');
select throws_ok($$select pg_temp.as_service('update game.ostracisms set quorum_bps = 0')$$, '42501', null,
  'le service ne change pas les règles d''un vote');
select throws_ok('update game.ostracisms set voting_closes_at = now() + interval ''1 day''', '23001', null,
  'et la base le refuse à tous');

-- Le vote de Kallistè dépouillé, O ouvre le suivant, une seule fois.
select lives_ok(pg_temp.open('0'), 'un décret d''ostracisme adopté ouvre son vote');
select is((select (opened_at = now()) || ':' || (tallied_at is null) from game.ostracisms where id = pg_temp.ostracism('0')),
  'true:true', 'ouvert maintenant, non dépouillé');
select throws_ok(pg_temp.open('0'), '23505', null, 'un vote par décret');
select throws_ok(pg_temp.tally('0', 2, 0, 'no_quorum'), '23001', null, 'pas de dépouillement avant la fin du vote');

-- Bulletins.
select lives_ok(pg_temp.cast_('a', 'b'), 'un citoyen nomme un citoyen de sa cité, Bob, même ostracisé');
select lives_ok(pg_temp.cast_('e', 'a'), 'un citoyen d''aujourd''hui vote aussitôt');
select lives_ok(pg_temp.cast_('b', 'b'), 'et l''on peut se nommer soi-même');
select throws_ok(pg_temp.cast_('a', 'e'), '23505', null, 'un bulletin par maison et par vote');
select throws_ok(pg_temp.cast_('c', 'a'), '23514', null, 'un métèque ne vote pas');
select throws_ok(pg_temp.cast_('d', 'a'), '23514', null, 'ni le citoyen d''une autre cité');
select throws_ok(pg_temp.cast_('e', 'c'), '23514', null, 'on ne nomme pas un métèque');
select throws_ok(pg_temp.cast_('e', 'd'), '23514', null, 'ni un citoyen d''une autre cité');
select throws_ok(pg_temp.cast_('d', 'd', '8'), '23514', null, 'pas de bulletin dans un vote dépouillé');
select throws_ok($$select pg_temp.as_service('update game.ostraca set target_house_id = house_id')$$, '42501', null,
  'le service ne change pas un bulletin');
select throws_ok('update game.ostraca set target_house_id = house_id', '23001', null, 'et la base le refuse à tous');
select throws_ok($$select pg_temp.as_service('delete from game.ostraca')$$, '42501', null, 'ni ne supprime un bulletin');

select * from finish();
rollback;
