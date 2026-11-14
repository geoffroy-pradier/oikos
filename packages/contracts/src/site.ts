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

/** Commande `site.acquire` : la maison acquiert un site dans sa cité et y lance une recette. */
export const siteAcquireInputSchema = z.strictObject({
  recipeId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
});
export type SiteAcquireInput = z.infer<typeof siteAcquireInputSchema>;

export const siteAcquireOutputSchema = z.object({
  siteId: z.uuid(),
  recipeId: z.string(),
  /** Type du site : celui de la recette choisie. */
  siteType: z.string(),
  /** Prix payé, en oboles (détruit). */
  costOboles: z.number().int().positive(),
});
export type SiteAcquireOutput = z.infer<typeof siteAcquireOutputSchema>;

export const SITE_ACQUIRE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'RECIPE_NOT_FOUND',
  'RECIPE_NOT_AVAILABLE',
  'SITE_LIMIT_REACHED',
  'INSUFFICIENT_FUNDS',
] as const;
export type SiteAcquireErrorCode = (typeof SITE_ACQUIRE_ERROR_CODES)[number];

/** Commande `site.setRecipe` : le site change de recette, parmi celles de son type. */
export const siteSetRecipeInputSchema = z.strictObject({
  siteId: z.uuid(),
  recipeId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
});
export type SiteSetRecipeInput = z.infer<typeof siteSetRecipeInputSchema>;

export const siteSetRecipeOutputSchema = z.object({
  siteId: z.uuid(),
  recipeId: z.string(),
  /** Début du nouveau cycle (ISO 8601) : le changement de recette repart de l'instant présent. */
  cycleStartedAt: z.iso.datetime(),
});
export type SiteSetRecipeOutput = z.infer<typeof siteSetRecipeOutputSchema>;

export const SITE_SET_RECIPE_ERROR_CODES = [
  'SITE_NOT_FOUND',
  'RECIPE_NOT_FOUND',
  'RECIPE_NOT_AVAILABLE',
  'RECIPE_NOT_COMPATIBLE',
  'RECIPE_UNCHANGED',
  'COLLECT_FIRST',
  'SITE_CHANGED',
] as const;
export type SiteSetRecipeErrorCode = (typeof SITE_SET_RECIPE_ERROR_CODES)[number];

export const siteAcquiredSchema = z.strictObject({
  type: z.literal('SiteAcquired'),
  payload: z.strictObject({
    siteId: z.uuid(),
    houseId: z.uuid(),
    cityId: z.uuid(),
    recipeId: z.string(),
    siteType: z.string(),
    costOboles: z.number().int().positive(),
  }),
});

export const siteRecipeChangedSchema = z.strictObject({
  type: z.literal('SiteRecipeChanged'),
  payload: z.strictObject({
    siteId: z.uuid(),
    houseId: z.uuid(),
    previousRecipeId: z.string(),
    recipeId: z.string(),
  }),
});
