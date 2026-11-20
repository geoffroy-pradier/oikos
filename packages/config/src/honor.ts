import { z } from 'zod';

/** Plafond technique d'une borne ou d'une variation de la Timè : loin des entiers sûrs, dont la base garde la Timè. */
const LIMIT = 1_000_000_000;

/**
 * Timè (docs/specs/04-systemes-gestion.md, 4.1 ; #704) : l'honneur public d'une maison, en entiers, tenu par un
 * journal en ajout seul (`honor_ledger`), à zéro pour une maison nouvelle. Chaque motif du journal a sa variation
 * ici, gain ou perte, nulle au départ ; chaque ticket qui ajoute un motif y ajoute la sienne. Une variation est
 * rognée pour que la Timè reste dans ses bornes (`honorChange`, `@oikos/sim`).
 */
export const honorSchema = z
  .strictObject({
    /** Timè la plus basse ; au plus zéro, la Timè d'une maison nouvelle. */
    min: z.number().int().min(-LIMIT).max(0),
    /** Timè la plus haute ; au moins zéro. */
    max: z.number().int().min(0).max(LIMIT),
    /** Variation de chaque motif, par son code au journal. */
    changes: z.strictObject({
      /** Mandat d'archonte mené à son terme : un gain pour la maison qui l'a tenu (6.2). */
      archon_term: z.number().int().min(0).max(LIMIT),
    }),
  })
  .refine((honor) => honor.min < honor.max, {
    message: 'the lowest Timè must be below the highest',
    path: ['max'],
  });
export type HonorRules = z.infer<typeof honorSchema>;
