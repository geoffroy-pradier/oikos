begin;
select plan(29);

-- Règlement des décrets de ligue (6.3, 6.5, #737). La charge d'Alice, archonte de Kallistè (101), sert à tous les décrets,
-- posés adoptés garde levée ; la ligue L, ses membres et leurs sorties sont écrits par le service, sous leurs gardes.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000007370aa', 'league-decrees-a@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values ('00000000-0000-7000-8000-0000007370a1',
  '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000007370aa', 'Alcméonides', '{}');
alter table game.elections disable trigger elections_guard;
alter table game.offices disable trigger offices_guard;
insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
values ('00000000-0000-7000-8000-00000073700a', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000101', 'archon',
  now() - interval '8 days', now() - interval '4 days', now() - interval '1 day', now() + interval '27 days', now());
insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
select id, world_id, city_id, office, '00000000-0000-7000-8000-0000007370a1', id, voting_closes_at, term_ends_at
from game.elections where id = '00000000-0000-7000-8000-00000073700a';
alter table game.elections enable trigger elections_guard;
alter table game.offices enable trigger offices_guard;

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.svc(statement text) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', statement)
$$;
create function pg_temp.d(key text) returns uuid language sql as $$ select md5('decree-737-' || key)::uuid $$;
create function pg_temp.c(key text) returns uuid language sql as $$ select ('01900000-0000-7000-8000-000000000' || key)::uuid $$;
create function pg_temp.league(founding text) returns uuid language sql as $$
  select id from game.leagues where founding_decree_id = pg_temp.d(founding)
$$;
-- Décret adopté, posé garde levée.
create function pg_temp.decree(key text, city text, model text, params jsonb, status text default 'adopted') returns void
language plpgsql as $$
begin
  alter table game.decrees disable trigger decrees_guard;
  insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at,
    quorum_bps, status, tallied_at, electorate, votes_for, votes_against, applied_at)
  values (pg_temp.d(key), '01900000-0000-7000-8000-000000000001', pg_temp.c(city), model, params,
    '00000000-0000-7000-8000-00000073700a', '00000000-0000-7000-8000-0000007370a1', now() - interval '6 days',
    now() - interval '4 days', 0, status, now() - interval '4 days', 0, 0, 0,
    case status when 'applied' then now() - interval '1 hour' end);
  alter table game.decrees enable trigger decrees_guard;
end $$;
create function pg_temp.found(key text, city text, name text) returns text language sql as $$
  select pg_temp.svc(format('insert into game.leagues (world_id, name, hegemon_city_id, founding_decree_id) values (%L, %L, %L, %L)',
    '01900000-0000-7000-8000-000000000001', name, pg_temp.c(city), pg_temp.d(key)))
$$;
create function pg_temp.enter(founding text, city text, entry text) returns text language sql as $$
  select pg_temp.svc(format('insert into game.league_members (league_id, world_id, city_id, entry_decree_id) values (%L, %L, %L, %L)',
    pg_temp.league(founding), '01900000-0000-7000-8000-000000000001', pg_temp.c(city), pg_temp.d(entry)))
$$;
create function pg_temp.leave(city text, reason text, exit text default null) returns text language sql as $$
  select pg_temp.svc(format('update game.league_members set left_at = now(), exit_reason = %L, exit_decree_id = %L '
    'where city_id = %L and left_at is null', reason, pg_temp.d(exit), pg_temp.c(city)))
$$;

-- Règlement d'un décret, une fois, maintenant ; `extra` change une colonne de plus.
create function pg_temp.settle(key text, status text, extra text default '') returns text language sql as $$
  select pg_temp.svc(format('update game.decrees set status = %L, applied_at = %s%s where id = %L', status,
    case status when 'applied' then 'now()' else 'null' end, extra, pg_temp.d(key)))
$$;

-- Refus d'un règlement sans son effet, ou caduc avec lui.
create function pg_temp.refused(statement text, description text) returns text language sql as $$
  select throws_ok(statement, '23001', 'a league decree is applied with its effect, and lapses without one', description)
$$;

-- Fondation : appliquée avec sa ligue et son membre fondateur, caduque sans eux, une fois.
select pg_temp.decree('f1', '101', 'league_found', '{"name": "Ligue de Délos"}');
select pg_temp.refused(pg_temp.settle('f1', 'applied'), 'une fondation n''est pas appliquée sans sa ligue');
select lives_ok(pg_temp.found('f1', '101', 'Ligue de Délos'), 'Kallistè fonde la ligue de Délos');
select pg_temp.refused(pg_temp.settle('f1', 'applied'), 'ni sans son membre fondateur');
select pg_temp.refused(pg_temp.settle('f1', 'lapsed'), 'ni caduque une fois sa ligue écrite');
select lives_ok(pg_temp.enter('f1', '101', 'f1'), 'Kallistè est membre de sa ligue');
select throws_ok(pg_temp.settle('f1', 'applied', ', settled_day = 1'), '23001', 'a league decree is settled once, now',
  'un décret de ligue n''a pas de jour de règlement');
