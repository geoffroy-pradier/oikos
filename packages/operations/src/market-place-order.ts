import type { MarketPlaceOrderInput, MarketPlaceOrderOutput } from '@oikos/contracts';
import { cityRatesOf, notSanctioned } from '@oikos/db';
import { marketTax, planLimitOrder } from '@oikos/sim';
import { sql } from 'kysely';
import {
  defineOperation,
  houseOf,
  type Actor,
  type OperationContext,
  type OperationResult,
} from './context';

const refuse = (code: string, message: string): OperationResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Dépose un ordre à l'agora. Il s'exécute à l'arrivée contre le côté opposé du carnet, au prix de chaque
 * ordre servi ; son reste attend. Une vente réserve son stock, un achat met prix × reste sous séquestre ;
 * un achat que la trésorerie ne permet pas de retenir voit son reste annulé. Chaque échange est réglé par
 * une écriture au grand livre (l'acheteur qui attendait paie de son séquestre), puis livré par le journal
 * des stocks. La même écriture prélève la taxe de marché sur le vendeur : l'acheteur paie le brut, le
 * vendeur reçoit le net, le reste va au puits et au trésor de la cité.
 *
 * Cœur de la commande `market.placeOrder`, partagé avec les intendants (ADR 0009) : l'ordre de la maison de
 * l'acteur.
 */
export const placeOrder = defineOperation({
  name: 'market.placeOrder',
  // La base fait foi sous concurrence : le stock libre est borné par la réservation, le solde par le compte.
  errorByConstraint: {
    inventories_reserved_within_quantity: {
      code: 'INSUFFICIENT_STOCK',
      message: 'Not enough free stock to sell.',
    },
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
  },
  async run(
    { trx, emit, config }: OperationContext,
    actor: Actor,
    input: MarketPlaceOrderInput,
  ): Promise<OperationResult<MarketPlaceOrderOutput>> {
    const house = await houseOf(
      trx.selectFrom('game.houses').select(['id', 'world_id']),
      actor,
    ).executeTakeFirst();
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
          // L'intendant qui pose l'ordre : ses règles nouvelles ou son renvoi l'annulent (#562).
          steward_id: 'stewardId' in actor ? (actor.stewardId ?? null) : null,
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

    // Les appariements d'un monde s'exécutent l'un après l'autre : deux ordres qui se croisent ne
    // peuvent pas s'attendre l'un l'autre (au plus simple).
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${house.world_id}`}, 0))`.execute(
      trx,
    );
    // Sanction relue sous ce verrou, à l'heure de l'instruction (#528) : le registre l'a contrôlée au début de la
    // transaction, mais une exclusion validée pendant l'attente du verrou a déjà annulé les ordres du compte ; un
    // ordre placé après elle resterait ouvert, sous séquestre, chez un compte exclu.
    // Colonne qualifiée : la sous-requête de `notSanctioned` a aussi un `user_id`.
    const sanctioned = await trx
      .selectFrom('game.houses as h')
      .select('h.id')
      .where('h.id', '=', house.id)
      .where((eb) => eb.not(notSanctioned(sql.ref('h.user_id'))))
      .executeTakeFirst();
    if (sanctioned) return refuse('SUSPENDED', 'This account is suspended.');
    const buying = input.side === 'buy';
    const accountOf = (houseId: string, kind: 'house' | 'escrow') =>
      trx
        .selectFrom('game.accounts')
        .select(['id', 'balance'])
        .where('house_id', '=', houseId)
        .where('kind', '=', kind);
    const inventoryOf = async (houseId: string) => {
      await trx
        .insertInto('game.inventories')
        .values({ world_id: house.world_id, house_id: houseId, ...market })
        .onConflict((conflict) => conflict.constraint('inventories_unique').doNothing())
        .execute();
      return stockOf(houseId).executeTakeFirstOrThrow();
    };
    // Ce que l'ordre engage : la trésorerie pour un achat, le stock libre pour une vente.
    const treasury = accountOf(house.id, 'house');
    const account = await (buying ? treasury.forUpdate() : treasury).executeTakeFirstOrThrow();
    if (!buying) {
      const stock = await stockOf(house.id).forUpdate().executeTakeFirst();
      if (!stock || Number(stock.quantity) - Number(stock.reserved) < input.quantity)
        return refuse('INSUFFICIENT_STOCK', 'Not enough free stock to sell.');
    }
    // Côté opposé, hors de ses propres ordres : une maison n'échange pas avec elle-même.
    const opposite = await trx
      .selectFrom('game.orders')
      .select(['id', 'house_id', 'price', 'remaining', 'seq'])
      .where('city_id', '=', market.city_id)
      .where('good_id', '=', market.good_id)
      .where('side', '=', buying ? 'sell' : 'buy')
      .where('status', '=', 'open')
      .where('price', buying ? '<=' : '>=', String(input.price))
      .where('house_id', '<>', house.id)
      .orderBy('price', buying ? 'asc' : 'desc')
      .orderBy('seq')
      .forUpdate()
      .execute();
    const counterparties = new Map(opposite.map((resting) => [resting.id, resting.house_id]));
    const terms = { houseId: house.id, price: input.price, quantity: input.quantity };
    const plan = planLimitOrder(
      buying
        ? { ...terms, side: 'buy', budget: Number(account.balance) }
        : { ...terms, side: 'sell' },
      opposite.map((resting) => ({
        orderId: resting.id,
        houseId: resting.house_id,
        price: Number(resting.price),
        quantity: Number(resting.remaining),
        sequence: Number(resting.seq),
      })),
    );
    const { trades, remaining } = plan;
    // Ni une unité payable, ni de quoi retenir le prix d'un ordre en attente : rien à faire.
    if (buying && trades.length === 0 && plan.shortOfFunds)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');

    const order = await place();
    placed(order.id);
    /** `amount` passe de `from` à `to`, moins ce que l'écriture prélève au passage pour d'autres comptes. */
    const post = async (
      kind: string,
      from: string,
      to: string,
      amount: number,
      levies: { account_id: string; amount: number }[] = [],
    ) => {
      const kept = levies.reduce((rest, levy) => rest - levy.amount, amount);
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({ world_id: house.world_id, kind })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Le compte débité l'est avant que l'autre soit crédité ; l'écriture est équilibrée.
      await trx
        .insertInto('game.ledger_lines')
        .values(
          [{ account_id: from, amount: -amount }, { account_id: to, amount: kept }, ...levies]
            // Une ligne nulle n'est pas une ligne : part détruite ou versée nulle, vente d'une obole taxée.
            .filter((line) => line.amount !== 0)
            .map((line) => ({ entry_id: entry.id, ...line })),
        )
        .execute();
      return entry.id;
    };
    // Taxe de la cité du marché (5.6), lue sous le verrou de l'agora : celui que prend la clôture qui
    // applique un décret de taux. Ses comptes, le puits du monde et le trésor de la cité, ne sont lus que
    // s'il y a à prélever.
    const rule = {
      rateBps:
        trades.length > 0
          ? (await cityRatesOf(trx, house.world_id, city.id, config)).marketTaxRateBps
          : 0,
      burnShareBps: config.marketTax.burnShareBps,
    };
    const taxed = rule.rateBps > 0;
    const taxAccount = (key: 'sink' | 'treasury') =>
      trx
        .selectFrom('game.accounts')
        .select('id')
        .where('world_id', '=', house.world_id)
        .where(
          key === 'sink' ? 'system_key' : 'city_id',
          '=',
          key === 'sink' ? 'sink_market_tax' : city.id,
        )
        .executeTakeFirstOrThrow();
    const [sink, cityTreasury] = taxed
      ? [await taxAccount('sink'), await taxAccount('treasury')]
      : [];
    for (const trade of trades) {
      const otherId = counterparties.get(trade.restingOrderId) ?? '';
      const [buyerId, sellerId] = buying ? [house.id, otherId] : [otherId, house.id];
      const [buyOrderId, sellOrderId] = buying
        ? [order.id, trade.restingOrderId]
        : [trade.restingOrderId, order.id];
      // L'acheteur qui arrive paie de sa trésorerie ; celui qui attendait, de son séquestre.
      const payer = buying ? account : await accountOf(otherId, 'escrow').executeTakeFirstOrThrow();
      const payee = buying ? await accountOf(otherId, 'house').executeTakeFirstOrThrow() : account;
      const gross = trade.price * trade.quantity;
      const tax = marketTax(gross, rule);
      const entryId = await post(
        'market.trade',
        payer.id,
        payee.id,
        gross,
        sink && cityTreasury
          ? [
              { account_id: sink.id, amount: tax.burned },
              { account_id: cityTreasury.id, amount: tax.treasury },
            ]
          : [],
      );
      // L'échange d'abord (il libère la réservation du vendeur), la livraison ensuite.
      const executed = await trx
        .insertInto('game.trades')
        .values({
          world_id: house.world_id,
          sell_order_id: sellOrderId,
          buy_order_id: buyOrderId,
          price: trade.price,
          quantity: trade.quantity,
          ledger_entry_id: entryId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const origin = await stockOf(sellerId).executeTakeFirstOrThrow();
      const destination = await inventoryOf(buyerId);
      await trx
        .insertInto('game.stock_ledger')
        .values({
          world_id: house.world_id,
          good_id: market.good_id,
          quantity: trade.quantity,
          from_inventory_id: origin.id,
          to_inventory_id: destination.id,
          kind: 'market.trade',
          ledger_entry_id: entryId,
        })
        .execute();
      emit({
        type: 'TradeExecuted',
        payload: {
          tradeId: executed.id,
          cityId: city.id,
          goodId: market.good_id,
          sellOrderId,
          buyOrderId,
          price: trade.price,
          quantity: trade.quantity,
        },
      });
    }
    if (plan.escrow > 0) {
      // Achat en attente : prix × reste quitte la trésorerie pour le séquestre de la maison.
      await trx
        .insertInto('game.accounts')
        .values({ world_id: house.world_id, kind: 'escrow', house_id: house.id })
        .onConflict((conflict) => conflict.constraint('accounts_one_per_house_kind').doNothing())
        .execute();
      const escrow = await accountOf(house.id, 'escrow').executeTakeFirstOrThrow();
      await post('market.escrow_hold', account.id, escrow.id, plan.escrow);
    }
    // Achat que la trésorerie ne permet pas de retenir : le reste est annulé dans la même transaction.
    if (remaining > 0 && !plan.rests) {
      await trx
        .updateTable('game.orders')
        .set({ status: 'cancelled' })
        .where('id', '=', order.id)
        .execute();
      // Sans cet événement, rien ne distinguerait dans le journal ce reste annulé d'un reste qui attend.
      emit({
        type: 'OrderCancelled',
        payload: {
          orderId: order.id,
          houseId: house.id,
          cityId: city.id,
          goodId: market.good_id,
          side: input.side,
          released: remaining,
        },
      });
    }
    const status = remaining === 0 ? 'filled' : plan.rests ? 'open' : 'cancelled';
    return {
      ok: true,
      data: {
        orderId: order.id,
        status: status as 'filled' | 'open' | 'cancelled',
        remaining,
        trades: trades.map(({ price, quantity }) => ({ price, quantity })),
        ...(buying ? { shortOfFunds: plan.shortOfFunds } : {}),
      },
    };
  },
});
