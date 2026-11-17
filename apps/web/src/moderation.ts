import { SANCTION_KINDS, type SanctionKind } from '@oikos/contracts';
import { z } from 'zod';

/**
 * Modération, côté joueur (#275) : sanctions du compte (vue `my_sanctions`), annoncées sur tous les écrans.
 */

export interface Sanction {
  id: string;
  kind: SanctionKind;
  startsAt: number;
  /** `null` : sans fin (exclusion). */
  endsAt: number | null;
  reason: string;
  appealBody: string | null;
  appealedAt: number | null;
}

export const SANCTION_COLUMNS = 'id, kind, starts_at, ends_at, reason, appeal_body, appealed_at';

const instant = z.string().transform((text, ctx) => {
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) ctx.addIssue({ code: 'custom', message: 'not an instant' });
  return ms;
});
const sanctionRow = z.object({
  id: z.string().min(1),
  kind: z.enum(SANCTION_KINDS),
  starts_at: instant,
  ends_at: instant.nullable(),
  reason: z.string(),
  appeal_body: z.string().nullable(),
  appealed_at: instant.nullable(),
});

/**
 * Sanctions pas encore finies à `now` (en cours ou à venir), la plus ancienne d'abord : celles que l'écran
 * annonce, et dont on peut faire appel. `null` si une ligne est illisible.
 */
export function currentSanctions(rows: unknown, now: number): Sanction[] | null {
  const parsed = z.array(sanctionRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .filter((row) => row.ends_at === null || row.ends_at > now)
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      reason: row.reason,
      appealBody: row.appeal_body,
      appealedAt: row.appealed_at,
    }))
    .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
}

/** Prochain instant où la liste des sanctions annoncées change (une fin), ou `null`. */
export function nextSanctionEnd(sanctions: readonly Sanction[]): number | null {
  const ends = sanctions.flatMap((sanction) => (sanction.endsAt === null ? [] : [sanction.endsAt]));
  return ends.length === 0 ? null : Math.min(...ends);
}

/**
 * Événement de fenêtre émis quand l'API refuse une commande pour une sanction (`SUSPENDED`, `SILENCED`) :
 * l'annonce des sanctions se relit aussitôt, sans attendre un rechargement.
 */
export const SANCTIONED_EVENT = 'oikos:sanctioned';
