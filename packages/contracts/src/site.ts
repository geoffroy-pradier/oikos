import { z } from 'zod';

/** Commande `site.collect` : récolte la production accumulée par un site depuis la dernière collecte. */
export const siteCollectInputSchema = z.strictObject({ siteId: z.uuid() });
export type SiteCollectInput = z.infer<typeof siteCollectInputSchema>;

const collectedStack = z.strictObject({
  goodId: z.string(),
  quantity: z.number().int().positive(),
});

export const siteCollectOutputSchema = z.object({
  siteId: z.uuid(),
  /** Nombre de cycles de recette récoltés. */
  cycles: z.number().int().positive(),
  outputs: z.array(collectedStack).min(1),
  /** Début du cycle désormais en cours (ISO 8601). */
  cycleStartedAt: z.iso.datetime(),
});
export type SiteCollectOutput = z.infer<typeof siteCollectOutputSchema>;

export const SITE_COLLECT_ERROR_CODES = ['SITE_NOT_FOUND', 'NOTHING_TO_COLLECT'] as const;
export type SiteCollectErrorCode = (typeof SITE_COLLECT_ERROR_CODES)[number];

export const siteCollectedSchema = z.strictObject({
  type: z.literal('SiteCollected'),
  payload: z.strictObject({
    siteId: z.uuid(),
    houseId: z.uuid(),
    cycles: z.number().int().positive(),
    outputs: z.array(collectedStack).min(1),
  }),
});
