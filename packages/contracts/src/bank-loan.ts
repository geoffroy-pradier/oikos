import { z } from 'zod';

/**
 * Prêts gagés des banques de joueurs (docs/specs/05-economie.md, 5.4 ; #728) : le banquier offre à une maison un prêt
 * (principal, taux, durée, garantie), qu'elle accepte aux conditions vues ; le principal passe du coffre à sa trésorerie,
 * dans la limite de la réserve exigée, et la garantie reste bloquée jusqu'au solde. Montants en oboles, entiers sûrs.
 */
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const owed = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const rate = z.number().int().min(0).max(1_000_000);
const term = z.number().int().min(1).max(366);

/** Garantie : un stock de l'emprunteur (cité, bien, quantité), bloqué dans sa cité, ou l'un de ses logements. */
export const loanCollateralSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('stock'),
    cityId: z.uuid(),
    goodId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
    quantity: positive,
  }),
  z.strictObject({ kind: z.literal('property'), propertyId: z.uuid() }),
]);
export type LoanCollateral = z.infer<typeof loanCollateralSchema>;

const terms = {
  principal: positive,
  rateBps: rate,
  termDays: term,
  collateral: loanCollateralSchema,
};

/**
 * Commande `bank.offerLoan` : la banque de la maison offre un prêt à une maison de joueur de son monde, qui n'est pas la
 * sienne, à un taux dans les bornes du monde (`bank_rules`). La garantie n'est jugée qu'à l'acceptation : l'offre ne dit
 * rien au banquier du stock ni des biens de l'emprunteur.
 */
export const bankOfferLoanInputSchema = z.strictObject({ borrowerHouseId: z.uuid(), ...terms });
export type BankOfferLoanInput = z.infer<typeof bankOfferLoanInputSchema>;

const offered = {
  offerId: z.uuid(),
  bankId: z.uuid(),
  borrowerHouseId: z.uuid(),
  ...terms,
  /** Intérêt simple de ces conditions, fixé à l'acceptation pour toute la durée. */
  interest: owed,
};
export const bankOfferLoanOutputSchema = z.object(offered);
export type BankOfferLoanOutput = z.infer<typeof bankOfferLoanOutputSchema>;

export const BANK_OFFER_LOAN_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'BANKS_CLOSED',
  /** La maison n'a pas de banque. */
  'BANK_NOT_FOUND',
  /** Aucune maison de joueur de ce monde ne porte cet identifiant. */
  'BORROWER_NOT_FOUND',
  /** Une banque ne prête pas à sa propre maison. */
  'OWN_HOUSE',
  /** Le taux est hors des bornes du monde (`bank_rules`), que le message donne. */
  'RATE_OUT_OF_BOUNDS',
  /** La garantie nomme une cité, un bien ou un logement que ce monde n'a pas. */
  'COLLATERAL_NOT_FOUND',
] as const;
export type BankOfferLoanErrorCode = (typeof BANK_OFFER_LOAN_ERROR_CODES)[number];

/** Commande `bank.withdrawOffer` : la banque de la maison retire une offre encore ouverte. */
export const bankWithdrawOfferInputSchema = z.strictObject({ offerId: z.uuid() });
export type BankWithdrawOfferInput = z.infer<typeof bankWithdrawOfferInputSchema>;
export const bankWithdrawOfferOutputSchema = z.object({ offerId: z.uuid(), bankId: z.uuid() });
export type BankWithdrawOfferOutput = z.infer<typeof bankWithdrawOfferOutputSchema>;

export const BANK_WITHDRAW_OFFER_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucune offre de la banque de la maison ne porte cet identifiant. */
  'OFFER_NOT_FOUND',
  /** L'offre est déjà retirée ou acceptée. */
  'OFFER_CLOSED',
] as const;
export type BankWithdrawOfferErrorCode = (typeof BANK_WITHDRAW_OFFER_ERROR_CODES)[number];

