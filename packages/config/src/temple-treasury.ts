import { z } from 'zod';

/** Plafond technique d'une borne de Timè, comme pour la Timè elle-même (`honor`). */
const HONOR_LIMIT = 1_000_000_000;
/**
 * Plafond technique d'un principal, en oboles : principal et intérêts (au plus un peu plus que le principal, au taux le
 * plus haut sur la durée la plus longue) restent loin des entiers sûrs, dont la base garde le reste dû.
 */
const PRINCIPAL_LIMIT = 1_000_000_000_000;

/**
 * Trésor du temple (docs/specs/05-economie.md, 5.4 ; #724) : prêteur PNJ au taux directeur, plafonné par la Timè, levier
 * de politique monétaire des administrateurs. Un prêt porte un intérêt simple, fixé à l'emprunt pour toute sa durée
 * (`templeLoanInterest`, `@oikos/sim`) ; son principal est créé par le robinet `faucet_temple_loans`, ses intérêts vont
 * au puits `sink_temple_interest` (5.5). Une maison n'a qu'un prêt du temple à la fois ; son principal est au plus le
 * plafond du palier de Timè qu'elle atteint (`templeLoanCap`). Plafonds nuls au départ : aucun prêt ne se consent.
 */
export const templeTreasurySchema = z
  .strictObject({
    /** Taux directeur annuel, en points de base (10 000 : 100 % l'an). */
    policyRateBps: z.number().int().min(0).max(10_000),
    /** Durées admises d'un prêt, en jours de jeu : l'échéance est la clôture autant de jours après l'emprunt. */
    termDays: z
      .array(z.number().int().min(1).max(366))
      .min(1)
      .max(20)
      .refine((terms) => new Set(terms).size === terms.length, 'each term appears once'),
    /**
     * Paliers de Timè, par Timè croissante : une maison dont la Timè atteint `minHonor` emprunte au plus `maxPrincipal`
     * oboles, le plafond du plus haut palier qu'elle atteint ; sous le premier palier, rien.
     */
    principalCaps: z
      .array(
        z.strictObject({
          minHonor: z.number().int().min(-HONOR_LIMIT).max(HONOR_LIMIT),
          maxPrincipal: z.number().int().min(0).max(PRINCIPAL_LIMIT),
        }),
      )
      .max(50),
    /**
     * Timè perdue par une maison dont le prêt passe en défaut à son échéance (#725), en valeur absolue, rognée aux
     * bornes de la Timè. Absente des versions publiées avant #725 : `DEFAULT_LOAN_DEFAULT_HONOR_LOSS`, aucune perte.
     */
    defaultHonorLoss: z.number().int().min(0).max(HONOR_LIMIT).optional(),
    /**
     * Durée de la marque de déshonneur après le solde d'un prêt en défaut, en jours de jeu (#725) : elle est levée à la
     * clôture autant de jours après le jour du solde. Absente des versions publiées avant #725 : `DEFAULT_DISHONOR_DAYS`,
     * la marque levée au solde, comme avant.
     */
    dishonorDays: z.number().int().min(0).max(3660).optional(),
  })
  .superRefine((rules, ctx) => {
    rules.principalCaps.forEach((tier, index) => {
      const previous = rules.principalCaps[index - 1];
      if (!previous) return;
      if (tier.minHonor <= previous.minHonor)
        ctx.addIssue({
          code: 'custom',
          path: ['principalCaps', index, 'minHonor'],
          message: 'the Timè tiers must rise',
        });
      // Plus de Timè, jamais moins de crédit.
      if (tier.maxPrincipal < previous.maxPrincipal)
        ctx.addIssue({
          code: 'custom',
          path: ['principalCaps', index, 'maxPrincipal'],
          message: 'a higher tier lends no less',
        });
    });
  });
export type TempleTreasuryRules = z.infer<typeof templeTreasurySchema>;

/** Perte de Timè d'un défaut pour une version qui ne la donne pas (publiée avant #725) : aucune, comportement inchangé. */
export const DEFAULT_LOAN_DEFAULT_HONOR_LOSS = 0;
/** Marque de déshonneur d'une version qui ne la borne pas (publiée avant #725) : levée au solde, comportement inchangé. */
export const DEFAULT_DISHONOR_DAYS = 0;
