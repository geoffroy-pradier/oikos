-- Données de développement local et de test. Aucune donnée réelle, aucun secret.
insert into game.worlds (id, slug, name)
values ('01900000-0000-7000-8000-000000000001', 'archipel', 'Archipel')
on conflict do nothing;

-- Cité de test du ticket 3.
insert into game.cities (id, world_id, slug, name)
values ('01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000001', 'kalliste', 'Kallistè')
on conflict do nothing;

-- Comptes système du monde de test : un par robinet et par puits (docs/specs/05-economie.md, 5.5).
insert into game.accounts (world_id, kind, system_key, allow_negative)
select '01900000-0000-7000-8000-000000000001', 'system', key, true
from unnest(array[
  'faucet_npc_purchases', 'faucet_temple_loans', 'faucet_rewards', 'faucet_starting_grant',
  'sink_npc_wages', 'sink_upkeep', 'sink_market_tax', 'sink_offerings', 'sink_temple_interest', 'sink_public_works'
]) as key
on conflict do nothing;
