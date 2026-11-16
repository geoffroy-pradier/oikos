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
  /** Intrants consommés dans le stock de la maison (vide pour une production primaire). */
  inputs: z.array(collectedStack),
  outputs: z.array(collectedStack).min(1),
  /** Début du cycle désormais en cours (ISO 8601). */
  cycleStartedAt: z.iso.datetime(),
});
export type SiteCollectOutput = z.infer<typeof siteCollectOutputSchema>;

export const SITE_COLLECT_ERROR_CODES = [
  'SITE_NOT_FOUND',
  'NOTHING_TO_COLLECT',
  /** Un cycle au moins est écoulé, mais le stock libre ne couvre les intrants d'aucun. */
  'MISSING_INPUTS',
  /** Atelier à l'arrêt, entretien impayé : il ne consomme aucun intrant avant d'être relancé. */
  'SITE_HALTED',
  /** La recette du site n'est plus dans la configuration : il ne produit plus, il doit en changer. */
  'RECIPE_RETIRED',
] as const;
export type SiteCollectErrorCode = (typeof SITE_COLLECT_ERROR_CODES)[number];

export const siteCollectedSchema = z.strictObject({
  type: z.literal('SiteCollected'),
  payload: z.strictObject({
    siteId: z.uuid(),
    houseId: z.uuid(),
    cycles: z.number().int().positive(),
    // Absent des événements enregistrés avant les ateliers : lu comme « aucun intrant ».
    inputs: z.array(collectedStack).default([]),
    outputs: z.array(collectedStack).min(1),
  }),
});

