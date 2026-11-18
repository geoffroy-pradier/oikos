import { z } from 'zod';

/**
 * Discussion (docs/specs/06-cites-politique-communaute.md, 6.6 ; #273) : canal de la cité, où écrit toute maison
 * de la cité, et conversations privées entre deux maisons d'un même monde.
 */

/**
 * Plafond technique d'un message, en caractères (points de code Unicode) : celui de la base
 * (`messages_body_length`). La longueur admise en jeu, `chat.maxMessageLength` (packages/config), ne le
 * dépasse jamais ; la commande la vérifie (`MESSAGE_TOO_LONG`).
 */
export const MESSAGE_BODY_MAX_CHARS = 2_000;

/** Caractères de contrôle refusés : tous, sauf la tabulation et le saut de ligne. */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

/** Texte d'un message : débarrassé des blancs de début et de fin, non vide, sans caractère de contrôle. */
export const messageBodySchema = z
  .string()
  .trim()
  .min(1)
  .refine((text) => [...text].length <= MESSAGE_BODY_MAX_CHARS, {
    message: `at most ${MESSAGE_BODY_MAX_CHARS} characters`,
  })
  .refine((text) => !CONTROL_CHARACTERS.test(text), { message: 'control characters' });

/** Commande `chat.post` : la maison écrit dans le canal de sa cité ou dans l'une de ses conversations. */
export const chatPostInputSchema = z.strictObject({
  channelId: z.uuid(),
  body: messageBodySchema,
});
export type ChatPostInput = z.infer<typeof chatPostInputSchema>;
export const chatPostOutputSchema = z.object({
  messageId: z.uuid(),
  channelId: z.uuid(),
  postedAt: z.iso.datetime(),
});
export type ChatPostOutput = z.infer<typeof chatPostOutputSchema>;

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

export const CHAT_POST_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /**
   * Aucun canal où la maison peut écrire sous cet identifiant : inconnu, canal d'une autre cité, conversation
   * d'autres maisons. Un seul code, pour ne pas dire si la conversation d'autres maisons existe.
   */
  'CHANNEL_NOT_FOUND',
  /** Plus long que `chat.maxMessageLength` caractères. */
  'MESSAGE_TOO_LONG',
  /** La maison a déjà écrit `chat.rateLimit.messages` messages dans la fenêtre `chat.rateLimit.windowSeconds`. */
  'TOO_MANY_MESSAGES',
  /** Le compte est réduit au silence (#275) : il lit, signale et fait appel, mais n'écrit plus. */
  'SILENCED',
  /** Le texte contient un terme interdit (`moderation.bannedTerms`) : rien n'est enregistré. */
  'MESSAGE_REJECTED',
] as const;
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
/** Un message est écrit. L'événement ne porte jamais le texte : il dure plus que la conservation des messages. */
export const messagePostedSchema = z.strictObject({
  type: z.literal('MessagePosted'),
  payload: z.strictObject({ messageId: z.uuid(), channelId: z.uuid(), houseId: z.uuid() }),
});
