import { CHAT_POST_ERROR_CODES, chatPostInputSchema, chatPostOutputSchema } from '@oikos/contracts';
import { defineCommand } from '../registry';
import { accountHasHouse } from './chat-open-direct';
import { refuse } from './city-election';

/**
 * Message (docs/specs/06-cites-politique-communaute.md, 6.6) : une maison écrit dans le canal de sa cité,
 * métèque ou citoyenne, et dans ses conversations privées, nulle part ailleurs. La base le vérifie aussi
 * (garde des messages) : son refus revient sous le même code.
 */

const CHANNEL_NOT_FOUND = {
  code: 'CHANNEL_NOT_FOUND',
  message: 'No channel this house writes in.',
};
const INVALID_BODY = { code: 'VALIDATION_FAILED', message: 'Invalid input.', fields: ['body'] };

export const chatPost = defineCommand({
  name: 'chat.post',
  input: chatPostInputSchema,
  output: chatPostOutputSchema,
  errors: CHAT_POST_ERROR_CODES,
  // Le texte ne vit que dans `game.messages`, que le moteur purge : le journal des commandes n'en garde que
  // la taille et l'empreinte.
  redactInput: true,
  errorByConstraint: {
    messages_author_member: CHANNEL_NOT_FOUND,
    // Le schéma d'entrée refuse avant la base tout texte qu'elle refuserait ; filet si leurs classes de
    // caractères blancs divergent.
    messages_body_length: INVALID_BODY,
    messages_body_not_blank: INVALID_BODY,
  },
  async handler({ trx, userId, emit, config }, input) {
    // Le canal et la maison du compte dans le monde du canal (un compte peut avoir une maison par monde), s'il
    // peut y écrire : canal de la cité de cette maison, ou conversation dont elle est membre.
    const target = await trx
      .selectFrom('game.channels as c')
      .innerJoin('game.houses as h', (join) =>
        join.onRef('h.world_id', '=', 'c.world_id').on('h.user_id', '=', userId),
      )
      .innerJoin('game.citizenships as z', 'z.house_id', 'h.id')
      .select(['c.id as channelId', 'h.id as houseId'])
      .where('c.id', '=', input.channelId)
      .where((eb) =>
        eb.or([
          eb('c.city_id', '=', eb.ref('z.city_id')),
          eb.exists(
            eb
              .selectFrom('game.channel_members as m')
              .select('m.channel_id')
              .whereRef('m.channel_id', '=', 'c.id')
              .whereRef('m.house_id', '=', 'h.id'),
          ),
        ]),
      )
      .executeTakeFirst();
    if (!target)
      return (await accountHasHouse(trx, userId))
        ? { ok: false, error: CHANNEL_NOT_FOUND }
        : refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const channel = { id: target.channelId };
    const house = { id: target.houseId };
    const { maxMessageLength } = config.chat;
    if ([...input.body].length > maxMessageLength)
      return refuse('MESSAGE_TOO_LONG', `At most ${maxMessageLength} characters.`);
    const message = await trx
      .insertInto('game.messages')
      .values({ channel_id: channel.id, house_id: house.id, body: input.body })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow();
    emit({
      type: 'MessagePosted',
      payload: { messageId: message.id, channelId: channel.id, houseId: house.id },
    });
    return {
      ok: true,
      data: {
        messageId: message.id,
        channelId: channel.id,
        postedAt: message.created_at.toISOString(),
      },
    };
  },
});
