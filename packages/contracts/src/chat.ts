import { z } from 'zod';

/**
 * Discussion (docs/specs/06-cites-politique-communaute.md, 6.6 ; #273) : canal de la cité, où écrit toute maison
 * de la cité, et conversations privées entre deux maisons d'un même monde.
 */

/**
 * Commande `chat.openDirect` : la maison ouvre sa conversation privée avec une autre maison du même monde, ou
 * retrouve celle qui existe déjà (`created` faux), quel que soit qui l'a ouverte.
 */
export const chatOpenDirectInputSchema = z.strictObject({ houseId: z.uuid() });
export type ChatOpenDirectInput = z.infer<typeof chatOpenDirectInputSchema>;
export const chatOpenDirectOutputSchema = z.object({
  channelId: z.uuid(),
  /** L'autre maison de la conversation. */
  houseId: z.uuid(),
  created: z.boolean(),
});
export type ChatOpenDirectOutput = z.infer<typeof chatOpenDirectOutputSchema>;

export const CHAT_OPEN_DIRECT_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucune maison de ce monde sous cet identifiant. */
  'RECIPIENT_NOT_FOUND',
  /** Une maison ne converse pas avec elle-même. */
  'SELF_CONVERSATION',
] as const;

/** Une conversation privée est ouverte par `houseId`, avec `otherHouseId`. */
export const directChannelOpenedSchema = z.strictObject({
  type: z.literal('DirectChannelOpened'),
  payload: z.strictObject({ channelId: z.uuid(), houseId: z.uuid(), otherHouseId: z.uuid() }),
});
