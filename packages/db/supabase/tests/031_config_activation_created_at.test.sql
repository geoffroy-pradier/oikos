begin;
select plan(11);

insert into config.versions (id, payload, note) values
  ('00000000-0000-7000-8000-0000000000c1', '{"v": 1}', 'un');

-- Insertion jouée sous le rôle donné (le service, comme l'API et le moteur ; sinon le propriétaire).
-- Rend « acceptée », ou le code d'erreur et le nom de contrainte du refus.
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
create function pg_temp.activation(columns text, rest text) returns text language sql as $$
  select format('insert into config.activations (version_id, %s) values (%L, %s)',
                columns, '00000000-0000-7000-8000-0000000000c1', rest)
$$;

-- Le service ne date pas une activation, et ne choisit pas son rang.
select is(pg_temp.attempt(pg_temp.activation('activate_at, created_at', $$'2999-01-01', '2020-01-01'$$)), '42501',
  'le service n''écrit pas la date de création d''une activation');
select is(pg_temp.attempt(
    $$insert into config.activations (seq, version_id) overriding system value values (1, '00000000-0000-7000-8000-0000000000c1')$$),
  '42501', 'ni son rang');

-- Une échéance antérieure à l'heure de la base est refusée, en nommant la contrainte.
select is(pg_temp.attempt(pg_temp.activation('activate_at', $$now() - interval '1 second'$$)), '23514 activations_not_backdated',
  'le service ne programme pas une échéance passée, même d''une seconde');
select is(pg_temp.attempt(pg_temp.activation('activate_at', $$'2020-01-01'$$)), '23514 activations_not_backdated',
  'ni une échéance ancienne');
-- Quel que soit l'appelant : même le propriétaire, qui a le droit d'écrire la date, ne la choisit pas.
select is(pg_temp.attempt(pg_temp.activation('activate_at, created_at', $$'2020-01-01', '2019-12-31'$$), 'none'),
  '23514 activations_not_backdated', 'le propriétaire n''antidate pas non plus une activation en fournissant sa date');
select is((select count(*) from config.activations where version_id = '00000000-0000-7000-8000-0000000000c1'), 0::bigint, 'les refus n''ont rien inscrit');

-- Sans échéance, l'activation est immédiate ; avec une échéance à venir, elle est programmée. Dans les
-- deux cas, la date de création est l'heure de la base, pas celle que fournirait l'appelant.
select is(pg_temp.attempt(pg_temp.activation('created_by', $$'00000000-0000-4000-8000-00000000000a'$$)), 'acceptée',
  'le service active une version immédiatement, sans fournir de date');
select is(pg_temp.attempt(pg_temp.activation('activate_at', $$'2999-01-01'$$)), 'acceptée',
  'le service programme une échéance à venir, sans fournir de date');
select is(pg_temp.attempt(pg_temp.activation('activate_at, created_at', $$'2999-01-02', '2020-01-01'$$), 'none'), 'acceptée',
  'le propriétaire programme une échéance à venir, même en fournissant une date');
select is(
  (select array_agg(created_at = now() order by seq) from config.activations where version_id = '00000000-0000-7000-8000-0000000000c1'), array[true, true, true],
  'chaque date de création est l''heure de la base, jamais la date fournie');
select is(config.active_version_at(now()), '00000000-0000-7000-8000-0000000000c1'::uuid,
  'l''activation immédiate est en vigueur dès maintenant');

select * from finish();
rollback;