/** Commande `site.acquire` : la maison acquiert un site dans sa cité et y lance une recette. */
export const siteAcquireInputSchema = z.strictObject({
  recipeId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  /**
   * Prix que le joueur a vu, en oboles : un autre tarif en vigueur est refusé (`PRICE_CHANGED`), pas
   * prélevé. Facultatif pour un client antérieur, servi au tarif en vigueur comme avant (4.2).
   */
  expectedCostOboles: z.number().int().positive().optional(),
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
  /** Production primaire absente du terroir de la cité de la maison (4.2) : rien n'est payé. */
  'RECIPE_NOT_IN_TERROIR',
  'SITE_LIMIT_REACHED',
  'INSUFFICIENT_FUNDS',
  /** Le prix en vigueur n'est pas celui que le client a envoyé : rien n'est payé, réessayer au nouveau prix. */
  'PRICE_CHANGED',
  /** La cité n'offre plus les travailleurs de cette recette (4.4, #258) : rien n'est payé. */
  'NO_WORKERS_AVAILABLE',
] as const;
export type SiteAcquireErrorCode = (typeof SITE_ACQUIRE_ERROR_CODES)[number];

/**
 * Commande `site.setRecipe` : le site change de recette, parmi celles de son type. Un site dont la
 * recette n'est plus dans la configuration n'a plus de type : il peut adopter n'importe quelle recette.
 */
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
  'RECIPE_NOT_COMPATIBLE',
  /** Production primaire absente du terroir de la cité du site (4.2) : le site garde sa recette. */
  'RECIPE_NOT_IN_TERROIR',
  'RECIPE_UNCHANGED',
  'COLLECT_FIRST',
  /** Le site est à l'arrêt, entretien impayé : il ne change pas de recette avant d'être relancé. */
  'SITE_HALTED',
  /** Le site a bougé pendant la commande. Comme tout refus, il est lié à sa clé : réessayer avec une clé neuve. */
  'SITE_CHANGED',
  /** La nouvelle recette demande plus de travailleurs que la cité n'en offre encore (#258) : rien ne change. */
  'NO_WORKERS_AVAILABLE',
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

/** Commande `site.restart` : relance un site à l'arrêt en payant l'entretien d'un jour (5.5). */
export const siteRestartInputSchema = z.strictObject({
  siteId: z.uuid(),
  /**
   * Prix de la relance que le joueur a vu, en oboles : le dû d'un jour du site, entretien et salaires
   * compris (5.5). Comme pour `site.acquire`, facultatif.
   */
  expectedUpkeepOboles: z.number().int().nonnegative().optional(),
});
export type SiteRestartInput = z.infer<typeof siteRestartInputSchema>;

export const siteRestartOutputSchema = z.object({
  siteId: z.uuid(),
  /** Entretien payé, en oboles, détruit par le puits `sink_upkeep`. */
  upkeepOboles: z.number().int().nonnegative(),
  /** Salaires payés, en oboles, détruits par le puits `sink_npc_wages` (4.4). */
  wagesOboles: z.number().int().nonnegative(),
  /** Début du cycle repris : celui d'avant l'arrêt, décalé de la durée de l'arrêt (ISO 8601). */
  cycleStartedAt: z.iso.datetime(),
});
export type SiteRestartOutput = z.infer<typeof siteRestartOutputSchema>;

export const SITE_RESTART_ERROR_CODES = [
  'SITE_NOT_FOUND',
  'SITE_NOT_HALTED',
  'INSUFFICIENT_FUNDS',
  /** Le site vient d'être arrêté par une clôture pendant la commande : réessayer avec une clé neuve. */
  'SITE_CHANGED',
  /** Le prix en vigueur (entretien et salaires) n'est pas celui que le client a envoyé : rien n'est payé. */
  'PRICE_CHANGED',
] as const;
export type SiteRestartErrorCode = (typeof SITE_RESTART_ERROR_CODES)[number];

export const siteRestartedSchema = z.strictObject({
  type: z.literal('SiteRestarted'),
  payload: z.strictObject({
    siteId: z.uuid(),
    houseId: z.uuid(),
    upkeepOboles: z.number().int().nonnegative(),
    wagesOboles: z.number().int().nonnegative(),
  }),
});

const oboles = z.number().int().nonnegative();
/**
 * Le dû d'un jour d'un site, payé en entier ou pas du tout : entretien plus salaires (5.5, 4.4), plus
 * l'hébergement chez les PNJ de ses travailleurs sans logement quand il coûte (#258).
 */
const upkeepDue = z
  .strictObject({
    siteId: z.uuid(),
    oboles,
    upkeepOboles: oboles,
    wagesOboles: oboles,
    lodgingOboles: oboles.optional(),
  })
  .refine((due) => due.oboles === due.upkeepOboles + due.wagesOboles + (due.lodgingOboles ?? 0), {
    message: 'oboles must be upkeep plus wages plus lodging',
  });
/** L'entretien d'un jour d'un navire, payé en entier ou pas du tout (#252). */
const shipUpkeepDue = z.strictObject({ shipId: z.uuid(), oboles });
/**
 * Entretien des navires d'une maison réglé à une clôture, après ses sites (#252) : ce qui a été payé, ce
 * qui ne l'a pas été, les navires que cette clôture a désarmés et ceux qu'elle a réarmés.
 */
const shipsSettled = z
  .strictObject({
    upkeepOboles: oboles,
    paid: z.array(shipUpkeepDue),
    unpaid: z.array(shipUpkeepDue),
    laidUp: z.array(z.uuid()),
    rearmed: z.array(z.uuid()),
  })
  .refine((ships) => ships.upkeepOboles === ships.paid.reduce((sum, due) => sum + due.oboles, 0), {
    message: 'ship upkeep must add up',
  });
/** L'entretien d'un jour d'un bien immobilier, payé en entier ou pas du tout (#256). */
const propertyUpkeepDue = z.strictObject({ propertyId: z.uuid(), oboles });
/**
 * Entretien des biens immobiliers d'une maison réglé à une clôture, après ses sites et ses navires (#256) :
 * ce qui a été payé, ce qui ne l'a pas été, les biens que cette clôture a trouvés impayés (`lapsed` : ils
 * ne logent plus personne) et ceux dont elle a levé l'impayé (`restored`).
 */
const propertiesSettled = z
  .strictObject({
    upkeepOboles: oboles,
    paid: z.array(propertyUpkeepDue),
    unpaid: z.array(propertyUpkeepDue),
    lapsed: z.array(z.uuid()),
    restored: z.array(z.uuid()),
  })
  .refine(
    (estate) => estate.upkeepOboles === estate.paid.reduce((sum, due) => sum + due.oboles, 0),
    { message: 'property upkeep must add up' },
  );
/**
 * Entretien et salaires d'une maison réglés à une clôture quotidienne (5.5) : ce qui a été payé, au total
 * et par nature, ce qui ne l'a pas été, les sites que cette clôture a arrêtés et ceux qu'elle a relancés.
 * Une maison qui a des navires y trouve aussi leur entretien (`ships`), compté dans le total, et de même
 * pour ses biens immobiliers (`properties`).
 * Émis par le moteur, sans commande.
 */
export const upkeepSettledSchema = z.strictObject({
  type: z.literal('UpkeepSettled'),
  payload: z
    .strictObject({
      houseId: z.uuid(),
      gameDay: z.number().int().nonnegative(),
      paidOboles: oboles,
      upkeepOboles: oboles,
      wagesOboles: oboles,
      /** Hébergement chez les PNJ (#258), écriture `lodging.daily` ; absent quand il ne coûte rien. */
      lodgingOboles: oboles.optional(),
      paid: z.array(upkeepDue),
      unpaid: z.array(upkeepDue),
      halted: z.array(z.uuid()),
      resumed: z.array(z.uuid()),
      ships: shipsSettled.optional(),
      properties: propertiesSettled.optional(),
    })
    // Les parts font le tout, et le tout est ce que les sites et les navires payés ont coûté.
    .refine(
      (payload) =>
        payload.paidOboles ===
          payload.upkeepOboles +
            payload.wagesOboles +
            (payload.lodgingOboles ?? 0) +
            (payload.ships?.upkeepOboles ?? 0) +
            (payload.properties?.upkeepOboles ?? 0) &&
        payload.upkeepOboles === payload.paid.reduce((sum, due) => sum + due.upkeepOboles, 0) &&
        payload.wagesOboles === payload.paid.reduce((sum, due) => sum + due.wagesOboles, 0) &&
        (payload.lodgingOboles ?? 0) ===
          payload.paid.reduce((sum, due) => sum + (due.lodgingOboles ?? 0), 0),
      { message: 'paid amounts must add up' },
    ),
});
