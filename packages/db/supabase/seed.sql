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

-- Huit cités de plus (ticket 706), sous les identifiants courts de la configuration : douze cités au lancement (6.1).
insert into game.cities (id, world_id, slug, name)
values
  ('01900000-0000-7000-8000-000000000121', '01900000-0000-7000-8000-000000000001', 'dikaia', 'Dikaia'),
  ('01900000-0000-7000-8000-000000000122', '01900000-0000-7000-8000-000000000001', 'gamelia', 'Gamelia'),
  ('01900000-0000-7000-8000-000000000123', '01900000-0000-7000-8000-000000000001', 'delphis', 'Delphis'),
  ('01900000-0000-7000-8000-000000000124', '01900000-0000-7000-8000-000000000001', 'agrotera', 'Agrotera'),
  ('01900000-0000-7000-8000-000000000125', '01900000-0000-7000-8000-000000000001', 'phrourion', 'Phrourion'),
  ('01900000-0000-7000-8000-000000000126', '01900000-0000-7000-8000-000000000001', 'myrrhine', 'Myrrhinè'),
  ('01900000-0000-7000-8000-000000000127', '01900000-0000-7000-8000-000000000001', 'chalkeia', 'Chalkeia'),
  ('01900000-0000-7000-8000-000000000128', '01900000-0000-7000-8000-000000000001', 'emporion', 'Emporion')
on conflict do nothing;
