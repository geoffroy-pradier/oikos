begin;
select plan(22);

-- Niveau des biens lu par le client (#873). Alice a sa maison dans le monde de la graine, Zénon dans un autre monde,
-- Dion n'a pas de maison : la configuration est globale, tous trois lisent les mêmes lignes, et aucun n'écrit.

-- Exposition : la vue et la fonction qu'elle lit, droits figés.
select is((select reloptions from pg_class where oid = 'public.good_tiers'::regclass), array['security_invoker=true'],
  'la vue lit au nom du joueur (`security_invoker`)');
select is(
  (select string_agg(pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ' ' order by 1)
   from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.good_tiers'::regclass and a.grantee <> c.relowner),
  'authenticated:SELECT', 'un seul droit hors propriétaire : la lecture par les joueurs connectés (liste figée)');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_table_privilege(r.oid, 'public.good_tiers', 'select, insert, update, delete, truncate, references, trigger')
     and not r.rolsuper and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'aucun autre rôle client ou de service n''y a un droit, même hérité');
select is(
  (select string_agg(r.rolname, ' ' order by r.rolname) from pg_roles r
   where has_function_privilege(r.oid, 'game.good_tiers()', 'execute') and not r.rolsuper
     and r.rolname in ('anon', 'authenticated', 'authenticator', 'oikos_service', 'service_role')),
  'authenticated', 'la fonction sous-jacente n''est exécutable que par les joueurs connectés');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'game.good_tiers()'::regprocedure),
  'la fonction lit la configuration au nom de son propriétaire, chemin de recherche vide');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'good_tiers'), array['good_id', 'tier'],
  'l''identifiant et le niveau, ni prix de référence ni élasticité');

-- Aucune version en vigueur (base de test après la graine) : aucune ligne. Sautée si la base en a déjà une.
select case when config.active_version_at(now()) is null
  then is((select count(*) from public.good_tiers), 0::bigint, 'sans version en vigueur, aucune ligne')
  else skip('une version est déjà en vigueur dans cette base', 1) end;

insert into game.worlds (id, slug, name) values ('01900000-0000-7000-8000-0000008730f2', 'monde-873', 'Autre monde');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000008730a' || u)::uuid, 'good-tiers-' || u || '@example.test'
from unnest(array['a', 'f', 'd']) u;
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000008730a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000008730aa',
   'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000008730f1', '01900000-0000-7000-8000-0000008730f2', '00000000-0000-4000-8000-0000008730af',
   'Zénonides', '{}');

