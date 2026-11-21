import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HUBRIS_CAUSES,
  hubrisDelta,
  medianWealth,
  type HubrisDay,
  type HubrisWeights,
} from './hubris';

const MAX = Number.MAX_SAFE_INTEGER;
const NEUTRAL: HubrisWeights = {
  marketShareThresholdBps: 3_500,
  wealthMultipleBps: 30_000,
  marketShareWeight: 0,
  wealthWeight: 0,
  leviedLiturgyWeight: 0,
  offeringReliefBps: 0,
  performedLiturgyRelief: 0,
  dailyDecay: 0,
};
const QUIET: HubrisDay = {
  markets: [],
  wealth: 0n,
  medianWealth: 0n,
  leviedLiturgies: 0,
  offeredOboles: 0n,
  performedLiturgies: 0,
  splendorOboles: 0n,
};
const after = (gauge: number, day: HubrisDay, rules: HubrisWeights) =>
  hubrisDelta(gauge, day, rules).reduce((level, change) => level + change.amount, gauge);

const weights = fc.record({
  marketShareThresholdBps: fc.integer({ min: 0, max: 10_000 }),
  wealthMultipleBps: fc.integer({ min: 10_000, max: 1_000_000_000 }),
  marketShareWeight: fc.integer({ min: 0, max: 1_000_000_000 }),
  wealthWeight: fc.integer({ min: 0, max: 1_000_000_000 }),
  leviedLiturgyWeight: fc.integer({ min: 0, max: 1_000_000_000 }),
  offeringReliefBps: fc.integer({ min: 0, max: 1_000_000_000 }),
  performedLiturgyRelief: fc.integer({ min: 0, max: 1_000_000_000 }),
  dailyDecay: fc.integer({ min: 0, max: 1_000_000_000 }),
});
const market = fc
  .record({
    sold: fc.bigInt({ min: 0n, max: 2n ** 40n }),
    rest: fc.bigInt({ min: 0n, max: 2n ** 40n }),
  })
  .filter(({ sold, rest }) => sold + rest > 0n)
  .map(({ sold, rest }) => ({ sold, total: sold + rest }));
const oboles = fc.bigInt({ min: 0n, max: 2n ** 53n });
const day = fc.record({
  markets: fc.array(market, { maxLength: 6 }),
  wealth: fc.bigInt({ min: -(2n ** 50n), max: 2n ** 62n }),
  medianWealth: fc.bigInt({ min: -(2n ** 40n), max: 2n ** 50n }),
  leviedLiturgies: fc.integer({ min: 0, max: 5 }),
  offeredOboles: oboles,
  performedLiturgies: fc.integer({ min: 0, max: 5 }),
  splendorOboles: oboles,
});
const gauge = fc.oneof(
  fc.integer({ min: 0, max: 1_000_000 }),
  fc.integer({ min: 0, max: MAX }),
  fc.constantFrom(0, MAX),
);

