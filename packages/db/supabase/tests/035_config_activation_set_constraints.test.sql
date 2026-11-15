begin;
select plan(6);

-- Limite assumée du contrôle des activations à la validation (ticket 208, spécification 13) : un appelant
-- qui force ses contrôles différés (`set constraints all immediate`, sans aucun droit requis) puis valide
-- tard n'est pas rattrapé, car la base ne rejoue pas à la validation un contrôle déjà joué. Une seconde
-- instruction `set constraints all immediate` fait ici ce que ferait `commit` : jouer les contrôles
-- différés encore en attente, et eux seuls. Ce qui reste garanti : la version enregistrée par un tick ne
-- change pas, et l'écart entre elle et le journal des activations se voit.

insert into config.versions (id, payload, note) values
  ('00000000-0000-7000-8000-0000000000d1', '{"v": 1}', 'lue par le tick'),
  ('00000000-0000-7000-8000-0000000000d2', '{"v": 2}', 'activée en retard'),
  ('00000000-0000-7000-8000-0000000000d3', '{"v": 3}', 'témoin');

-- Instruction jouée sous le rôle donné (le service, comme l'API ; sinon le propriétaire). Rend
-- « acceptée », ou le code d'erreur et le nom de contrainte du refus.
create function pg_temp.attempt(statement text, as_role text default 'oikos_service') returns text
language plpgsql as $$
declare
  code text;
  name text;
begin
  perform set_config('role', as_role, true);
  execute statement;
  perform set_config('role', 'none', true);
  return 'acceptée';
exception when others then
  get stacked diagnostics code = returned_sqlstate, name = constraint_name;
  perform set_config('role', 'none', true);
  return trim(code || ' ' || name);
end $$;
create function pg_temp.activate(version text) returns text language sql as $$
  select format('insert into config.activations (version_id) values (%L)', '00000000-0000-7000-8000-0000000000' || version)
$$;

-- Le service active d1, puis d2, sans échéance (effet au début de la transaction), et force aussitôt les
-- contrôles différés : moins de cinq secondes se sont écoulées, ils passent.
select is(pg_temp.attempt(pg_temp.activate('d1') || '; ' || pg_temp.activate('d2') || '; set constraints all immediate'),
  'acceptée', 'le service force ses contrôles différés sans aucun droit particulier');
-- Le mode `immediate` vaudrait jusqu'à la fin de la transaction : les contrôles suivants sont de nouveau
-- remis à la validation.
set constraints all deferred;

-- Un tick joué pendant que la transaction reste ouverte ne voit pas d2 : il lit et enregistre d1.
insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch) values
  ('01900000-0000-7000-8000-000000000001', 999000208, now() + interval '2 seconds', 'graine-du-ticket-208',
   '00000000-0000-7000-8000-0000000000d1', false, false);

select pg_sleep(5.5);

-- Validation tardive : plus de cinq secondes après le début de la transaction, rien ne reste à contrôler.
select is(pg_temp.attempt('set constraints all immediate'), 'acceptée',
  'limite assumée : validée tard après des contrôles forcés, l''activation immédiate est acceptée');
set constraints all deferred;
-- Témoin : la même activation, inscrite sans forcer son contrôle, passe l'insertion et n'est refusée qu'à
-- la validation simulée. Le refus annule la sous-transaction, d3 comprise.
create function pg_temp.witness() returns text language plpgsql as $$
declare
  step text := 'insertion';
  statement text := pg_temp.activate('d3');
  code text;
  name text;
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  step := 'insérée';
  set constraints all immediate;
  perform set_config('role', 'none', true);
  return 'acceptée';
exception when others then
  get stacked diagnostics code = returned_sqlstate, name = constraint_name;
  perform set_config('role', 'none', true);
  return step || ' puis ' || trim(code || ' ' || name);
end $$;
select is(pg_temp.witness(), 'insérée puis 23514 activations_not_backdated',
  'contrôle non forcé : inscrite, l''activation immédiate est refusée à la validation tardive');

-- Ce qui reste garanti : le service ne réécrit pas la version qu'un tick a enregistrée, celle qui fait foi
-- pour le rejouer (voir aussi 007, qui le vérifie pour le propriétaire)…
select is(pg_temp.attempt(format('update game.ticks set config_version_id = %L where world_id = %L and index = 999000208',
    '00000000-0000-7000-8000-0000000000d2', '01900000-0000-7000-8000-000000000001')),
  '42501', 'le service ne réécrit pas la version enregistrée par un tick');
select is(config.active_version_at(now() + interval '2 seconds'), '00000000-0000-7000-8000-0000000000d2'::uuid,
  'le journal des activations dit d2 en vigueur à l''instant de ce tick');
-- … et le rapprochement entre version enregistrée et journal révèle l'écart.
select is(
  (select array_agg(t.index) from game.ticks t
   where t.scheduled_at between now() and clock_timestamp()
     and t.config_version_id is distinct from config.active_version_at(t.scheduled_at)),
  array[999000208::bigint], 'le rapprochement des ticks avec le journal révèle l''activation validée en retard');

select * from finish();
rollback;