-- Version en vigueur : un bien dessiné, deux biens sans dessin (ajoutés par Olympe), un service, et quatre éléments
-- illisibles (identifiant non textuel, niveau absent, niveau nul, élément qui n'est pas un objet). Version suivante,
-- dans une heure, qui change les niveaux.
insert into config.versions (id, payload) values
  ('00000000-0000-7000-8000-00000000c871', $${"goods": [
     {"id": "wheat", "tier": "raw", "referencePriceOboles": 6, "elasticity": 0.4},
     {"id": "ambrosia", "tier": "finished", "referencePriceOboles": 900, "elasticity": 1.5},
     {"id": "nectar", "tier": "intermediate", "referencePriceOboles": 300, "elasticity": 1},
     {"id": "freight", "tier": "service", "referencePriceOboles": 20, "elasticity": 0.5},
     {"id": 7, "tier": "raw"}, {"id": "no_tier"}, {"id": "null_tier", "tier": null}, "oops"]}$$),
  ('00000000-0000-7000-8000-00000000c872', '{"goods": [{"id": "ambrosia", "tier": "raw"}]}');
insert into config.activations (version_id, activate_at) values
  ('00000000-0000-7000-8000-00000000c871', now()),
  ('00000000-0000-7000-8000-00000000c872', now() + interval '1 hour');

set local role anon;
select throws_ok('select * from public.good_tiers', '42501', null, 'un visiteur anonyme ne lit pas les niveaux');
set local role service_role;
select throws_ok('select * from public.good_tiers', '42501', null, 'ni `service_role` (l''API lit la configuration directement)');

-- Alice.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000008730aa", "role": "authenticated"}';
select is((select string_agg(good_id || ':' || tier, ' ' order by good_id) from public.good_tiers),
  'ambrosia:finished freight:service nectar:intermediate wheat:raw',
  'chaque bien lisible de la version en vigueur et son niveau, pas ceux de la version suivante ; éléments illisibles écartés');
select throws_ok('select payload from config.versions', '42501', null, 'mais pas la configuration elle-même');
select throws_ok('select * from config.activations', '42501', null, 'ni le journal des activations');
-- Vue faite d'une fonction, donc non modifiable (55000) ; et sans droit d'écriture (liste figée ci-dessus).
select throws_ok($$insert into public.good_tiers values ('ambrosia', 'raw')$$, '55000', null, 'un joueur n''écrit pas par la vue');
select throws_ok($$update public.good_tiers set tier = 'raw' where good_id = 'ambrosia'$$, '55000', null, 'ni ne la modifie');
select throws_ok('delete from public.good_tiers', '55000', null, 'ni n''en supprime');
select throws_ok($$insert into config.versions (payload) values ('{"goods": []}')$$, '42501', null,
  'ni n''ajoute une version de configuration');
select throws_ok($$insert into config.activations (version_id) values ('00000000-0000-7000-8000-00000000c872')$$, '42501', null,
  'ni n''avance la version suivante');

-- Zénon, d'un autre monde, puis Dion, sans maison : les mêmes lignes, la configuration étant globale.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000008730af", "role": "authenticated"}';
select is((select string_agg(good_id || ':' || tier, ' ' order by good_id) from public.good_tiers),
  'ambrosia:finished freight:service nectar:intermediate wheat:raw', 'un joueur d''un autre monde lit le même catalogue');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000008730ad", "role": "authenticated"}';
select is((select count(*) from public.good_tiers), 4::bigint, 'un compte sans maison aussi : rien d''un monde ni d''une maison');
reset role;

-- Une activation annulée est ignorée : la version précédente reste en vigueur. (Contrôles différés passés,
-- gardes levées pour annuler une activation déjà échue, ce que la commande refuse ; seule la lecture est testée ici.)
insert into config.activations (id, version_id, activate_at)
values ('00000000-0000-7000-8000-00000000c87a', '00000000-0000-7000-8000-00000000c872', now());
set constraints all immediate;
alter table config.activation_cancellations disable trigger activation_cancellations_guard;
alter table config.activation_cancellations disable trigger activation_cancellations_before_activation_at_commit;
insert into config.activation_cancellations (activation_id, cancelled_by)
values ('00000000-0000-7000-8000-00000000c87a', '00000000-0000-4000-8000-0000008730aa');
alter table config.activation_cancellations enable trigger activation_cancellations_guard;
alter table config.activation_cancellations enable trigger activation_cancellations_before_activation_at_commit;
set local role authenticated;
select is((select tier from public.good_tiers where good_id = 'ambrosia'), 'finished',
  'activation annulée : le niveau de la version qui reste en vigueur');
reset role;

-- Deux versions activées au même instant : la décision enregistrée en dernier l'emporte.
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c872', now());
set local role authenticated;
select is((select string_agg(good_id || ':' || tier, ' ') from public.good_tiers), 'ambrosia:raw',
  'à égalité d''échéance, la dernière activation enregistrée : un bien dont le niveau change le change aussi ici');
reset role;

-- Version dont le catalogue n'est pas une liste : aucune ligne, sans erreur.
insert into config.versions (id, payload) values ('00000000-0000-7000-8000-00000000c873', '{"goods": {"wheat": "raw"}}');
insert into config.activations (version_id, activate_at) values ('00000000-0000-7000-8000-00000000c873', now());
set local role authenticated;
select is((select count(*) from public.good_tiers), 0::bigint, 'catalogue illisible : aucune ligne, le client garde la caisse');
reset role;

select * from finish();
rollback;
