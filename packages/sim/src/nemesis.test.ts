import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  drawNemesisModel,
  nemesisExcess,
  nemesisMagnitudeBps,
  nemesisRelief,
  nemesisTake,
} from './nemesis';

const MAX = Number.MAX_SAFE_INTEGER;
const gauge = fc.oneof(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: MAX }));
const fullExcess = fc.oneof(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 1, max: MAX }));
const bounds = fc
  .tuple(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 1, max: 10_000 }))
  .map(([a, b]) => ({ minBps: Math.min(a, b), maxBps: Math.max(a, b) }));

describe('ampleur de Némésis (7.2, #735)', () => {
  it('exemples : excès strict, prorata arrondi vers le bas, plafonné à l’excès plein', () => {
    const fire = { minBps: 500, maxBps: 3_000 };
    expect(nemesisExcess(1_000, 1_000)).toBe(0);
    expect(nemesisExcess(999, 1_000)).toBe(0);
    expect(nemesisExcess(1_001, 1_000)).toBe(1);
    // Le seuil de départ, le plus grand entier sûr, n'est jamais dépassé.
    expect(nemesisExcess(MAX, MAX)).toBe(0);
    expect(nemesisMagnitudeBps(0, fire, 10_000)).toBe(0);
    // 500 + 2 500 × 1 / 10 000 = 500,25 : 500 ; à mi-chemin, 1 750 ; à l'excès plein et au-delà, 3 000.
    expect(nemesisMagnitudeBps(1, fire, 10_000)).toBe(500);
    expect(nemesisMagnitudeBps(5_000, fire, 10_000)).toBe(1_750);
    expect(nemesisMagnitudeBps(9_999, fire, 10_000)).toBe(2_999);
    expect(nemesisMagnitudeBps(10_000, fire, 10_000)).toBe(3_000);
    expect(nemesisMagnitudeBps(MAX, fire, 10_000)).toBe(3_000);
    expect(nemesisMagnitudeBps(MAX, { minBps: 10_000, maxBps: 10_000 }, MAX)).toBe(10_000);
    expect(nemesisRelief(4_000, 10_000)).toBe(4_000);
    expect(nemesisRelief(MAX, 10_000)).toBe(10_000);
    // 1 750 points de 99 oboles : 17,325, soit 17 ; rien de rien.
    expect(nemesisTake(99n, 1_750)).toBe(17n);
    expect(nemesisTake(0n, 10_000)).toBe(0n);
    expect(nemesisTake(1n, 9_999)).toBe(0n);
    expect(nemesisTake(2n ** 62n, 10_000)).toBe(2n ** 62n);
  });

  it('entrées invalides refusées', () => {
    expect(() => nemesisExcess(-1, 0)).toThrow(RangeError);
    expect(() => nemesisExcess(0, 0.5)).toThrow(RangeError);
    expect(() => nemesisRelief(1, 0)).toThrow(RangeError);
    expect(() => nemesisMagnitudeBps(1, { minBps: 20, maxBps: 10 }, 10)).toThrow(RangeError);
    expect(() => nemesisMagnitudeBps(1, { minBps: 0, maxBps: 10_001 }, 10)).toThrow(RangeError);
    expect(() => nemesisMagnitudeBps(1, { minBps: -1, maxBps: 10 }, 10)).toThrow(RangeError);
    expect(() => nemesisTake(-1n, 10)).toThrow(RangeError);
    expect(() => nemesisTake(1n, 10_001)).toThrow(RangeError);
    expect(() => drawNemesisModel('s', [])).toThrow(RangeError);
  });

  it('propriété : l’ampleur reste dans les bornes du modèle, et nulle sans excès', () => {
    fc.assert(
      fc.property(gauge, bounds, fullExcess, (excess, share, full) => {
        const bps = nemesisMagnitudeBps(excess, share, full);
        if (excess === 0) return bps === 0;
        return bps >= share.minBps && bps <= share.maxBps;
      }),
    );
  });

  it('propriété : l’ampleur croît avec l’excès, et atteint la borne haute à l’excès plein', () => {
    fc.assert(
      fc.property(gauge, gauge, bounds, fullExcess, (a, b, share, full) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        return (
          nemesisMagnitudeBps(low, share, full) <= nemesisMagnitudeBps(high, share, full) &&
          nemesisMagnitudeBps(Math.max(high, full), share, full) === share.maxBps
        );
      }),
    );
  });

  it('propriété : la baisse ne fait jamais passer la jauge sous le seuil, ni hors de ses bornes', () => {
    fc.assert(
      fc.property(gauge, gauge, fullExcess, (level, threshold, full) => {
        const excess = nemesisExcess(level, threshold);
        const relief = nemesisRelief(excess, full);
        const after = level - relief;
        return (
          relief >= 0 &&
          relief <= excess &&
          after >= 0 &&
          (excess === 0 || after >= threshold) &&
          (excess <= full ? after === Math.min(level, threshold) : after > threshold)
        );
      }),
    );
  });

  it('propriété : une part ne prend jamais plus que le tout, et ce qui reste plus ce qui est pris le refait', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 62n }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (amount, a, b) => {
          const taken = nemesisTake(amount, a);
          const [low, high] = a <= b ? [a, b] : [b, a];
          return (
            taken >= 0n &&
            taken <= amount &&
            amount - taken + taken === amount &&
            nemesisTake(amount, low) <= nemesisTake(amount, high) &&
            (amount > 0n || taken === 0n)
          );
        },
      ),
    );
  });

  it('propriété : le modèle tiré est l’un de ceux en jeu, le même pour la même graine', () => {
    const all = ['warehouse_fire', 'lawsuit', 'artisan_desertion', 'ship_lost'] as const;
    fc.assert(
      fc.property(fc.string(), fc.subarray([...all], { minLength: 1 }), (seed, models) => {
        const model = drawNemesisModel(seed, models);
        return models.includes(model) && drawNemesisModel(seed, models) === model;
      }),
    );
    // Les quatre modèles sortent, sur des graines différentes.
    const seen = new Set(Array.from({ length: 200 }, (_, i) => drawNemesisModel(`s${i}`, all)));
    expect(seen.size).toBe(4);
  });
});
