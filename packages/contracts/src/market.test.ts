import { describe, expect, it } from 'vitest';
import {
  domainEventSchema,
  marketPlaceOrderInputSchema,
  MAX_ORDER_PRICE,
  MAX_ORDER_QUANTITY,
} from './index';

const valid = {
  cityId: '01900000-0000-7000-8000-000000000101',
  goodId: 'wheat',
  side: 'sell',
  price: 6,
  quantity: 40,
};

describe('market.placeOrder', () => {
  it('accepte un ordre valide, jusqu’aux bornes', () => {
    expect(marketPlaceOrderInputSchema.safeParse(valid).success).toBe(true);
    const largest = { ...valid, side: 'buy', price: MAX_ORDER_PRICE, quantity: MAX_ORDER_QUANTITY };
    expect(marketPlaceOrderInputSchema.safeParse(largest).success).toBe(true);
    // Le montant le plus grand possible reste un entier exact.
    expect(Number.isSafeInteger(MAX_ORDER_PRICE * MAX_ORDER_QUANTITY)).toBe(true);
  });

  it.each([
    { price: 0 },
    { price: -6 },
    { price: 6.5 },
    { price: MAX_ORDER_PRICE + 1 },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: MAX_ORDER_QUANTITY + 1 },
    { side: 'hold' },
    { goodId: 'Wheat' },
    { cityId: 'kalliste' },
    { houseId: '01900000-0000-7000-8000-000000000101' },
  ])('refuse %j', (patch) => {
    expect(marketPlaceOrderInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('les événements du marché font partie du contrat', () => {
    const id = '01900000-0000-7000-8000-000000000101';
    const placed = {
      orderId: id,
      houseId: id,
      cityId: id,
      goodId: 'wheat',
      side: 'sell',
      price: 6,
      quantity: 40,
    };
    const traded = {
      tradeId: id,
      cityId: id,
      goodId: 'wheat',
      sellOrderId: id,
      buyOrderId: null,
      price: 6,
      quantity: 4,
    };
    expect(domainEventSchema.safeParse({ type: 'OrderPlaced', payload: placed }).success).toBe(
      true,
    );
    expect(domainEventSchema.safeParse({ type: 'TradeExecuted', payload: traded }).success).toBe(
      true,
    );
    expect(
      domainEventSchema.safeParse({ type: 'TradeExecuted', payload: { ...traded, quantity: 0 } })
        .success,
    ).toBe(false);
  });
});
