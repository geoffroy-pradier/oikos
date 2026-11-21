import { z } from 'zod';
import { houseNameSchema } from './house';

/**
 * Banques de joueurs (trapeza, docs/specs/05-economie.md, 5.4 ; #726) : une maison fonde au plus une banque, dans sa
 * cité, en payant le droit de fondation et en versant un capital au coffre. Montants en oboles, entiers sûrs.
 */
const oboles = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
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

/** Une maison a fondé sa banque : la banque, son droit, son capital et ses taux. Lu par le seul serveur. */
export const bankFoundedSchema = z.strictObject({
  type: z.literal('BankFounded'),
  payload: z.strictObject({ ...founded, houseId: z.uuid() }),
});
