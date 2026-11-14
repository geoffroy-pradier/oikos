-- Contexte de chaque commande au journal (docs/specs/13-moteur-anti-triche.md ; ticket 65).
-- Le journal disait qui, quoi et quand ; il dit maintenant sous quelle session, avec quel rôle
-- d'administration et sous quelle configuration la commande a été jugée. Colonnes facultatives :
-- les lignes déjà écrites et le code précédent restent valides.

alter table game.command_log
  -- Niveau d'assurance de la session : `aal2` après le second facteur.
  add column if not exists aal text check (aal in ('aal1', 'aal2')),
  -- Rôle d'administration relu en base pour cette commande ; absent pour une commande de jeu ou un
  -- compte sans rôle. Le rôle a pu être retiré depuis : c'est celui du moment qui compte.
  add column if not exists admin_role text check (admin_role ~ '^[a-z][a-z_]{1,31}$'),
  -- Version de configuration en vigueur quand la commande a été exécutée. Absente si elle n'a pas pu
  -- être chargée. Pas de clé étrangère : le journal est un constat, il ne retient pas la table des versions.
  add column if not exists config_version_id uuid;
