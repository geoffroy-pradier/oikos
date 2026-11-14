import {
  MARKET_CANCEL_ORDER_ERROR_CODES,
  marketCancelOrderInputSchema,
  marketCancelOrderOutputSchema,
} from '@oikos/contracts';
import { defineCommand } from '../registry';

/**
 * Annule un ordre ouvert de sa propre maison. La base libère la réservation du stock d'une vente
 * (déclencheur des ordres) : ce qui a déjà été servi reste acquis, seul le reste est retiré du carnet.
 */
export const marketCancelOrder = defineCommand({
  name: 'market.cancelOrder',
  input: marketCancelOrderInputSchema,
  output: marketCancelOrderOutputSchema,
  errors: MARKET_CANCEL_ORDER_ERROR_CODES,
  async handler({ trx, userId, emit }, input) {
    // Verrouille l'ordre : un achat ou un tick qui le sert au même instant passe avant ou après,
    // jamais pendant. L'état lu ici est donc celui qui sera annulé.
    const order = await trx
      .selectFrom('game.orders')
      .select(['id', 'house_id', 'city_id', 'good_id', 'side', 'remaining', 'status'])
      .where('id', '=', input.orderId)
      .where('house_id', 'in', (houses) =>
        houses.selectFrom('game.houses').select('id').where('user_id', '=', userId),
      )
      .forUpdate()
      .executeTakeFirst();
    // L'ordre d'un autre joueur est indiscernable d'un ordre inexistant.
    if (!order) return { ok: false, error: { code: 'ORDER_NOT_FOUND', message: 'Unknown order.' } };
    if (order.status !== 'open') {
      const message = 'This order is already filled or cancelled.';
      return { ok: false, error: { code: 'ORDER_NOT_OPEN', message } };
    }

    await trx
      .updateTable('game.orders')
      .set({ status: 'cancelled' })
      .where('id', '=', order.id)
      .execute();
    const released = Number(order.remaining);
    emit({
      type: 'OrderCancelled',
      payload: {
        orderId: order.id,
        houseId: order.house_id,
        cityId: order.city_id,
        goodId: order.good_id,
        side: order.side,
        released,
      },
    });
    return { ok: true, data: { orderId: order.id, status: 'cancelled', released } };
  },
});
