import type { ConfigLoader } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

const DAY_MS = 86_400_000;
/** Le journal des appels d'IA garde au moins le mois en cours : le plafond mensuel s'y lit (ADR 0005). */
const AI_CALLS_MIN_DAYS = 32;

/**
 * Supprime les passages de tick et de clôture plus anciens que la rétention de la configuration en
 * vigueur (`telemetry.retentionDays`), par la fonction du propriétaire : `close_runs` reste en ajout
 * seul pour le service. Le journal des appels d'IA garde au moins 32 jours. Rend le nombre de lignes
 * supprimées.
 */
export async function purgeTelemetry(
  db: Db,
  { now, config }: { now: Date; config: Pick<ConfigLoader, 'at'> },
): Promise<{ tickRuns: number; closeRuns: number; aiCalls: number }> {
  const { retentionDays } = (await config.at(now)).config.telemetry;
  const before = new Date(now.getTime() - retentionDays * DAY_MS);
  const { rows } = await sql<{ purged_tick_runs: string; purged_close_runs: string }>`
    select * from telemetry.purge_runs(${before})
  `.execute(db);
  const row = rows[0];
  const aiBefore = new Date(now.getTime() - Math.max(retentionDays, AI_CALLS_MIN_DAYS) * DAY_MS);
  const ai = await sql<{ purged: string }>`
    select telemetry.purge_ai_calls(${aiBefore}) as purged
  `.execute(db);
  return {
    tickRuns: Number(row?.purged_tick_runs ?? 0),
    closeRuns: Number(row?.purged_close_runs ?? 0),
    aiCalls: Number(ai.rows[0]?.purged ?? 0),
  };
}

export interface ClockChangingActivation {
  activationId: string;
  versionNumber: number;
  activateAt: Date;
  /** Faux : à moins d'une minute de son échéance, l'activation ne pouvait plus être annulée. */
  cancelled: boolean;
}

/**
 * Annule les activations à venir dont la version change l'horloge en vigueur (programmées avant #123),
 * et les signale dans le journal du moteur. Appelée au démarrage ; la migration 41 fait de même au
 * déploiement.
 */
export async function cancelClockChangingActivations(db: Db): Promise<ClockChangingActivation[]> {
  const { rows } = await sql<{
    activation_id: string;
    version_number: string;
    activate_at: Date;
    cancelled: boolean;
  }>`select * from config.cancel_clock_changing_activations()`.execute(db);
  const found = rows.map((row) => ({
    activationId: row.activation_id,
    versionNumber: Number(row.version_number),
    activateAt: row.activate_at,
    cancelled: row.cancelled,
  }));
  for (const { activationId, versionNumber, activateAt, cancelled } of found) {
    console.error(
      `Configuration #${versionNumber} would change the world clock at ${activateAt.toISOString()} ` +
        `(activation ${activationId}): ${cancelled ? 'cancelled' : 'too close to cancel, it will apply'}`,
    );
  }
  return found;
}
