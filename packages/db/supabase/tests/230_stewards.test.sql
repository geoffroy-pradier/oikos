begin;
select plan(64);

-- Jeu d'essai : Alice et Bob ont chacun une maison et deux sites dans le monde de test, Bob un intendant ; Chloé
-- n'a pas de maison.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000027aa', 'intendants-alice@example.test'),
  ('00000000-0000-4000-8000-0000000027ab', 'intendants-bob@example.test'),
  ('00000000-0000-4000-8000-0000000027ac', 'intendants-chloe@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000027a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000027aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000027b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000027ab', 'Philaïdes', '{}');
insert into game.sites (id, world_id, house_id, city_id, recipe_id) values
  ('00000000-0000-7000-8000-0000000027a3', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '01900000-0000-7000-8000-000000000101', 'press_oil'),
  ('00000000-0000-7000-8000-0000000027a4', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '01900000-0000-7000-8000-000000000101', 'grow_wheat'),
  ('00000000-0000-7000-8000-0000000027b3', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027b1', '01900000-0000-7000-8000-000000000103', 'grow_olives'),
  ('00000000-0000-7000-8000-0000000027b4', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027b1', '01900000-0000-7000-8000-000000000103', 'grow_wheat');
insert into game.stewards (id, world_id, house_id, site_id, name) values
  ('00000000-0000-7000-8000-0000000027b5', '01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027b1', '00000000-0000-7000-8000-0000000027b3', 'Kléon');
update game.stewards set rules_revision = 1 where id = '00000000-0000-7000-8000-0000000027b5';
insert into game.steward_rules (steward_id, revision, position, kind) values ('00000000-0000-7000-8000-0000000027b5', 1, 0, 'collect');
update game.stewards set rules_revision = 2 where id = '00000000-0000-7000-8000-0000000027b5';
insert into game.steward_rules (steward_id, revision, position, kind, good_id, price_oboles, units) values
  ('00000000-0000-7000-8000-0000000027b5', 2, 0, 'sell', 'olives', 11, 0);

create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;

-- Droits, lus dans le catalogue.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('game.stewards'::regclass, 'game.steward_rules'::regclass)),
  'règles par ligne actives sur les deux tables');
select is(
  (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'game' and tablename in ('stewards', 'steward_rules')),
  'steward_rules:service_all:ALL:oikos_service steward_rules:steward_rules_read_own:SELECT:authenticated stewards:service_all:ALL:oikos_service stewards:stewards_read_own:SELECT:authenticated',
  'une règle de lecture pour les joueurs par table, aucune d''écriture');
select is(
  (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ' ' order by table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('my_stewards', 'my_steward_rules') and grantee in ('anon', 'authenticated')),
  'my_steward_rules:authenticated:SELECT my_stewards:authenticated:SELECT', 'vues en lecture seule, rien pour un visiteur anonyme');
select is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ' ' order by table_name, column_name, privilege_type)
   from information_schema.column_privileges
   where table_schema = 'game' and table_name in ('stewards', 'steward_rules') and grantee = 'oikos_service' and privilege_type <> 'SELECT'),
  'steward_rules.good_id:INSERT steward_rules.kind:INSERT steward_rules.position:INSERT steward_rules.price_oboles:INSERT steward_rules.revision:INSERT steward_rules.steward_id:INSERT steward_rules.units:INSERT '
  || 'stewards.dismissed_at:UPDATE stewards.house_id:INSERT stewards.name:INSERT stewards.rules_revision:UPDATE stewards.site_id:INSERT stewards.unpaid_since:UPDATE stewards.world_id:INSERT',
  'le service embauche sans choisir ni l''identifiant, ni les dates, ni l''impayé, puis ne change que l''impayé, la révision des règles et le renvoi : liste figée');
select ok(not has_table_privilege('oikos_service', 'game.stewards', 'delete'), 'le service ne supprime pas un intendant');
select ok(not has_table_privilege('oikos_service', 'game.steward_rules', 'delete')
  and not has_table_privilege('oikos_service', 'game.steward_rules', 'update'), 'il écrit des règles sans jamais en modifier ni en effacer une');
