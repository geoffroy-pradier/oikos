import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_CLASS_POPULATION,
  nextPopulation,
  vitalCoverageBps,
  vitalMeasure,
  type PopulationDynamics,
} from './population';

const dynamics: PopulationDynamics = {
  vitalCoverageThresholdBps: 9_000,
  growthBps: 100,
  emigrationBps: 200,
  minShareBps: 5_000,
  maxShareBps: 20_000,
};
const anyDynamics = fc.record({
  vitalCoverageThresholdBps: fc.integer({ min: 1, max: 10_000 }),
  growthBps: fc.integer({ min: 0, max: 1_000 }),
  emigrationBps: fc.integer({ min: 0, max: 1_000 }),
  minShareBps: fc.integer({ min: 0, max: 10_000 }),
  maxShareBps: fc.integer({ min: 10_000, max: 100_000 }),
});
const people = fc.oneof(
  fc.integer({ min: 0, max: 10_000_000 }),
  fc.integer({ min: 0, max: MAX_CLASS_POPULATION }),
);
const coverage = fc.integer({ min: 0, max: 10_000 });

describe('couverture des besoins vitaux', () => {
  it('servi sur demandé, bornée à 100 %, complète sans demande', () => {
    expect(vitalCoverageBps(45, 50)).toBe(9_000);
    expect(vitalCoverageBps(0, 50)).toBe(0);
    expect(vitalCoverageBps(60, 50)).toBe(10_000);
    expect(vitalCoverageBps(0, 0)).toBe(10_000);
    expect(vitalCoverageBps(1, 3)).toBe(3_333);
    expect(() => vitalCoverageBps(-1, 3)).toThrow(RangeError);
    expect(() => vitalCoverageBps(1, Number.NaN)).toThrow(RangeError);
  });
});

describe('population d’une classe après un jour', () => {
  it('exemples : croissance au-dessus du seuil, émigration en dessous', () => {
    // 100 % de couverture : +1 % ; au seuil : rien ; 45 % (moitié du seuil) : −1 %.
    expect(nextPopulation(10_000, 10_000, 10_000, dynamics)).toBe(10_100);
    expect(nextPopulation(10_000, 10_000, 9_000, dynamics)).toBe(10_000);
    expect(nextPopulation(10_000, 10_000, 9_500, dynamics)).toBe(10_050);
    expect(nextPopulation(10_000, 10_000, 4_500, dynamics)).toBe(9_900);
    expect(nextPopulation(10_000, 10_000, 0, dynamics)).toBe(9_800);
  });

  it('arrondi vers zéro : une petite classe ne bouge pas pour une fraction d’habitant', () => {
    // 40 habitants : +0,4 et −0,8 habitant, arrondis à zéro ; 50 à couverture nulle : −1 exactement.
    expect(nextPopulation(40, 40, 10_000, dynamics)).toBe(40);
    expect(nextPopulation(40, 40, 0, dynamics)).toBe(40);
    expect(nextPopulation(50, 50, 0, dynamics)).toBe(49);
  });

  it('bornes : jamais sous la moitié ni au-dessus du double de la population initiale', () => {
    expect(nextPopulation(5_000, 10_000, 0, dynamics)).toBe(5_000);
    expect(nextPopulation(20_000, 10_000, 10_000, dynamics)).toBe(20_000);
    // Hors bornes (configuration changée) : ramenée dans les bornes.
    expect(nextPopulation(1_000, 10_000, 9_000, dynamics)).toBe(5_000);
    // Le double de la population initiale dépasserait la limite d'une classe : la limite l'emporte,
    // et le résultat reste une entrée valide du calcul du lendemain.
    const full = nextPopulation(99_500_000, 60_000_000, 10_000, dynamics);
    expect(full).toBe(MAX_CLASS_POPULATION);
    expect(nextPopulation(full, 60_000_000, 10_000, dynamics)).toBe(MAX_CLASS_POPULATION);
  });

  it('seuil à 100 % : seule une couverture complète fait croître, au taux plein', () => {
    const strict = { ...dynamics, vitalCoverageThresholdBps: 10_000 };
    expect(nextPopulation(10_000, 10_000, 10_000, strict)).toBe(10_100);
    // Juste sous le seuil : pas de croissance (le manque infime s'arrondit à zéro) ; à 50 % : −1 %.
    expect(nextPopulation(10_000, 10_000, 9_999, strict)).toBe(10_000);
    expect(nextPopulation(10_000, 10_000, 5_000, strict)).toBe(9_900);
  });

  it('propriété : toujours un entier dans les bornes', () => {
    fc.assert(
      fc.property(people, people, coverage, anyDynamics, (current, initial, cov, d) => {
        const next = nextPopulation(current, initial, cov, d);
        expect(Number.isSafeInteger(next)).toBe(true);
        expect(next).toBeGreaterThanOrEqual(Math.floor((initial * d.minShareBps) / 10_000));
        expect(next).toBeLessThanOrEqual(Math.floor((initial * d.maxShareBps) / 10_000));
        expect(next).toBeLessThanOrEqual(MAX_CLASS_POPULATION);
      }),
    );
  });

  it('propriété : croissante en couverture et en population courante', () => {
    fc.assert(
      fc.property(people, people, coverage, coverage, anyDynamics, (current, initial, a, b, d) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(nextPopulation(current, initial, low, d)).toBeLessThanOrEqual(
          nextPopulation(current, initial, high, d),
        );
      }),
    );
    fc.assert(
      fc.property(people, people, people, coverage, anyDynamics, (a, b, initial, cov, d) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(nextPopulation(low, initial, cov, d)).toBeLessThanOrEqual(
          nextPopulation(high, initial, cov, d),
        );
      }),
    );
  });

  it('propriété : dans les bornes, croît au seuil ou au-dessus, ne croît jamais en dessous', () => {
    fc.assert(
      fc.property(people, coverage, anyDynamics, (current, cov, d) => {
        // Population initiale égale à la courante : on observe la variation sans l'effet des bornes.
        const wide = { ...d, minShareBps: 0, maxShareBps: 100_000 };
        const next = nextPopulation(current, current, cov, wide);
        if (cov >= d.vitalCoverageThresholdBps) expect(next).toBeGreaterThanOrEqual(current);
        else expect(next).toBeLessThanOrEqual(current);
      }),
    );
  });

  it('refuse une entrée hors domaine', () => {
    expect(() => nextPopulation(-1, 10, 0, dynamics)).toThrow(RangeError);
    expect(() => nextPopulation(10, 10, 10_001, dynamics)).toThrow(RangeError);
    expect(() => nextPopulation(10.5, 10, 0, dynamics)).toThrow(RangeError);
    expect(() => nextPopulation(MAX_CLASS_POPULATION + 1, 10, 0, dynamics)).toThrow(RangeError);
  });
});

