import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { giniBps, giniFraction, houseWealth, wealthInequality } from './wealth';

/** Fortunes de une à quarante maisons, au-delà des entiers sûrs, zéros compris. */
const wealth = fc.oneof(fc.constantFrom(0n, 1n), fc.bigInt({ min: 0n, max: 2n ** 62n }));
const wealths = fc.array(wealth, { minLength: 1, maxLength: 40 });
/** a ÷ b < c ÷ d, dénominateurs positifs. */
const below = ([a, b]: readonly [bigint, bigint], [c, d]: readonly [bigint, bigint]) =>
  a * d < c * b;
/** Gini exact recalculé par la définition, Σᵢ Σⱼ |xᵢ − xⱼ| ÷ (2 n Σ x). */
function naive(xs: readonly bigint[]): [bigint, bigint] {
  const total = xs.reduce((sum, x) => sum + x, 0n);
  let spread = 0n;
  for (const x of xs) for (const y of xs) spread += x > y ? x - y : y - x;
  return [spread, 2n * BigInt(xs.length) * total];
}

describe('fortune d’une maison', () => {
  it('exemples : trésorerie, séquestre et stocks au prix observé ; un stock sans prix compté à part', () => {
    const stocks = [
      { quantity: 100n, unitPrice: 8n },
      { quantity: 5n, unitPrice: null },
      { quantity: 0n, unitPrice: null },
      { quantity: 0n, unitPrice: 40n },
      { quantity: 3n, unitPrice: 1n },
    ];
    expect(houseWealth({ treasury: 2_346n, escrow: 40n, stocks })).toEqual({
      treasury: 2_346n,
      escrow: 40n,
      stockValue: 803n,
      unpricedStocks: 1,
      debt: 0n,
      wealth: 3_189n,
    });
    // Solde nul partout : fortune nulle, sans stock sans prix.
    expect(houseWealth({ treasury: 0n, escrow: 0n, stocks: [] })).toEqual({
      treasury: 0n,
      escrow: 0n,
      stockValue: 0n,
      unpricedStocks: 0,
      debt: 0n,
      wealth: 0n,
    });
    // Un prêt (#724) : le reste dû se déduit, jusqu'à une fortune négative ; une dette négative n'a pas de sens.
    expect(houseWealth({ treasury: 1_000n, escrow: 0n, stocks, debt: 1_100n })).toMatchObject({
      debt: 1_100n,
      wealth: 703n,
    });
    expect(houseWealth({ treasury: 1_000n, escrow: 0n, stocks: [], debt: 1_100n }).wealth).toBe(
      -100n,
    );
    expect(() => houseWealth({ treasury: 0n, escrow: 0n, stocks: [], debt: -1n })).toThrow(
      RangeError,
    );
  });

  it('propriété : un stock sans prix ne change pas la fortune, il n’ajoute qu’au compte des stocks sans prix', () => {
    const stock = fc.record({
      quantity: fc.bigInt({ min: 0n, max: 2n ** 40n }),
      unitPrice: fc.option(fc.bigInt({ min: 1n, max: 2n ** 20n }), { nil: null }),
    });
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 60n }),
        fc.bigInt({ min: 0n, max: 2n ** 60n }),
        fc.array(stock, { maxLength: 20 }),
        fc.bigInt({ min: 1n, max: 2n ** 40n }),
        (treasury, escrow, stocks, quantity) => {
          const before = houseWealth({ treasury, escrow, stocks });
          const after = houseWealth({
            treasury,
            escrow,
            stocks: [...stocks, { quantity, unitPrice: null }],
          });
          expect(after.wealth).toBe(before.wealth);
          expect(after.unpricedStocks).toBe(before.unpricedStocks + 1);
          // Fortune = trésorerie + séquestre + Σ quantité × prix des stocks qui ont un prix.
          const priced = stocks.reduce((sum, s) => sum + s.quantity * (s.unitPrice ?? 0n), 0n);
          expect(before.wealth).toBe(treasury + escrow + priced);
        },
      ),
    );
  });
});

