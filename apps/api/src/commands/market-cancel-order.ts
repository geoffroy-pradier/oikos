import {
  MARKET_CANCEL_ORDER_ERROR_CODES,
  marketCancelOrderInputSchema,
  marketCancelOrderOutputSchema,
} from '@oikos/contracts';
import { defineCommand } from '../registry';

/**
 * Annule un ordre ouvert de sa propre maison : ce qui a déjà été servi reste acquis, seul le reste est
 * retiré du carnet. La base libère la réservation du stock d'une vente (déclencheur des ordres) ; pour
 * un achat, la commande rend à la trésorerie ce que le séquestre retenait (prix × reste).
 *
 * Seule commande de jeu permise à un compte suspendu ou exclu (#528) : elle ne crée rien, elle rend ce qu'un ordre
 * engageait. Sans elle, ses ordres resteraient sous séquestre et pourraient s'exécuter pendant la suspension.
 */
export const marketCancelOrder = defineCommand({
  name: 'market.cancelOrder',
  input: marketCancelOrderInputSchema,
  output: marketCancelOrderOutputSchema,
  errors: MARKET_CANCEL_ORDER_ERROR_CODES,
  moderation: 'exempt',
  async handler({ trx, userId, emit }, input) {
    // Verrouille l'ordre : un achat ou un tick qui le sert au même instant passe avant ou après,
    // jamais pendant. L'état lu ici est donc celui qui sera annulé.
    const order = await trx
      .selectFrom('game.orders')
      .select([
        'id',
        'world_id',
        'house_id',
        'city_id',
        'good_id',
        'side',
        'price',
        'remaining',
        'status',
      ])
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

    const released = Number(order.remaining);
    if (order.side === 'buy') {
      // La trésorerie avant le séquestre, comme à la mise en attente : même ordre de verrouillage.
      const accountOf = (kind: 'house' | 'escrow') =>
        trx
          .selectFrom('game.accounts')
          .select('id')
          .where('house_id', '=', order.house_id)
          .where('kind', '=', kind);
      const treasury = await accountOf('house').forUpdate().executeTakeFirstOrThrow();
      const escrow = await accountOf('escrow').executeTakeFirstOrThrow();
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({ world_id: order.world_id, kind: 'market.escrow_release' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const amount = Number(order.price) * released;
      await trx
        .insertInto('game.ledger_lines')
        .values([
          { entry_id: entry.id, account_id: escrow.id, amount: -amount },
          { entry_id: entry.id, account_id: treasury.id, amount },
        ])
        .execute();
    }
    await trx
      .updateTable('game.orders')
      .set({ status: 'cancelled' })
      .where('id', '=', order.id)
      .execute();
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
