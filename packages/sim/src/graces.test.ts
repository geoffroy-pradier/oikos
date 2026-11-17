import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fairWindSeconds, graceSurplus, graceToConsume, type PendingGrace } from './graces';
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
    // Dépassement réel : la quantité est un entier sûr, la récolte augmentée n'en est plus un.
    expect(() => graceSurplus([{ goodId: 'wheat', quantity: Number.MAX_SAFE_INTEGER }], 1)).toThrow(
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
        // Formule exacte, en entiers longs : ⌈secondes × (10 000 − ampleur) ÷ 10 000⌉.
        const scaled = BigInt(seconds) * BigInt(10_000 - magnitude);
        expect(BigInt(shortened)).toBe((scaled + 9_999n) / 10_000n);
        expect(shortened).toBeLessThanOrEqual(seconds);
        expect(shortened).toBeGreaterThanOrEqual(Math.max(1, Math.ceil(seconds / 2)));
        // Tempête d'abord, vent ensuite : le vent ne rallonge jamais ce que la tempête a fixé.
        const stormy = stormDurationSeconds(seconds, storm);
        expect(fairWindSeconds(stormy, magnitude)).toBeLessThanOrEqual(stormy);
      }),
    );
  });
});
describe('grâce consommée par une action (#266)', () => {
  const at = (ms: number) => new Date(ms);
  const pending: PendingGrace[] = [
    { id: 'b', effect: 'blessed_harvest', invokedAt: at(2) },
    { id: 'w', effect: 'fair_wind', invokedAt: at(1) },
    { id: 'a', effect: 'blessed_harvest', invokedAt: at(2) },
    { id: 'c', effect: 'blessed_harvest', invokedAt: at(3) },
  ];
  it('exemples : la plus ancienne de l’effet, à égalité le plus petit identifiant, si elle ajoute', () => {
    expect(graceToConsume(pending, 'blessed_harvest', () => true)?.id).toBe('a');
    expect(graceToConsume(pending, 'fair_wind', () => true)?.id).toBe('w');
    expect(graceToConsume(pending, 'inspired_workshop', () => true)).toBeUndefined();
    // La plus ancienne n'ajoute rien : aucune n'est consommée, pas même une plus récente.
    expect(graceToConsume(pending, 'blessed_harvest', (grace) => grace.id !== 'a')).toBeUndefined();
  });

  it('propriété : une grâce ne se consomme qu’une fois, par une action de son effet', () => {
    const effect = fc.constantFrom('blessed_harvest', 'inspired_workshop', 'fair_wind');
    const step = fc.oneof(
      fc.record({ invoke: effect, at: fc.nat(20) }),
      fc.record({ act: effect, adds: fc.boolean() }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        let waiting: PendingGrace[] = [];
        const invoked: PendingGrace[] = [];
        const consumed: { grace: PendingGrace; by: string }[] = [];
        for (const [index, item] of steps.entries()) {
          if ('invoke' in item) {
            const grace = { id: `g${index}`, effect: item.invoke, invokedAt: at(item.at) };
            waiting.push(grace);
            invoked.push(grace);
            continue;
          }
          const grace = graceToConsume(waiting, item.act, () => item.adds);
          if (!grace) continue;
          consumed.push({ grace, by: item.act });
          waiting = waiting.filter((candidate) => candidate !== grace);
        }
        const ids = consumed.map(({ grace }) => grace.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const { grace, by } of consumed) expect(grace.effect).toBe(by);
        expect([...ids, ...waiting.map((grace) => grace.id)].sort()).toEqual(
          invoked.map((grace) => grace.id).sort(),
        );
      }),
    );
  });
});
