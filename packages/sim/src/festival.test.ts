import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boostedBudget, boostedDemand, festivalDemandBoosts } from './festival';

const RULES = { maxOboles: 30_000, maxDays: 7, demandBoostBps: 5_000 };
const festival = (amountOboles: number, days: number, goodIds: string[], settledDay = 100) => ({
  amountOboles,
  days,
  goodIds,
  settledDay,
});
const boosts = (...args: Parameters<typeof festivalDemandBoosts>) =>
  Object.fromEntries(festivalDemandBoosts(...args));

describe('hausse de la demande d’une fête', () => {
  it('pendant ses jours de jeu, à partir de sa clôture : la part de sa dépense par jour', () => {
    const two = [festival(30_000, 2, ['bread', 'wine'])];
    expect(boosts(two, 99, RULES)).toEqual({});
    expect(boosts(two, 100, RULES)).toEqual({ bread: 2_500, wine: 2_500 });
    expect(boosts(two, 101, RULES)).toEqual({ bread: 2_500, wine: 2_500 });
    expect(boosts(two, 102, RULES)).toEqual({});
    // Une obole de moins : arrondi vers le bas. Une fête d'un jour au maximum : toute la hausse.
    expect(boosts([festival(29_999, 1, ['bread'])], 100, RULES)).toEqual({ bread: 4_999 });
    expect(boosts([festival(30_000, 1, ['bread'])], 100, RULES)).toEqual({ bread: 5_000 });
    expect(boosts([festival(5, 7, ['bread'])], 100, RULES)).toEqual({ bread: 0 });
  });

  it('bornée : montant et durée ramenés aux maximums en vigueur, fêtes d’un même bien plafonnées ensemble', () => {
    expect(
      boosts([festival(30_000, 7, ['bread'])], 101, { ...RULES, maxOboles: 15_000, maxDays: 1 }),
    ).toEqual({});
    expect(boosts([festival(60_000, 2, ['bread'])], 100, { ...RULES, maxOboles: 15_000 })).toEqual({
      bread: 2_500,
    });
    const both = [festival(30_000, 1, ['bread']), festival(30_000, 2, ['bread', 'fish'])];
    expect(boosts(both, 100, RULES)).toEqual({ bread: 5_000, fish: 2_500 });
    expect(boosts(both, 101, RULES)).toEqual({ bread: 2_500, fish: 2_500 });
    // Modèle fermé, ou hausse absente ou nulle : aucune hausse.
    expect(boosts(both, 100, undefined)).toEqual({});
    expect(boosts(both, 100, { maxOboles: 30_000, maxDays: 7 })).toEqual({});
    expect(boosts(both, 100, { ...RULES, demandBoostBps: 0 })).toEqual({});
  });

  it('propriétés : jamais plus que la hausse de la configuration, nulle hors des jours de la fête', () => {
    const anyFestival = fc.record({
      amountOboles: fc.integer({ min: 1, max: 1_000_000_000_000 }),
      days: fc.integer({ min: 1, max: 366 }),
      goodIds: fc.uniqueArray(fc.constantFrom<string>('bread', 'wine', 'fish'), { minLength: 1 }),
      settledDay: fc.integer({ min: 0, max: 50 }),
    });
    const rules = fc.record({
      maxOboles: fc.integer({ min: 1, max: 1_000_000_000_000 }),
      maxDays: fc.integer({ min: 1, max: 366 }),
      demandBoostBps: fc.integer({ min: 0, max: 10_000 }),
    });
    fc.assert(
      fc.property(
        fc.array(anyFestival, { maxLength: 5 }),
        fc.integer({ min: 0, max: 500 }),
        rules,
        (all, day, given) => {
          for (const [goodId, boost] of festivalDemandBoosts(all, day, given)) {
            expect(Number.isInteger(boost) && boost >= 0 && boost <= given.demandBoostBps).toBe(
              true,
            );
            const active = all.filter(
              (one) =>
                one.goodIds.includes(goodId) &&
                day >= one.settledDay &&
                day < one.settledDay + Math.min(one.days, given.maxDays),
            );
            expect(active.length).toBeGreaterThan(0);
          }
        },
      ),
    );
  });

  it('demande et budget relevés : budget entier, arrondi vers le bas, jamais au-delà de la hausse', () => {
    expect(boostedDemand(10, 2_500)).toBe(12.5);
    expect(boostedDemand(10, 0)).toBe(10);
    expect(boostedBudget(99, 2_500)).toBe(123);
    expect(boostedBudget(0, 5_000)).toBe(0);
    expect(boostedBudget(Number.MAX_SAFE_INTEGER, 0)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => boostedBudget(1.5, 0)).toThrow(RangeError);
    expect(() => boostedBudget(10, -1)).toThrow(RangeError);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 40 }),
        fc.integer({ min: 0, max: 10_000 }),
        (budget, bps) => {
          const raised = boostedBudget(budget, bps);
          expect(raised >= budget).toBe(true);
          expect(BigInt(raised) * 10_000n <= BigInt(budget) * BigInt(10_000 + bps)).toBe(true);
          expect(BigInt(raised + 1) * 10_000n > BigInt(budget) * BigInt(10_000 + bps)).toBe(true);
        },
      ),
    );
  });
});
