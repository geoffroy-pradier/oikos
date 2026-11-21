import { z } from 'zod';

/**
 * Plafond technique d'un montant de la section, en oboles, comme le principal d'un prêt du temple : un droit, un capital
 * ou une réserve restent loin des entiers sûrs, dont la base garde les soldes.
 */
const AMOUNT_LIMIT = 1_000_000_000_000;
/** Plafond technique d'un taux annuel, en points de base (100 000 : 1 000 % l'an). */
const RATE_LIMIT = 100_000;

/** Bornes d'un taux annuel affiché par une banque, en points de base, la plus basse d'abord. */
const rateBoundsSchema = z
  .strictObject({
    min: z.number().int().min(0).max(RATE_LIMIT),
    max: z.number().int().min(0).max(RATE_LIMIT),
  })
  .refine((bounds) => bounds.min <= bounds.max, {
    path: ['max'],
    message: 'the upper bound is not below the lower one',
  });

/**
 * Banques de joueurs (trapeza, docs/specs/05-economie.md, 5.4 ; #726) : une maison fonde au plus une banque, dans sa
 * cité, en payant un droit de fondation, détruit par le puits `sink_bank_charter`, et en versant au coffre de la banque
 * un capital d'au moins `minCapitalOboles`. Le coffre est un compte du grand livre, que la masse monétaire compte ; la
 * maison n'en retire que ce qui excède la réserve exigée (`bankRequiredReserve`, `@oikos/sim`). Les dépôts (#727) et les
 * prêts (#728) affichent leurs taux dans les bornes du monde. Une version sans cette section ne laisse fonder aucune
 * banque (`BANKS_CLOSED`), et la configuration initiale ne la porte pas.
 */
export const banksSchema = z.strictObject({
  /** Droit de fondation, en oboles, détruit à la fondation ; nul, la fondation n'a pas d'écriture de droit. */
  charterFeeOboles: z.number().int().min(0).max(AMOUNT_LIMIT),
  /** Capital versé au coffre à la fondation, au moins, en oboles ; c'est aussi le plancher de la réserve exigée. */
  minCapitalOboles: z.number().int().min(0).max(AMOUNT_LIMIT),
  /** Réserve exigée en part des dépôts (#727), en points de base (10 000 : la totalité des dépôts). */
  reserveRatioBps: z.number().int().min(0).max(10_000),
  /** Bornes du taux annuel servi aux déposants (#727). */
  depositRateBps: rateBoundsSchema,
  /** Bornes du taux annuel des prêts d'une banque (#728). */
  loanRateBps: rateBoundsSchema,
});
export type BankRules = z.infer<typeof banksSchema>;