select throws_ok(pg_temp.svc(format('update game.decrees set status = ''applied'', applied_at = now() - interval ''1 hour'' where id = %L',
  pg_temp.d('f1'))), '23001', 'a league decree is settled once, now', 'il est appliqué maintenant');
select lives_ok(pg_temp.settle('f1', 'applied'), 'la fondation est appliquée');
select throws_ok(pg_temp.settle('f1', 'lapsed'), '23001', 'a decree is tallied once, now', 'une fois');
select pg_temp.decree('f3', '101', 'league_found', '{"name": "Ligue de Paros"}');
select lives_ok(pg_temp.settle('f3', 'lapsed'), 'une seconde fondation de Kallistè est caduque, sans ligue');

-- Demande d'entrée : appliquée pour une cité hors de toute ligue qui vise une ligue en activité de son monde.
select pg_temp.decree('j1', '101', 'league_join', jsonb_build_object('leagueId', pg_temp.league('f1')));
select pg_temp.decree('jx', '104', 'league_join', '{"leagueId": "not-a-league"}');
select pg_temp.decree('j3', '103', 'league_join', jsonb_build_object('leagueId', pg_temp.league('f1')));
select pg_temp.refused(pg_temp.settle('j1', 'applied'), 'Kallistè est déjà dans une ligue');
select lives_ok(pg_temp.settle('j1', 'lapsed'), 'sa demande est caduque');
select pg_temp.refused(pg_temp.settle('jx', 'applied'), 'une demande vise une ligue qui existe');
select lives_ok(pg_temp.settle('jx', 'lapsed'), 'sinon elle est caduque');
select lives_ok(pg_temp.settle('j3', 'applied'), 'Elaia demande à entrer');

-- Admission et départ : appliqués avec l'entrée ou la sortie de la cité qu'ils écrivent.
select pg_temp.decree('a3', '101', 'league_admit', jsonb_build_object('joinDecreeId', pg_temp.d('j3')));
select pg_temp.refused(pg_temp.settle('a3', 'applied'), 'une admission n''est pas appliquée sans son membre');
select lives_ok(pg_temp.enter('f1', '103', 'a3'), 'Kallistè admet Elaia');
select pg_temp.refused(pg_temp.settle('a3', 'lapsed'), 'une admission écrite n''est pas caduque');
select lives_ok(pg_temp.settle('a3', 'applied'), 'l''admission est appliquée');
select pg_temp.decree('l3', '103', 'league_leave', '{}');
select pg_temp.decree('l4', '104', 'league_leave', '{}');
select pg_temp.refused(pg_temp.settle('l3', 'applied'), 'un départ n''est pas appliqué sans la sortie de sa cité');
select lives_ok(pg_temp.leave('103', 'left', 'l3'), 'Elaia quitte la ligue');
select lives_ok(pg_temp.settle('l3', 'applied'), 'son départ est appliqué');
select pg_temp.refused(pg_temp.settle('l4', 'applied'), 'Ampelos, hors de toute ligue, ne la quitte pas');
select lives_ok(pg_temp.settle('l4', 'lapsed'), 'son départ est caduc');

-- Identifiants en majuscules dans les paramètres : comparés sans casse, par la garde des décrets comme par celle des
-- membres. Une admission ne vaut que pour une demande vers sa ligue.
select pg_temp.decree('j5', '105', 'league_join', jsonb_build_object('leagueId', upper(pg_temp.league('f1')::text)));
select lives_ok(pg_temp.settle('j5', 'applied'), 'Halos demande à entrer, l''identifiant de la ligue en majuscules');
select pg_temp.decree('a5', '101', 'league_admit', jsonb_build_object('joinDecreeId', upper(pg_temp.d('j5')::text)));
select lives_ok(pg_temp.enter('f1', '105', 'a5'), 'Kallistè l''admet, l''identifiant de la demande en majuscules');
select lives_ok(pg_temp.settle('a5', 'applied'), 'et l''admission est appliquée');
select pg_temp.decree('jy', '121', 'league_join', jsonb_build_object('leagueId', md5('other')::uuid), 'applied');
select pg_temp.decree('ay', '101', 'league_admit', jsonb_build_object('joinDecreeId', pg_temp.d('jy')));
select throws_ok(pg_temp.enter('f1', '121', 'ay'), '23514', null, 'une admission n''admet qu''une demande vers sa ligue');
select is((select string_agg(status, ' ' order by status) from game.decrees where model like 'league_%'),
  'adopted applied applied applied applied applied applied applied lapsed lapsed lapsed lapsed',
  'les décrets réglés une fois chacun, l''admission refusée encore adoptée');

select * from finish();
rollback;
