import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classDemand, matchNpcDemand, npcGoodBudget, wholeUnits, type Ask } from './demand';

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

  it('qualité aux bornes, et entrées hors domaine refusées', () => {
    // À qualité nulle et sensibilité maximale, la demande s'annule exactement ; elle n'est jamais négative.
    expect(classDemand({ ...bread, price: 15, quality: 0, qualitySensitivity: 1 })).toBe(0);
    for (const quality of [-1, 101, 150, Number.NaN]) {
      expect(() => classDemand({ ...bread, price: 15, quality })).toThrow(RangeError);
    }
    for (const price of [0, -6, Number.NaN, Infinity]) {
      expect(() => classDemand({ ...bread, price })).toThrow(RangeError);
    }
    expect(() => classDemand({ ...bread, price: 15, referencePrice: 0 })).toThrow(RangeError);
  });

  it('wholeUnits : tolérance d’arrondi minuscule, entrées invalides refusées', () => {
    expect(wholeUnits(3 - 1e-12, 0).units).toBe(3);
    expect(wholeUnits(0.9995, 0)).toEqual({ units: 0, carry: 0.9995 });
    expect(wholeUnits(0.1 + 0.2, 0.7).units).toBe(1);
    for (const [demand, carry] of [
      [-5, 0],
      [Number.NaN, 0],
      [Infinity, 0],
      [1, -0.1],
      [1, 1],
    ] as const) {
      expect(() => wholeUnits(demand, carry)).toThrow(RangeError);
    }
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
  const UNLIMITED = Number.MAX_SAFE_INTEGER;

  it('sert les offres de la moins chère à la plus chère, la plus ancienne d’abord, au prix du vendeur', () => {
    const frozen = Object.freeze([...asks]);
    expect(matchNpcDemand({ asks: frozen, demandAt, budget: UNLIMITED, carry: 0 })).toEqual({
      fills: [
        { orderId: 'ancien', price: 6, quantity: 50 },
        { orderId: 'récent', price: 6, quantity: 50 },
        { orderId: 'moyen', price: 7, quantity: 40 },
      ],
      spent: 880,
      carry: 0,
    });
  });

  it('le budget plafonne la dépense, même si un vendeur demande un prix démesuré', () => {
    expect(matchNpcDemand({ asks, demandAt, budget: 500, carry: 0 })).toMatchObject({
      fills: [
        { orderId: 'ancien', price: 6, quantity: 50 },
        { orderId: 'récent', price: 6, quantity: 33 },
      ],
      spent: 498,
    });
    // Formule 5.2 pour le blé de Kallistè, avec ses valeurs d'avant le calibrage de #78 : sans budget, 1 unité s'achèterait encore à 2 millions d'oboles.
    const wheat = (price: number) => 174 * (price / 6) ** -0.4;
    const greedy = [{ orderId: 'rente', price: 2_000_000, quantity: 10 }];
    expect(
      matchNpcDemand({ asks: greedy, demandAt: wheat, budget: UNLIMITED, carry: 0 }).spent,
    ).toBe(2_000_000);
    expect(matchNpcDemand({ asks: greedy, demandAt: wheat, budget: 1305, carry: 0 })).toMatchObject(
      { fills: [], spent: 0 },
    );
  });

  it('reporte la fraction d’un tick à l’autre : une demande de 0,9 ou de 1,86 par tick est servie sur la durée', () => {
    for (const [perTick, ticks, expected] of [
      [0.9, 1000, 900],
      [1.86, 100, 186],
    ] as const) {
      let [carry, bought] = [0, 0];
      for (let tick = 0; tick < ticks; tick++) {
        const book = [{ orderId: 'a', price: 5, quantity: 1000 }];
        const purchase = matchNpcDemand({
          asks: book,
          demandAt: () => perTick,
          budget: UNLIMITED,
          carry,
        });
        carry = purchase.carry;
        bought += purchase.fills.reduce((sum, fill) => sum + fill.quantity, 0);
      }
      expect(Math.abs(bought - expected)).toBeLessThanOrEqual(1);
    }
    // Carnet vide : le report est conservé tel quel, la demande non servie ne s'accumule pas.
    expect(matchNpcDemand({ asks: [], demandAt, budget: UNLIMITED, carry: 0.4 })).toEqual({
      fills: [],
      spent: 0,
      carry: 0.4,
    });
  });

  it('propriété : jamais plus que la demande au prix payé, jamais plus que le budget, jamais plus que l’offre', () => {
    const row = fc.record({
      price: fc.integer({ min: 1, max: 30 }),
      quantity: fc.integer({ min: 0, max: 100 }),
    });
    fc.assert(
      fc.property(
        fc.array(row, { maxLength: 15 }),
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.integer({ min: 0, max: 5000 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (rows, base, budget, carry) => {
          const book = rows.map((entry, position) => ({ ...entry, orderId: String(position) }));
          // Demande réelle, non entière, décroissante avec le prix.
          const demand = (price: number) => Math.max(0, base - price * 9.37);
          const {
            fills,
            spent,
            carry: nextCarry,
          } = matchNpcDemand({ asks: book, demandAt: demand, budget, carry });
          let bought = 0;
          for (const fill of fills) {
            bought += fill.quantity;
            expect(fill.quantity).toBeGreaterThan(0);
            expect(bought).toBeLessThanOrEqual(demand(fill.price) + carry + 1e-6);
            const ask = book.find((candidate) => candidate.orderId === fill.orderId);
            expect(fill.quantity).toBeLessThanOrEqual(ask?.quantity ?? 0);
            expect(fill.price).toBe(ask?.price);
          }
          expect(spent).toBe(fills.reduce((sum, fill) => sum + fill.price * fill.quantity, 0));
          expect(spent).toBeLessThanOrEqual(budget);
          expect(nextCarry >= 0 && nextCarry < 1).toBe(true);
          // Prix croissants : aucune offre moins chère n'est laissée de côté au profit d'une plus chère.
          const prices = fills.map((fill) => fill.price);
          expect(prices).toEqual([...prices].sort((a, b) => a - b));
        },
      ),
    );
  });

  it('refuse un budget, une offre, une demande ou un report invalides', () => {
    const book = [{ orderId: 'a', price: 5, quantity: 10 }];
    expect(() => matchNpcDemand({ asks: book, demandAt, budget: -1, carry: 0 })).toThrow(
      RangeError,
    );
    expect(() => matchNpcDemand({ asks: book, demandAt, budget: 10.5, carry: 0 })).toThrow(
      RangeError,
    );
    expect(() => matchNpcDemand({ asks: book, demandAt, budget: 100, carry: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      matchNpcDemand({ asks: book, demandAt: () => Number.NaN, budget: 100, carry: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      matchNpcDemand({ asks: book, demandAt: () => Infinity, budget: 100, carry: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      matchNpcDemand({
        asks: [{ orderId: 'x', price: -3, quantity: 1 }],
        demandAt,
        budget: 100,
        carry: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      matchNpcDemand({
        asks: [{ orderId: 'x', price: 3, quantity: 1.5 }],
        demandAt,
        budget: 100,
        carry: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe('budget des PNJ par bien (5.2)', () => {
  const prices: Record<string, number> = { wheat: 6, bread: 15, wine: 36 };
  const price = (goodId: string) => prices[goodId] ?? 0;
  const poor = {
    population: 6000,
    incomePerThousand: 500,
    basket: [
      { goodId: 'wheat', quantityPerThousand: 25 }, // 150 oboles de référence
      { goodId: 'bread', quantityPerThousand: 10 }, // 150
    ],
  };
  const rich = {
    population: 500,
    incomePerThousand: 2000,
    basket: [
      { goodId: 'bread', quantityPerThousand: 20 }, // 300
      { goodId: 'wine', quantityPerThousand: 25 }, // 900
    ],
  };

  it('répartit le revenu de chaque classe au prorata de la dépense de référence', () => {
    expect(npcGoodBudget([poor], 'wheat', price)).toBe(1500);
    expect(npcGoodBudget([poor, rich], 'bread', price)).toBe(1500 + 250);
    expect(npcGoodBudget([poor, rich], 'wine', price)).toBe(750);
  });

  it('vaut zéro pour un bien hors de tout panier ou une cité vide', () => {
    expect(npcGoodBudget([poor, rich], 'fish', price)).toBe(0);
    expect(npcGoodBudget([{ ...poor, population: 0 }], 'wheat', price)).toBe(0);
  });

  it('arrondit vers le bas : jamais plus que le revenu', () => {
    expect(npcGoodBudget([{ ...poor, population: 1001 }], 'wheat', price)).toBe(250);
  });

  it('refuse un bien du panier sans prix de référence', () => {
    expect(() => npcGoodBudget([poor], 'wheat', () => 0)).toThrow(RangeError);
  });

  it('propriété : la somme des budgets des biens ne dépasse jamais le revenu de la cité', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 5000 }),
        (poorCount, richCount, income) => {
          const classes = [
            { ...poor, population: poorCount, incomePerThousand: income },
            { ...rich, population: richCount },
          ];
          const total = ['wheat', 'bread', 'wine']
            .map((goodId) => npcGoodBudget(classes, goodId, price))
            .reduce((sum, value) => sum + value, 0);
          const revenue = (poorCount * income + richCount * rich.incomePerThousand) / 1000;
          expect(total).toBeLessThanOrEqual(revenue + 1e-6);
          expect(total).toBeGreaterThan(revenue - 3);
        },
      ),
    );
  });
});
