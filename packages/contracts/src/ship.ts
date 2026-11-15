import { z } from 'zod';

/** Commande `ship.acquire` : la maison achète un navire neuf, à quai dans le port de sa cité (4.6). */
export const shipAcquireInputSchema = z.strictObject({
  classId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  /**
   * Prix que le joueur a vu, en oboles : un autre tarif en vigueur est refusé (`PRICE_CHANGED`), pas
   * prélevé. Obligatoire, à la différence de `site.acquire` : aucun client antérieur ne l'omet.
   */
  expectedCostOboles: z.number().int().positive(),
});
export type ShipAcquireInput = z.infer<typeof shipAcquireInputSchema>;

export const shipAcquireOutputSchema = z.object({
  shipId: z.uuid(),
  classId: z.string(),
  /** Cité où le navire est à quai : celle de la maison. */
  dockedCityId: z.uuid(),
  /** Prix payé, en oboles (détruit). */
  costOboles: z.number().int().positive(),
});
export type ShipAcquireOutput = z.infer<typeof shipAcquireOutputSchema>;

export const SHIP_ACQUIRE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Classe absente de la configuration en vigueur (une version publiée avant le transport n'en a aucune). */
  'SHIP_CLASS_NOT_FOUND',
  /** La cité de la maison n'a pas de port (6.1) : aucun navire n'y naît, rien n'est payé. */
  'NO_PORT',
  'INSUFFICIENT_FUNDS',
  /** Le prix en vigueur n'est pas celui que le client a envoyé : rien n'est payé, réessayer au nouveau prix. */
  'PRICE_CHANGED',
] as const;
export type ShipAcquireErrorCode = (typeof SHIP_ACQUIRE_ERROR_CODES)[number];

export const shipAcquiredSchema = z.strictObject({
  type: z.literal('ShipAcquired'),
  payload: z.strictObject({
    shipId: z.uuid(),
    houseId: z.uuid(),
    /** Cité où le navire est à quai à sa naissance. */
    cityId: z.uuid(),
    classId: z.string(),
    costOboles: z.number().int().positive(),
  }),
});
