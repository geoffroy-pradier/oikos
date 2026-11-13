-- Rôles du back-office Olympe (docs/specs/15-back-office-olympe.md, 15.3 ; ticket 10).
-- Un compte sans ligne ici n'a aucun accès au back-office. Un seul rôle par compte en v0 (pas de cumul). Les rôles ne se modifient que par des
-- commandes d'administration, journalisées comme les commandes de jeu.

create table if not exists admin.roles (
  user_id uuid primary key references auth.users (id),
  role text not null check (
    role in ('super_admin', 'game_designer', 'community_manager', 'moderator', 'support', 'observer')
  ),
  -- Compte qui a accordé le rôle ; absent pour le tout premier super-administrateur, créé par un humain en base.
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  constraint roles_not_self_granted check (granted_by is distinct from user_id),
  -- Seul un super-administrateur peut exister sans avoir été nommé par quelqu'un.
  constraint roles_granted_unless_root check (granted_by is not null or role = 'super_admin')
);

-- Non exposé aux clients : règles par ligne actives, aucune règle, aucun droit pour `anon`, `authenticated`
-- ni `service_role`. Seule l'API de jeu, par sa connexion directe à la base, lit et écrit cette table.
alter table admin.roles enable row level security;
