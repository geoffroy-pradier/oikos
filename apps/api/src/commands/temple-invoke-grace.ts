import {
  TEMPLE_INVOKE_GRACE_ERROR_CODES,
  templeInvokeGraceInputSchema,
  templeInvokeGraceOutputSchema,
} from '@oikos/contracts';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { defineCommand, type CommandResult } from '../registry';
import { accountHouseId } from '@oikos/operations';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const NO_CHARIS = { code: 'INSUFFICIENT_CHARIS', message: 'Not enough Charis for this grace.' };
const PENDING = {
  code: 'GRACE_PENDING',
  message: 'This grace is still waiting for the action it applies to.',
};

/**
 * La maison invoque une grâce (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; #266) : il lui faut la Charis requise
 * envers le dieu de la grâce ; la Charis dépensée entre au journal de la Charis, dans la même transaction, et
 * l'invocation attend la prochaine action admise de son effet (récolte ou départ), qui la consommera. Une grâce
 * qui attend encore, ou qui se recharge, est refusée. L'invocation garde l'effet, l'ampleur et le dieu de la
 * configuration en vigueur : l'action reçoit ce qui a été payé. Une autre Charis dépensée que celle vue est refusée.
 */
export const templeInvokeGrace = defineCommand({
  name: 'temple.invokeGrace',
  input: templeInvokeGraceInputSchema,
  output: templeInvokeGraceOutputSchema,
  errors: TEMPLE_INVOKE_GRACE_ERROR_CODES,
  // La base fait foi sous concurrence : ni Charis sous zéro, ni deux invocations en attente.
  errorByConstraint: { favor_charis_range: NO_CHARIS, graces_used_one_pending: PENDING },
  async handler({ trx, userId, emit, config, now }, input) {
    // Ordre des verrous : la maison, puis sa Charis envers le dieu, comme une offrande ; ni agora, ni monnaie, ni
    // stock. La maison fait se suivre les invocations et les offrandes d'une même maison.
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('id', '=', accountHouseId(userId))
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const grace = config.graces.find((candidate) => candidate.id === input.graceId);
    if (!grace) return refuse('GRACE_NOT_FOUND', 'Unknown grace.');
    if (grace.charisSpent !== input.expectedCharisSpent)
      return refuse('CHARIS_CHANGED', `This grace now costs ${grace.charisSpent} Charis.`);

    const favor = await trx
      .selectFrom('game.favor')
      .select('charis')
      .where('house_id', '=', house.id)
      .where('god_id', '=', grace.godId)
      .forUpdate()
      .executeTakeFirst();
    const charis = Number(favor?.charis ?? 0);
    // Les invocations de cette grâce par la maison : une en attente, ou une qui se recharge encore.
    const previous = await trx
      .selectFrom('game.graces_used')
      .select(['consumed_at', 'ready_at'])
      .where('house_id', '=', house.id)
      .where('grace_id', '=', grace.id)
      .where((eb) => eb.or([eb('consumed_at', 'is', null), eb('ready_at', '>', now)]))
      .orderBy('ready_at', 'desc')
      .execute();
    if (previous.some((row) => row.consumed_at === null))
      return refuse(PENDING.code, PENDING.message);
    const recharging = previous[0];
    if (recharging)
      return refuse(
        'GRACE_RECHARGING',
        `This grace recharges until ${recharging.ready_at.toISOString()}.`,
      );
    if (charis < grace.charisRequired) return refuse(NO_CHARIS.code, NO_CHARIS.message);

    // Recharge en jours de jeu : invoquée le jour J, réinvocable à la clôture qui ouvre le jour J + recharge.
    const readyAt = dailyCloseAt(gameDayAt(now, config.clock) + grace.cooldownDays, config.clock);
    const used = await trx
      .insertInto('game.graces_used')
      .values({
        world_id: house.world_id,
        house_id: house.id,
        grace_id: grace.id,
        god_id: grace.godId,
        effect: grace.effect,
        magnitude_bps: grace.magnitudeBps,
        charis_spent: grace.charisSpent,
        ready_at: readyAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // Une grâce gratuite n'a pas de ligne : le journal refuse un mouvement nul.
    if (grace.charisSpent > 0)
      await trx
        .insertInto('game.favor_ledger')
        .values({
          world_id: house.world_id,
          house_id: house.id,
          god_id: grace.godId,
          amount: -grace.charisSpent,
          kind: 'grace',
          grace_use_id: used.id,
        })
        .execute();

    const invocation = {
      graceUseId: used.id,
      graceId: grace.id,
      godId: grace.godId,
      effect: grace.effect,
      magnitudeBps: grace.magnitudeBps,
      charisSpent: grace.charisSpent,
      readyAt: readyAt.toISOString(),
    };
    emit({ type: 'GraceInvoked', payload: { ...invocation, houseId: house.id } });
    return { ok: true, data: { ...invocation, charis: charis - grace.charisSpent } };
  },
});
