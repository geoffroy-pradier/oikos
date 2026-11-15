-- Empreinte du schéma du jeu, une ligne par objet, triée : deux bases au même schéma donnent le même texte.
-- Sert au test de rejeu des migrations (`replay-migrations.sh`) : rejouer ne doit rien changer.
-- Couvre les schémas du jeu (`game`, `config`, `telemetry`, `admin`, `public`), sans les objets des
-- extensions : colonnes, vues, fonctions, contraintes, index, déclencheurs, règles par ligne, droits
-- (triés), propriétaires, nombre de lignes de chaque table, et réglages des rôles des clients et du service.
with nsp as (
  select oid, nspname from pg_namespace where nspname in ('game', 'config', 'telemetry', 'admin', 'public')
), rel as (
  select c.*, n.nspname from pg_class c join nsp n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
), fn as (
  select p.*, n.nspname from pg_proc p join nsp n on n.oid = p.pronamespace
  where not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
)
select line from (
  select format('schema %s owner=%s acl=%s', n.nspname, pg_get_userbyid(s.nspowner),
                array(select x::text from unnest(s.nspacl) x order by 1)) as line
  from nsp n join pg_namespace s on s.oid = n.oid
  union all
  select format('relation %s.%s kind=%s owner=%s rls=%s/%s acl=%s', nspname, relname, relkind, pg_get_userbyid(relowner),
                relrowsecurity, relforcerowsecurity, array(select x::text from unnest(relacl) x order by 1))
  from rel
  union all
  select format('column %s.%s.%s %s notnull=%s default=%s acl=%s', r.nspname, r.relname, a.attname,
                format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(ad.adbin, ad.adrelid),
                array(select x::text from unnest(a.attacl) x order by 1))
  from rel r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  union all
  select format('view %s.%s %s options=%s', nspname, relname, pg_get_viewdef(oid), reloptions)
  from rel where relkind in ('v', 'm')
  union all
  select format('rows %s.%s %s', nspname, relname,
                (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', nspname, relname), false, true, '')))[1]::text)
  from rel where relkind in ('r', 'p')
  union all
  select format('function %s owner=%s acl=%s %s', p.oid::regprocedure, pg_get_userbyid(p.proowner),
                array(select x::text from unnest(p.proacl) x order by 1),
                case when p.prokind in ('f', 'p', 'w') then pg_get_functiondef(p.oid) else p.prokind::text end)
  from fn p
  union all
  select format('constraint %s.%s %s %s validated=%s', r.nspname, r.relname, c.conname, pg_get_constraintdef(c.oid), c.convalidated)
  from pg_constraint c join rel r on r.oid = c.conrelid
  union all
  select format('index %s', pg_get_indexdef(i.indexrelid))
  from pg_index i join rel r on r.oid = i.indrelid
  union all
  select format('trigger %s enabled=%s', pg_get_triggerdef(t.oid), t.tgenabled)
  from pg_trigger t join rel r on r.oid = t.tgrelid where not t.tgisinternal
  union all
  select format('policy %s.%s %s %s %s roles=%s using=%s check=%s', schemaname, tablename, policyname, permissive, cmd,
                roles, qual, with_check)
  from pg_policies where schemaname in (select nspname from nsp)
  union all
  select format('default acl %s %s %s %s', pg_get_userbyid(defaclrole), coalesce(defaclnamespace::regnamespace::text, '*'),
                defaclobjtype, array(select x::text from unnest(defaclacl) x order by 1))
  from pg_default_acl
  union all
  select format('role %s config=%s member_of=%s', r.rolname, r.rolconfig,
                array(select g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid order by 1))
  from pg_roles r where r.rolname in ('anon', 'authenticated', 'oikos_service', 'authenticator', 'service_role')
) lines
order by line collate "C";