describe('mesure d’un tick pour la couverture des besoins vitaux', () => {
  const entry = (goodId: string, need: string, quantityPerThousand: number) => ({
    goodId,
    need,
    quantityPerThousand,
  });
  // Pain vital pour tous (20 et 10 pour mille), vin de confort pour les uns, vital pour les autres.
  const poor = { id: 'poor', population: 3_000, basket: [entry('bread', 'vital', 20)] };
  const rich = {
    id: 'rich',
    population: 1_000,
    basket: [entry('bread', 'vital', 10), entry('wine', 'vital', 4), entry('salt', 'comfort', 1)],
  };
  const drinkers = { ...poor, basket: [...poor.basket, entry('wine', 'comfort', 4)] };

  it('demandé : le besoin de référence des biens vitaux ; servi : la part de la classe dans les achats', () => {
    // 35 pains achetés pour un besoin de 60 + 10 : chacun en reçoit la moitié de son besoin.
    expect(vitalMeasure([poor, rich], new Map([['bread', 35]]))).toEqual([
      { classId: 'poor', served: 30, demanded: 60 },
      { classId: 'rich', served: 5, demanded: 14 },
    ]);
    // Le vin se partage avec ceux pour qui il n'est qu'un confort (12 et 4) ; le sel, confort, ne compte pas.
    const shared = new Map([
      ['wine', 8],
      ['salt', 9],
    ]);
    expect(vitalMeasure([drinkers, rich], shared)).toEqual([
      { classId: 'poor', served: 0, demanded: 60 },
      { classId: 'rich', served: 2, demanded: 14 },
    ]);
    // Rien d'acheté, classe vide, classe sans bien vital : rien de servi, et le besoin reste compté.
    const idle = { id: 'idle', population: 500, basket: [entry('salt', 'luxury', 1)] };
    expect(vitalMeasure([{ ...poor, population: 0 }, rich, idle], new Map())).toEqual([
      { classId: 'poor', served: 0, demanded: 0 },
      { classId: 'rich', served: 0, demanded: 14 },
      { classId: 'idle', served: 0, demanded: 0 },
    ]);
  });

  it('propriété : jamais plus d’unités servies qu’achetées ; tout est servi si le bien est vital pour tous', () => {
    const goods = ['bread', 'fish', 'salt'];
    const anyClass = (levels: string[]) =>
      fc.record({
        population: fc.integer({ min: 0, max: MAX_CLASS_POPULATION }),
        basket: fc.subarray(goods).chain((wanted) =>
          fc.tuple(
            ...wanted.map((goodId) =>
              fc.record({
                goodId: fc.constant(goodId),
                need: fc.constantFrom(...levels),
                quantityPerThousand: fc.double({ min: 0.1, max: 50, noNaN: true }),
              }),
            ),
          ),
        ),
      });
    const units = fc.dictionary(fc.constantFrom(...goods), fc.integer({ min: 0, max: 1e9 }));
    const run = (levels: string[], exact: boolean) =>
      fc.assert(
        fc.property(fc.array(anyClass(levels), { maxLength: 5 }), units, (drawn, purchases) => {
          const classes = drawn.map((npcClass, rank) => ({ ...npcClass, id: `c${rank}` }));
          const wanted = (goodId: string) =>
            classes.some((c) => c.population > 0 && c.basket.some((e) => e.goodId === goodId));
          const bought = new Map(Object.entries(purchases).filter(([goodId]) => wanted(goodId)));
          const measure = vitalMeasure(classes, bought);
          const total = [...bought.values()].reduce((sum, quantity) => sum + quantity, 0);
          const served = measure.reduce((sum, { served }) => sum + served, 0);
          expect(measure.every((m) => m.served >= 0 && Number.isFinite(m.demanded))).toBe(true);
          expect(served).toBeLessThanOrEqual(total * (1 + 1e-9));
          if (exact) expect(served).toBeGreaterThanOrEqual(total * (1 - 1e-9));
        }),
      );
    run(['vital', 'comfort', 'luxury'], false);
    run(['vital'], true);
  });
});
