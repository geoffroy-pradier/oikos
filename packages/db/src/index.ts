/** Accès typé à la base pour l'API de jeu et le moteur (Kysely). */
import { Kysely, PostgresDialect, type Generated } from 'kysely';
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
    blazon: string;
    created_at: Generated<Date>;
  };
  'game.citizenships': {
    id: Generated<string>;
    house_id: string;
    city_id: string;
    status: Generated<'metic' | 'citizen'>;
    since: Generated<Date>;
  };
}

export type Db = Kysely<GameDatabase>;

export function createDb(connectionString: string): Db {
  return new Kysely<GameDatabase>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
}

/** Erreur Postgres de violation de contrainte d'unicité, avec le nom de la contrainte. */
export function uniqueViolation(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === '23505' && typeof constraint === 'string' ? constraint : null;
}
