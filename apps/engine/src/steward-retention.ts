import { stewardOperationsRetentionDays, type ConfigLoader } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

const DAY_MS = 86_400_000;

/**
 * Conservation des opérations d'intendant (4.4, #561 ; ADR 0002) : supprime celles inscrites il y a plus de
 * `stewards.operationsRetentionDays` jours (configuration en vigueur), par la fonction du propriétaire, seule à pouvoir
 * le faire. La base garde la dernière opération de chaque intendant, d'où repart la file de ses règles, et celles du
 * dernier tick de son monde, clés d'idempotence que le moteur relit. Rend le nombre d'opérations supprimées.
 */
export async function purgeStewardOperations(
  db: Db,
  { now, config }: { now: Date; config: Pick<ConfigLoader, 'at'> },
): Promise<number> {
  const retentionDays = stewardOperationsRetentionDays((await config.at(now)).config);
  const before = new Date(now.getTime() - retentionDays * DAY_MS);
  const { rows } = await sql<{ purged: string }>`
    select game.purge_steward_operations(${before}) as purged
  `.execute(db);
  return Number(rows[0]?.purged ?? 0);
}
