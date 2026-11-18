import type { AdminReports } from '@oikos/contracts';

/**
 * Seuil de l'alerte « signalements en attente » (docs/specs/15-back-office-olympe.md, 15.5) : un seuil de
 * surveillance fixé par la spécification, pas une règle d'équilibrage du jeu.
 */
export const STALE_REPORT_HOURS = 24;
const HOUR_MS = 3_600_000;

/** Heures entières écoulées de `since` à `now` (l'heure de la base, rendue par l'API) ; jamais négatif. */
export function hoursSince(since: string, now: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / HOUR_MS));
}

/**
 * Ancienneté, en heures entières, du plus ancien signalement ouvert, s'il attend depuis plus de
 * `STALE_REPORT_HOURS` ; sinon `null`. Tolère une réponse sans file : l'alerte ne casse pas l'écran qui l'accueille.
 */
export function staleReportHours(data: Pick<AdminReports, 'now' | 'queue'> | null): number | null {
  if (!data || !Array.isArray(data.queue)) return null;
  const times = data.queue.flatMap((entry) =>
    entry.reports.map((report) => Date.parse(report.createdAt)),
  );
  if (times.length === 0) return null;
  const oldest = Math.min(...times);
  const waited = Date.parse(data.now) - oldest;
  // « Plus de 24 h » : strictement.
  return waited > STALE_REPORT_HOURS * HOUR_MS ? Math.floor(waited / HOUR_MS) : null;
}
