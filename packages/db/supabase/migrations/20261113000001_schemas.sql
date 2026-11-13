-- Schémas de la base (docs/specs/12-modele-donnees.md).
-- game      : tables de vérité, API de jeu et moteur uniquement.
-- config    : paramètres d'équilibrage versionnés.
-- telemetry : événements et agrégats.
-- admin     : sanctions, audit, rôles ; back-office uniquement.
-- public    : réservé aux vues de lecture exposées au client.
create schema if not exists game;
create schema if not exists config;
create schema if not exists telemetry;
create schema if not exists admin;

-- Aucun rôle client n'a de droit sur les schémas internes : ni usage, ni privilège par défaut.
revoke all on schema game, config, telemetry, admin from public, anon, authenticated;

-- `public` : les clients n'y créent rien et n'y héritent d'aucun privilège implicite.
revoke create on schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
-- Postgres accorde par défaut EXECUTE à PUBLIC sur toute nouvelle fonction : on le retire partout,
-- sinon une fonction ajoutée dans `public` serait appelable par /rest/v1/rpc/.
alter default privileges for role postgres revoke execute on functions from public;

comment on schema game is 'Tables de vérité du jeu. Écriture par l''API de jeu et le moteur uniquement.';
comment on schema config is 'Paramètres d''équilibrage versionnés.';
comment on schema telemetry is 'Événements et agrégats.';
comment on schema admin is 'Sanctions, audit, rôles. Back-office uniquement.';
