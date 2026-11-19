import {
  ADMIN_CONFIRM_EXCLUSION_ERROR_CODES,
  ADMIN_DECIDE_APPEAL_ERROR_CODES,
  ADMIN_HIDE_MESSAGE_ERROR_CODES,
  ADMIN_LIFT_SANCTION_ERROR_CODES,
  ADMIN_RESOLVE_REPORT_ERROR_CODES,
  ADMIN_SANCTION_ERROR_CODES,
  ADMIN_WITHDRAW_EXCLUSION_ERROR_CODES,
  adminConfirmExclusionInputSchema,
  adminConfirmExclusionOutputSchema,
  adminDecideAppealInputSchema,
  adminDecideAppealOutputSchema,
  adminHideMessageInputSchema,
  adminHideMessageOutputSchema,
  adminLiftSanctionInputSchema,
  adminLiftSanctionOutputSchema,
  adminResolveReportInputSchema,
  adminResolveReportOutputSchema,
  adminSanctionInputSchema,
  adminSanctionOutputSchema,
  adminWithdrawExclusionInputSchema,
  adminWithdrawExclusionOutputSchema,
  MODERATION_ROLES,
} from '@oikos/contracts';
import { sql } from 'kysely';
import { defineCommand } from '../registry';
import { refuse } from './city-election';
import { cancelOrdersOfExcluded } from './exclusion-orders';

/**
 * Commandes d'administration de la modération (docs/specs/15-back-office-olympe.md, 15.1, 15.4 ; #276, #531). La
 * base tient les mêmes règles que ces commandes (migrations 260 et 390) : elle date chaque changement, n'en admet
 * qu'un, refuse qu'une exclusion soit validée par son auteur ou par le compte exclu, et qu'une exclusion validée
 * soit levée sans appel par une seule personne.
 */

