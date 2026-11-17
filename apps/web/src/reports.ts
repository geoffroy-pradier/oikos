import { DEFAULT_MODERATION } from '@oikos/config/schema';
import { useMemo } from 'react';
import { z } from 'zod';
import { useRows } from './data';

/**
 * Signalement d'un message (#275) : motifs de la configuration en vigueur (vue `moderation_rules`) et messages déjà
 * signalés par la maison (vue `my_reports`, sous règle par ligne).
 */

/**
 * Motifs de signalement : ceux de la configuration en vigueur, ceux du schéma partagé pour une version publiée
 * avant la modération (colonne nulle), aucun sans version en vigueur. `null` si la lecture est illisible.
 */
export function parseReportReasons(rows: unknown): string[] | null {
  const parsed = z
    .array(z.object({ report_reasons: z.array(z.string().min(1)).nullable() }))
    .safeParse(rows);
  if (!parsed.success) return null;
  const [row] = parsed.data;
  if (!row) return [];
  return row.report_reasons ?? [...DEFAULT_MODERATION.reportReasons];
}

/** Messages déjà signalés par la maison ; `null` si une ligne est illisible. */
export function reportedMessages(rows: unknown): Set<string> | null {
  const parsed = z.array(z.object({ message_id: z.string().nullable() })).safeParse(rows);
  if (!parsed.success) return null;
  return new Set(parsed.data.flatMap((row) => (row.message_id ? [row.message_id] : [])));
}

/** Lectures de l'onglet Messages pour le signalement ; `reload` relit les signalements de la maison. */
export function useReports() {
  const rules = useRows<unknown>('moderation_rules', 'report_reasons', 'report_reasons');
  const mine = useRows<unknown>('my_reports', 'message_id', 'created_at');
  const reasons = useMemo(
    () => (rules.rows === null ? null : parseReportReasons(rules.rows)),
    [rules.rows],
  );
  const reported = useMemo(
    () => (mine.rows === null ? null : reportedMessages(mine.rows)),
    [mine.rows],
  );
  return { reasons, reported, reload: mine.reload };
}
