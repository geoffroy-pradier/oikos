import { z } from 'zod';

/**
 * Trésor du temple (docs/specs/05-economie.md, 5.4 ; #724) : la maison emprunte au taux directeur, dans le plafond de
 * son palier de Timè, un prêt à la fois, puis rembourse, intérêts d'abord. Montants en oboles, entiers sûrs.
 */
const oboles = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const owed = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const day = z.number().int().nonnegative();
export const LOAN_STATUSES = ['active', 'repaid', 'defaulted'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

/**
 * Commande `loan.borrowFromTemple` : principal, durée admise (jours de jeu) et taux directeur que le joueur a vu
 * (`temple_treasury_rules`) ; un autre taux est refusé (`RATE_CHANGED`), rien n'est emprunté.
 */
export const loanBorrowFromTempleInputSchema = z.strictObject({
  principal: oboles,
  termDays: z.number().int().min(1).max(366),
  expectedRateBps: z.number().int().min(0).max(10_000),
});
export type LoanBorrowFromTempleInput = z.infer<typeof loanBorrowFromTempleInputSchema>;

const disbursed = {
  loanId: z.uuid(),
  principal: oboles,
  rateBps: z.number().int().min(0).max(10_000),
  termDays: z.number().int().min(1).max(366),
  /** Intérêt simple fixé à l'emprunt pour toute la durée. */
  interest: owed,
  /** Reste dû : principal plus intérêts. */
  outstanding: oboles,
  dueDay: day,
  dueAt: z.iso.datetime(),
};
export const loanBorrowFromTempleOutputSchema = z.object(disbursed);
export type LoanBorrowFromTempleOutput = z.infer<typeof loanBorrowFromTempleOutputSchema>;

export const LOAN_BORROW_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** La configuration en vigueur n'a pas de Trésor du temple : il ne prête pas. */
  'TEMPLE_CLOSED',
  /** Le taux directeur n'est plus celui que le client a envoyé, que le message donne. */
  'RATE_CHANGED',
  /** Cette durée n'est pas parmi celles que le temple admet. */
  'TERM_NOT_OFFERED',
  /** La maison porte une marque de déshonneur (un prêt en défaut, #725). */
  'DISHONORED',
  /** La maison a déjà un prêt du temple en cours. */
  'LOAN_OUTSTANDING',
  /** Le principal dépasse le plafond du palier de Timè de la maison, que le message donne. */
  'ABOVE_CAP',
] as const;
export type LoanBorrowErrorCode = (typeof LOAN_BORROW_ERROR_CODES)[number];

/** Commande `loan.repay` : un prêt de la maison et le montant remboursé, intérêts d'abord. */
export const loanRepayInputSchema = z.strictObject({
  loanId: z.uuid(),
  amount: oboles,
});
export type LoanRepayInput = z.infer<typeof loanRepayInputSchema>;

const repaid = {
  loanId: z.uuid(),
  /** Part des intérêts, puis part du principal : leur somme est le montant remboursé. */
  interest: owed,
  principal: owed,
  /** Reste dû après le remboursement ; nul, le prêt est remboursé. */
  outstanding: owed,
  status: z.enum(LOAN_STATUSES),
};
export const loanRepayOutputSchema = z.object(repaid);
export type LoanRepayOutput = z.infer<typeof loanRepayOutputSchema>;

export const LOAN_REPAY_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucun prêt de cet identifiant pour la maison : celui d'une autre maison est inconnu. */
  'LOAN_NOT_FOUND',
  /** Le prêt est déjà remboursé. */
  'LOAN_REPAID',
  /** Le montant dépasse le reste dû, que le message donne. */
  'ABOVE_OUTSTANDING',
  'INSUFFICIENT_FUNDS',
] as const;
export type LoanRepayErrorCode = (typeof LOAN_REPAY_ERROR_CODES)[number];

/** Le temple a prêté à une maison : son prêt et ses conditions. Lu par le seul serveur. */
export const loanDisbursedSchema = z.strictObject({
  type: z.literal('LoanDisbursed'),
  payload: z.strictObject({ ...disbursed, houseId: z.uuid(), lender: z.literal('temple') }),
});

/** Une maison a remboursé une part de son prêt : intérêts, principal, reste dû et état. Lu par le seul serveur. */
export const loanRepaidSchema = z.strictObject({
  type: z.literal('LoanRepaid'),
  payload: z.strictObject({ ...repaid, houseId: z.uuid() }),
});
