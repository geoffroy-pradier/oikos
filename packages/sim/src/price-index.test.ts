import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { basketCost, costRatioBps, inflationStatus, type Traded } from './price-index';

type Rows = Record<string, [turnover: bigint, volume: bigint]>;
const traded = (rows: Rows) =>
  new Map<string, Traded>(
    Object.entries(rows).map(([id, [turnover, volume]]) => [id, { turnover, volume }]),
  );
const BASKET = [
  { goodId: 'wheat', quantity: 3 },
  { goodId: 'bread', quantity: 1 },
];
/** Panier de un à six biens, et pour chacun ses échanges (montants au-delà des entiers sûrs). */
const amount = fc.bigInt({ min: 1n, max: 2n ** 60n });
const market = fc
  .array(fc.tuple(fc.integer({ min: 1, max: 1_000_000 }), amount, amount), {
    minLength: 1,
    maxLength: 6,
  })
  .map((goods) => ({
    basket: goods.map(([quantity], index) => ({ goodId: `good_${index}`, quantity })),
    rows: Object.fromEntries(goods.map(([, t, v], index) => [`good_${index}`, [t, v]])) as Rows,
  }));

describe('indice des prix', () => {
  it('exemples : prix moyens fractionnaires, arrondi au point de base le plus proche', () => {
    // Blé à 20 ÷ 3 oboles, pain à 16 : panier à 36 contre 33 au prix de référence (6 et 15).
    const reference = basketCost(BASKET, traded({ wheat: [6n, 1n], bread: [15n, 1n] }));
    const current = basketCost(BASKET, traded({ wheat: [20n, 3n], bread: [32n, 2n] }));
    expect(reference).toEqual([33n, 1n]);
    expect(costRatioBps(current, reference)).toBe(10_909); // 36 ÷ 33 = 1,090909…
    expect(costRatioBps(reference, current)).toBe(9_167); // 0,91666…
    // Le demi-point monte : 20 001 ÷ 20 000 = 10 000,5 points ; juste en dessous, il descend.
    expect(costRatioBps([20_001n, 1n], [20_000n, 1n])).toBe(10_001);
    expect(costRatioBps([40_001n, 2n], [20_001n, 1n])).toBe(10_000);
  });

  it('jamais de prix inventé : panier vide, bien sans échange ou sans montant, coût inconnu', () => {
    expect(basketCost([], traded({ wheat: [6n, 1n] }))).toBeNull();
    expect(basketCost(BASKET, traded({ wheat: [6n, 1n] }))).toBeNull();
    expect(basketCost(BASKET, traded({ wheat: [6n, 1n], bread: [15n, 0n] }))).toBeNull();
    expect(basketCost(BASKET, traded({ wheat: [0n, 1n], bread: [15n, 1n] }))).toBeNull();
    expect([costRatioBps(null, [1n, 1n]), costRatioBps([1n, 1n], null)]).toEqual([null, null]);
  });

  it('propriétés : identité, proportionnalité, indifférence au volume, croissance en prix', () => {
    fc.assert(
      fc.property(
        market,
        fc.integer({ min: 2, max: 1_000 }),
        fc.nat(5),
        ({ basket, rows }, factor, pick) => {
          const base = basketCost(basket, traded(rows));
          /** Indice, contre `base`, du marché dont les montants et les unités (d'un bien ou de tous) sont multipliés. */
          const scaled = (turnover: number, volume: number, only?: string) => {
            const scale = ([id, [t, v]]: [string, [bigint, bigint]]): [string, [bigint, bigint]] =>
              only && only !== id ? [id, [t, v]] : [id, [t * BigInt(turnover), v * BigInt(volume)]];
            const cost = basketCost(
              basket,
              traded(Object.fromEntries(Object.entries(rows).map(scale))),
            );
            return costRatioBps(cost, base) ?? Number.NaN;
          };
          expect(scaled(1, 1)).toBe(10_000);
          // Tous les prix multipliés par k : l'indice vaut exactement k ; divisés : son inverse arrondi.
          expect(scaled(factor, 1)).toBe(10_000 * factor);
          expect(scaled(1, factor)).toBe(Math.round(10_000 / factor));
          // Mêmes prix sur des volumes différents : même coût.
          expect(scaled(factor, factor)).toBe(10_000);
          // Un seul bien plus cher : l'indice ne baisse pas, et reste sous celui de la hausse générale.
          const single = scaled(factor, 1, `good_${pick % basket.length}`);
          expect(single).toBeGreaterThanOrEqual(10_000);
          expect(single).toBeLessThanOrEqual(10_000 * factor);
        },
      ),
    );
  });

  it('cible d’inflation : bornes comprises, inconnue sans mesure', () => {
    const status = (bps: number | null, min = 0, max = 300) => inflationStatus(bps, { min, max });
    expect([-1, 0, 150, 300, 301].map((bps) => status(bps))).toEqual([
      'below',
      'in_target',
      'in_target',
      'in_target',
      'above',
    ]);
    expect([status(null), status(-50, -100, -50), status(-49, -100, -50)]).toEqual([
      'unknown',
      'in_target',
      'above',
    ]);
  });
});
