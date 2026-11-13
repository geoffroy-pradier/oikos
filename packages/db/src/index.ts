/** Accès typé à la base pour l'API de jeu et le moteur (Kysely). */
import type { Blazon } from '@oikos/contracts';
import {
  Kysely,
  PostgresDialect,
  type ColumnType,
  type Generated,
  type GeneratedAlways,
} from 'kysely';
import pg from 'pg';

/** Tables du schéma `game`. À remplacer par les types générés quand le schéma grossira. */
export interface GameDatabase {
  'game.worlds': { id: Generated<string>; slug: string; name: string; created_at: Generated<Date> };
  'game.cities': {
    id: Generated<string>;
    world_id: string;
    slug: string;
    name: string;
    created_at: Generated<Date>;
  };
  'game.houses': {
    id: Generated<string>;
    world_id: string;
    user_id: string;
    name: string;
    /** Colonne générée : `lower(name)`. */
    name_key: GeneratedAlways<string>;
    /** `jsonb` : lu désérialisé, écrit sous forme de texte JSON. */
    blazon: ColumnType<Blazon, string, string>;
    created_at: Generated<Date>;
  };
  'game.citizenships': {
    id: Generated<string>;
    house_id: string;
    city_id: string;
    status: Generated<'metic' | 'citizen'>;
    since: Generated<Date>;
  };

  'game.command_log': {
    id: Generated<string>;
    user_id: string;
    command: string;
    idempotency_key: string | null;
    input: ColumnType<unknown, string, never>;
    status: 'ok' | 'rejected' | 'failed';
    error_code: string | null;
    response: ColumnType<unknown, string, never>;
    duration_ms: number;
    created_at: Generated<Date>;
  };
  'game.domain_events': {
    id: Generated<string>;
    seq: GeneratedAlways<string>;
    command_id: string | null;
    type: string;
    payload: ColumnType<unknown, string, never>;
    created_at: Generated<Date>;
  };

  'game.ticks': {
    world_id: string;
    /** `bigint` : lu en texte, écrit en nombre (un indice de tick tient dans un entier sûr). */
    index: ColumnType<string, number, never>;
    scheduled_at: Date;
    seed: string;
    config_version_id: string;
    daily_close: boolean;
    season_switch: boolean;
    summary: ColumnType<unknown, string, never>;
    finished_at: Generated<Date>;
  };
  'telemetry.tick_runs': {
    id: Generated<string>;
    world_id: string;
    tick_index: ColumnType<string, number, never>;
    status: 'done' | 'skipped' | 'failed';
    duration_ms: number;
    error: string | null;
    created_at: Generated<Date>;
  };

  'config.versions': {
    id: Generated<string>;
    number: GeneratedAlways<number>;
    /** `jsonb` : lu désérialisé, écrit sous forme de texte JSON. */
    payload: ColumnType<unknown, string, never>;
    note: Generated<string>;
    created_by: string | null;
    created_at: Generated<Date>;
  };
  'config.activations': {
    id: Generated<string>;
    seq: GeneratedAlways<string>;
    version_id: string;
    /** Par défaut : immédiatement, à l'horloge de la base. */
    activate_at: Generated<Date>;
    created_by: string | null;
    created_at: Generated<Date>;
  };
}

export type Db = Kysely<GameDatabase>;

export function createDb(connectionString: string, pool: { max?: number } = {}): Db {
  const connections = new pg.Pool({ connectionString, ...pool });
  // Une connexion inactive fermée par Postgres (redémarrage, bascule) émet `error` sur le pool : sans
  // écouteur, le processus s'arrêterait. Le pool rouvre une connexion à la requête suivante.
  connections.on('error', (error) => console.error('Database pool error', error));
  return new Kysely<GameDatabase>({
    dialect: new PostgresDialect({ pool: connections }),
  });
}

/** Nom de la contrainte violée (unicité 23505 ou vérification 23514), ou `null` pour toute autre erreur. */
export function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  const isViolation = code === '23505' || code === '23514';
  return isViolation && typeof constraint === 'string' ? constraint : null;
}
