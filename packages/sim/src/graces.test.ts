import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fairWindSeconds, graceSurplus } from './graces';
import { stormDurationSeconds } from './world-event-effects';

const bps = fc.oneof(
  fc.constantFrom(0, 1, 2_000, 9_999, 10_000),
  fc.integer({ min: 0, max: 10_000 }),
);
const wind = fc.oneof(
  fc.constantFrom(0, 1, 2_500, 4_999, 5_000),
  fc.integer({ min: 0, max: 5_000 }),
);
const quantity = fc.oneof(
  fc.constantFrom(0, 1, 4, 5, 9, 10, 2 ** 52 - 1),
  fc.nat(),
  fc.integer({ min: 0, max: 2 ** 52 - 1 }),
);
const outputs = fc.uniqueArray(
  fc.record({ goodId: fc.constantFrom('wheat', 'olives', 'flour', 'wine'), quantity }),
  { selector: (stack) => stack.goodId, maxLength: 4 },
);

describe('récolte bénie, atelier inspiré (#266)', () => {
  it('exemples : arrondi vers le bas, sur toute la récolte ; un surplus nul n’est pas rendu', () => {
    expect(graceSurplus([{ goodId: 'wheat', quantity: 40 }], 2_000)).toEqual([
      { goodId: 'wheat', quantity: 8 },
    ]);
    // 9 × 20 % = 1,8 : une unité ; 4 × 20 % = 0,8 : rien.
    expect(
      graceSurplus(
        [
          { goodId: 'flour', quantity: 9 },
          { goodId: 'wheat', quantity: 4 },
        ],
        2_000,
      ),
    ).toEqual([{ goodId: 'flour', quantity: 1 }]);
    expect(graceSurplus([{ goodId: 'wheat', quantity: 0 }], 10_000)).toEqual([]);
    expect(graceSurplus([{ goodId: 'wheat', quantity: 7 }], 10_000)).toEqual([
      { goodId: 'wheat', quantity: 7 },
    ]);
    expect(() => graceSurplus([], 10_001)).toThrow(RangeError);
    expect(() => graceSurplus([{ goodId: 'wheat', quantity: -1 }], 1)).toThrow(RangeError);
    expect(() => graceSurplus([{ goodId: 'wheat', quantity: 2 ** 53 }], 10_000)).toThrow(
      RangeError,
    );
  });

  it('propriété : ne retire jamais rien, au plus double, ⌊q × ampleur ÷ 10 000⌋ exactement', () => {
    fc.assert(
      fc.property(outputs, bps, (stacks, magnitude) => {
        const surplus = graceSurplus(stacks, magnitude);
        for (const extra of surplus) {
          const base = stacks.find((stack) => stack.goodId === extra.goodId)?.quantity ?? -1;
          expect(extra.quantity).toBeGreaterThan(0);
          expect(extra.quantity).toBeLessThanOrEqual(base);
          expect(BigInt(extra.quantity)).toBe((BigInt(base) * BigInt(magnitude)) / 10_000n);
        }
        // Chaque extrant absent du surplus n'avait rien à y gagner.
        for (const stack of stacks)
          if (!surplus.some((extra) => extra.goodId === stack.goodId))
            expect((BigInt(stack.quantity) * BigInt(magnitude)) / 10_000n).toBe(0n);
      }),
    );
  });
});

describe('vent favorable (#266)', () => {
  it('exemples : arrondi vers le haut, au plus deux fois plus court, jamais instantané', () => {
    expect(fairWindSeconds(14_400, 2_500)).toBe(10_800);
    expect(fairWindSeconds(3, 2_500)).toBe(3);
    expect(fairWindSeconds(1, 5_000)).toBe(1);
    expect(fairWindSeconds(0, 5_000)).toBe(0);
    expect(fairWindSeconds(14_401, 5_000)).toBe(7_201);
    expect(() => fairWindSeconds(10, 5_001)).toThrow(RangeError);
    expect(() => fairWindSeconds(-1, 0)).toThrow(RangeError);
  });

  it('propriété : jamais plus long, au moins la moitié, au moins une seconde ; après une tempête aussi', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 40 }), wind, bps, (seconds, magnitude, storm) => {
        const shortened = fairWindSeconds(seconds, magnitude);
        expect(shortened).toBeLessThanOrEqual(seconds);
        expect(shortened).toBeGreaterThanOrEqual(Math.max(1, Math.ceil(seconds / 2)));
        // Tempête d'abord, vent ensuite : le vent ne rallonge jamais ce que la tempête a fixé.
        const stormy = stormDurationSeconds(seconds, storm);
        expect(fairWindSeconds(stormy, magnitude)).toBeLessThanOrEqual(stormy);
      }),
    );
  });
});
