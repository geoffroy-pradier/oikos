import {
  CHAT_REPORT_ERROR_CODES,
  chatReportInputSchema,
  chatReportOutputSchema,
} from '@oikos/contracts';
import { defineCommand } from '../registry';
import { accountHasHouse } from './chat-open-direct';
import { refuse } from './city-election';

/**
 * Signalement (docs/specs/18-indicateurs-risques-conformite.md, contenus ; #275) : une maison signale un message
 * d'une autre maison, dans un canal qu'elle lit, sous un motif de la configuration. Un signalement par maison et
 * par message (contrainte unique de la base, qui départage aussi deux signalements simultanés).
 */

const MESSAGE_NOT_FOUND = { code: 'MESSAGE_NOT_FOUND', message: 'No message this house reads.' };

export const chatReport = defineCommand({
  name: 'chat.report',
  input: chatReportInputSchema,
  output: chatReportOutputSchema,
  errors: CHAT_REPORT_ERROR_CODES,
  // La garde de la base refait les contrôles : sous concurrence, son refus revient sous le même code.
  errorByConstraint: {
    reports_message_exists: MESSAGE_NOT_FOUND,
    // Message purgé entre la garde et la vérification de la clé étrangère.
    reports_message_id_fkey: MESSAGE_NOT_FOUND,
    reports_reader: MESSAGE_NOT_FOUND,
    reports_message_visible: { code: 'MESSAGE_HIDDEN', message: 'The message is hidden.' },
    reports_not_own: { code: 'OWN_MESSAGE', message: 'A house does not report itself.' },
    reports_one_per_house: { code: 'ALREADY_REPORTED', message: 'Already reported.' },
  },
  async handler({ trx, userId, emit, config }, input) {
    if (!config.moderation.reportReasons.includes(input.reason))
      return refuse('REASON_NOT_FOUND', 'No such report reason.');
    // Le message et la maison du compte dans son monde, si elle lit son canal : celui de sa cité, ou une
    // conversation dont elle est membre.
    const target = await trx
      .selectFrom('game.messages as msg')
      .innerJoin('game.channels as c', 'c.id', 'msg.channel_id')
      .innerJoin('game.houses as h', (join) =>
        join.onRef('h.world_id', '=', 'c.world_id').on('h.user_id', '=', userId),
      )
      .innerJoin('game.citizenships as z', 'z.house_id', 'h.id')
      .select(['msg.id as messageId', 'msg.house_id as authorId', 'msg.hidden_at as hiddenAt'])
      .select('h.id as houseId')
      .where('msg.id', '=', input.messageId)
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
        ? { ok: false, error: MESSAGE_NOT_FOUND }
        : refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    if (target.authorId === target.houseId)
      return refuse('OWN_MESSAGE', 'A house does not report itself.');
    if (target.hiddenAt) return refuse('MESSAGE_HIDDEN', 'The message is hidden.');
    // Deux signalements simultanés du même message par la même maison : le second attend le premier, n'écrit
    // rien, et rend `ALREADY_REPORTED`.
    const report = await trx
      .insertInto('game.reports')
      .values({
        message_id: target.messageId,
        reported_house_id: target.authorId,
        house_id: target.houseId,
        reason: input.reason,
      })
      .onConflict((conflict) => conflict.columns(['message_id', 'house_id']).doNothing())
      .returning(['id', 'created_at'])
      .executeTakeFirst();
    if (!report) return refuse('ALREADY_REPORTED', 'Already reported.');
    emit({
      type: 'MessageReported',
      payload: {
        reportId: report.id,
        messageId: target.messageId,
        houseId: target.houseId,
        reason: input.reason,
      },
    });
    return {
      ok: true,
      data: {
        reportId: report.id,
        messageId: target.messageId,
        reportedAt: report.created_at.toISOString(),
      },
    };
  },
});
