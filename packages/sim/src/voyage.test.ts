import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cargoUnits, departureCost, portDues, voyageDurationSeconds } from './voyage';

const BPS = 10_000n;
const bps = fc.oneof(fc.constantFrom(0, 1, 9_999, 10_000), fc.integer({ min: 0, max: 10_000 }));
const coefficient = fc.oneof(
  fc.constantFrom(0, 1, 10_000, 100_000),
  fc.integer({ min: 0, max: 100_000 }),
);
const oboles = fc.oneof(
  fc.integer({ min: 0, max: 200 }),
  fc.integer({ min: 0, max: 1_000_000_000 }),
);
/** Vrai si `rounded` est exactement ⌈amount × share / 10 000⌉, vérifié en entiers longs. */
const isCeiling = (rounded: number, amount: number, share: number) => {
  const exact = BigInt(amount) * BigInt(share);
  return BigInt(rounded) * BPS >= exact && (BigInt(rounded) - 1n) * BPS < exact;
};

describe('durée d’un trajet', () => {
  it('exemples : la durée de référence à la vitesse 10 000, plus longue pour un navire plus lent', () => {
    expect(voyageDurationSeconds(4, 10_000)).toBe(4 * 3_600);
    expect(voyageDurationSeconds(4, 20_000)).toBe(2 * 3_600);
    expect(voyageDurationSeconds(6, 7_500)).toBe(8 * 3_600);
    // 2 h à la vitesse 7 000 : 10 285,71… secondes, arrondies à la seconde supérieure.
    expect(voyageDurationSeconds(2, 7_000)).toBe(10_286);
  });

  it('jamais plus courte que la durée exacte, et d’au plus une seconde de plus', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (hours, speed) => {
          const seconds = BigInt(voyageDurationSeconds(hours, speed));
          const exact = BigInt(hours) * 3_600n * BPS;
          expect(seconds * BigInt(speed) >= exact).toBe(true);
          expect((seconds - 1n) * BigInt(speed) < exact).toBe(true);
        },
      ),
    );
  });

  it('refuse une route ou une vitesse nulle, négative ou fractionnaire', () => {
    for (const [hours, speed] of [
      [0, 10_000],
      [2.5, 10_000],
      [2, 0],
      [2, -1],
      [2, 0.5],
    ] as const)
      expect(() => voyageDurationSeconds(hours, speed)).toThrow(RangeError);
  });
});

describe('droit de port', () => {
  it('exemples : forfait modulé par la cité, part détruite à l’obole supérieure', () => {
    const rule = { baseOboles: 40, cityCoefficientBps: 10_000, burnShareBps: 5_000 };
    expect(portDues(rule)).toEqual({ oboles: 40, burned: 20, treasury: 20 });
    expect(portDues({ ...rule, baseOboles: 41 })).toEqual({ oboles: 41, burned: 21, treasury: 20 });
    // ×1,25 : 50 ; ×0,333 3 : 13,33… arrondi à 14, dont 7 détruites.
    expect(portDues({ ...rule, cityCoefficientBps: 12_500 }).oboles).toBe(50);
    expect(portDues({ ...rule, cityCoefficientBps: 3_333 })).toEqual({
      oboles: 14,
      burned: 7,
      treasury: 7,
    });
    expect(portDues({ ...rule, baseOboles: 1, burnShareBps: 1 })).toEqual({
      oboles: 1,
      burned: 1,
      treasury: 0,
    });
  });

  it('forfait nul ou cité au coefficient nul : rien à payer, rien à détruire ni à verser', () => {
    fc.assert(
      fc.property(oboles, coefficient, bps, (base, cityCoefficientBps, burnShareBps) => {
        const nothing = { oboles: 0, burned: 0, treasury: 0 };
        expect(portDues({ baseOboles: 0, cityCoefficientBps, burnShareBps })).toEqual(nothing);
        expect(portDues({ baseOboles: base, cityCoefficientBps: 0, burnShareBps })).toEqual(
          nothing,
        );
      }),
    );
  });

  it('conservation : détruit + trésor = droit, chaque part entière, positive ou nulle', () => {
    fc.assert(
      fc.property(oboles, coefficient, bps, (baseOboles, cityCoefficientBps, burnShareBps) => {
        const dues = portDues({ baseOboles, cityCoefficientBps, burnShareBps });
        for (const part of [dues.oboles, dues.burned, dues.treasury])
          expect(Number.isSafeInteger(part) && part >= 0).toBe(true);
        expect(dues.burned + dues.treasury).toBe(dues.oboles);
      }),
    );
  });

  it('arrondis exacts vers le haut : jamais en faveur de la monnaie qui reste en circulation', () => {
    fc.assert(
      fc.property(oboles, coefficient, bps, (baseOboles, cityCoefficientBps, burnShareBps) => {
        const dues = portDues({ baseOboles, cityCoefficientBps, burnShareBps });
        expect(isCeiling(dues.oboles, baseOboles, cityCoefficientBps)).toBe(true);
        expect(isCeiling(dues.burned, dues.oboles, burnShareBps)).toBe(true);
        // Le trésor de la cité, monnaie en circulation, ne reçoit jamais plus que sa part exacte.
        const treasuryShare = BigInt(dues.oboles) * (BPS - BigInt(burnShareBps));
        expect(BigInt(dues.treasury) * BPS <= treasuryShare).toBe(true);
      }),
    );
  });

  it('refuse une part détruite hors de 0 à 10 000, un forfait ou un coefficient négatifs', () => {
    const rule = { baseOboles: 10, cityCoefficientBps: 10_000, burnShareBps: 5_000 };
    for (const patch of [
      { burnShareBps: -1 },
      { burnShareBps: 10_001 },
      { burnShareBps: 0.5 },
      { baseOboles: -1 },
      { baseOboles: 1.5 },
      { cityCoefficientBps: -1 },
    ])
      expect(() => portDues({ ...rule, ...patch })).toThrow(RangeError);
  });
});

