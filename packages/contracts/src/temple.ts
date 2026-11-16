import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const stack = z.strictObject({ goodId: id, quantity: z.number().int().positive().max(1_000_000) });
const charis = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * Commande `temple.makeOffering` (docs/specs/07-dieux-faveur-evenements.md, 7.1) : la maison offre à un dieu
 * des oboles, détruites, et des biens de son stock libre dans sa cité, consommés ; elle gagne la Charis de
 * l'offrande au taux du dieu. Rien ne s'offre à une autre maison.
 */
export const templeMakeOfferingInputSchema = z
  .strictObject({
    godId: id,
    oboles: z.number().int().min(0).max(1_000_000_000),
    /** Biens offerts, dans un ordre quelconque, chaque bien une fois. */
    goods: z
      .array(stack)
      .max(20)
      .refine((goods) => new Set(goods.map((entry) => entry.goodId)).size === goods.length, {
        message: 'each good is listed once',
      }),
    /**
     * Charis que le joueur a vue (`temple_rules`) : un autre taux en vigueur est refusé (`CHARIS_CHANGED`),
     * rien n'est offert.
     */
    expectedCharis: charis,
  })
  .refine((input) => input.oboles > 0 || input.goods.length > 0, {
    message: 'an offering gives oboles or goods',
    path: ['goods'],
  });
export type TempleMakeOfferingInput = z.infer<typeof templeMakeOfferingInputSchema>;

export const templeMakeOfferingOutputSchema = z.object({
  offeringId: z.uuid(),
  godId: z.string(),
  oboles: z.number().int().nonnegative(),
  /** Biens offerts, dans l'ordre des identifiants. */
  goods: z.array(stack),
  charisGained: charis,
  /** Charis de la maison envers ce dieu après l'offrande. */
  charis,
});
export type TempleMakeOfferingOutput = z.infer<typeof templeMakeOfferingOutputSchema>;

export const TEMPLE_MAKE_OFFERING_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Dieu absent de la configuration en vigueur. */
  'GOD_NOT_FOUND',
  /** Le dieu n'accepte pas l'un des dons : la monnaie, ou un bien sans taux. Rien n'est offert. */
  'OFFERING_REFUSED',
  /** La Charis en vigueur n'est pas celle que le client a envoyée : rien n'est offert. */
  'CHARIS_CHANGED',
  'INSUFFICIENT_FUNDS',
  /** Le stock libre de la maison dans sa cité, hors réservations des ventes, ne couvre pas les biens. */
  'INSUFFICIENT_STOCK',
  /** La Charis de la maison envers ce dieu dépasserait le plus grand entier sûr. */
  'CHARIS_LIMIT_REACHED',
] as const;
export type TempleMakeOfferingErrorCode = (typeof TEMPLE_MAKE_OFFERING_ERROR_CODES)[number];

export const offeringMadeSchema = z.strictObject({
  type: z.literal('OfferingMade'),
  payload: z.strictObject({
    offeringId: z.uuid(),
    houseId: z.uuid(),
    cityId: z.uuid(),
    godId: z.string(),
    oboles: z.number().int().nonnegative(),
    goods: z.array(stack),
    charisGained: charis,
  }),
});
