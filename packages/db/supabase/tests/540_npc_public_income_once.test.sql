begin;
select plan(6);

-- Revenu public des PNJ : une écriture par cité et par jour de jeu (migration 1120 ; ticket 632). La clôture et le
-- tick de demande partagent cette clé : la base refuse le second versement, sous le service comme au propriétaire.
-- Monde de test (seed) : Kallistè 101, Elaia 103.
create function pg_temp.income(city text, day integer, oboles bigint) returns void language plpgsql as $$
declare
  entry uuid;
begin
  insert into game.ledger_entries (world_id, kind, meta) values ('01900000-0000-7000-8000-000000000001', 'npc.public_income',
    jsonb_build_object('cityId', '01900000-0000-7000-8000-000000000' || city, 'gameDay', day)) returning id into entry;
  insert into game.ledger_lines (entry_id, account_id, amount) values
    (entry, (select account_id from game.npc_purses() where city_id = ('01900000-0000-7000-8000-000000000' || city)::uuid), oboles),
    (entry, (select id from game.accounts where world_id = '01900000-0000-7000-8000-000000000001'
               and system_key = 'faucet_npc_public_income'), -oboles);
end $$;
grant execute on function pg_temp.income(text, integer, bigint) to oikos_service;
create function pg_temp.as_service(statement text) returns void language plpgsql as $$
begin
  perform set_config('role', 'oikos_service', true);
  execute statement;
  perform set_config('role', 'none', true);
end $$;

select lives_ok($$select pg_temp.as_service('select pg_temp.income(''101'', 20771, 100)')$$,
  'le service verse le revenu public du jour à Kallistè');
select throws_ok($$select pg_temp.as_service('select pg_temp.income(''101'', 20771, 100)')$$, '23505', null,
  'pas un second versement pour la même cité et le même jour de jeu');
select throws_ok($$select pg_temp.income('101', 20771, 1)$$, '23505', null, 'ni par le propriétaire, ni d''un autre montant');
select lives_ok($$select pg_temp.as_service('select pg_temp.income(''101'', 20772, 100)')$$, 'le jour suivant est un autre versement');
select lives_ok($$select pg_temp.as_service('select pg_temp.income(''103'', 20771, 100)')$$, 'une autre cité, le même jour aussi');
select is((select balance from game.npc_purses() where city_id = '01900000-0000-7000-8000-000000000101'), 200::bigint,
  'la bourse de Kallistè a reçu deux jours, pas trois');

select * from finish();
rollback;
