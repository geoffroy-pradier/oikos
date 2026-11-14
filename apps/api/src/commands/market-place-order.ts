import {
  MARKET_PLACE_ORDER_ERROR_CODES,
  marketPlaceOrderInputSchema,
  marketPlaceOrderOutputSchema,
} from '@oikos/contracts';
import { matchLimitOrder } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Dépose un ordre à l'agora. Une vente attend dans le carnet et réserve son stock ; un achat s'exécute
 * à l'arrivée contre les ventes en attente, de la moins chère à la plus chère, et son reste est annulé.
 * Chaque échange est réglé par une écriture au grand livre, puis livré par le journal des stocks.
 */
export const marketPlaceOrder = defineCommand({
  name: 'market.placeOrder',
  input: marketPlaceOrderInputSchema,
  output: marketPlaceOrderOutputSchema,
  errors: MARKET_PLACE_ORDER_ERROR_CODES,
  // La base fait foi sous concurrence : le stock libre est borné par la réservation, le solde par le compte.
  errorByConstraint: {
    inventories_reserved_within_quantity: {
      code: 'INSUFFICIENT_STOCK',
      message: 'Not enough free stock to sell.',
    },
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
  },
  async handler({ trx, userId, emit, config }, input) {
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const city = await trx
      .selectFrom('game.cities')
      .select('id')
      .where('id', '=', input.cityId)
      .where('world_id', '=', house.world_id)
      .executeTakeFirst();
    if (!city) return refuse('CITY_NOT_FOUND', 'Unknown city.');
    if (!config.goods.some((good) => good.id === input.goodId))
      return refuse('GOOD_NOT_FOUND', 'Unknown good.');

    const market = { city_id: city.id, good_id: input.goodId };
    const stockOf = (houseId: string) =>
      trx
        .selectFrom('game.inventories')
        .select(['id', 'quantity', 'reserved'])
        .where('house_id', '=', houseId)
        .where('city_id', '=', market.city_id)
        .where('good_id', '=', market.good_id);
    const place = () =>
      trx
        .insertInto('game.orders')
        .values({
          world_id: house.world_id,
          house_id: house.id,
          ...market,
          side: input.side,
          price: input.price,
          quantity: input.quantity,
          remaining: input.quantity,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    const placed = (orderId: string) =>
      emit({
        type: 'OrderPlaced',
        payload: {
          orderId,
          houseId: house.id,
          cityId: city.id,
          goodId: input.goodId,
          side: input.side,
          price: input.price,
          quantity: input.quantity,
        },
      });

    if (input.side === 'sell') {
      const stock = await stockOf(house.id).forUpdate().executeTakeFirst();
      if (!stock || Number(stock.quantity) - Number(stock.reserved) < input.quantity)
        return refuse('INSUFFICIENT_STOCK', 'Not enough free stock to sell.');
      const order = await place();
      placed(order.id);
      return {
        ok: true,
        data: { orderId: order.id, status: 'open' as const, remaining: input.quantity, trades: [] },
      };
    }

    // Achat. Les appariements d'un monde s'exécutent l'un après l'autre : deux acheteurs qui se
    // vendent mutuellement ne peuvent pas s'attendre l'un l'autre (version 0, au plus simple).
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${house.world_id}`}, 0))`.execute(
      trx,
    );
    const account = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const asks = await trx
      .selectFrom('game.orders')
      .select(['id', 'house_id', 'price', 'remaining', 'seq'])
      .where('city_id', '=', market.city_id)
      .where('good_id', '=', market.good_id)
      .where('side', '=', 'sell')
      .where('status', '=', 'open')
      .where('price', '<=', String(input.price))
      .where('house_id', '<>', house.id)
      .orderBy('price')
      .orderBy('seq')
      .forUpdate()
      .execute();
    const sellers = new Map(asks.map((ask) => [ask.id, ask.house_id]));
    // L'achat s'exécute pour ce que la trésorerie permet de payer, du moins cher au plus cher.
    const { trades, remaining, shortOfFunds } = matchLimitOrder(
      {
        side: 'buy',
        price: input.price,
        quantity: input.quantity,
        budget: Number(account.balance),
      },
      asks.map((ask) => ({
        orderId: ask.id,
        price: Number(ask.price),
        quantity: Number(ask.remaining),
        sequence: Number(ask.seq),
      })),
    );
    // Pas même une unité payable alors qu'une vente attendait à ce prix : rien à exécuter.
    if (trades.length === 0 && shortOfFunds)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');

    const order = await place();
    placed(order.id);
    if (trades.length > 0) {
      await trx
        .insertInto('game.inventories')
        .values({ world_id: house.world_id, house_id: house.id, ...market })
        .onConflict((conflict) => conflict.constraint('inventories_unique').doNothing())
        .execute();
    }
    const destination =
      trades.length > 0 ? await stockOf(house.id).executeTakeFirstOrThrow() : null;
    for (const trade of trades) {
      const sellerId = sellers.get(trade.restingOrderId) ?? '';
      const sellerAccount = await trx
        .selectFrom('game.accounts')
        .select('id')
        .where('house_id', '=', sellerId)
        .where('kind', '=', 'house')
        .executeTakeFirstOrThrow();
      const origin = await stockOf(sellerId).executeTakeFirstOrThrow();
      const amount = trade.price * trade.quantity;
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({ world_id: house.world_id, kind: 'market.trade' })
        .returning('id')
        .executeTakeFirstOrThrow();
      // L'acheteur est débité avant que le vendeur soit crédité ; l'écriture est équilibrée.
      await trx
        .insertInto('game.ledger_lines')
        .values([
          { entry_id: entry.id, account_id: account.id, amount: -amount },
          { entry_id: entry.id, account_id: sellerAccount.id, amount },
        ])
        .execute();
      // L'échange d'abord (il libère la réservation du vendeur), la livraison ensuite.
      const executed = await trx
        .insertInto('game.trades')
        .values({
          world_id: house.world_id,
          sell_order_id: trade.restingOrderId,
          buy_order_id: order.id,
          price: trade.price,
          quantity: trade.quantity,
          ledger_entry_id: entry.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('game.stock_ledger')
        .values({
          world_id: house.world_id,
          good_id: market.good_id,
          quantity: trade.quantity,
          from_inventory_id: origin.id,
          to_inventory_id: destination?.id ?? null,
          kind: 'market.trade',
          ledger_entry_id: entry.id,
        })
        .execute();
      emit({
        type: 'TradeExecuted',
        payload: {
          tradeId: executed.id,
          cityId: city.id,
          goodId: market.good_id,
          sellOrderId: trade.restingOrderId,
          buyOrderId: order.id,
          price: trade.price,
          quantity: trade.quantity,
        },
      });
    }
    // Pas d'achat en attente : le reste est annulé dans la même transaction.
    if (remaining > 0) {
      await trx
        .updateTable('game.orders')
        .set({ status: 'cancelled' })
        .where('id', '=', order.id)
        .execute();
    }
    return {
      ok: true,
      data: {
        orderId: order.id,
        status: remaining > 0 ? ('cancelled' as const) : ('filled' as const),
        remaining,
        trades: trades.map(({ price, quantity }) => ({ price, quantity })),
        shortOfFunds,
      },
    };
  },
});
