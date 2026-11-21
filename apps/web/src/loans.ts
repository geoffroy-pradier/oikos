import { LOAN_STATUSES, type LoanStatus } from '@oikos/contracts';
import { templeLoanCap } from '@oikos/sim';
import { z } from 'zod';

/**
 * Prêts lus par le client (5.4, 10). Seuls les prêts de la maison du joueur se lisent (`my_loans`) ; la fortune et la
 * dette d'une autre maison ne se lisent jamais. Plafond, taux et durées viennent de `temple_treasury_rules` (la
 * configuration en vigueur) et les calculs de `packages/sim` ; l'API fait foi, l'écran ne fait qu'annoncer.
 */

const id = z.string().min(1);
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const instant = z.string().transform((value, ctx) => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) ctx.addIssue({ code: 'custom', message: 'not an instant' });
  return ms;
});

/** Colonnes lues dans `my_loans`. */
export const LOAN_COLUMNS =
  'id, lender, principal, rate_bps, term_days, interest, due_day, due_at, principal_repaid, interest_repaid, outstanding, status';

const loanRow = z.object({
  id,
  lender: z.enum(['temple', 'bank']),
  principal: money,
  rate_bps: z.number().int().min(0).max(10_000),
  term_days: z.number().int().min(1),
  interest: money,
  due_day: z.number().int(),
  due_at: instant,
  principal_repaid: money,
  interest_repaid: money,
  outstanding: money,
  status: z.enum(LOAN_STATUSES),
});

/** Prêt de la maison du joueur, montants en oboles, échéance en millisecondes. */
export interface MyLoan {
  id: string;
  lender: 'temple' | 'bank';
  principal: number;
  rateBps: number;
  termDays: number;
  /** Intérêt simple fixé à l'emprunt pour toute la durée. */
  interest: number;
  dueAt: number;
  /** Ce qui reste des intérêts, au plus le reste dû. */
  interestDue: number;
  outstanding: number;
  status: LoanStatus;
}

/**
 * Prêts non soldés de la maison, le plus proche de son échéance d'abord ; `null` si une ligne est illisible. Un prêt
 * remboursé n'est pas montré : l'historique des prêts soldés est hors de cet écran.
 */
export function parseMyLoans(rows: unknown): MyLoan[] | null {
  const parsed = z.array(loanRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .filter((row) => row.status !== 'repaid')
    .map((row) => ({
      id: row.id,
      lender: row.lender,
      principal: row.principal,
      rateBps: row.rate_bps,
      termDays: row.term_days,
      interest: row.interest,
      dueAt: row.due_at,
      interestDue: Math.min(Math.max(row.interest - row.interest_repaid, 0), row.outstanding),
      outstanding: row.outstanding,
      status: row.status,
    }))
    .sort((a, b) => a.dueAt - b.dueAt);
}

/** Marque de déshonneur d'une maison (`house_honor`) : le premier jour de jeu sans marque quand elle a une fin. */
export interface Dishonor {
  dishonored: boolean;
  untilDay: number | null;
}

const honorRow = z.object({
  honor: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  dishonored: z.boolean(),
  dishonored_until_day: z.number().int().nullable(),
});

/** Timè et marque de la maison, lues dans `house_honor` (une ligne par maison) ; `null` si illisible. */
export function parseHouseHonor(rows: unknown): { honor: number; dishonor: Dishonor } | null {
  const parsed = z.array(honorRow).safeParse(rows);
  if (!parsed.success) return null;
  const row = parsed.data[0];
  return {
    honor: row?.honor ?? 0,
    dishonor: { dishonored: row?.dishonored ?? false, untilDay: row?.dishonored_until_day ?? null },
  };
}

/** Règles du Trésor du temple (vue `temple_treasury_rules`) : taux directeur, durées admises, plafonds par palier. */
export interface TempleRules {
  policyRateBps: number;
  termDays: number[];
  tiers: { minHonor: number; maxPrincipal: number }[];
}

const rulesRow = z.object({
  policy_rate_bps: z.number().int().min(0).max(10_000),
  term_days: z.array(z.number().int().min(1).max(366)),
  principal_caps: z.array(
    z.object({
      minHonor: z.number().int(),
      maxPrincipal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    }),
  ),
});

/**
 * Règles lues dans la première ligne ; `null` si la ligne est illisible. Sans ligne (aucune configuration ne prête) :
 * `'closed'`, le temple ne prête pas.
 */
export function parseTempleRules(rows: unknown): TempleRules | 'closed' | null {
  if (!Array.isArray(rows)) return null;
  if (rows.length === 0) return 'closed';
  const parsed = rulesRow.safeParse(rows[0]);
  if (!parsed.success) return null;
  return {
    policyRateBps: parsed.data.policy_rate_bps,
    termDays: [...parsed.data.term_days].sort((a, b) => a - b),
    tiers: parsed.data.principal_caps,
  };
}

/** Plafond du principal d'une maison de Timè `honor`, par la formule de `packages/sim` ; zéro sous le premier palier. */
export const loanCap = (honor: number, rules: TempleRules): number =>
  templeLoanCap(honor, rules.tiers);

/** Alerte du tableau de bord sur un prêt (10) : une échéance proche, ou un défaut. */
export interface LoanAlert {
  kind: 'dueSoon' | 'overdue' | 'defaulted';
  loan: MyLoan;
}

/**
 * Délai, en jours de jeu, sous lequel une échéance alerte le tableau de bord : seuil d'affichage du ticket #732, pas une
 * règle de jeu. Un jour de jeu dure vingt-quatre heures, de clôture à clôture.
 */
export const DUE_SOON_DAYS = 3;
/** Millisecondes d'un jour de jeu, de clôture à clôture : conversion d'unité, pas d'équilibrage. */
export const DAY_MS = 86_400_000;

/**
 * Prêts qui demandent la maison à `now` : ceux en défaut d'abord, puis les prêts en cours dont l'échéance tombe dans les
 * `DUE_SOON_DAYS` jours de jeu à venir, ou est passée sans que la clôture l'ait prélevée ; le plus proche en tête.
 */
export function loanAlerts(loans: readonly MyLoan[], now: number): LoanAlert[] {
  const horizon = now + DUE_SOON_DAYS * DAY_MS;
  return [
    ...loans
      .filter((loan) => loan.status === 'defaulted')
      .map((loan) => ({ kind: 'defaulted' as const, loan })),
    ...loans
      .filter((loan) => loan.status === 'active' && loan.dueAt <= horizon)
      .map((loan) => ({
        kind: loan.dueAt <= now ? ('overdue' as const) : ('dueSoon' as const),
        loan,
      })),
  ];
}
