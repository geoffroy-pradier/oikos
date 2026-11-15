import type { ConfigLoader } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

const DAY_MS = 86_400_000;

/**
 * Conservation limitée des messages (docs/specs/18-indicateurs-risques-conformite.md, contenus ; 6.6) :
 * supprime les messages écrits il y a plus de `chat.retentionDays` jours (configuration en vigueur), par la
 * fonction du propriétaire, seule à pouvoir le faire. Tâche distincte de la rétention de la télémétrie : une
 * panne de l'une n'arrête pas l'autre. Rend le nombre de messages supprimés.
 */
export async function purgeMessages(
  db: Db,
  { now, config }: { now: Date; config: Pick<ConfigLoader, 'at'> },
): Promise<number> {
  const { retentionDays } = (await config.at(now)).config.chat;
  const before = new Date(now.getTime() - retentionDays * DAY_MS);
  const { rows } = await sql<{ purged: string }>`
    select game.purge_messages(${before}) as purged
  `.execute(db);
  return Number(rows[0]?.purged ?? 0);
}