select ok(not exists (select 1 from pg_roles r where (has_function_privilege(r.oid, 'game.guard_steward()', 'execute')
  or has_function_privilege(r.oid, 'game.guard_steward_rule()', 'execute'))
  and r.rolname in ('anon', 'authenticated', 'oikos_service', 'service_role')), 'personne n''exécute les gardes');

-- Intégrité, sous le rôle de service : un intendant par site, de la maison du site.
select lives_ok($$select pg_temp.as_service($s$insert into game.stewards (world_id, house_id, site_id, name)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a3', 'Nikias')$s$)$$,
  'le service embauche un intendant pour un site de la maison');
select is((select hired_at = now() and unpaid_since = now() and dismissed_at is null from game.stewards where name = 'Nikias'),
  true, 'il est embauché maintenant, impayé jusqu''à la clôture qui le paie, en poste');
select throws_ok($$select pg_temp.as_service($s$insert into game.stewards (world_id, house_id, site_id, name)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a3', 'Timon')$s$)$$,
  '23505', null, 'un seul intendant en poste par site');
select throws_ok($$select pg_temp.as_service($s$insert into game.stewards (world_id, house_id, site_id, name)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027b4', 'Timon')$s$)$$,
  '23503', 'insert or update on table "stewards" violates foreign key constraint "stewards_site"', 'pas pour le site d''une autre maison');
select throws_ok($$select pg_temp.as_service($s$insert into game.stewards (world_id, house_id, site_id, name)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a4', ' Timon')$s$)$$,
  '23514', null, 'un nom sans espace autour');
select throws_ok($$select pg_temp.as_service($s$insert into game.stewards (world_id, house_id, site_id, name, hired_at)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a4', 'Timon', '2000-01-01')$s$)$$,
  '42501', null, 'le service n''antidate pas une embauche');
select throws_ok($$select pg_temp.as_service($s$insert into game.stewards (world_id, house_id, site_id, name, unpaid_since)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a4', 'Timon', null)$s$)$$,
  '42501', null, 'ni n''embauche un intendant déjà payé');
select throws_ok($$select pg_temp.as_service($s$update game.stewards set name = 'Timon' where name = 'Nikias'$s$)$$,
  '42501', null, 'ni ne le renomme');
select throws_ok($$select pg_temp.as_service($s$delete from game.stewards where name = 'Nikias'$s$)$$,
  '42501', null, 'ni ne le supprime');

-- La garde ne dépend pas des droits : même le propriétaire de la table ne passe pas outre.
select throws_ok($$insert into game.stewards (world_id, house_id, site_id, name, hired_at, unpaid_since)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a4', 'Timon', '2000-01-01', '2000-01-01')$$,
  '23001', 'a steward is hired now, unpaid until a close pays him', 'une embauche n''est pas antidatée');
select throws_ok($$insert into game.stewards (world_id, house_id, site_id, name, unpaid_since)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a4', 'Timon', null)$$,
  '23001', 'a steward is hired now, unpaid until a close pays him', 'ni payée d''avance');
select throws_ok($$update game.stewards set site_id = '00000000-0000-7000-8000-0000000027a4' where name = 'Nikias'$$,
  '23001', 'steward identity is immutable', 'un intendant ne change pas de site');
select throws_ok($$update game.stewards set hired_at = hired_at - interval '1 day' where name = 'Nikias'$$,
  '23001', 'steward identity is immutable', 'ni de date d''embauche');
select lives_ok($$update game.stewards set unpaid_since = null where name = 'Nikias'$$, 'une clôture lève son impayé');
select throws_ok($$update game.stewards set unpaid_since = now() - interval '1 hour' where name = 'Nikias'$$,
  '23001', 'a steward is unpaid from now', 'un impayé n''est pas antidaté');
select throws_ok($$update game.stewards set dismissed_at = now() + interval '1 hour' where name = 'Nikias'$$,
  '23001', 'a steward is dismissed now', 'ni un renvoi postdaté');

-- Règles, sous le rôle de service : la grammaire fermée, une par sorte et par bien, au plus 20.
select lives_ok($$select pg_temp.as_service($s$update game.stewards set rules_revision = 1 where name = 'Nikias'$s$)$$,
  'le service ouvre la première révision des règles');
select lives_ok($$select pg_temp.as_service($s$insert into game.steward_rules (steward_id, revision, position, kind, good_id, price_oboles, units)
  select id, 1, p, k, g, pr, u from game.stewards, (values (0, 'collect', null, null::bigint, null::bigint),
    (1, 'sell', 'olive_oil', 72, 10), (2, 'buy', 'olives', 8, 40)) as r (p, k, g, pr, u) where name = 'Nikias'$s$)$$,
  'le service enregistre les trois règles de la grammaire');
create function pg_temp.rule(p int, k text, g text, pr bigint, u bigint, rev int = 1) returns text language sql as $$
  select format('select pg_temp.as_service(%L)', format(
    'insert into game.steward_rules (steward_id, revision, position, kind, good_id, price_oboles, units)
     select id, %s, %s, %L, %L, %L, %L from game.stewards where name = %L', rev, p, k, g, pr, u, 'Nikias'));
$$;
select throws_ok(pg_temp.rule(3, 'collect', 'wheat', null, null), '23514', null, 'une récolte ne porte ni bien, ni prix, ni quantité');
select throws_ok(pg_temp.rule(3, 'sell', 'wheat', 5, null), '23514', null, 'une vente porte sa réserve');
select throws_ok(pg_temp.rule(3, 'buy', 'wheat', 5, 0), '23514', null, 'un rachat vise un stock d''au moins une unité');
select throws_ok(pg_temp.rule(3, 'sell', 'wheat', 0, 5), '23514', null, 'un prix est d''au moins une obole');
select throws_ok(pg_temp.rule(3, 'sell', 'wheat', 1000000001, 5), '23514', null, 'et borné comme un ordre de l''agora');
select throws_ok(pg_temp.rule(20, 'sell', 'wheat', 5, 5), '23514', null, 'au plus 20 règles');
select throws_ok(pg_temp.rule(3, 'transport', 'wheat', 5, 5), '23514', null, 'aucune autre sorte de règle');
select throws_ok(pg_temp.rule(3, 'sell', 'olive_oil', 90, 0), '23505', null, 'une seule vente par bien');
select throws_ok(pg_temp.rule(3, 'collect', null, null, null), '23505', null, 'une seule récolte');
select throws_ok($$select pg_temp.as_service($s$update game.steward_rules set price_oboles = 80 where kind = 'sell'$s$)$$,
  '42501', null, 'une règle ne se modifie pas : une révision nouvelle la remplace');
select throws_ok($$select pg_temp.as_service($s$delete from game.steward_rules where kind = 'sell'$s$)$$,
  '42501', null, 'ni ne s''efface');
select throws_ok(pg_temp.rule(0, 'sell', 'wheat', 5, 5, 2), '23001', 'rules are written in the current revision of a steward in post',
  'pas de règle dans une révision qui n''est pas ouverte');
select throws_ok($$update game.stewards set rules_revision = 3 where name = 'Nikias'$$,
  '23001', 'rules are revised one at a time', 'les révisions se suivent une à une');
select lives_ok($$select pg_temp.as_service($s$update game.stewards set rules_revision = 2 where name = 'Nikias'$s$)$$,
  'une révision nouvelle remplace la précédente, vide pour l''instant');
select throws_ok(pg_temp.rule(5, 'sell', 'wheat', 5, 5, 1), '23001', 'rules are written in the current revision of a steward in post',
  'l''ancienne révision ne s''allonge plus');
select lives_ok(pg_temp.rule(0, 'sell', 'wheat', 5, 5, 2), 'la nouvelle reçoit ses règles');
select is((select rules_revised_at = now() from game.stewards where name = 'Nikias'), true, 'la révision est datée de la transaction qui l''ouvre');
-- Une révision ouverte par une autre transaction (antidatée, garde levée) ne reçoit plus de règle.
alter table game.stewards disable trigger stewards_guard;
update game.stewards set rules_revised_at = now() - interval '1 hour' where name = 'Nikias';
alter table game.stewards enable trigger stewards_guard;
select throws_ok(pg_temp.rule(1, 'sell', 'olives', 5, 5, 2), '23001', 'rules are written in the current revision of a steward in post',
  'une révision ouverte par une autre transaction ne s''allonge plus');

-- Renvoi : l'intendant et ses règles restent tels qu'il les a laissés ; le site peut en embaucher un autre.
select lives_ok($$select pg_temp.as_service($s$update game.stewards set dismissed_at = now() where name = 'Nikias'$s$)$$,
  'le service renvoie un intendant');
select throws_ok($$update game.stewards set unpaid_since = now() where name = 'Nikias'$$,
  '23001', 'a dismissed steward does not change', 'un intendant renvoyé ne change plus');
select throws_ok($$update game.stewards set rules_revision = 3 where name = 'Nikias'$$,
  '23001', 'a dismissed steward does not change', 'ni ne reçoit de révision nouvelle');
select throws_ok(pg_temp.rule(3, 'sell', 'olives', 5, 5, 2), '23001', 'rules are written in the current revision of a steward in post',
  'ses règles ne s''allongent plus');
select lives_ok($$select pg_temp.as_service($s$insert into game.stewards (world_id, house_id, site_id, name)
  values ('01900000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a3', 'Timon')$s$)$$,
  'son poste libéré, le site embauche un autre intendant');

-- Visiteur anonyme : rien.
set local role anon;
select throws_ok('select * from public.my_stewards', '42501', null, 'anon ne lit pas d''intendants');
select throws_ok('select * from public.my_steward_rules', '42501', null, 'ni de règles');

-- Alice ne voit que ses intendants en poste et leurs règles.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000027aa", "role": "authenticated"}';
select results_eq('select house_id, site_id, name, unpaid_since = hired_at from public.my_stewards',
  $$values ('00000000-0000-7000-8000-0000000027a1'::uuid, '00000000-0000-7000-8000-0000000027a3'::uuid, 'Timon', true)$$,
  'Alice lit son intendant en poste, impayé depuis son embauche, pas celui qu''elle a renvoyé');
select is((select count(*) from public.my_steward_rules), 0::bigint, 'ni les règles de l''intendant renvoyé');
select is((select count(*) from game.stewards where house_id = '00000000-0000-7000-8000-0000000027b1'), 0::bigint,
  'pas l''intendant de Bob, même en interrogeant game');
select is((select count(*) from game.steward_rules where steward_id = '00000000-0000-7000-8000-0000000027b5'), 0::bigint,
  'ni ses règles');
select throws_ok('select world_id from game.stewards', '42501', null, 'colonnes internes illisibles');
select throws_ok($$insert into game.stewards (world_id, house_id, site_id, name) values ('01900000-0000-7000-8000-000000000001',
  '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a4', 'Agathé')$$, '42501', null, 'pas d''embauche directe dans game');
select throws_ok($$update public.my_stewards set name = 'Agathé'$$, '42501', null, 'ni de renommage par la vue');
select throws_ok($$insert into public.my_steward_rules (steward_id, position, kind) select id, 0, 'collect' from public.my_stewards$$,
  '55000', null, 'ni de règle écrite par la vue, qui n''est pas modifiable');
select throws_ok($$insert into game.steward_rules (steward_id, revision, position, kind) select id, 1, 0, 'collect' from public.my_stewards$$,
  '42501', null, 'ni directement dans game');
select throws_ok($$delete from game.steward_rules$$, '42501', null, 'ni de règle effacée dans game');

-- Bob ne voit que le sien ; Chloé, sans maison, rien.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000027ab", "role": "authenticated"}';
select results_eq('select id, name from public.my_stewards',
  $$values ('00000000-0000-7000-8000-0000000027b5'::uuid, 'Kléon')$$, 'Bob ne voit que son intendant');
select results_eq('select position, kind, good_id, price_oboles, units from public.my_steward_rules',
  $$values (0::smallint, 'sell', 'olives', 11::bigint, 0::bigint)$$,
  'et ses règles en vigueur, pas celles de sa révision précédente ni celles d''Alice');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000027ac", "role": "authenticated"}';
select is((select count(*) from public.my_stewards) + (select count(*) from public.my_steward_rules), 0::bigint,
  'un compte sans maison ne voit ni intendant ni règle');

reset role;
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'my_stewards'),
  array['id', 'house_id', 'site_id', 'name', 'hired_at', 'unpaid_since', 'rules_revision'], 'my_stewards : ni monde ni renvoi');

select * from finish();
rollback;
