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

/**
 * Commande `bank.deposit` (#727) : verser à une banque du monde, qui n'est pas celle de la maison, un montant de sa
 * trésorerie, au taux de dépôt que le joueur a vu (`banks`) ; un autre taux est refusé (`RATE_CHANGED`), rien n'est
 * versé. La monnaie passe au coffre ; la maison en garde une créance, son dépôt, qui n'est pas de la monnaie de plus.
 */
export const bankDepositInputSchema = z.strictObject({
  bankId: z.uuid(),
  amount: positive,
  expectedRateBps: rate,
});
export type BankDepositInput = z.infer<typeof bankDepositInputSchema>;

/** Commande `bank.withdraw` (#727) : retirer de son dépôt dans une banque, ce que le solde et le coffre couvrent. */
export const bankWithdrawInputSchema = z.strictObject({
  bankId: z.uuid(),
  amount: positive,
});
export type BankWithdrawInput = z.infer<typeof bankWithdrawInputSchema>;

const deposited = {
  bankId: z.uuid(),
  depositId: z.uuid(),
  amount: positive,
  /** Solde du dépôt après le mouvement, intérêts compris. */
  balance: oboles,
};
export const bankDepositOutputSchema = z.object({ ...deposited, rateBps: rate });
export type BankDepositOutput = z.infer<typeof bankDepositOutputSchema>;
export const bankWithdrawOutputSchema = z.object(deposited);
export type BankWithdrawOutput = z.infer<typeof bankWithdrawOutputSchema>;

export const BANK_DEPOSIT_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'BANKS_CLOSED',
  /** Aucune banque de ce monde ne porte cet identifiant. */
  'BANK_NOT_FOUND',
  /** Une maison ne dépose pas dans sa propre banque : elle y verse du capital (`bank.moveCapital`). */
  'OWN_BANK',
  /** Le taux de dépôt affiché n'est plus celui que le client a envoyé, que le message donne. */
  'RATE_CHANGED',
  'INSUFFICIENT_FUNDS',
] as const;
export type BankDepositErrorCode = (typeof BANK_DEPOSIT_ERROR_CODES)[number];

export const BANK_WITHDRAW_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'BANK_NOT_FOUND',
  /** La maison n'a pas de dépôt dans cette banque. */
  'DEPOSIT_NOT_FOUND',
  /** Le retrait dépasse le solde du dépôt, que le message donne. */
  'ABOVE_BALANCE',
  /** Le coffre de la banque ne couvre pas le retrait : la ruée est possible (5.4). */
  'VAULT_SHORT',
] as const;
export type BankWithdrawErrorCode = (typeof BANK_WITHDRAW_ERROR_CODES)[number];

/** Commande `bank.setRates` (#727) : les taux annuels de dépôt et de prêt que la banque de la maison affiche. */
export const bankSetRatesInputSchema = z.strictObject({
  depositRateBps: rate,
  loanRateBps: rate,
});
export type BankSetRatesInput = z.infer<typeof bankSetRatesInputSchema>;
const rates = { bankId: z.uuid(), depositRateBps: rate, loanRateBps: rate };
export const bankSetRatesOutputSchema = z.object(rates);
export type BankSetRatesOutput = z.infer<typeof bankSetRatesOutputSchema>;

export const BANK_SET_RATES_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'BANKS_CLOSED',
  'BANK_NOT_FOUND',
  /** Un taux est hors des bornes du monde (`bank_rules`), que le message donne. */
  'RATE_OUT_OF_BOUNDS',
] as const;
export type BankSetRatesErrorCode = (typeof BANK_SET_RATES_ERROR_CODES)[number];

/** Une maison a déposé dans une banque. Lu par le seul serveur. */
export const bankDepositedSchema = z.strictObject({
  type: z.literal('BankDeposited'),
  payload: z.strictObject({ ...deposited, rateBps: rate, houseId: z.uuid() }),
});

/** Une maison a retiré de son dépôt dans une banque. Lu par le seul serveur. */
export const bankWithdrawnSchema = z.strictObject({
  type: z.literal('BankWithdrawn'),
  payload: z.strictObject({ ...deposited, houseId: z.uuid() }),
});

/** Une banque a changé ses taux affichés. Lu par le seul serveur. */
export const bankRatesSetSchema = z.strictObject({
  type: z.literal('BankRatesSet'),
  payload: z.strictObject({ ...rates, houseId: z.uuid() }),
});

/** La clôture a ajouté l'intérêt du jour à un dépôt, au taux affiché, sans écriture au grand livre. */
export const bankInterestCreditedSchema = z.strictObject({
  type: z.literal('BankInterestCredited'),
  payload: z.strictObject({
    bankId: z.uuid(),
    depositId: z.uuid(),
    houseId: z.uuid(),
    interest: positive,
    rateBps: rate,
    balance: oboles,
    gameDay: z.number().int().min(0),
  }),
});