/**
 * Commande `loan.acceptOffer` : la maison accepte une offre qu'elle a reçue, aux conditions qu'elle a vues
 * (`my_loan_offers`) ; d'autres conditions sont refusées (`TERMS_CHANGED`), rien n'est décaissé.
 */
export const loanAcceptOfferInputSchema = z.strictObject({ offerId: z.uuid(), ...terms });
export type LoanAcceptOfferInput = z.infer<typeof loanAcceptOfferInputSchema>;

const accepted = {
  loanId: z.uuid(),
  offerId: z.uuid(),
  bankId: z.uuid(),
  principal: positive,
  rateBps: rate,
  termDays: term,
  interest: owed,
  /** Reste dû : principal plus intérêts. */
  outstanding: positive,
  dueDay: z.number().int().nonnegative(),
  dueAt: z.iso.datetime(),
};
export const loanAcceptOfferOutputSchema = z.object(accepted);
export type LoanAcceptOfferOutput = z.infer<typeof loanAcceptOfferOutputSchema>;

export const LOAN_ACCEPT_OFFER_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucune offre reçue par la maison ne porte cet identifiant. */
  'OFFER_NOT_FOUND',
  /** L'offre est retirée, ou déjà acceptée. */
  'OFFER_CLOSED',
  /** Les conditions de l'offre ne sont pas celles que le client a envoyées. */
  'TERMS_CHANGED',
  /** La configuration en vigueur n'a pas de section `banks` : aucune banque ne prête. */
  'BANKS_CLOSED',
  /** La maison porte une marque de déshonneur (#725) : elle n'emprunte pas. */
  'DISHONORED',
  /** Le coffre, moins le principal, passerait sous la réserve exigée ; le message donne ce que la banque peut prêter. */
  'RESERVE_SHORT',
  /** La garantie n'est pas libre : stock libre insuffisant, logement d'une autre maison, offert, déjà gagé ou loué à la banque. */
  'COLLATERAL_NOT_FREE',
] as const;
export type LoanAcceptOfferErrorCode = (typeof LOAN_ACCEPT_OFFER_ERROR_CODES)[number];

/** Une banque a offert un prêt à une maison. Lu par le seul serveur. */
export const loanOfferedSchema = z.strictObject({
  type: z.literal('LoanOffered'),
  payload: z.strictObject({ ...offered, houseId: z.uuid() }),
});

/** Une banque a retiré une offre de prêt. Lu par le seul serveur. */
export const loanOfferWithdrawnSchema = z.strictObject({
  type: z.literal('LoanOfferWithdrawn'),
  payload: z.strictObject({ offerId: z.uuid(), bankId: z.uuid(), houseId: z.uuid() }),
});

/** Une maison a accepté l'offre d'une banque : le prêt, ses conditions et sa garantie. Lu par le seul serveur. */
export const loanOfferAcceptedSchema = z.strictObject({
  type: z.literal('LoanOfferAccepted'),
  payload: z.strictObject({ ...accepted, collateral: loanCollateralSchema, houseId: z.uuid() }),
});

/**
 * La clôture a saisi la garantie d'un prêt de banque que le prélèvement de l'échéance ne soldait pas (#729) : le stock
 * gagé ou le logement, avec son bail en cours, passe de l'emprunteur (`houseId`) à la maison de la banque
 * (`bankHouseId`), et la saisie solde le prêt, son reste dû (`writtenOff`) remis quelle que soit la valeur de la
 * garantie ; jour de jeu de la clôture. Lu par le seul serveur.
 */
export const collateralSeizedSchema = z.strictObject({
  type: z.literal('CollateralSeized'),
  payload: z.strictObject({
    loanId: z.uuid(),
    bankId: z.uuid(),
    houseId: z.uuid(),
    bankHouseId: z.uuid(),
    collateral: loanCollateralSchema,
    writtenOff: positive,
    gameDay: z.number().int().nonnegative(),
  }),
});
