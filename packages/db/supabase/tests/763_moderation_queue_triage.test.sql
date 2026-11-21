begin;
select plan(11);

-- Jeu d'essai : Alice écrit cinq messages, signalés par Bob, du plus ancien (m1, il y a 50 minutes) au plus récent
-- (m5, il y a 10 minutes). Pré-tri : m1 douteux, m2 probablement infondé, m3 et m5 violations probables, m4 sans
-- catégorie (essai rejeté). Gardes coupées le temps de dater messages et signalements.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000764aa', 'qt-alice@example.test'),
  ('00000000-0000-4000-8000-0000000764ab', 'qt-bob@example.test');
insert into game.houses (id, world_id, user_id, name, blazon) values
  ('00000000-0000-7000-8000-0000000764a1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000764aa', 'Alcméonides', '{}'),
  ('00000000-0000-7000-8000-0000000764b1', '01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-0000000764ab', 'Philaïdes', '{}');
insert into game.citizenships (house_id, city_id) values
  ('00000000-0000-7000-8000-0000000764a1', '01900000-0000-7000-8000-000000000101'),
  ('00000000-0000-7000-8000-0000000764b1', '01900000-0000-7000-8000-000000000101');
alter table game.messages disable trigger user;
alter table game.reports disable trigger user;
insert into game.messages (id, channel_id, house_id, body, created_at)
select ('00000000-0000-7000-8000-00000007640' || m.n)::uuid, c.id, '00000000-0000-7000-8000-0000000764a1', 'Message ' || m.n,
       now() - interval '2 hours' + m.n * interval '1 minute'
from generate_series(1, 5) m (n)
join game.channels c on c.city_id = '01900000-0000-7000-8000-000000000101';
insert into game.reports (id, message_id, reported_house_id, house_id, reason, created_at)
select ('00000000-0000-7000-8000-00000007641' || r.n)::uuid, ('00000000-0000-7000-8000-00000007640' || r.n)::uuid,
       '00000000-0000-7000-8000-0000000764a1', '00000000-0000-7000-8000-0000000764b1', 'spam',
       now() - (60 - r.n * 10) * interval '1 minute'
from generate_series(1, 5) r (n);
alter table game.messages enable trigger user;
alter table game.reports enable trigger user;
insert into game.report_triage (message_id, category, summary, outcome) values
  ('00000000-0000-7000-8000-000000076401', 'doubtful', 'Propos ambigus.', 'ok'),
  ('00000000-0000-7000-8000-000000076402', 'likely_unfounded', 'Rien de répréhensible.', 'ok'),
  ('00000000-0000-7000-8000-000000076403', 'likely_violation', 'Insulte.', 'ok'),
  ('00000000-0000-7000-8000-000000076405', 'likely_violation', 'Harcèlement.', 'ok');
insert into game.report_triage (message_id, outcome) values ('00000000-0000-7000-8000-000000076404', 'invalid');

create function pg_temp.order_of(doc jsonb) returns text[] language sql as $$
  select coalesce(array_agg(right(e #>> '{message,id}', 1) order by o), '{}') from jsonb_array_elements(doc -> 'queue') with ordinality x (e, o)
$$;

-- Violations probables d'abord, puis douteux, sans catégorie, probablement infondé ; dans chaque catégorie, l'ordre de la phase 2.
select is(pg_temp.order_of(admin.moderation_queue(2, 10)), array['3', '5', '1', '4', '2'],
  'la file montre d''abord les violations probables, puis garde l''ordre de la phase 2 dans chaque catégorie');
-- m3 (signalée il y a 30 minutes) et m5 (10 minutes) sont toutes deux violations probables : la plus ancienne d'abord.
select is((select admin.moderation_queue(2, 10) -> 'queue' -> 0 -> 'triage'),
  '{"category": "likely_violation", "summary": "Insulte."}'::jsonb, 'l''entrée porte la catégorie et le résumé');
select is((select admin.moderation_queue(2, 10) -> 'queue' -> 3 -> 'triage'), 'null'::jsonb,
  'sans catégorie : triage nul (essai rejeté)');
select is(pg_temp.order_of(admin.moderation_queue(2, 2)), array['3', '5'],
  'la borne du nombre d''entrées garde les mieux classées');

-- Repli, IA coupée : plus de ligne de pré-tri, la file garde exactement l'ordre de la phase 2.
delete from game.report_triage;
select is(pg_temp.order_of(admin.moderation_queue(2, 10)), array['1', '2', '3', '4', '5'],
  'sans pré-tri, la file garde l''ordre de la phase 2 : le plus ancien signalement d''abord');
select ok((select bool_and(e -> 'triage' = 'null'::jsonb) from jsonb_array_elements(admin.moderation_queue(2, 10) -> 'queue') e),
  'et aucune entrée n''a de catégorie');

-- La catégorie ne sert qu'à l'ordre de la file : aucune autre fonction, vue, règle ni déclencheur ne la lit.
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p where p.prosrc ilike '%report_triage%'),
  array['moderation_queue'], 'seule la lecture de la file lit le pré-tri, aucune commande de sanction');
select is((select count(*) from pg_views where definition ilike '%report_triage%'), 0::bigint, 'aucune vue ne le lit');
select is((select count(*) from pg_policies where qual ilike '%report_triage%' or with_check ilike '%report_triage%'), 0::bigint,
  'aucune règle par ligne ne le lit');
select is((select count(*) from pg_constraint c where c.contype = 'f' and c.confrelid = 'game.report_triage'::regclass), 0::bigint,
  'aucune table ne s''y réfère');
select is((select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid <> 'game.report_triage'::regclass
  and pg_get_triggerdef(t.oid) ilike '%report_triage%'), 0::bigint, 'aucun déclencheur ne le lit');

select * from finish();
rollback;
