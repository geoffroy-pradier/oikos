import { SANCTION_KINDS, type SanctionKind } from '@oikos/contracts';
import { z } from 'zod';

/**
 * Modération, côté joueur (#275) : sanctions du compte (vue `my_sanctions`), annoncées sur tous les écrans, avec la
 * décision sur leur appel (#529, vue `my_appeal_decisions`).
 */

export const APPEAL_DECISIONS = ['granted', 'rejected'] as const;
export type AppealDecisionKind = (typeof APPEAL_DECISIONS)[number];

/** Décision sur l'appel d'une sanction : accueilli (la sanction est levée) ou rejeté, et son instant. */
export interface AppealDecision {
  decision: AppealDecisionKind;
  decidedAt: number;
}

export interface Sanction {
  id: string;
  kind: SanctionKind;
  startsAt: number;
  /** `null` : sans fin (exclusion). */
  endsAt: number | null;
  reason: string;
  appealBody: string | null;
  appealedAt: number | null;
  /** `null` : pas d'appel, ou appel pas encore tranché. */
  decision: AppealDecision | null;
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

export const APPEAL_DECISION_COLUMNS = 'sanction_id, decision, decided_at';

const decisionRow = z.object({
  sanction_id: z.string().min(1),
  decision: z.enum(APPEAL_DECISIONS),
  decided_at: instant,
});

/** Décisions sur les appels du compte, par sanction. `null` si une ligne est illisible. */
export function appealDecisions(rows: unknown): Map<string, AppealDecision> | null {
  const parsed = z.array(decisionRow).safeParse(rows);
  if (!parsed.success) return null;
  return new Map(
    parsed.data.map((row) => [
      row.sanction_id,
      { decision: row.decision, decidedAt: row.decided_at },
    ]),
  );
}

/**
 * Sanctions que l'écran annonce, la plus ancienne d'abord : celles qui ne sont pas finies à `now` (en cours ou à
 * venir), et dont on peut faire appel, puis celles qui sont finies mais dont l'appel a été tranché, tant que le
 * joueur n'a pas masqué cette décision (`dismissed`) : un appel accueilli lève la sanction, qui finit à l'instant
 * de la décision. `null` si une ligne est illisible.
 */
export function noticedSanctions(
  rows: unknown,
  decisions: ReadonlyMap<string, AppealDecision>,
  dismissed: ReadonlySet<string>,
  now: number,
): Sanction[] | null {
  const parsed = z.array(sanctionRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      reason: row.reason,
      appealBody: row.appeal_body,
      appealedAt: row.appealed_at,
      decision: decisions.get(row.id) ?? null,
    }))
    .filter(
      (sanction) =>
        !sanctionEnded(sanction, now) ||
        (sanction.decision !== null && !dismissed.has(sanction.id)),
    )
    .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
}

/** Sanctions pas encore finies à `now`, sans décision lue : celles dont on peut faire appel. */
export const currentSanctions = (rows: unknown, now: number): Sanction[] | null =>
  noticedSanctions(rows, new Map(), new Set(), now);

export const sanctionEnded = (sanction: Sanction, now: number): boolean =>
  sanction.endsAt !== null && sanction.endsAt <= now;

/** Prochain instant après `now` où la liste des sanctions annoncées change (une fin), ou `null`. */
export function nextSanctionEnd(sanctions: readonly Sanction[], now: number): number | null {
  const ends = sanctions.flatMap((sanction) =>
    sanction.endsAt === null || sanction.endsAt <= now ? [] : [sanction.endsAt],
  );
  return ends.length === 0 ? null : Math.min(...ends);
}

/** Clé propre au compte : sa maison n'appartient qu'à lui (même convention que les clés d'idempotence). */
const dismissedKey = (houseId: string) => `oikos.appealDecisionsDismissed.${houseId}`;

/**
 * Décisions masquées par le joueur sur cet appareil, par sanction (un confort du navigateur : un autre appareil
 * les montre de nouveau). Lecture tolérante : le stockage peut être indisponible ou contenir n'importe quoi.
 */
export function dismissedDecisions(houseId: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(dismissedKey(houseId)) ?? '[]');
    return new Set(z.array(z.string()).safeParse(stored).data ?? []);
  } catch {
    return new Set();
  }
}

/** Mémorise les décisions masquées ; sans stockage, l'avis revient au prochain chargement. */
export function storeDismissedDecisions(houseId: string, dismissed: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(dismissedKey(houseId), JSON.stringify([...dismissed]));
  } catch {
    // Sans autre conséquence.
  }
}

/**
 * Événement de fenêtre émis quand l'API refuse une commande pour une sanction (`SUSPENDED`, `SILENCED`) :
 * l'annonce des sanctions se relit aussitôt, sans attendre un rechargement.
 */
export const SANCTIONED_EVENT = 'oikos:sanctioned';
