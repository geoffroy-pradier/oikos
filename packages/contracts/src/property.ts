import { z } from 'zod';

/**
 * Commande `property.buy` (docs/specs/04-systemes-gestion.md, 4.5) : la maison achète à la cité un bien
 * qu'elle détient encore, dans n'importe quelle cité de son monde. Le prix est détruit.
 */
export const propertyBuyInputSchema = z.strictObject({
  propertyId: z.uuid(),
  /** Prix que le joueur a vu, en oboles : un autre tarif en vigueur est refusé (`PRICE_CHANGED`), pas prélevé. */
  expectedPriceOboles: z.number().int().positive(),
});
export type PropertyBuyInput = z.infer<typeof propertyBuyInputSchema>;

export const propertyBuyOutputSchema = z.object({
  propertyId: z.uuid(),
  cityId: z.uuid(),
  sizeId: z.string(),
  /** Numéro du bien dans le parc de sa cité et de sa taille. */
  lot: z.number().int().positive(),
  /** Prix payé, en oboles (détruit). */
  priceOboles: z.number().int().positive(),
});
export type PropertyBuyOutput = z.infer<typeof propertyBuyOutputSchema>;

export const PROPERTY_BUY_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Bien inconnu, ou d'un autre monde que celui de la maison. */
  'PROPERTY_NOT_FOUND',
  /** Taille absente de la configuration en vigueur : la cité ne vend pas ce bien, rien n'est payé. */
  'PROPERTY_SIZE_RETIRED',
  /** Le bien n'est plus à la cité : une maison l'a acheté, celle-ci comprise. */
  'PROPERTY_NOT_FOR_SALE',
  'INSUFFICIENT_FUNDS',
  /** Le prix en vigueur n'est pas celui que le client a envoyé : rien n'est payé, réessayer au nouveau prix. */
  'PRICE_CHANGED',
] as const;
export type PropertyBuyErrorCode = (typeof PROPERTY_BUY_ERROR_CODES)[number];

export const propertyBoughtSchema = z.strictObject({
  type: z.literal('PropertyBought'),
  payload: z.strictObject({
    propertyId: z.uuid(),
    houseId: z.uuid(),
    cityId: z.uuid(),
    sizeId: z.string(),
    priceOboles: z.number().int().positive(),
  }),
});
