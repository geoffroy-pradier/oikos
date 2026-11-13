import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import type { GameConfig } from './schema';
import { validateConfig } from './validate';

export interface ConfigVersionRef {
  id: string;
  number: number;
}

export interface LoadedConfig extends ConfigVersionRef {
  config: Readonly<GameConfig>;
}

export type PublishResult =
  { ok: true; version: ConfigVersionRef } | { ok: false; errors: string[] };

export class ConfigError extends Error {}

/** Enregistre une nouvelle version immuable. Une configuration invalide n'atteint jamais la base. */
export async function publishVersion(
  db: Db,
  candidate: unknown,
  meta: { note?: string; createdBy?: string | null } = {},
): Promise<PublishResult> {
  const validation = validateConfig(candidate);
  if (!validation.ok) return validation;
  const version = await db
    .insertInto('config.versions')
    .values({
      payload: JSON.stringify(validation.config),
      note: meta.note ?? '',
      created_by: meta.createdBy ?? null,
    })
    .returning(['id', 'number'])
    .executeTakeFirstOrThrow();
  return { ok: true, version };
}

/**
 * Programme l'activation d'une version à une échéance future, ou l'active immédiatement (à l'horloge de
 * la base) si `activateAt` est omis. Une échéance passée est refusée par la base : la configuration vue
 * par un tick déjà joué ne change jamais. Un retour arrière est l'activation d'une version antérieure.
 */
export async function scheduleActivation(
  db: Db,
  versionId: string,
  activateAt?: Date,
  createdBy: string | null = null,
): Promise<void> {
  await db
    .insertInto('config.activations')
    .values({
      version_id: versionId,
      created_by: createdBy,
      ...(activateAt ? { activate_at: activateAt } : {}),
    })
    .execute();
}

/**
 * Charge la configuration active à un instant donné. Les versions étant immuables, elles sont mises en
 * cache sans expiration ; seul l'identifiant de la version active est relu à chaque appel.
 * Un tick appelle `at(instant du tick)` une seule fois et travaille sur l'objet figé rendu.
 */
export type ConfigLoader = ReturnType<typeof createConfigLoader>;

export function createConfigLoader(db: Db) {
  const cache = new Map<string, LoadedConfig>();

  async function at(instant: Date): Promise<LoadedConfig> {
    const active = await sql<{ id: string | null }>`
      select config.active_version_at(${instant}) as id
    `.execute(db);
    const id = active.rows[0]?.id;
    if (!id) throw new ConfigError(`No active configuration at ${instant.toISOString()}`);

    return byId(id);
  }

  /** Charge une version précise, active ou non : sert à rejouer un tick avec la version qu'il a enregistrée. */
  async function byId(id: string): Promise<LoadedConfig> {
    const cached = cache.get(id);
    if (cached) return cached;

    const row = await db
      .selectFrom('config.versions')
      .select(['id', 'number', 'payload'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new ConfigError(`Unknown configuration version ${id}`);
    // Une version écrite hors de `publishVersion` ne doit jamais atteindre la simulation.
    const validation = validateConfig(row.payload);
    if (!validation.ok) {
      throw new ConfigError(
        `Stored configuration #${row.number} is invalid: ${validation.errors.join('; ')}`,
      );
    }
    const loaded = Object.freeze({ id: row.id, number: row.number, config: validation.config });
    cache.set(id, loaded);
    return loaded;
  }

  return { at, byId, cachedVersions: () => cache.size };
}

/** Au premier démarrage, publie et active la configuration fournie. Sans effet si une version existe déjà. */
export async function ensureInitialConfig(
  db: Db,
  initial: unknown,
): Promise<ConfigVersionRef | null> {
  const run = async (trx: Db) => {
    // Sérialise les démarrages concurrents de l'API et du moteur.
    await sql`select pg_advisory_xact_lock(hashtext('config.ensure_initial'))`.execute(trx);
    const existing = await trx
      .selectFrom('config.versions')
      .select('id')
      .limit(1)
      .executeTakeFirst();
    if (existing) return null;
    const published = await publishVersion(trx, initial, { note: 'initial' });
    if (!published.ok)
      throw new ConfigError(`Initial configuration is invalid: ${published.errors.join('; ')}`);
    await scheduleActivation(trx, published.version.id);
    return published.version;
  };
  return db.isTransaction ? run(db) : db.transaction().execute(run);
}
