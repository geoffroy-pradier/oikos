import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classDemand, matchNpcDemand, wholeUnits, type Ask } from './demand';

describe('demande des PNJ (formule 5.2)', () => {
  const bread = {
    quantityPerThousand: 30,
    population: 6000,
    referencePrice: 15,
    elasticity: 0.3,
    qualitySensitivity: 0.1,
    quality: 50,
  };

  it('au prix de référence et à qualité neutre, vaut Q0 · N', () => {
    expect(classDemand({ ...bread, price: 15 })).toBeCloseTo(180, 9);
  });

  it('suit l’élasticité : prix doublé, demande multipliée par 2^-ε', () => {
    expect(classDemand({ ...bread, price: 30 })).toBeCloseTo(180 * 2 ** -0.3, 9);
    expect(classDemand({ ...bread, price: 30, elasticity: 1.8 })).toBeCloseTo(180 * 2 ** -1.8, 9);
  });

  it('suit la qualité : (1 + β·(q-50)/50)', () => {
    expect(classDemand({ ...bread, price: 15, quality: 100, qualitySensitivity: 0.9 })).toBeCloseTo(
      180 * 1.9,
      9,
    );
    expect(classDemand({ ...bread, price: 15, quality: 0, qualitySensitivity: 0.9 })).toBeCloseTo(
      180 * 0.1,
      9,
    );
  });

  it('propriété : décroît quand le prix monte, n’est jamais négative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        fc.double({ min: 0.1, max: 3, noNaN: true }),
        (a, b, elasticity) => {
          const [low, high] = [Math.min(a, b), Math.max(a, b)];
          const [atLow, atHigh] = [low, high].map((price) =>
            classDemand({ ...bread, price, elasticity }),
          );
          expect(atHigh).toBeLessThanOrEqual(atLow as number);
          expect(atHigh).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('wholeUnits reporte la fraction : sur la durée, ni demande créée ni demande perdue', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.integer({ min: 1, max: 200 }),
        (perTick, ticks) => {
          let [carry, bought] = [0, 0];
          for (let tick = 0; tick < ticks; tick++) {
            const step = wholeUnits(perTick, carry);
            expect(Number.isInteger(step.units) && step.units >= 0).toBe(true);
            expect(step.carry).toBeGreaterThanOrEqual(0);
            expect(step.carry).toBeLessThan(1);
            [carry, bought] = [step.carry, bought + step.units];
          }
          expect(Math.abs(bought + carry - perTick * ticks)).toBeLessThan(1e-6);
        },
      ),
    );
    expect(wholeUnits(1.86, 0).units).toBe(1);
  });
});

describe('achats des PNJ dans le carnet', () => {
  const asks: Ask[] = [
    { orderId: 'cher', price: 9, quantity: 100 },
    { orderId: 'ancien', price: 6, quantity: 50 },
    { orderId: 'récent', price: 6, quantity: 50 },
    { orderId: 'moyen', price: 7, quantity: 40 },
  ];
  // Demande linéaire d'essai : 200 unités à 6 oboles, 20 de moins par obole supplémentaire.
  const demandAt = (price: number) => 200 - (price - 6) * 20;

  it('sert les offres de la moins chère à la plus chère, la plus ancienne d’abord, au prix du vendeur', () => {
    expect(matchNpcDemand(asks, demandAt)).toEqual([
      { orderId: 'ancien', price: 6, quantity: 50 },
      { orderId: 'récent', price: 6, quantity: 50 },
      { orderId: 'moyen', price: 7, quantity: 40 },
    ]);
  });

  it('n’achète jamais au-delà de la demande au prix payé', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            price: fc.integer({ min: 1, max: 30 }),
            quantity: fc.integer({ min: 1, max: 100 }),
          }),
          { maxLength: 15 },
        ),
        fc.integer({ min: 0, max: 400 }),
        (rows, base) => {
          const book = rows.map((row, index) => ({ ...row, orderId: String(index) }));
          const demand = (price: number) => Math.max(0, base - price * 10);
          const fills = matchNpcDemand(book, demand);
          let bought = 0;
          for (const fill of fills) {
            bought += fill.quantity;
            expect(bought).toBeLessThanOrEqual(demand(fill.price));
            const ask = book.find((candidate) => candidate.orderId === fill.orderId);
            expect(fill.quantity).toBeLessThanOrEqual(ask?.quantity ?? 0);
            expect(fill.price).toBe(ask?.price);
          }
          // Prix croissants : aucune offre moins chère n'est laissée de côté au profit d'une plus chère.
          expect(fills.map((fill) => fill.price)).toEqual(
            [...fills.map((fill) => fill.price)].sort((a, b) => a - b),
          );
        },
      ),
    );
  });
});
