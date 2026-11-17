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

const GRACE_EFFECTS = ['blessed_harvest', 'inspired_workshop', 'fair_wind'] as const;
const charisSpent = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * Commande `temple.invokeGrace` (7.1, #266) : la maison invoque une grâce de la configuration ; sa Charis envers
 * le dieu de la grâce est dépensée, et la grâce attend la prochaine action admise de son effet, qui la consomme.
 */
export const templeInvokeGraceInputSchema = z.strictObject({
  graceId: id,
  /** Charis dépensée que le joueur a vue (`temple_rules`) : une autre en vigueur est refusée (`CHARIS_CHANGED`). */
  expectedCharisSpent: charisSpent,
});
export type TempleInvokeGraceInput = z.infer<typeof templeInvokeGraceInputSchema>;

const invocation = {
  graceUseId: z.uuid(),
  graceId: z.string(),
  godId: z.string(),
  effect: z.enum(GRACE_EFFECTS),
  magnitudeBps: z.number().int().positive(),
  charisSpent,
  /** Fin de la recharge (ISO 8601) : la clôture qui ouvre le jour de jeu de l'invocation plus la recharge. */
  readyAt: z.iso.datetime(),
};
export const templeInvokeGraceOutputSchema = z.object({
  ...invocation,
  /** Charis de la maison envers ce dieu après l'invocation. */
  charis: charisSpent,
});
export type TempleInvokeGraceOutput = z.infer<typeof templeInvokeGraceOutputSchema>;

export const TEMPLE_INVOKE_GRACE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Grâce absente de la configuration en vigueur. */
  'GRACE_NOT_FOUND',
  /** La Charis dépensée en vigueur n'est pas celle que le client a envoyée : rien n'est dépensé. */
  'CHARIS_CHANGED',
  /** La Charis de la maison envers le dieu est sous la Charis requise. */
  'INSUFFICIENT_CHARIS',
  /** Une invocation de cette grâce attend encore l'action qui la consommera. */
  'GRACE_PENDING',
  /** La grâce se recharge : elle se réinvoque à la clôture que le message nomme. */
  'GRACE_RECHARGING',
] as const;
export type TempleInvokeGraceErrorCode = (typeof TEMPLE_INVOKE_GRACE_ERROR_CODES)[number];

export const graceInvokedSchema = z.strictObject({
  type: z.literal('GraceInvoked'),
  payload: z.strictObject({ ...invocation, houseId: z.uuid() }),
});
