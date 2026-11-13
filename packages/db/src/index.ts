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
    version_id: string;
    activate_at: Date;
    created_by: string | null;
    created_at: Generated<Date>;
  };
}

export type Db = Kysely<GameDatabase>;

export function createDb(connectionString: string): Db {
  return new Kysely<GameDatabase>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
}

/** Nom de la contrainte violée (unicité 23505 ou vérification 23514), ou `null` pour toute autre erreur. */
export function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  const isViolation = code === '23505' || code === '23514';
  return isViolation && typeof constraint === 'string' ? constraint : null;
}