describe('variation de l’Hybris (7.2, #734)', () => {
  it('exemples : seuils, arrondis vers le bas, ordre des causes, rognées à zéro et au maximum', () => {
    const rules = {
      ...NEUTRAL,
      marketShareWeight: 10_000,
      wealthWeight: 100,
      leviedLiturgyWeight: 50,
      offeringReliefBps: 100,
      performedLiturgyRelief: 7,
      dailyDecay: 3,
    };
    const deltaOf = (gauge: number, seen: Partial<HubrisDay>) =>
      hubrisDelta(gauge, { ...QUIET, ...seen }, rules).map((c) => `${c.cause}:${c.amount}`);
    const sales = (...markets: [bigint, bigint][]) => ({
      markets: markets.map(([sold, total]) => ({ sold, total })),
    });
    // 36 % des ventes : 100 points au-delà du seuil, 100 au poids de 10 000 par part entière ; puis le déclin.
    expect(deltaOf(0, sales([36n, 100n]))).toEqual(['market_share:100', 'decay:-3']);
    // Au seuil exact, ou un dixième de point au-delà, qui ne fait pas une unité : rien, et une jauge vide ne décline pas.
    expect(deltaOf(0, sales([35n, 100n]))).toEqual([]);
    expect(deltaOf(0, sales([35_001n, 100_000n]))).toEqual([]);
    // Deux marchés s'ajoutent, chacun arrondi pour lui-même.
    expect(deltaOf(0, sales([10n, 10n], [1n, 2n]))).toEqual(['market_share:8000', 'decay:-3']);
    // Fortune de 5 médianes pour un multiple de 3 : 2 médianes de trop, 200 au poids de 100.
    expect(deltaOf(7, { wealth: 500n, medianWealth: 100n })).toEqual(['wealth:200', 'decay:-3']);
    expect(deltaOf(7, { wealth: 300n, medianWealth: 100n })).toEqual(['decay:-3']);
    // Médiane nulle ou négative : la fortune ne compte pas.
    expect(deltaOf(7, { wealth: 10n ** 15n, medianWealth: 0n })).toEqual(['decay:-3']);
    expect(deltaOf(7, { wealth: 10n ** 15n, medianWealth: -5n })).toEqual(['decay:-3']);
    // Gains d'abord, baisses ensuite : rien ne s'éponge d'avance sur une jauge vide. 25,5 et 7 + 1,99 arrondis.
    const acts = {
      leviedLiturgies: 2,
      offeredOboles: 2_550n,
      performedLiturgies: 1,
      splendorOboles: 199n,
    };
    expect(deltaOf(0, acts)).toEqual([
      'liturgy_levied:100',
      'offering:-25',
      'liturgy_performed:-8',
      'decay:-3',
    ]);
    // Rognées : une baisse jusqu'à zéro, un gain jusqu'au plus grand entier sûr.
    expect(deltaOf(10, { offeredOboles: 100_000n })).toEqual(['offering:-10']);
    expect(deltaOf(MAX - 5, { leviedLiturgies: 1 })).toEqual(['liturgy_levied:5', 'decay:-3']);
  });

  it('entrées invalides refusées', () => {
    for (const [gauge, seen, rules] of [
      [-1, {}, {}],
      [0.5, {}, {}],
      [MAX + 1, {}, {}],
      [0, { markets: [{ sold: 3n, total: 2n }] }, {}],
      [0, { markets: [{ sold: -1n, total: 2n }] }, {}],
      [0, { offeredOboles: -1n }, {}],
      [0, { leviedLiturgies: -1 }, {}],
      [0, {}, { dailyDecay: -1 }],
    ] as const)
      expect(() => hubrisDelta(gauge, { ...QUIET, ...seen }, { ...NEUTRAL, ...rules })).toThrow(
        RangeError,
      );
  });

  it('propriété : poids, baisses et déclin nuls ne changent rien', () => {
    fc.assert(
      fc.property(gauge, day, (level, seen) => hubrisDelta(level, seen, NEUTRAL).length === 0),
    );
  });

  it('propriété : jauge entre zéro et le plus grand entier sûr ; causes dans l’ordre, une fois, de leur signe', () => {
    fc.assert(
      fc.property(gauge, day, weights, (level, seen, rules) => {
        let current = level;
        const changes = hubrisDelta(level, seen, rules);
        const order = changes.map((change) => HUBRIS_CAUSES.indexOf(change.cause));
        expect(order).toEqual([...new Set(order)].sort((a, b) => a - b));
        for (const change of changes) {
          expect(Number.isSafeInteger(change.amount) && change.amount !== 0).toBe(true);
          expect(change.amount > 0).toBe(HUBRIS_CAUSES.indexOf(change.cause) < 3);
          current += change.amount;
          expect(current >= 0 && current <= MAX).toBe(true);
        }
      }),
    );
  });

  it('propriété : nulle sous les seuils de part de marché et de fortune', () => {
    fc.assert(
      fc.property(gauge, day, weights, (level, seen, rules) => {
        const under: HubrisDay = {
          ...seen,
          markets: seen.markets.map(({ total }) => ({
            total,
            sold: (total * BigInt(rules.marketShareThresholdBps)) / 10_000n,
          })),
          wealth:
            seen.medianWealth > 0n
              ? (seen.medianWealth * BigInt(rules.wealthMultipleBps)) / 10_000n
              : seen.wealth,
        };
        const causes = hubrisDelta(level, under, rules).map((change) => change.cause);
        expect(causes).not.toContain('market_share');
        expect(causes).not.toContain('wealth');
      }),
    );
  });

  it('propriété : croissante avec chaque part de marché', () => {
    fc.assert(
      fc.property(
        gauge,
        day,
        weights,
        market,
        fc.bigInt({ min: 0n, max: 2n ** 40n }),
        (level, seen, rules, { sold, total }, more) => {
          const extra = more > total - sold ? total - sold : more;
          const less = { ...seen, markets: [...seen.markets, { sold, total }] };
          const larger = { ...seen, markets: [...seen.markets, { sold: sold + extra, total }] };
          expect(after(level, larger, rules)).toBeGreaterThanOrEqual(after(level, less, rules));
          // Un marché de plus ne fait jamais baisser la jauge.
          expect(after(level, less, rules)).toBeGreaterThanOrEqual(after(level, seen, rules));
        },
      ),
    );
  });

  it('propriété : croissante avec la fortune et les prélèvements, décroissante avec offrandes et mécénat', () => {
    fc.assert(
      fc.property(gauge, day, weights, oboles, fc.nat(5), (level, seen, rules, more, n) => {
        const base = after(level, seen, rules);
        const patched = (patch: Partial<HubrisDay>) => after(level, { ...seen, ...patch }, rules);
        expect(patched({ wealth: seen.wealth + more })).toBeGreaterThanOrEqual(base);
        expect(patched({ leviedLiturgies: seen.leviedLiturgies + n })).toBeGreaterThanOrEqual(base);
        expect(patched({ offeredOboles: seen.offeredOboles + more })).toBeLessThanOrEqual(base);
        expect(patched({ splendorOboles: seen.splendorOboles + more })).toBeLessThanOrEqual(base);
        expect(patched({ performedLiturgies: seen.performedLiturgies + n })).toBeLessThanOrEqual(
          base,
        );
      }),
    );
  });
});

describe('fortune médiane (#734)', () => {
  it('exemples : impair, pair arrondi vers le bas, négatif, vide', () => {
    expect(medianWealth([])).toBe(0n);
    expect(medianWealth([5n])).toBe(5n);
    expect(medianWealth([9n, 1n, 5n])).toBe(5n);
    expect(medianWealth([1n, 4n])).toBe(2n);
    expect(medianWealth([-3n, 0n])).toBe(-2n);
    expect(medianWealth([-4n, 0n])).toBe(-2n);
    expect(medianWealth([0n, 0n, 0n, 10n ** 18n])).toBe(0n);
  });

  it('propriété : entre les deux fortunes du milieu, indépendante de l’ordre', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -(2n ** 62n), max: 2n ** 62n }), { minLength: 1, maxLength: 30 }),
        (values) => {
          const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          const median = medianWealth(values);
          const low = sorted[(sorted.length - 1) >> 1] ?? 0n;
          const high = sorted[sorted.length >> 1] ?? 0n;
          expect(median >= low && median <= high).toBe(true);
          expect(medianWealth([...values].reverse())).toBe(median);
        },
      ),
    );
  });
});
