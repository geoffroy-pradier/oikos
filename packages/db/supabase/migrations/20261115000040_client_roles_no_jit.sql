-- Pas de compilation à la volée (`jit`) pour les lectures des joueurs (ticket 155).
-- Les règles par ligne du grand livre donnent à la lecture des flux de trésorerie (`my_cash_flows`, et les
-- comptes de résultat qui en dérivent) un coût estimé élevé, qui déclenche la compilation à la volée : sur
-- 40 maisons et 40 000 écritures, la compilation coûte à elle seule plus que la lecture (de 40 ms à
-- 900 ms selon l'estimation, contre une dizaine sans). Une lecture de joueur est courte : la compilation
-- n'y rapporte jamais. Réécrire les règles abaisserait l'estimation, mais elle remonterait avec le
-- volume du grand livre ; le réglage du rôle tient quel que soit le volume, sans toucher aux règles.
--
-- Réglage des rôles des clients, comme le `statement_timeout` que Supabase y pose. PostgREST lit les
-- réglages des rôles à son démarrage et à chaque rechargement de son cache de schéma, puis les applique à
-- chaque requête : sans rechargement, il garderait `jit = on`. Le déclencheur d'événements de Supabase qui
-- provoque ce rechargement ne réagit pas à `alter role` : d'où le `notify` final, délivré à la validation
-- de la migration (sans effet si personne n'écoute). Le rôle de service (API, moteur) n'est pas visé.
-- Rejouable : `alter role … set` remplace la valeur, la fonction est remplacée. Sans effet sur une grappe
-- sans compilation à la volée.
alter role authenticated set jit = off;
alter role anon set jit = off;

-- Vérification faite par PostgREST lui-même (`/rest/v1/rpc/client_jit`, voir infra/README.md) : rend le
-- réglage de la requête en cours, aucune donnée. Exécutée avec les droits de l'appelant.
create or replace function public.client_jit() returns text
language sql stable security invoker as $$ select pg_catalog.current_setting('jit') $$;
revoke execute on function public.client_jit() from public;
grant execute on function public.client_jit() to anon, authenticated;

notify pgrst, 'reload schema';
