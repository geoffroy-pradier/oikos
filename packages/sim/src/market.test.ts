import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matchLimitOrder, type RestingOrder } from './orderbook';
import { accrueProduction } from './production';

describe('production paresseuse', () => {
  const field = { cycleMinutes: 240, outputPerCycle: 40, maxCycles: 36 };
  const t0 = new Date('2026-11-13T00:00:00Z');
  const after = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  it('compte les cycles entiers écoulés et garde le temps entamé du cycle en cours', () => {
    expect(accrueProduction({ ...field, since: t0, now: after(239) })).toEqual({
      cycles: 0,
      quantity: 0,
      since: t0,
    });
    expect(accrueProduction({ ...field, since: t0, now: after(240) })).toEqual({
      cycles: 1,
      quantity: 40,
      since: after(240),
    });
    expect(accrueProduction({ ...field, since: t0, now: after(1000) })).toEqual({
      cycles: 4,
      quantity: 160,
      since: after(960),
    });
  });

  it('plafonne à la capacité du site : au-delà, la production s’arrête et repart à la collecte', () => {
    const full = accrueProduction({ ...field, since: t0, now: after(240 * 100 + 17) });
    expect(full).toEqual({ cycles: 36, quantity: 1440, since: after(240 * 100 + 17) });
  });

  it('propriété : collecter souvent ou rarement rapporte autant, tant que le site n’est pas plein', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 600 }), { minLength: 1, maxLength: 12 }),
        (gaps) => {
          let [since, now, collected] = [t0, t0, 0];
          for (const gap of gaps) {
            now = new Date(now.getTime() + gap * 60_000);
            const step = accrueProduction({ ...field, since, now });
            since = step.since;
            collected += step.quantity;
          }
          expect(collected).toBe(accrueProduction({ ...field, since: t0, now }).quantity);
        },
      ),
    );
  });

  it('horloge qui recule ou paramètre absurde : rien n’est produit, ou l’appel est refusé', () => {
    expect(accrueProduction({ ...field, since: t0, now: after(-500) }).quantity).toBe(0);
    expect(() => accrueProduction({ ...field, cycleMinutes: 0, since: t0, now: t0 })).toThrow(
      RangeError,
    );
    expect(() => accrueProduction({ ...field, outputPerCycle: 1.5, since: t0, now: t0 })).toThrow(
      RangeError,
    );
  });
});

describe('appariement d’un ordre à cours limité', () => {
  const asks: RestingOrder[] = [
    { orderId: 'a', price: 8, quantity: 10, sequence: 1 },
    { orderId: 'b', price: 7, quantity: 5, sequence: 2 },
    { orderId: 'c', price: 7, quantity: 5, sequence: 3 },
    { orderId: 'd', price: 12, quantity: 50, sequence: 4 },
  ];

  it('achat : meilleur prix d’abord, puis le plus ancien, au prix de l’ordre présent ; le reste va au carnet', () => {
    expect(matchLimitOrder({ side: 'buy', price: 8, quantity: 30 }, asks)).toEqual({
      trades: [
        { restingOrderId: 'b', price: 7, quantity: 5 },
        { restingOrderId: 'c', price: 7, quantity: 5 },
        { restingOrderId: 'a', price: 8, quantity: 10 },
      ],
      remaining: 10,
    });
  });

  it('vente : sert les acheteurs les plus offrants ; aucun échange sous le prix limite', () => {
    const bids: RestingOrder[] = [
      { orderId: 'x', price: 5, quantity: 10, sequence: 1 },
      { orderId: 'y', price: 9, quantity: 4, sequence: 2 },
    ];
    expect(matchLimitOrder({ side: 'sell', price: 6, quantity: 10 }, bids)).toEqual({
      trades: [{ restingOrderId: 'y', price: 9, quantity: 4 }],
      remaining: 6,
    });
  });

  it('propriété : quantités conservées, prix toujours au moins aussi bons que la limite, carnet non modifié', () => {
    const order = fc.record({
      price: fc.integer({ min: 1, max: 50 }),
      quantity: fc.integer({ min: 1, max: 100 }),
    });
    fc.assert(
      fc.property(
        fc.array(order, { maxLength: 20 }),
        order,
        fc.constantFrom('buy' as const, 'sell' as const),
        (rows, incoming, side) => {
          const book = rows.map((row, index) => ({
            ...row,
            orderId: String(index),
            sequence: index,
          }));
          const snapshot = structuredClone(book);
          const { trades, remaining } = matchLimitOrder({ side, ...incoming }, book);
          expect(book).toEqual(snapshot);
          expect(trades.reduce((sum, trade) => sum + trade.quantity, 0) + remaining).toBe(
            incoming.quantity,
          );
          for (const trade of trades) {
            const resting = book.find((candidate) => candidate.orderId === trade.restingOrderId);
            expect(trade.quantity).toBeLessThanOrEqual(resting?.quantity ?? 0);
            expect(trade.price).toBe(resting?.price);
            expect(
              side === 'buy' ? trade.price <= incoming.price : trade.price >= incoming.price,
            ).toBe(true);
          }
          // S'il reste de la quantité, plus aucun ordre du carnet ne croise le prix limite.
          if (remaining > 0) {
            const matched = new Set(trades.map((trade) => trade.restingOrderId));
            const leftover = book.filter((resting) => !matched.has(resting.orderId));
            expect(
              leftover.some((resting) =>
                side === 'buy' ? resting.price <= incoming.price : resting.price >= incoming.price,
              ),
            ).toBe(false);
          }
        },
      ),
    );
  });

  it('refuse un prix ou une quantité non entiers ou non positifs', () => {
    expect(() => matchLimitOrder({ side: 'buy', price: 0, quantity: 1 }, [])).toThrow(RangeError);
    expect(() => matchLimitOrder({ side: 'sell', price: 5, quantity: 1.5 }, [])).toThrow(
      RangeError,
    );
  });
});