const HOUR_MS = 3_600_000;
const SELF_SANCTION = { code: 'SELF_SANCTION', message: 'An account does not sanction itself.' };
export const SECOND_PERSON_REQUIRED = {
  code: 'SECOND_PERSON_REQUIRED',
  message: 'Another account than the author and the sanctioned account must do this.',
};
const EXCLUSION_WITHDRAWN = {
  code: 'EXCLUSION_WITHDRAWN',
  message: 'This exclusion was withdrawn.',
};
const SANCTION_ENDED = { code: 'SANCTION_ENDED', message: 'The sanction has ended.' };
const APPEAL_PENDING = {
  code: 'APPEAL_PENDING',
  message: 'An appeal is pending: decide it to lift the sanction.',
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

/**
 * Valide une exclusion proposée (double validation, 15.4) : elle commence à cet instant. Dans la même transaction,
 * les ordres ouverts de toutes les maisons du compte exclu sont annulés et leur séquestre rendu (#528).
 */
export const adminConfirmExclusion = defineCommand({
  name: 'admin.confirmExclusion',
  admin: MODERATION_ROLES,
  input: adminConfirmExclusionInputSchema,
  output: adminConfirmExclusionOutputSchema,
  errors: ADMIN_CONFIRM_EXCLUSION_ERROR_CODES,
  errorByConstraint: {
    sanctions_validated_by_other: SECOND_PERSON_REQUIRED,
    sanctions_confirm_not_withdrawn: EXCLUSION_WITHDRAWN,
  },
  async handler({ trx, userId, emit }, input) {
    // Verrou de la ligne : de deux validations simultanées, ou d'une validation et d'un retrait, la seconde voit
    // la première. Une exclusion retirée n'annule donc jamais d'ordre.
    const ban = await trx
      .selectFrom('admin.sanctions')
      .select(['id', 'user_id', 'author_id', 'validated_by', 'lifted_at'])
      .where('id', '=', input.sanctionId)
      .where('kind', '=', 'ban')
      .forUpdate()
      .executeTakeFirst();
    if (!ban) return refuse('SANCTION_NOT_FOUND', 'No such exclusion.');
    if (ban.validated_by)
      return refuse('ALREADY_CONFIRMED', 'This exclusion is already confirmed.');
    if (ban.lifted_at) return { ok: false, error: EXCLUSION_WITHDRAWN };
    if (ban.author_id === userId || ban.user_id === userId)
      return { ok: false, error: SECOND_PERSON_REQUIRED };
    const confirmed = await trx
      .updateTable('admin.sanctions')
      .set({ validated_by: userId })
      .where('id', '=', ban.id)
      .returning('starts_at')
      .executeTakeFirstOrThrow();
    await cancelOrdersOfExcluded(trx, ban.user_id, emit);
    emit({ type: 'ExclusionConfirmed', payload: { sanctionId: ban.id, userId: ban.user_id } });
    return {
      ok: true,
      data: { sanctionId: ban.id, startsAt: confirmed.starts_at.toISOString() },
    };
  },
});

/**
 * Retire une exclusion proposée et pas encore validée : elle n'a jamais agi, et quitte la file. Retirer ne demande pas
 * de seconde personne : son auteur le peut, tout autre compte de la modération aussi, sauf le compte exclu. La base
 * date le retrait, qui est une levée de l'exclusion proposée : elle prend une fin.
 */
export const adminWithdrawExclusion = defineCommand({
  name: 'admin.withdrawExclusion',
  admin: MODERATION_ROLES,
  input: adminWithdrawExclusionInputSchema,
  output: adminWithdrawExclusionOutputSchema,
  errors: ADMIN_WITHDRAW_EXCLUSION_ERROR_CODES,
  errorByConstraint: { sanctions_lift_shape: SECOND_PERSON_REQUIRED },
  async handler({ trx, userId, emit }, input) {
    // Verrou de la ligne : un retrait et une validation simultanés s'ordonnent, le second voit le premier.
    const ban = await trx
      .selectFrom('admin.sanctions')
      .select(['id', 'user_id', 'validated_by', 'lifted_at'])
      .where('id', '=', input.sanctionId)
      .where('kind', '=', 'ban')
      .forUpdate()
      .executeTakeFirst();
    if (!ban) return refuse('SANCTION_NOT_FOUND', 'No such exclusion.');
    if (ban.validated_by)
      return refuse('ALREADY_CONFIRMED', 'This exclusion is confirmed: lift it instead.');
    if (ban.lifted_at) return { ok: false, error: EXCLUSION_WITHDRAWN };
    if (ban.user_id === userId) return { ok: false, error: SECOND_PERSON_REQUIRED };
    const withdrawn = await trx
      .updateTable('admin.sanctions')
      .set({ lifted_by: userId })
      .where('id', '=', ban.id)
      .returning('lifted_at')
      .executeTakeFirstOrThrow();
    if (!withdrawn.lifted_at) throw new Error('The database did not date the withdrawal');
    emit({ type: 'ExclusionWithdrawn', payload: { sanctionId: ban.id, userId: ban.user_id } });
    return {
      ok: true,
      data: { sanctionId: ban.id, withdrawnAt: withdrawn.lifted_at.toISOString() },
    };
  },
});

/**
 * Lève sans appel une sanction en vigueur : elle finit à cet instant. Tout compte de la modération le peut, sauf le
 * compte sanctionné. Une exclusion validée demande deux personnes (15.4) : la première commande en propose la levée,
 * une autre personne la lève par la même commande. Ce que la validation a annulé (ordres, séquestre rendu : #528)
 * le reste : lever l'exclusion ne rouvre aucun ordre. Une sanction dont l'appel attend se lève en l'accueillant.
 */
export const adminLiftSanction = defineCommand({
  name: 'admin.liftSanction',
  admin: MODERATION_ROLES,
  input: adminLiftSanctionInputSchema,
  output: adminLiftSanctionOutputSchema,
  errors: ADMIN_LIFT_SANCTION_ERROR_CODES,
  errorByConstraint: {
    sanctions_lift_shape: SECOND_PERSON_REQUIRED,
    sanctions_lift_proposal_shape: SECOND_PERSON_REQUIRED,
    sanctions_lift_confirmed_by_other: SECOND_PERSON_REQUIRED,
    sanctions_lift_not_ended: SANCTION_ENDED,
    sanctions_lift_appeal_pending: APPEAL_PENDING,
  },
  async handler({ trx, userId, emit, now }, input) {
    // Verrou de la ligne : de deux levées, ou d'une proposition et d'une levée, simultanées, la seconde voit la
    // première ; de deux propositions de deux personnes, la seconde lève donc l'exclusion.
    const sanction = await trx
      .selectFrom('admin.sanctions')
      .select([
        'id',
        'user_id',
        'kind',
        'ends_at',
        'lifted_at',
        'validated_by',
        'appeal_body',
        'appeal_decision',
        'lift_proposed_by',
      ])
      .where('id', '=', input.sanctionId)
      .forUpdate()
      .executeTakeFirst();
    if (!sanction) return refuse('SANCTION_NOT_FOUND', 'No such sanction.');
    // Même instant que celui de la base, qui refuserait de lever une sanction finie ; une sanction levée l'est,
    // même si sa levée est datée après cet instant (#616).
    if (sanction.lifted_at || (sanction.ends_at && sanction.ends_at <= now))
      return { ok: false, error: SANCTION_ENDED };
    const ban = sanction.kind === 'ban';
    if (ban && !sanction.validated_by)
      return refuse('NOT_CONFIRMED', 'This exclusion is not confirmed: withdraw it instead.');
    if (sanction.user_id === userId) return { ok: false, error: SECOND_PERSON_REQUIRED };
    if (sanction.appeal_body !== null && sanction.appeal_decision === null)
      return { ok: false, error: APPEAL_PENDING };
    const target = { sanctionId: sanction.id, userId: sanction.user_id };
    if (ban && !sanction.lift_proposed_by) {
      await trx
        .updateTable('admin.sanctions')
        .set({ lift_proposed_by: userId })
        .where('id', '=', sanction.id)
        .execute();
      emit({ type: 'SanctionLiftProposed', payload: target });
      return { ok: true, data: { sanctionId: sanction.id, pending: true, liftedAt: null } };
    }
    if (ban && sanction.lift_proposed_by === userId)
      return { ok: false, error: SECOND_PERSON_REQUIRED };
    const lifted = await trx
      .updateTable('admin.sanctions')
      .set({ lifted_by: userId })
      .where('id', '=', sanction.id)
      .returning('lifted_at')
      .executeTakeFirstOrThrow();
    if (!lifted.lifted_at) throw new Error('The database did not date the lift');
    emit({ type: 'SanctionLifted', payload: { ...target, kind: sanction.kind } });
    return {
      ok: true,
      data: { sanctionId: sanction.id, pending: false, liftedAt: lifted.lifted_at.toISOString() },
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

/**
 * Traite un signalement : il est écarté ou retenu, avec les autres signalements encore ouverts du même message (une
 * entrée de la file). Ni le compte de la maison signalée ni un compte qui a signalé ce message ne le traitent.
 */
export const adminResolveReport = defineCommand({
  name: 'admin.resolveReport',
  admin: MODERATION_ROLES,
  input: adminResolveReportInputSchema,
  output: adminResolveReportOutputSchema,
  errors: ADMIN_RESOLVE_REPORT_ERROR_CODES,
  errorByConstraint: { reports_resolved_by_other: SECOND_PERSON_REQUIRED },
  async handler({ trx, userId, emit }, input) {
    const target = await trx
      .selectFrom('game.reports as r')
      .innerJoin('game.houses as h', 'h.id', 'r.reported_house_id')
      .select(['r.id', 'r.message_id', 'h.user_id as reportedUserId'])
      .where('r.id', '=', input.reportId)
      .executeTakeFirst();
    if (!target) return refuse('REPORT_NOT_FOUND', 'No such report.');
    // Verrous des signalements du message, dans l'ordre des identifiants : deux traitements simultanés du même
    // message, par l'un ou l'autre de ses signalements, s'ordonnent sans s'interbloquer ; le second voit le premier.
    const reports = await trx
      .selectFrom('game.reports')
      .select(['id', 'state', 'created_at', 'house_id'])
      // Le signalement désigné en est toujours, même si la purge a emporté son message entre-temps.
      .where((eb) =>
        eb.or([
          eb('id', '=', target.id),
          ...(target.message_id ? [eb('message_id', '=', target.message_id)] : []),
        ]),
      )
      .orderBy('id')
      .forUpdate()
      .execute();
    if (reports.find(({ id }) => id === target.id)?.state !== 'open')
      return refuse('ALREADY_RESOLVED', 'This report is already resolved.');
    const open = reports.filter(({ state }) => state === 'open');
    const ownCase = await trx
      .selectFrom('game.houses')
      .select('id')
      .where(
        'id',
        'in',
        open.map(({ house_id }) => house_id),
      )
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (target.reportedUserId === userId || ownCase)
      return { ok: false, error: SECOND_PERSON_REQUIRED };
    await trx
      .updateTable('game.reports')
      .set({ state: input.decision, resolved_by: userId })
      .where(
        'id',
        'in',
        open.map(({ id }) => id),
      )
      .execute();
    const reportIds = open
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : 1))
      .map(({ id }) => id);
    emit({ type: 'ReportsResolved', payload: { reportIds, decision: input.decision } });
    return { ok: true, data: { reportIds, decision: input.decision } };
  },
});

/**
 * Tranche l'appel d'une sanction, par un autre compte que son auteur et que le compte sanctionné. Accueilli, il lève
 * la sanction si elle n'est pas finie : sa fin devient cet instant. Rejeté, la sanction court jusqu'à sa fin.
 */
export const adminDecideAppeal = defineCommand({
  name: 'admin.decideAppeal',
  admin: MODERATION_ROLES,
  input: adminDecideAppealInputSchema,
  output: adminDecideAppealOutputSchema,
  errors: ADMIN_DECIDE_APPEAL_ERROR_CODES,
  errorByConstraint: { sanctions_decided_by_other: SECOND_PERSON_REQUIRED },
  async handler({ trx, userId, emit }, input) {
    // Verrou de la ligne : de deux décisions simultanées, la seconde voit la première.
    const sanction = await trx
      .selectFrom('admin.sanctions')
      .select(['id', 'user_id', 'author_id', 'appeal_body', 'appeal_decision'])
      // À l'horloge de la base, comme la garde `sanctions_lift_not_ended` : pas à `now`, tronqué (#611). Une
      // sanction levée n'est plus en vigueur, même si sa levée est datée après cet instant (#616).
      .select(
        sql<boolean>`lifted_at is null and (ends_at is null or ends_at > now())`.as('inForce'),
      )
      .where('id', '=', input.sanctionId)
      .forUpdate()
      .executeTakeFirst();
    if (!sanction) return refuse('SANCTION_NOT_FOUND', 'No such sanction.');
    if (sanction.appeal_body === null)
      return refuse('NOT_APPEALED', 'This sanction has no appeal.');
    if (sanction.appeal_decision)
      return refuse('APPEAL_DECIDED', 'This appeal is already decided.');
    if (sanction.author_id === userId || sanction.user_id === userId)
      return { ok: false, error: SECOND_PERSON_REQUIRED };
    // Même instant que celui de la base, qui refuserait de lever une sanction finie.
    const lift = input.decision === 'granted' && sanction.inForce;
    const decided = await trx
      .updateTable('admin.sanctions')
      .set({
        appeal_decision: input.decision,
        appeal_decided_by: userId,
        ...(lift ? { lifted_by: userId } : {}),
      })
      .where('id', '=', sanction.id)
      .returning('lifted_at')
      .executeTakeFirstOrThrow();
    emit({
      type: 'AppealDecided',
      payload: { sanctionId: sanction.id, decision: input.decision, lifted: lift },
    });
    return {
      ok: true,
      data: {
        sanctionId: sanction.id,
        decision: input.decision,
        liftedAt: decided.lifted_at?.toISOString() ?? null,
      },
    };
  },
});
