import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { marketTax } from './tax';

const BPS = 10_000n;
const gross = fc.oneof(
  fc.integer({ min: 1, max: 200 }),
  fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
);
const bps = fc.oneof(fc.constantFrom(0, 1, 9_999, 10_000), fc.integer({ min: 0, max: 10_000 }));
const rule = fc.record({ rateBps: bps, burnShareBps: bps });
/** Vrai si `rounded` est exactement ⌈amount × share / 10 000⌉, vérifié en entiers longs. */
const isCeiling = (rounded: number, amount: number, share: number) => {
  const exact = BigInt(amount) * BigInt(share);
  return BigInt(rounded) * BPS >= exact && (BigInt(rounded) - 1n) * BPS < exact;
};

describe('taxe de marché', () => {
  it('exemples : obole supérieure pour la taxe, puis pour sa part détruite', () => {
    const half = { rateBps: 500, burnShareBps: 5_000 };
    expect(marketTax(100, half)).toEqual({ net: 95, burned: 3, treasury: 2 });
    expect(marketTax(6, half)).toEqual({ net: 5, burned: 1, treasury: 0 });
    expect(marketTax(20, half)).toEqual({ net: 19, burned: 1, treasury: 0 });
    expect(marketTax(21, half)).toEqual({ net: 19, burned: 1, treasury: 1 });
    expect(marketTax(1, { rateBps: 1, burnShareBps: 0 })).toEqual({
      net: 0,
      burned: 0,
      treasury: 1,
    });
    expect(marketTax(Number.MAX_SAFE_INTEGER, { rateBps: 10_000, burnShareBps: 10_000 })).toEqual({
      net: 0,
      burned: Number.MAX_SAFE_INTEGER,
      treasury: 0,
    });
  });

  it('rien ne se crée ni ne se perd : net + détruit + trésor = brut, en entiers positifs ou nuls', () => {
    fc.assert(
      fc.property(gross, rule, (amount, taxRule) => {
        const { net, burned, treasury } = marketTax(amount, taxRule);
        for (const part of [net, burned, treasury])
          expect(Number.isSafeInteger(part) && part >= 0).toBe(true);
        expect(BigInt(net) + BigInt(burned) + BigInt(treasury)).toBe(BigInt(amount));
      }),
    );
  });

  it('taux nul : aucune taxe, quelle que soit la part détruite', () => {
    fc.assert(
      fc.property(gross, bps, (amount, burnShareBps) => {
        expect(marketTax(amount, { rateBps: 0, burnShareBps })).toEqual({
          net: amount,
          burned: 0,
          treasury: 0,
        });
      }),
    );
  });

  it('arrondi exact à l’obole supérieure, même aux plus grands montants : le vendeur ne garde jamais plus que le taux ne lui laisse, le trésor jamais plus que sa part', () => {
    fc.assert(
      fc.property(gross, rule, (amount, taxRule) => {
        const { net, burned } = marketTax(amount, taxRule);
        expect(isCeiling(amount - net, amount, taxRule.rateBps)).toBe(true);
        expect(isCeiling(burned, amount - net, taxRule.burnShareBps)).toBe(true);
      }),
    );
  });

  it('découper un échange ne fait jamais payer ni détruire moins', () => {
    const part = fc.integer({ min: 1, max: 2 ** 40 });
    fc.assert(
      fc.property(part, part, rule, (a, b, taxRule) => {
        const of = (amount: number) => marketTax(amount, taxRule);
        expect(of(a).net + of(b).net).toBeLessThanOrEqual(of(a + b).net);
        expect(of(a).burned + of(b).burned).toBeGreaterThanOrEqual(of(a + b).burned);
      }),
    );
  });

  it('vendre une obole de plus ne rapporte jamais moins, et jamais plus d’une obole', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 50 }), rule, (amount, taxRule) => {
        const gain = marketTax(amount + 1, taxRule).net - marketTax(amount, taxRule).net;
        expect(gain === 0 || gain === 1).toBe(true);
      }),
    );
  });

  it('refuse un montant nul, négatif, fractionnaire ou hors des entiers sûrs, et un taux hors bornes', () => {
    const valid = { rateBps: 500, burnShareBps: 5_000 };
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => marketTax(bad, valid)).toThrow(RangeError);
    for (const bad of [-1, 10_001, 0.5, Number.NaN]) {
      expect(() => marketTax(100, { ...valid, rateBps: bad })).toThrow(/rateBps/);
      expect(() => marketTax(100, { ...valid, burnShareBps: bad })).toThrow(/burnShareBps/);
    }
  });
});
