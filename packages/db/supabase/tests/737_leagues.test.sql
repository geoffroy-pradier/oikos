begin;
select plan(43);

-- Ligues (6.5, #737). La charge d'Alice, archonte de Kallistè (101), sert à tous les décrets, posés garde levée. Kallistè
-- fonde L ; quatre cités y entrent, Gamelia (122) en est refusée ; Delphis (123) et Agrotera (124) fondent puis dissolvent M.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000007370aa', 'leagues-a@example.test');
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
-- Décret adopté, posé garde levée ; une demande d'entrée est posée déjà appliquée, il y a une heure.
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

select ok(relrowsecurity, format('règles par ligne actives sur game.%s', relname))
from pg_class where oid in ('game.leagues'::regclass, 'game.league_members'::regclass) order by relname;
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('leagues', 'league_members') and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'league_members.city_id:INSERT league_members.entry_decree_id:INSERT league_members.exit_decree_id:UPDATE '
    || 'league_members.exit_reason:UPDATE league_members.league_id:INSERT league_members.left_at:UPDATE league_members.world_id:INSERT '
    || 'leagues.dissolved_at:UPDATE leagues.founding_decree_id:INSERT leagues.hegemon_city_id:INSERT leagues.hegemon_city_id:UPDATE '
    || 'leagues.name:INSERT leagues.world_id:INSERT',
  'le service ne choisit ni identifiant, ni date de fondation ou d''entrée : liste figée');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee, privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'game' and table_name in ('leagues', 'league_members') and grantee in ('anon', 'authenticated', 'oikos_service')
     and privilege_type <> 'SELECT'),
  null, 'aucune suppression, aucune écriture de table entière, rien pour les joueurs');

-- Fondation : par un décret de fondation adopté de la cité hégémon, sous le nom voté.
select pg_temp.decree('f1', '101', 'league_found', '{"name": "Ligue de Délos"}');
select pg_temp.decree('w0', '101', 'public_works', '{"amountOboles": 600}');
select throws_ok(pg_temp.found('f1', '101', 'Ligue de Paros'), '23514', null, 'le nom est celui du décret');
select throws_ok(pg_temp.found('f1', '103', 'Ligue de Délos'), '23514', null, 'l''hégémon est la cité du décret');
select throws_ok(pg_temp.found('w0', '101', 'Ligue de Délos'), '23514', null, 'un décret d''un autre modèle ne fonde rien');
select throws_ok(pg_temp.svc(format('insert into game.leagues (world_id, name, hegemon_city_id, founding_decree_id, founded_at) '
    'values (%L, %L, %L, %L, now() - interval ''1 day'')', '01900000-0000-7000-8000-000000000001', 'Ligue de Délos',
    pg_temp.c('101'), pg_temp.d('f1'))), '42501', null, 'le service ne date pas la fondation');
select lives_ok(pg_temp.found('f1', '101', 'Ligue de Délos'), 'Kallistè fonde la ligue de Délos');
select lives_ok(pg_temp.enter('f1', '101', 'f1'), 'Kallistè, fondatrice, en est membre');
select pg_temp.decree('f2', '103', 'league_found', '{"name": "ligue de délos"}');
select throws_ok(pg_temp.found('f2', '103', 'ligue de délos'), '23505', null, 'deux ligues en activité n''ont pas le même nom');
select pg_temp.decree('f3', '101', 'league_found', '{"name": "Ligue de Paros"}');
select throws_ok(pg_temp.found('f3', '101', 'Ligue de Paros'), '23514', null, 'une cité est dans une ligue au plus');

