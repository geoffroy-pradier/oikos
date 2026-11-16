import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PROPERTY_CONDITION_MAX, usableHousingUnits, wornCondition } from './property';

const condition = fc.oneof(
  fc.constantFrom(0, 1, 9_999, PROPERTY_CONDITION_MAX),
  fc.integer({ min: 0, max: PROPERTY_CONDITION_MAX }),
);

describe('vétusté d’un bien (#256)', () => {
  it('exemples : le bien perd la vétusté du jour, sans passer sous zéro', () => {
    expect(wornCondition(10_000, 40)).toBe(9_960);
    expect(wornCondition(30, 40)).toBe(0);
    expect(wornCondition(40, 40)).toBe(0);
    expect(wornCondition(0, 40)).toBe(0);
    expect(wornCondition(7_000, 0)).toBe(7_000);
    expect(wornCondition(10_000, 10_000)).toBe(0);
  });

  it('jamais négatif, jamais en hausse, exact tant qu’il reste de quoi user', () => {
    fc.assert(
      fc.property(condition, condition, (before, wear) => {
        const after = wornCondition(before, wear);
        expect(after).toBeGreaterThanOrEqual(0);
        expect(after).toBeLessThanOrEqual(before);
        expect(Number.isSafeInteger(after)).toBe(true);
        expect(after).toBe(before >= wear ? before - wear : 0);
      }),
    );
  });

  it('jours après jours : n jours de vétusté font n fois la vétusté, bornés à zéro', () => {
    fc.assert(
      fc.property(condition, fc.integer({ min: 0, max: 500 }), fc.nat(40), (start, wear, days) => {
        let state = start;
        for (let day = 0; day < days; day += 1) state = wornCondition(state, wear);
        expect(state).toBe(Math.max(0, start - wear * days));
      }),
    );
  });

  it('refuse un état ou une vétusté hors de 0 à 10 000, ou non entiers', () => {
    for (const bad of [-1, 10_001, 0.5, Number.NaN]) {
      expect(() => wornCondition(bad, 1)).toThrow(RangeError);
      expect(() => wornCondition(5_000, bad)).toThrow(RangeError);
    }
  });
});

describe('logements utiles d’un bien (#256)', () => {
  const house = { housingUnits: 4, minHabitableCondition: 3_000, upkeepUnpaid: false };

  it('exemples : toute la capacité au seuil et au-dessus, rien en dessous ni impayé', () => {
    expect(usableHousingUnits({ ...house, condition: 10_000 })).toBe(4);
    expect(usableHousingUnits({ ...house, condition: 3_000 })).toBe(4);
    expect(usableHousingUnits({ ...house, condition: 2_999 })).toBe(0);
    expect(usableHousingUnits({ ...house, condition: 10_000, upkeepUnpaid: true })).toBe(0);
    // Seuil nul : un bien à zéro loge encore, s'il est payé.
    expect(usableHousingUnits({ ...house, condition: 0, minHabitableCondition: 0 })).toBe(4);
  });

  it('tout ou rien, monotone en l’état, nul dès que l’entretien est impayé', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        condition,
        condition,
        fc.boolean(),
        (housingUnits, state, threshold, upkeepUnpaid) => {
          const property = { housingUnits, minHabitableCondition: threshold, upkeepUnpaid };
          const units = usableHousingUnits({ ...property, condition: state });
          expect([0, housingUnits]).toContain(units);
          if (upkeepUnpaid) expect(units).toBe(0);
          // Une rénovation (état au maximum) ne retire jamais de logement.
          expect(
            usableHousingUnits({ ...property, condition: PROPERTY_CONDITION_MAX }),
          ).toBeGreaterThanOrEqual(units);
          // La vétusté n'en ajoute jamais.
          expect(
            usableHousingUnits({ ...property, condition: wornCondition(state, 1) }),
          ).toBeLessThanOrEqual(units);
        },
      ),
    );
  });

  it('refuse une capacité négative ou non entière, un état ou un seuil hors bornes', () => {
    for (const bad of [-1, 0.5, Number.NaN])
      expect(() => usableHousingUnits({ ...house, housingUnits: bad, condition: 1 })).toThrow(
        RangeError,
      );
    expect(() => usableHousingUnits({ ...house, condition: 10_001 })).toThrow(RangeError);
    expect(() => usableHousingUnits({ ...house, condition: 1, minHabitableCondition: -1 })).toThrow(
      RangeError,
    );
  });
});
