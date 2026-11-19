import {
  CHAT_OPEN_DIRECT_ERROR_CODES,
  chatOpenDirectInputSchema,
  chatOpenDirectOutputSchema,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { defineCommand } from '../registry';
import { refuse } from './city-election';
import { accountHouseId } from '@oikos/operations';

/**
 * Conversation privée (docs/specs/06-cites-politique-communaute.md, 6.6) : une maison l'ouvre avec une autre
 * maison de son monde, de sa cité ou d'une autre, ou retrouve celle qui existe. La base inscrit les deux
 * membres, et n'admet qu'une conversation par paire (contrainte unique) : sous concurrence, la seconde
 * ouverture relit la première.
 */

/** Vrai si le compte a sa maison, dans quelque monde que ce soit : départage `HOUSE_NOT_FOUND` d'un autre refus. */
export const accountHasHouse = async (trx: Db, userId: string) =>
  !!(await trx
    .selectFrom('game.houses')
    .select('id')
    .where('user_id', '=', userId)
    .limit(1)
    .executeTakeFirst());

export const chatOpenDirect = defineCommand({
  name: 'chat.openDirect',
  input: chatOpenDirectInputSchema,
  output: chatOpenDirectOutputSchema,
  errors: CHAT_OPEN_DIRECT_ERROR_CODES,
  async handler({ trx, userId, emit }, input) {
    // La maison du compte (la plus ancienne d'un compte hérité, #604), si elle est du monde de la maison désignée.
    const other = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('id', '=', input.houseId)
      .executeTakeFirst();
    const house =
      other &&
      (await trx
        .selectFrom('game.houses')
        .select(['id', 'world_id'])
        .where('id', '=', accountHouseId(userId))
        .where('world_id', '=', other.world_id)
        .executeTakeFirst());
    if (!other || !house)
      return (await accountHasHouse(trx, userId))
        ? refuse('RECIPIENT_NOT_FOUND', 'No such house in this world.')
        : refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    if (other.id === house.id)
      return refuse('SELF_CONVERSATION', 'A house does not talk to itself.');
    // Identifiants lus en base, en minuscules : leur ordre de texte est celui des UUID dans Postgres.
    const [low, high] = house.id < other.id ? [house.id, other.id] : [other.id, house.id];
    // Deux ouvertures simultanées de la même paire, dans un sens ou dans l'autre : la seconde attend la
    // première, ne crée rien, et relit la conversation qu'elle a validée.
    const opened = await trx
      .insertInto('game.channels')
      .values({ world_id: house.world_id, house_low: low, house_high: high })
      .onConflict((conflict) => conflict.columns(['house_low', 'house_high']).doNothing())
      .returning('id')
      .executeTakeFirst();
    const channel =
      opened ??
      (await trx
        .selectFrom('game.channels')
        .select('id')
        .where('house_low', '=', low)
        .where('house_high', '=', high)
        .executeTakeFirstOrThrow());
    if (opened)
      emit({
        type: 'DirectChannelOpened',
        payload: { channelId: opened.id, houseId: house.id, otherHouseId: other.id },
      });
    return { ok: true, data: { channelId: channel.id, houseId: other.id, created: !!opened } };
  },
});