-- Admission : par un décret adopté de la cité hégémon, qui admet une demande d'entrée appliquée de la cité vers sa
-- ligue (Elaia l'a demandé il y a une heure).
select pg_temp.decree('j3', '103', 'league_join', jsonb_build_object('leagueId', pg_temp.league('f1')), 'applied');
select pg_temp.decree('a3', '101', 'league_admit', jsonb_build_object('joinDecreeId', pg_temp.d('j3')));
select pg_temp.decree('b3', '104', 'league_admit', jsonb_build_object('joinDecreeId', pg_temp.d('j3')));
select pg_temp.decree('c3', '101', 'league_admit', '{"joinDecreeId": "nothing"}');
select throws_ok(pg_temp.enter('f1', '103', 'b3'), '23514', null, 'Ampelos n''est pas l''hégémon de la ligue');
select throws_ok(pg_temp.enter('f1', '104', 'a3'), '23514', null, 'l''admission est celle de la cité qui l''a demandée');
select throws_ok(pg_temp.enter('f1', '103', 'c3'), '23514', null, 'une admission admet une demande d''entrée');
select lives_ok(pg_temp.enter('f1', '103', 'a3'), 'Kallistè admet Elaia');
select pg_temp.decree('d3', '101', 'league_admit', jsonb_build_object('joinDecreeId', pg_temp.d('j3')));
select throws_ok(pg_temp.enter('f1', '103', 'd3'), '23514', null, 'une demande déjà admise ne sert pas deux fois');

-- Cinq cités au plus : Ampelos, Halos et Dikaia entrent, Gamelia est refusée.
select pg_temp.decree('j' || c, '1' || c, 'league_join', jsonb_build_object('leagueId', pg_temp.league('f1')), 'applied'),
       pg_temp.decree('a' || c, '101', 'league_admit', jsonb_build_object('joinDecreeId', pg_temp.d('j' || c)))
from unnest(array['04', '05', '21', '22']) c;
select lives_ok(pg_temp.enter('f1', '1' || c, 'a' || c), format('la ligue admet la cité 1%s', c)) from unnest(array['04', '05', '21']) c;
select throws_ok(pg_temp.enter('f1', '122', 'a22'), '23514', null, 'une ligue a cinq cités au plus');

-- Départ : par un décret adopté de la cité, une fois, maintenant ; l'hégémonie passe au plus ancien membre restant.
select pg_temp.decree('l3', '103', 'league_leave', '{}');
select pg_temp.decree('l1', '101', 'league_leave', '{}');
select throws_ok(pg_temp.leave('103', 'left', 'l1'), '23514', null, 'Elaia part par son propre décret');
select throws_ok(pg_temp.svc(format('update game.league_members set left_at = now() - interval ''1 day'', exit_reason = ''left'', '
    'exit_decree_id = %L where city_id = %L', pg_temp.d('l3'), pg_temp.c('103'))), '23001', null, 'un départ est daté maintenant');
select lives_ok(pg_temp.leave('103', 'left', 'l3'), 'Elaia quitte la ligue');
select throws_ok(pg_temp.svc(format('update game.leagues set hegemon_city_id = %L where id = %L', pg_temp.c('104'), pg_temp.league('f1'))),
  '23001', null, 'l''hégémonie ne change pas tant que l''hégémon reste');
select lives_ok(pg_temp.leave('101', 'left', 'l1'), 'Kallistè, hégémon, quitte la ligue');
-- Ampelos, Halos et Dikaia sont entrées dans la même transaction : à date égale, le plus petit identifiant l'emporte.
create function pg_temp.member(rank text) returns uuid language sql as $$
  select city_id from game.league_members where league_id = pg_temp.league('f1') and left_at is null
  order by joined_at, id offset case rank when 'oldest' then 0 else 1 end limit 1
$$;
select throws_ok(pg_temp.svc(format('update game.leagues set hegemon_city_id = %L where id = %L', pg_temp.member('next'), pg_temp.league('f1'))),
  '23001', null, 'l''hégémonie va au plus ancien membre, pas à un autre');
select lives_ok(pg_temp.svc(format('update game.leagues set hegemon_city_id = %L where id = %L', pg_temp.member('oldest'), pg_temp.league('f1'))),
  'elle va au plus ancien membre restant');
select throws_ok(pg_temp.leave('105', 'dissolved'), '23514', null, 'une ligue qui garde deux cités ne se dissout pas');
select throws_ok(pg_temp.svc(format('update game.leagues set dissolved_at = now() where id = %L', pg_temp.league('f1'))),
  '23001', null, 'ni tant qu''elle a des membres');

-- Dissolution : Delphis fonde M, Agrotera y entre puis s'en va ; Delphis, restée seule, en sort, et M se dissout.
select pg_temp.decree('f4', '123', 'league_found', '{"name": "Ligue de Naxos"}');
select lives_ok(pg_temp.found('f4', '123', 'Ligue de Naxos'), 'Delphis fonde M');
select lives_ok(pg_temp.enter('f4', '123', 'f4'), 'et en est membre');
select pg_temp.decree('j24', '124', 'league_join', jsonb_build_object('leagueId', pg_temp.league('f4')), 'applied');
select pg_temp.decree('a24', '123', 'league_admit', jsonb_build_object('joinDecreeId', pg_temp.d('j24')));
select pg_temp.decree('l24', '124', 'league_leave', '{}');
select pg_temp.decree('j25', '125', 'league_join', jsonb_build_object('leagueId', pg_temp.league('f4')), 'applied');
select lives_ok(pg_temp.enter('f4', '124', 'a24'), 'Agrotera y entre');
select lives_ok(pg_temp.leave('124', 'left', 'l24'), 'puis la quitte');
select throws_ok(pg_temp.leave('123', 'left'), '23514', null, 'un départ sans décret est une dissolution');
select lives_ok(pg_temp.leave('123', 'dissolved'), 'Delphis, seule, sort par la dissolution');
select lives_ok(pg_temp.svc(format('update game.leagues set dissolved_at = now() where id = %L', pg_temp.league('f4'))), 'M est dissoute');
select throws_ok(pg_temp.svc(format('update game.leagues set dissolved_at = now() where id = %L', pg_temp.league('f4'))),
  '23001', null, 'une ligue dissoute ne change plus');
select pg_temp.decree('a25', '123', 'league_admit', jsonb_build_object('joinDecreeId', pg_temp.d('j25')));
select throws_ok(pg_temp.enter('f4', '125', 'a25'), '23514', 'a dissolved league admits no city',
  'une ligue dissoute n''admet personne, même la demande encore inutilisée de Phrourion');
select pg_temp.decree('f6', '122', 'league_found', '{"name": "Ligue de Céos"}');
select lives_ok(pg_temp.found('f6', '122', 'Ligue de Céos'), 'Gamelia fonde une ligue à elle seule');
select lives_ok(pg_temp.enter('f6', '122', 'f6'), 'et en est membre');
select throws_ok(pg_temp.leave('122', 'dissolved'), '23514', 'a city leaves by its decree, or with the dissolution of its league',
  'une ligue sans départ dans la transaction ne se dissout pas, même réduite à sa fondatrice');
select pg_temp.decree('f5', '103', 'league_found', '{"name": "ligue de naxos"}');
select lives_ok(pg_temp.found('f5', '103', 'ligue de naxos'), 'Elaia, sortie de L, fonde une ligue sous le nom que M a libéré');

select * from finish();
rollback;
