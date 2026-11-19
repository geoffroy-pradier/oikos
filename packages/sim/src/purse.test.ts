import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dailyPublicIncome } from './purse';

const klass = fc.record({
  incomePerThousand: fc.integer({ min: 0, max: 10_000 }),
  publicIncomeBps: fc.integer({ min: 0, max: 10_000 }),
  population: fc.oneof(fc.constantFrom(0, 1, 999), fc.integer({ min: 0, max: 100_000_000 })),
});

describe('revenu public d’un jour d’une cité (#632)', () => {
  it('exemples : revenu d’un jour × part, sommé sur les classes, arrondi une fois à l’obole inférieure', () => {
    // 70 oboles par tick pour 1 000 habitants, 144 ticks, 3 000 habitants : 30 240 par jour, à 100 %.
    const thetes = { incomePerThousand: 70, publicIncomeBps: 10_000, population: 3_000 };
    expect(dailyPublicIncome([thetes], 144)).toBe(30_240);
    // À 2,5 % : 756. Onze classes à 0,099 obole chacune donnent 1, pas 0 : l'arrondi se fait sur la somme.
    expect(dailyPublicIncome([{ ...thetes, publicIncomeBps: 250 }], 144)).toBe(756);
    const tiny = { incomePerThousand: 99, publicIncomeBps: 1, population: 1_000 };
    expect(dailyPublicIncome([tiny], 1)).toBe(0);
    expect(
      dailyPublicIncome([tiny, tiny, tiny, tiny, tiny, tiny, tiny, tiny, tiny, tiny, tiny], 10),
    ).toBe(1);
    // Part nulle, classe vide, aucune classe : rien.
    expect(dailyPublicIncome([{ ...thetes, publicIncomeBps: 0 }], 144)).toBe(0);
    expect(dailyPublicIncome([{ ...thetes, population: 0 }], 144)).toBe(0);
    expect(dailyPublicIncome([], 144)).toBe(0);
  });

  it('propriétés : entier, jamais au-dessus du revenu exact, à moins d’une obole de lui ; croissant en part et en population', () => {
    fc.assert(
      fc.property(
        fc.array(klass, { maxLength: 6 }),
        fc.integer({ min: 1, max: 1_440 }),
        (classes, ticks) => {
          const income = dailyPublicIncome(classes, ticks);
          const exact = classes.reduce(
            (sum, c) =>
              sum +
              BigInt(c.incomePerThousand) *
                BigInt(c.population) *
                BigInt(c.publicIncomeBps) *
                BigInt(ticks),
            0n,
          );
          expect(Number.isSafeInteger(income)).toBe(true);
          expect(BigInt(income) * 10_000_000n <= exact).toBe(true);
          expect(exact - BigInt(income) * 10_000_000n < 10_000_000n).toBe(true);
          const [first, ...rest] = classes;
          if (first) {
            const more = {
              ...first,
              population: first.population + 1,
              publicIncomeBps: first.publicIncomeBps + 1,
            };
            expect(dailyPublicIncome([more, ...rest], ticks)).toBeGreaterThanOrEqual(income);
          }
        },
      ),
    );
  });

  it('refuse un nombre négatif ou fractionnaire', () => {
    const ok = { incomePerThousand: 1, publicIncomeBps: 1, population: 1 };
    for (const bad of [
      { ...ok, population: -1 },
      { ...ok, publicIncomeBps: 0.5 },
      { ...ok, incomePerThousand: Number.NaN },
    ])
      expect(() => dailyPublicIncome([bad], 144)).toThrow(RangeError);
    expect(() => dailyPublicIncome([ok], -1)).toThrow(RangeError);
  });
});
