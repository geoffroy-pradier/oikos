-- Données de développement local et de test. Aucune donnée réelle, aucun secret.
insert into game.worlds (id, slug, name)
values ('01900000-0000-7000-8000-000000000001', 'archipel', 'Archipel')
on conflict do nothing;

-- Cité de test du ticket 3.
insert into game.cities (id, world_id, slug, name)
values ('01900000-0000-7000-8000-000000000101', '01900000-0000-7000-8000-000000000001', 'kalliste', 'Kallistè')
on conflict do nothing;

-- Trois cités de plus (ticket 250) : leur identité (terroir, port, dieu protecteur) est dans la
-- configuration, sous le même identifiant court. Les noms affichés viennent des fichiers de traduction.
insert into game.cities (id, world_id, slug, name)
values
  ('01900000-0000-7000-8000-000000000103', '01900000-0000-7000-8000-000000000001', 'elaia', 'Elaia'),
  ('01900000-0000-7000-8000-000000000104', '01900000-0000-7000-8000-000000000001', 'ampelos', 'Ampelos'),
  ('01900000-0000-7000-8000-000000000105', '01900000-0000-7000-8000-000000000001', 'halos', 'Halos')
on conflict do nothing;
