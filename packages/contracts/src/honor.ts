import { z } from 'zod';

/**
 * Timè (docs/specs/04-systemes-gestion.md, 4.1 ; #704) : motifs du journal de l'honneur (`honor_ledger`), liste
 * fermée que la base vérifie aussi. Chaque ticket qui ajoute un motif l'ajoute ici, à la base et à la
 * configuration (`honor.changes`).
 */
export const HONOR_REASONS = [
  /** Mandat d'archonte mené à son terme (6.2), référence : la charge (`offices`). */
  'archon_term',
  /** Liturgie accomplie (6.4, #720), un gain ; référence : la liturgie. */
  'liturgy_performed',
  /** Dérobade à une liturgie, prélevée d'office à son échéance (6.4, #720), une perte ; référence : la liturgie. */
  'liturgy_evaded',
] as const;
export type HonorReason = (typeof HONOR_REASONS)[number];

const safe = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

/** La Timè d'une maison a changé : sa variation, non nulle, son motif et sa Timè après la variation. */
export const honorChangedSchema = z.strictObject({
  type: z.literal('HonorChanged'),
  payload: z.strictObject({
    houseId: z.uuid(),
    amount: safe.refine((amount) => amount !== 0, 'a Timè change is never zero'),
    reason: z.enum(HONOR_REASONS),
    balance: safe,
  }),
});
