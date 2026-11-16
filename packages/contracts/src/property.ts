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

const stack = z.strictObject({
  goodId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  quantity: z.number().int().positive(),
});

/**
 * Commande `property.renovate` (4.5) : la maison rend neuf un bien qu'elle possède. Le coût en oboles est
 * détruit, les biens sont consommés dans son stock libre de la cité du bien.
 */
export const propertyRenovateInputSchema = z.strictObject({
  propertyId: z.uuid(),
  /**
   * Coût que le joueur a vu, en oboles et en biens (dans un ordre quelconque, chaque bien une fois) : un
   * autre coût en vigueur est refusé (`PRICE_CHANGED`), rien n'est payé ni consommé.
   */
  expectedCostOboles: z.number().int().positive(),
  expectedGoods: z
    .array(stack)
    .max(20)
    .refine((goods) => new Set(goods.map((entry) => entry.goodId)).size === goods.length, {
      message: 'each good is listed once',
    }),
});
export type PropertyRenovateInput = z.infer<typeof propertyRenovateInputSchema>;

export const propertyRenovateOutputSchema = z.object({
  propertyId: z.uuid(),
  costOboles: z.number().int().positive(),
  /** Biens consommés, dans l'ordre des identifiants. */
  goods: z.array(stack),
  /** État du bien après la rénovation : neuf. */
  condition: z.number().int(),
});
export type PropertyRenovateOutput = z.infer<typeof propertyRenovateOutputSchema>;

export const PROPERTY_RENOVATE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'PROPERTY_NOT_FOUND',
  /** Le bien est à la cité ou à une autre maison. */
  'PROPERTY_NOT_OWNED',
  /** Taille absente de la configuration en vigueur : plus de tarif de rénovation, rien n'est fait. */
  'PROPERTY_SIZE_RETIRED',
  /** Le bien est déjà neuf : rien à payer. */
  'NOTHING_TO_RENOVATE',
  'INSUFFICIENT_FUNDS',
  /** Le stock libre de la maison dans la cité du bien ne couvre pas les biens de la rénovation. */
  'INSUFFICIENT_STOCK',
  /** Le coût en vigueur n'est pas celui que le client a envoyé : rien n'est payé ni consommé. */
  'PRICE_CHANGED',
] as const;
export type PropertyRenovateErrorCode = (typeof PROPERTY_RENOVATE_ERROR_CODES)[number];

export const propertyRenovatedSchema = z.strictObject({
  type: z.literal('PropertyRenovated'),
  payload: z.strictObject({
    propertyId: z.uuid(),
    houseId: z.uuid(),
    cityId: z.uuid(),
    sizeId: z.string(),
    costOboles: z.number().int().positive(),
    goods: z.array(stack),
    /** État avant la rénovation, de 0 à 10 000. */
    conditionBefore: z.number().int().min(0).max(10_000),
  }),
});
