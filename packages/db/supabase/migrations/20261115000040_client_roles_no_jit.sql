-- Pas de compilation à la volée (`jit`) pour les lectures des joueurs (ticket 155).
-- Les règles par ligne du grand livre donnent à la lecture des flux de trésorerie (`my_cash_flows`, et les
-- comptes de résultat qui en dérivent) un coût estimé élevé, qui déclenche la compilation à la volée : sur
-- 40 maisons et 40 000 écritures, la compilation coûte à elle seule plus que la lecture (de 40 ms à
-- 900 ms selon l'estimation, contre une dizaine sans). Une lecture de joueur est courte : la compilation
-- n'y rapporte jamais. Réécrire les règles abaisserait l'estimation, mais elle remonterait avec le
-- volume du grand livre ; le réglage du rôle tient quel que soit le volume, sans toucher aux règles.
--
-- Réglage des rôles des clients, comme le `statement_timeout` que Supabase y pose : PostgREST applique
-- les réglages du rôle qu'il endosse à chaque requête. Le rôle de service (API, moteur) n'est pas visé.
-- Rejouable : `alter role … set` remplace la valeur. Sans effet sur une grappe sans compilation à la volée.
alter role authenticated set jit = off;
alter role anon set jit = off;