describe('coût d’un départ', () => {
  it('provisions plus droit de port, chaque part gardée telle quelle', () => {
    expect(
      departureCost({
        provisionsOboles: 30,
        portDuesBaseOboles: 41,
        cityCoefficientBps: 10_000,
        burnShareBps: 5_000,
      }),
    ).toEqual({
      provisionsOboles: 30,
      portDues: { oboles: 41, burned: 21, treasury: 20 },
      totalOboles: 71,
    });
  });

  it('paramètres neutres : un départ ne coûte rien', () => {
    fc.assert(
      fc.property(coefficient, bps, (cityCoefficientBps, burnShareBps) => {
        expect(
          departureCost({
            provisionsOboles: 0,
            portDuesBaseOboles: 0,
            cityCoefficientBps,
            burnShareBps,
          }).totalOboles,
        ).toBe(0);
      }),
    );
  });

  it('conservation : ce que paie la maison est exactement ce que reçoivent les deux puits et le trésor', () => {
    fc.assert(
      fc.property(
        oboles,
        oboles,
        coefficient,
        bps,
        (provisionsOboles, portDuesBaseOboles, cityCoefficientBps, burnShareBps) => {
          const cost = departureCost({
            provisionsOboles,
            portDuesBaseOboles,
            cityCoefficientBps,
            burnShareBps,
          });
          expect(cost.totalOboles).toBe(
            cost.provisionsOboles + cost.portDues.burned + cost.portDues.treasury,
          );
          expect(cost.provisionsOboles).toBe(provisionsOboles);
        },
      ),
    );
  });

  it('refuse des provisions négatives ou fractionnaires', () => {
    const cost = { portDuesBaseOboles: 0, cityCoefficientBps: 10_000, burnShareBps: 0 };
    expect(() => departureCost({ ...cost, provisionsOboles: -1 })).toThrow(RangeError);
    expect(() => departureCost({ ...cost, provisionsOboles: 0.5 })).toThrow(RangeError);
  });
});

describe('unités d’une cargaison', () => {
  it('somme des quantités, tous biens confondus ; une cargaison vide n’en a aucune', () => {
    expect(cargoUnits([])).toBe(0);
    expect(
      cargoUnits([
        { goodId: 'wheat', quantity: 120 },
        { goodId: 'oil', quantity: 30 },
      ]),
    ).toBe(150);
  });

  it('refuse une quantité nulle, négative ou fractionnaire, et un total hors des entiers sûrs', () => {
    for (const quantity of [0, -1, 1.5])
      expect(() => cargoUnits([{ goodId: 'wheat', quantity }])).toThrow(RangeError);
    const huge = { goodId: 'wheat', quantity: Number.MAX_SAFE_INTEGER };
    expect(() => cargoUnits([huge, { goodId: 'oil', quantity: 1 }])).toThrow(RangeError);
  });
});
