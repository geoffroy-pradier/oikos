import { z } from 'zod';
import { houseNameSchema } from './house';

/**
 * Banques de joueurs (trapeza, docs/specs/05-economie.md, 5.4 ; #726) : une maison fonde au plus une banque, dans sa
 * cité, en payant le droit de fondation et en versant un capital au coffre, puis y verse ou en retire du capital, ce
 * qui excède la réserve exigée. Montants en oboles, entiers sûrs.
 */
const oboles = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const rate = z.number().int().min(0).max(1_000_000);

/**
 * Commande `bank.found` : le nom de la banque (règle du nom d'une maison), le capital versé au coffre et le droit de
 * fondation que le joueur a vu (`bank_rules`) ; un autre droit est refusé (`FEE_CHANGED`), rien n'est payé.
 */
export const bankFoundInputSchema = z.strictObject({
  name: houseNameSchema,
  capital: oboles,
  expectedCharterFee: oboles,
});
export type BankFoundInput = z.infer<typeof bankFoundInputSchema>;

const founded = {
  bankId: z.uuid(),
  cityId: z.uuid(),
  name: z.string(),
  /** Droit payé, détruit par le puits `sink_bank_charter`. */
  charterFee: oboles,
  /** Capital versé au coffre à la fondation. */
  capital: oboles,
  /** Taux affichés à la fondation : les bornes basses du monde, que `bank.setRates` (#727) changera. */
  depositRateBps: rate,
  loanRateBps: rate,
};
export const bankFoundOutputSchema = z.object(founded);
export type BankFoundOutput = z.infer<typeof bankFoundOutputSchema>;

export const BANK_FOUND_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** La configuration en vigueur n'a pas de section `banks` : aucune banque ne se fonde. */
  'BANKS_CLOSED',
  /** Le droit de fondation n'est plus celui que le client a envoyé, que le message donne. */
  'FEE_CHANGED',
  /** Le capital est sous le capital minimal, que le message donne. */
  'CAPITAL_TOO_LOW',
  /** La maison a déjà sa banque. */
  'BANK_EXISTS',
  /** Une banque du monde porte déjà ce nom, casse ignorée. */
  'NAME_TAKEN',
  'INSUFFICIENT_FUNDS',
] as const;
export type BankFoundErrorCode = (typeof BANK_FOUND_ERROR_CODES)[number];

export const BANK_CAPITAL_DIRECTIONS = ['in', 'out'] as const;
export type BankCapitalDirection = (typeof BANK_CAPITAL_DIRECTIONS)[number];

/**
 * Commande `bank.moveCapital` : verser au coffre de la banque de la maison (`in`) ou en retirer (`out`) un montant ; un
 * retrait ne prend que ce qui excède la réserve exigée.
 */
export const bankMoveCapitalInputSchema = z.strictObject({
  direction: z.enum(BANK_CAPITAL_DIRECTIONS),
  amount: positive,
});
export type BankMoveCapitalInput = z.infer<typeof bankMoveCapitalInputSchema>;

const moved = {
  bankId: z.uuid(),
  direction: z.enum(BANK_CAPITAL_DIRECTIONS),
  amount: positive,
  /** Coffre après le mouvement. */
  vault: oboles,
  /** Réserve exigée en vigueur : le coffre n'en descend pas par un retrait. */
  requiredReserve: oboles,
};
export const bankMoveCapitalOutputSchema = z.object(moved);
export type BankMoveCapitalOutput = z.infer<typeof bankMoveCapitalOutputSchema>;

export const BANK_MOVE_CAPITAL_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'BANKS_CLOSED',
  /** La maison n'a pas de banque. */
  'BANK_NOT_FOUND',
  /** Un versement dépasse la trésorerie. */
  'INSUFFICIENT_FUNDS',
  /** Un retrait passerait le coffre sous la réserve exigée ; le message donne ce qui peut sortir. */
  'RESERVE_SHORT',
] as const;
export type BankMoveCapitalErrorCode = (typeof BANK_MOVE_CAPITAL_ERROR_CODES)[number];

/** Une maison a fondé sa banque : la banque, son droit, son capital et ses taux. Lu par le seul serveur. */
export const bankFoundedSchema = z.strictObject({
  type: z.literal('BankFounded'),
  payload: z.strictObject({ ...founded, houseId: z.uuid() }),
});

/** Une maison a versé au coffre de sa banque ou en a retiré du capital. Lu par le seul serveur. */
export const bankCapitalMovedSchema = z.strictObject({
  type: z.literal('BankCapitalMoved'),
  payload: z.strictObject({ ...moved, houseId: z.uuid() }),
});
