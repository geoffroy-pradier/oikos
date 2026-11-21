import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { voyageLoss, voyageLossRiskBps } from './voyage-loss';

const bps = fc.oneof(fc.constantFrom(0, 1, 9_999, 10_000), fc.integer({ min: 0, max: 10_000 }));
const seed = fc.string({ minLength: 16, maxLength: 64 });
const draw = fc.record({ worldSeed: seed, voyageId: fc.uuid() });
const WORLD = 'graine-du-monde-de-test';

describe('risque de perte fixé au départ', () => {
  it('exemples : la route seule par temps calme, majorée pendant une tempête, borné à 10 000', () => {
    expect(voyageLossRiskBps({ routeRiskBps: 0, stormRiskBps: 0, storm: true })).toBe(0);
    expect(voyageLossRiskBps({ routeRiskBps: 300, stormRiskBps: 1_200, storm: false })).toBe(300);
    expect(voyageLossRiskBps({ routeRiskBps: 300, stormRiskBps: 1_200, storm: true })).toBe(1_500);
    expect(voyageLossRiskBps({ routeRiskBps: 9_000, stormRiskBps: 5_000, storm: true })).toBe(
      10_000,
    );
  });

  it('propriété : min(10 000, route + tempête si tempête), entier, jamais sous le risque de la route', () => {
    fc.assert(
      fc.property(bps, bps, fc.boolean(), (routeRiskBps, stormRiskBps, storm) => {
        const risk = voyageLossRiskBps({ routeRiskBps, stormRiskBps, storm });
        expect(risk).toBe(Math.min(10_000, routeRiskBps + (storm ? stormRiskBps : 0)));
        expect(Number.isSafeInteger(risk) && risk >= routeRiskBps && risk <= 10_000).toBe(true);
      }),
    );
  });

  it('refuse un risque hors des points de base entiers', () => {
    for (const bad of [-1, 10_001, 0.5, Number.NaN]) {
      expect(() => voyageLossRiskBps({ routeRiskBps: bad, stormRiskBps: 0, storm: false })).toThrow(
        RangeError,
      );
      expect(() => voyageLossRiskBps({ routeRiskBps: 0, stormRiskBps: bad, storm: false })).toThrow(
        RangeError,
      );
    }
  });
});

describe('tirage de la perte à l’arrivée', () => {
  it('propriété : risque nul, jamais de perte ; risque plein, toujours', () => {
    fc.assert(
      fc.property(draw, (voyage) => {
        expect(voyageLoss({ ...voyage, riskBps: 0 })).toBe(false);
        expect(voyageLoss({ ...voyage, riskBps: 10_000 })).toBe(true);
      }),
    );
  });

  it('propriété : déterministe pour une graine, et croissant avec le risque', () => {
    fc.assert(
      fc.property(draw, bps, bps, (voyage, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(voyageLoss({ ...voyage, riskBps: a })).toBe(voyageLoss({ ...voyage, riskBps: a }));
        // Un seul tirage comparé au risque : ce qu'un risque faible perd, un risque plus fort le perd aussi.
        if (voyageLoss({ ...voyage, riskBps: low }))
          expect(voyageLoss({ ...voyage, riskBps: high })).toBe(true);
      }),
    );
  });

  it('propriété : il existe un seuil, l’issue change exactement une fois de 0 à 10 000', () => {
    fc.assert(
      fc.property(draw, (voyage) => {
        const outcomes = [0, 1, 2_500, 5_000, 7_500, 9_999, 10_000].map((riskBps) =>
          voyageLoss({ ...voyage, riskBps }),
        );
        const changes = outcomes.filter((lost, i) => i > 0 && lost !== outcomes[i - 1]).length;
        expect(changes).toBe(1);
      }),
    );
  });

  it('valeurs de référence, figées : le tirage ne change pas d’une version à l’autre', () => {
    // Tirages (0 à 9 999) de ces voyages dans ce monde : 9 221, 8 406, 497, 27.
    const lost = (id: string, riskBps: number) =>
      voyageLoss({
        worldSeed: WORLD,
        voyageId: `01900000-0000-7000-8000-000000000a0${id}`,
        riskBps,
      });
    expect([lost('1', 9_221), lost('1', 9_222)]).toEqual([false, true]);
    expect([lost('2', 8_406), lost('2', 8_407)]).toEqual([false, true]);
    expect([lost('3', 497), lost('3', 498)]).toEqual([false, true]);
    expect([lost('4', 27), lost('4', 28)]).toEqual([false, true]);
  });

  it('la graine du monde compte : le même voyage dans un autre monde a un autre tirage', () => {
    const ids = Array.from(
      { length: 64 },
      (_, i) => `01900000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    const outcomes = (worldSeed: string) =>
      ids.map((voyageId) => voyageLoss({ worldSeed, voyageId, riskBps: 5_000 }));
    expect(outcomes(WORLD)).not.toEqual(outcomes(`${WORLD}-autre`));
  });

  it('fréquence : sur 20 000 voyages, la part perdue est proche du risque', () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `voyage-${i}`);
    for (const riskBps of [100, 2_500, 9_000]) {
      const lost = ids.filter((voyageId) => voyageLoss({ worldSeed: WORLD, voyageId, riskBps }));
      // Écart type d'au plus 0,36 point sur 20 000 tirages : 1,5 point de marge, et l'issue est figée par la graine.
      expect(Math.abs(lost.length / ids.length - riskBps / 10_000)).toBeLessThan(0.015);
    }
  });

  it('refuse un risque hors bornes et un tirage sans graine ni voyage', () => {
    for (const riskBps of [-1, 10_001, 0.5, Number.NaN])
      expect(() => voyageLoss({ worldSeed: WORLD, voyageId: 'v', riskBps })).toThrow(RangeError);
    expect(() => voyageLoss({ worldSeed: '', voyageId: 'v', riskBps: 0 })).toThrow(RangeError);
    expect(() => voyageLoss({ worldSeed: WORLD, voyageId: '', riskBps: 0 })).toThrow(RangeError);
  });
});
