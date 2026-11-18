import {
  ADMIN_CONFIRM_EXCLUSION_ERROR_CODES,
  ADMIN_HIDE_MESSAGE_ERROR_CODES,
  ADMIN_SANCTION_ERROR_CODES,
  adminConfirmExclusionInputSchema,
  adminConfirmExclusionOutputSchema,
  adminHideMessageInputSchema,
  adminHideMessageOutputSchema,
  adminSanctionInputSchema,
  adminSanctionOutputSchema,
  MODERATION_ROLES,
} from '@oikos/contracts';
import { sql } from 'kysely';
import { defineCommand } from '../registry';
import { refuse } from './city-election';

/**
 * Commandes d'administration de la modération (docs/specs/15-back-office-olympe.md, 15.1, 15.4 ; #276). La base
 * tient les mêmes règles que ces commandes (migration 260) : elle date chaque changement, n'en admet qu'un, et
 * refuse qu'une exclusion soit validée par son auteur ou par le compte exclu.
 */

const HOUR_MS = 3_600_000;
const SELF_SANCTION = { code: 'SELF_SANCTION', message: 'An account does not sanction itself.' };
export const SECOND_PERSON_REQUIRED = {
  code: 'SECOND_PERSON_REQUIRED',
  message: 'Another account than the author and the sanctioned account must do this.',
};

/**
 * Prononce une sanction, à partir de maintenant. Une exclusion n'est que proposée : elle n'agit, et n'est annoncée
 * au compte, qu'une fois validée par un autre compte (`admin.confirmExclusion`).
 */
export const adminSanction = defineCommand({
  name: 'admin.sanction',
  admin: MODERATION_ROLES,
  input: adminSanctionInputSchema,
  output: adminSanctionOutputSchema,
  errors: ADMIN_SANCTION_ERROR_CODES,
  errorByConstraint: {
    sanctions_user_id_fkey: { code: 'ACCOUNT_NOT_FOUND', message: 'Unknown account.' },
    sanctions_not_self: SELF_SANCTION,
  },
  async handler({ trx, userId, emit, config, now }, input) {
    if (input.userId === userId) return { ok: false, error: SELF_SANCTION };
    let endsAt: Date | null = null;
    if (input.kind !== 'ban') {
      if (!config.moderation.sanctionHours[input.kind].includes(input.hours))
        return refuse('DURATION_NOT_OFFERED', 'This duration is not offered for this sanction.');
      // Le début est l'instant de la base, le même que `now` dans la transaction de la commande.
      endsAt = new Date(now.getTime() + input.hours * HOUR_MS);
    }
    const sanction = await trx
      .insertInto('admin.sanctions')
      .values({
        user_id: input.userId,
        kind: input.kind,
        ends_at: endsAt,
        reason: input.reason,
        author_id: userId,
      })
      .returning(['id', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const pending = input.kind === 'ban';
    emit({
      type: 'SanctionPronounced',
      payload: { sanctionId: sanction.id, userId: input.userId, kind: input.kind, pending },
    });
    return {
      ok: true,
      data: {
        sanctionId: sanction.id,
        kind: input.kind,
        startsAt: sanction.starts_at.toISOString(),
        endsAt: sanction.ends_at?.toISOString() ?? null,
        pending,
      },
    };
  },
});

/** Valide une exclusion proposée (double validation, 15.4) : elle commence à cet instant. */
export const adminConfirmExclusion = defineCommand({
  name: 'admin.confirmExclusion',
  admin: MODERATION_ROLES,
  input: adminConfirmExclusionInputSchema,
  output: adminConfirmExclusionOutputSchema,
  errors: ADMIN_CONFIRM_EXCLUSION_ERROR_CODES,
  errorByConstraint: { sanctions_validated_by_other: SECOND_PERSON_REQUIRED },
  async handler({ trx, userId, emit }, input) {
    // Verrou de la ligne : de deux validations simultanées, la seconde voit la première.
    const ban = await trx
      .selectFrom('admin.sanctions')
      .select(['id', 'user_id', 'author_id', 'validated_by'])
      .where('id', '=', input.sanctionId)
      .where('kind', '=', 'ban')
      .forUpdate()
      .executeTakeFirst();
    if (!ban) return refuse('SANCTION_NOT_FOUND', 'No such exclusion.');
    if (ban.validated_by)
      return refuse('ALREADY_CONFIRMED', 'This exclusion is already confirmed.');
    if (ban.author_id === userId || ban.user_id === userId)
      return { ok: false, error: SECOND_PERSON_REQUIRED };
    const confirmed = await trx
      .updateTable('admin.sanctions')
      .set({ validated_by: userId })
      .where('id', '=', ban.id)
      .returning('starts_at')
      .executeTakeFirstOrThrow();
    emit({ type: 'ExclusionConfirmed', payload: { sanctionId: ban.id, userId: ban.user_id } });
    return {
      ok: true,
      data: { sanctionId: ban.id, startsAt: confirmed.starts_at.toISOString() },
    };
  },
});

/** Masque un message : il reste listé, dit masqué, sans son texte pour les joueurs (6.6). */
export const adminHideMessage = defineCommand({
  name: 'admin.hideMessage',
  admin: MODERATION_ROLES,
  input: adminHideMessageInputSchema,
  output: adminHideMessageOutputSchema,
  errors: ADMIN_HIDE_MESSAGE_ERROR_CODES,
  async handler({ trx, emit }, input) {
    // Verrou de la ligne : de deux masquages simultanés, le second voit le premier.
    const message = await trx
      .selectFrom('game.messages')
      .select(['id', 'hidden_at'])
      .where('id', '=', input.messageId)
      .forUpdate()
      .executeTakeFirst();
    if (!message) return refuse('MESSAGE_NOT_FOUND', 'No such message.');
    if (message.hidden_at) return refuse('MESSAGE_HIDDEN', 'The message is already hidden.');
    const hidden = await trx
      .updateTable('game.messages')
      .set({ hidden_at: sql<Date>`now()` })
      .where('id', '=', message.id)
      .returning('hidden_at')
      .executeTakeFirstOrThrow();
    if (!hidden.hidden_at) throw new Error('The database did not hide the message');
    emit({ type: 'MessageHidden', payload: { messageId: message.id } });
    return {
      ok: true,
      data: { messageId: message.id, hiddenAt: hidden.hidden_at.toISOString() },
    };
  },
});
