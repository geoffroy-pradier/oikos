begin;
select plan(3);

-- Le calendrier d'Olympe (#267, #446) lit les événements de tous les mondes par leur fin : un index sur `ends_at`.
create function pg_temp.plan_of(query text) returns text language plpgsql as $$
declare
  line text;
  result text := '';
begin
  for line in execute 'explain ' || query loop
    result := result || line || E'\n';
  end loop;
  return result;
end $$;

select has_index('game', 'world_events', 'world_events_ends_idx', array['ends_at'],
  'les événements sont indexés par leur seule fin, tous mondes confondus');
select is(
  (select indisunique from pg_index where indexrelid = 'game.world_events_ends_idx'::regclass),
  false,
  'deux événements peuvent finir au même instant');
-- Le parcours séquentiel écarté, la lecture du calendrier (fin après un instant, tous mondes) prend cet index
-- plutôt que de parcourir en entier un index qui commence par la cité ou le monde.
set local enable_seqscan = off;
select matches(
  pg_temp.plan_of($q$select id from game.world_events where ends_at > now() - interval '30 days'
    order by starts_at desc, id desc limit 1001$q$),
  'world_events_ends_idx',
  'la lecture du calendrier passe par l’index de fin');

select * from finish();
rollback;
