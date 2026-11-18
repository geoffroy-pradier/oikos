import type { AdminReports } from '@oikos/contracts';

const HOUR_MS = 3_600_000;

/** Heures entières écoulées de `since` à `now` (l'heure de la base, rendue par l'API) ; jamais négatif. */
export function hoursSince(since: string, now: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / HOUR_MS));
}

/**
 * Ancienneté, en heures entières, du plus ancien signalement ouvert, s'il attend depuis plus de
 * `data.staleAfterHours` (la configuration, 15.5) ; sinon `null`. Tolère une réponse sans file : l'alerte ne casse pas l'écran qui l'accueille.
 */
export function staleReportHours(
  data: Pick<AdminReports, 'now' | 'queue' | 'staleAfterHours'> | null,
): number | null {
  if (!data || !Array.isArray(data.queue)) return null;
  const times = data.queue.flatMap((entry) =>
    entry.reports.map((report) => Date.parse(report.createdAt)),
  );
  if (times.length === 0) return null;
  const oldest = Math.min(...times);
  const waited = Date.parse(data.now) - oldest;
  // « Plus de 24 h » : strictement.
  return waited > data.staleAfterHours * HOUR_MS ? Math.floor(waited / HOUR_MS) : null;
}
