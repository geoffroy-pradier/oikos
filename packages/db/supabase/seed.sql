-- Données de développement local et de test. Aucune donnée réelle, aucun secret.
insert into game.worlds (id, slug, name)
values ('01900000-0000-7000-8000-000000000001', 'archipel', 'Archipel')
on conflict do nothing;

-- Cité de test du ticket 3.
insert into game.cities (id, world_id, slug, name)
values ('01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000001', 'kalliste', 'Kallistè')
on conflict do nothing;