describe('coefficient de Gini des fortunes', () => {
  it('exemples : égalité, une maison qui a tout, arrondi au point le plus proche', () => {
    expect(giniBps([])).toBeNull();
    expect(giniBps([0n])).toBe(0);
    expect(giniBps([0n, 0n, 0n])).toBe(0);
    expect(giniBps([500n, 500n])).toBe(0);
    expect(giniBps([0n, 100n])).toBe(5_000);
    expect(giniBps([0n, 0n, 0n, 7n])).toBe(7_500);
    // 1, 2, 3 : Σ|xᵢ − xⱼ| = 8, 2 n Σ x = 36 ; 2 222,2… points.
    expect(giniBps([3n, 1n, 2n])).toBe(2_222);
    // 1 ÷ 6 = 1 666,66… points : arrondi vers le haut.
    expect(giniBps([1n, 1n, 2n])).toBe(1_667);
    // Demi-point : 0, 0, …, 1 sur 20 000 maisons = 9 999,5 points, arrondi à 10 000.
    expect(giniBps([...Array.from({ length: 19_999 }, () => 0n), 1n])).toBe(10_000);
    // Une fortune négative compte pour zéro.
    expect(giniBps([-50n, 100n])).toBe(5_000);
  });

  it('propriété : la fraction triée égale la définition, entre 0 et (n − 1) ÷ n', () => {
    fc.assert(
      fc.property(wealths, (xs) => {
        const gini = giniFraction(xs);
        if (!gini) throw new Error('unreachable');
        const [num, den] = naive(xs);
        if (den === 0n) expect(gini).toEqual([0n, 1n]);
        else expect(gini[0] * den).toBe(num * gini[1]);
        const n = BigInt(xs.length);
        expect(gini[0] >= 0n).toBe(true);
        expect(gini[0] * n <= (n - 1n) * gini[1]).toBe(true);
        const bps = giniBps(xs) ?? -1;
        expect(bps).toBeGreaterThanOrEqual(0);
        expect(bps).toBeLessThanOrEqual(10_000);
      }),
    );
  });

  it('propriété : nul pour des fortunes égales, quel que soit leur nombre', () => {
    fc.assert(
      fc.property(wealth, fc.integer({ min: 1, max: 200 }), (x, n) => {
        expect(giniBps(Array.from({ length: n }, () => x))).toBe(0);
      }),
    );
  });

  it('propriété : ne dépend ni de l’ordre des maisons ni de l’échelle des fortunes', () => {
    fc.assert(
      fc.property(wealths, fc.bigInt({ min: 1n, max: 1_000_000n }), fc.nat(), (xs, k, shift) => {
        const turned = xs.map((_, i) => xs[(i + shift) % xs.length] ?? 0n).reverse();
        expect(giniBps(turned)).toBe(giniBps(xs));
        expect(giniBps(xs.map((x) => x * k))).toBe(giniBps(xs));
      }),
    );
  });

  it('propriété : croissant quand une fortune passe d’une maison pauvre à une plus riche', () => {
    fc.assert(
      fc.property(
        fc.array(wealth, { minLength: 2, maxLength: 40 }),
        fc.nat(),
        fc.nat(),
        fc.bigInt({ min: 1n, max: 2n ** 62n }),
        (xs, i, j, amount) => {
          const [a, b] = [i % xs.length, j % xs.length];
          if (a === b) return;
          // `poor` n'est pas plus riche que `rich`, et lui cède au plus ce qu'il a.
          const [poor, rich] = (xs[a] ?? 0n) <= (xs[b] ?? 0n) ? [a, b] : [b, a];
          const moved = amount > (xs[poor] ?? 0n) ? (xs[poor] ?? 0n) : amount;
          if (moved === 0n) return;
          const after = xs.map((x, k) => (k === poor ? x - moved : k === rich ? x + moved : x));
          const [before, then] = [giniFraction(xs), giniFraction(after)];
          if (!before || !then) throw new Error('unreachable');
          // Strictement en fraction exacte, et jamais à rebours une fois arrondi.
          expect(below(before, then)).toBe(true);
          expect(giniBps(after)).toBeGreaterThanOrEqual(giniBps(xs) ?? 0);
        },
      ),
    );
  });

  it('les maisons PNJ de secours n’entrent pas dans l’inégalité', () => {
    const players = [
      { npc: false, wealth: 100n },
      { npc: false, wealth: 300n },
    ];
    const npc = { npc: true, wealth: 1_000_000n };
    expect(wealthInequality(players)).toEqual({ houses: 2, giniBps: 2_500 });
    expect(wealthInequality([npc, ...players, npc])).toEqual({ houses: 2, giniBps: 2_500 });
    expect(wealthInequality([npc])).toEqual({ houses: 0, giniBps: null });
    fc.assert(
      fc.property(wealths, fc.array(wealth, { maxLength: 10 }), (xs, npcs) => {
        const mixed = [
          ...xs.map((w) => ({ npc: false, wealth: w })),
          ...npcs.map((w) => ({ npc: true, wealth: w })),
        ];
        expect(wealthInequality(mixed)).toEqual({ houses: xs.length, giniBps: giniBps(xs) });
      }),
    );
  });
});
