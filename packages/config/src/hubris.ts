import { z } from 'zod';

/** Plafond technique d'un poids, d'une baisse ou du déclin, comme pour la Timè (`honor`). */
const LIMIT = 1_000_000_000;
const weight = z.number().int().min(0).max(LIMIT);

/**
 * Hybris (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; #734) : jauge cachée de chaque maison de joueur, en entiers,
 * tenue par un journal en ajout seul (`hubris_ledger`) et recalculée à chaque clôture (`hubrisDelta`, `@oikos/sim`).
 * Elle monte avec la part des ventes d'une maison dans les échanges d'un bien et d'une cité au-delà de
 * `marketShareThresholdBps`, sur `marketShareWindowDays` jours, avec sa fortune au-delà de `wealthMultipleBps` fois la
 * médiane du monde, et avec chaque liturgie prélevée d'office. Elle baisse avec les oboles offertes (offrandes et faste
 * des liturgies), chaque liturgie accomplie, et d'un déclin quotidien. Le joueur ne lit que son palier : le nombre de
 * bornes de `tiers` que sa jauge atteint. Poids, baisses et déclin nuls au départ : la jauge ne bouge pas.
 */
export const hubrisSchema = z.strictObject({
  /** Part des ventes d'un bien dans une cité au-delà de laquelle la jauge monte, en points de base (3 500 : 35 %). */
  marketShareThresholdBps: z.number().int().min(0).max(10_000),
  /** Fenêtre des échanges comptés, en jours de jeu, jusqu'à l'instant de la clôture. */
  marketShareWindowDays: z.number().int().min(1).max(366),
  /** Multiple de la fortune médiane au-delà duquel la jauge monte, en points de base (30 000 : trois fois). */
  wealthMultipleBps: z.number().int().min(10_000).max(LIMIT),
  /** Hybris gagnée par jour et par marché pour une part entière (10 000 points) au-delà du seuil, au prorata. */
  marketShareWeight: weight,
  /** Hybris gagnée par jour pour une médiane de fortune au-delà du multiple, au prorata. */
  wealthWeight: weight,
  /** Hybris gagnée par liturgie prélevée d'office (dérobade, 6.4). */
  leviedLiturgyWeight: weight,
  /** Hybris retirée par obole offerte, en dix-millièmes : offrandes (7.1) et faste d'une liturgie accomplie. */
  offeringReliefBps: weight,
  /** Hybris retirée par liturgie accomplie (6.4), en plus de son faste. */
  performedLiturgyRelief: weight,
  /** Hybris retirée à chaque clôture, jusqu'à zéro. */
  dailyDecay: weight,
  /** Bornes des paliers, strictement croissantes : le palier d'une jauge est le nombre de bornes qu'elle atteint. */
  tiers: z
    .array(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER))
    .min(1)
    .max(10)
    .refine(
      (tiers) => tiers.every((bound, index) => index === 0 || bound > (tiers[index - 1] ?? 0)),
      'tier bounds are strictly increasing',
    ),
});
export type HubrisRules = z.infer<typeof hubrisSchema>;
