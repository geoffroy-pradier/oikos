import {
  MODERATION_APPEAL_ERROR_CODES,
  moderationAppealInputSchema,
  moderationAppealOutputSchema,
} from '@oikos/contracts';
import { defineCommand } from '../registry';
import { refuse } from './city-election';

/**
 * Appel d'une sanction (docs/specs/18-indicateurs-risques-conformite.md, contenus ; #275) : le compte conteste
 * l'une de ses sanctions en vigueur, une fois, par un texte borné. Ouvert même à un compte suspendu ou exclu.
 * La base date l'appel et n'en admet qu'un ; la décision vient avec les commandes d'administration (#276).
 */

const SANCTION_ENDED = { code: 'SANCTION_ENDED', message: 'The sanction has ended.' };

export const moderationAppeal = defineCommand({
  name: 'moderation.appeal',
  input: moderationAppealInputSchema,
  output: moderationAppealOutputSchema,
  errors: MODERATION_APPEAL_ERROR_CODES,
  moderation: 'exempt',
  // Le texte se garde avec la sanction : le journal n'en garde que la taille et l'empreinte.
  redactInput: true,
  errorByConstraint: { sanctions_appeal_in_force: SANCTION_ENDED },
  async handler({ trx, userId, emit, config, now }, input) {
    // Verrou de la ligne : deux appels simultanés de la même sanction s'ordonnent, le second voit le premier.
    const sanction = await trx
      .selectFrom('admin.sanctions')
      .select(['id', 'ends_at', 'appealed_at'])
      .where('id', '=', input.sanctionId)
      .where('user_id', '=', userId)
      // Une exclusion pas encore validée n'est pas annoncée au compte : elle n'existe pas pour lui.
      .where((eb) => eb.or([eb('kind', '<>', 'ban'), eb('validated_by', 'is not', null)]))
      .forUpdate()
      .executeTakeFirst();
    if (!sanction) return refuse('SANCTION_NOT_FOUND', 'No such sanction for this account.');
    if (sanction.ends_at && sanction.ends_at <= now) return { ok: false, error: SANCTION_ENDED };
    if (sanction.appealed_at) return refuse('ALREADY_APPEALED', 'One appeal per sanction.');
    const { maxAppealLength } = config.moderation;
    if ([...input.body].length > maxAppealLength)
      return refuse('APPEAL_TOO_LONG', `At most ${maxAppealLength} characters.`);
    const appealed = await trx
      .updateTable('admin.sanctions')
      .set({ appeal_body: input.body })
      .where('id', '=', sanction.id)
      .returning('appealed_at')
      .executeTakeFirstOrThrow();
    if (!appealed.appealed_at) throw new Error('The database did not date the appeal');
    emit({ type: 'SanctionAppealed', payload: { sanctionId: sanction.id } });
    return {
      ok: true,
      data: { sanctionId: sanction.id, appealedAt: appealed.appealed_at.toISOString() },
    };
  },
});
