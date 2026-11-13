-- Rôles du back-office Olympe (docs/specs/15-back-office-olympe.md, 15.3 ; ticket 10).
-- Un compte sans ligne ici n'a aucun accès au back-office. Les rôles ne se modifient que par des
-- commandes d'administration, journalisées comme les commandes de jeu.

create table if not exists admin.roles (
  user_id uuid primary key references auth.users (id),
  role text not null check (
    role in ('super_admin', 'game_designer', 'community_manager', 'moderator', 'support', 'observer')
  ),
  -- Compte qui a accordé le rôle ; absent pour le tout premier super-administrateur, créé par un humain en base.
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  constraint roles_not_self_granted check (granted_by is distinct from user_id)
);

-- Non exposé aux clients : règles par ligne actives, aucune règle, aucun droit. L'API de jeu lit cette table
-- avec son rôle de service ; un joueur ne peut ni la lire ni s'y inscrire.
alter table admin.roles enable row level security;
