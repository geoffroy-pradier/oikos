import { z } from 'zod';

/** Genres d'une liturgie (6.4) : fête, triérarchie (navire d'escorte), chorégie (chœur). Ils ne changent que le libellé. */
export const LITURGY_GENRES = ['festival', 'trierarchy', 'choregia'] as const;
export type LiturgyGenre = (typeof LITURGY_GENRES)[number];

/** Plafond technique d'un gain ou d'une perte, comme pour la Timè (`honor`). */
const LIMIT = 1_000_000_000;
const oboles = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * Liturgies (docs/specs/06-cites-politique-communaute.md, 6.4 ; #719) : à la première clôture de chaque saison, chaque
 * cité confie une dépense publique à ses `housesPerCity` maisons les plus riches dont la fortune atteint
 * `wealthFloor`. Le dû est la part `dueShareBps` de la fortune, arrondie à l'obole supérieure, entre `minDue` et
 * `maxDue` (`liturgyDue`, `@oikos/sim`), à régler dans `dueDays` jours de jeu. Le genre est tiré dans `genres`. Les
 * gains et la perte servent à l'accomplissement et à la dérobade (#720). Aucune maison désignée au départ.
 */
export const liturgiesSchema = z
  .strictObject({
    /** Maisons désignées par cité et par saison ; zéro : aucune. */
    housesPerCity: z.number().int().min(0).max(100),
    /** Fortune la plus basse d'une maison désignée, en oboles ; au moins le dû minimal. */
    wealthFloor: oboles,
    /** Part de la fortune due, en points de base. */
    dueShareBps: z.number().int().min(1).max(10_000),
    /** Dû minimal et maximal, en oboles. */
    minDue: oboles.min(1),
    maxDue: oboles.min(1),
    /** Délai pour accomplir, en jours de jeu : l'échéance est la clôture `dueDays` jours après la désignation. */
    dueDays: z.number().int().min(1).max(366),
    /** Genres tirés, chacun une fois. */
    genres: z
      .array(z.enum(LITURGY_GENRES))
      .min(1)
      .refine((genres) => new Set(genres).size === genres.length, 'each genre appears once'),
    /** Timè et Charis (envers le dieu protecteur de la cité) gagnées par une liturgie accomplie (#720). */
    honorGain: z.number().int().min(0).max(LIMIT),
    charisGain: z.number().int().min(0).max(LIMIT),
    /** Timè perdue par une dérobade, en valeur absolue (#720). */
    evasionHonorLoss: z.number().int().min(0).max(LIMIT),
  })
  .superRefine((rules, ctx) => {
    if (rules.minDue > rules.maxDue)
      ctx.addIssue({
        code: 'custom',
        path: ['maxDue'],
        message: 'the highest due is below the lowest',
      });
    // Le dû ne dépasse jamais la fortune d'une maison désignée : la part est au plus 100 % et le dû minimal au plus
    // le plancher.
    if (rules.minDue > rules.wealthFloor)
      ctx.addIssue({
        code: 'custom',
        path: ['wealthFloor'],
        message: 'the wealth floor is below the lowest due',
      });
  });
export type LiturgyRules = z.infer<typeof liturgiesSchema>;
