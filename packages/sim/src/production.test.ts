import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accrueProduction, accrueWorkshop } from './production';

const T0 = new Date('2026-01-01T00:00:00Z');
const after = (minutes: number, from: Date = T0) => new Date(from.getTime() + minutes * 60_000);
const mill = { cycleMinutes: 60, maxCycles: 8 };

describe('accrueWorkshop', () => {
  it('sans intrant, rend exactement ce que rend une production primaire', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 5000 }), (minutes) => {
        const now = after(minutes);
        const primary = accrueProduction({ since: T0, now, ...mill, outputPerCycle: 1 });
        const workshop = accrueWorkshop({ since: T0, now, ...mill, inputs: [] });
        expect(workshop).toEqual({
          cycles: primary.cycles,
          elapsedCycles: primary.cycles,
          since: primary.since,
        });
      }),
    );
  });

  it('avec assez d’intrants, tourne autant que le temps le permet', () => {
    const run = accrueWorkshop({
      since: T0,
      now: after(200),
      ...mill,
      inputs: [{ perCycle: 5, available: 1000 }],
    });
    expect(run).toEqual({ cycles: 3, elapsedCycles: 3, since: after(180) });
  });

  it('à court d’intrants, le cycle attend : son temps reste dû', () => {
    // 200 minutes, de quoi moudre une seule fois : deux cycles attendent, leur temps est gardé.
    const run = accrueWorkshop({
      since: T0,
      now: after(200),
      ...mill,
      inputs: [{ perCycle: 5, available: 9 }],
    });
    expect(run).toEqual({ cycles: 1, elapsedCycles: 3, since: after(60) });
    // Réapprovisionné aussitôt : les deux cycles dus tournent, rien de plus.
    const next = accrueWorkshop({
      since: run.since,
      now: after(200),
      ...mill,
      inputs: [{ perCycle: 5, available: 1000 }],
    });
    expect(next).toEqual({ cycles: 2, elapsedCycles: 2, since: after(180) });
  });

  it('sans aucun intrant, rien ne tourne et rien ne bouge', () => {
    const run = accrueWorkshop({
      since: T0,
      now: after(200),
      ...mill,
      inputs: [{ perCycle: 5, available: 4 }],
    });
    expect(run).toEqual({ cycles: 0, elapsedCycles: 3, since: T0 });
  });

  it('le temps perdu ne se rattrape pas au-delà du plafond du site', () => {
    // Dix jours d'attente, plafond de 8 cycles, de quoi en faire 3 : 5 cycles restent dus, pas davantage.
    const now = after(14_400);
    const run = accrueWorkshop({
      since: T0,
      now,
      ...mill,
      inputs: [{ perCycle: 1, available: 3 }],
    });
    expect(run).toEqual({ cycles: 3, elapsedCycles: 8, since: after(-5 * 60, now) });
    const next = accrueWorkshop({
      since: run.since,
      now,
      ...mill,
      inputs: [{ perCycle: 1, available: 1000 }],
    });
    expect(next.cycles).toBe(5);
  });

  it('l’intrant le plus rare décide', () => {
    const run = accrueWorkshop({
      since: T0,
      now: after(600),
      ...mill,
      inputs: [
        { perCycle: 2, available: 100 },
        { perCycle: 3, available: 7 },
      ],
    });
    expect(run.cycles).toBe(2);
  });

  it('propriétés : jamais plus de cycles que d’intrants ni que de temps, et rien ne se perd en deux collectes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.array(
          fc.record({
            perCycle: fc.integer({ min: 1, max: 9 }),
            available: fc.integer({ min: 0, max: 60 }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.integer({ min: 0, max: 60 }),
        (first, later, inputs, restock) => {
          const now = after(first);
          const run = accrueWorkshop({ since: T0, now, ...mill, inputs });
          for (const { perCycle, available } of inputs)
            expect(run.cycles * perCycle).toBeLessThanOrEqual(available);
          expect(run.cycles).toBeLessThanOrEqual(run.elapsedCycles);
          expect(run.elapsedCycles).toBeLessThanOrEqual(mill.maxCycles);
          expect(run.since.getTime()).toBeGreaterThanOrEqual(T0.getTime());
          expect(run.since.getTime()).toBeLessThanOrEqual(now.getTime());
          // Seconde collecte, stock diminué de ce qui a été consommé puis réapprovisionné : le total
          // des deux ne dépasse jamais ce que le temps total aurait permis d'une traite sans plafond.
          const left = inputs.map(({ perCycle, available }) => ({
            perCycle,
            available: available - run.cycles * perCycle + restock * perCycle,
          }));
          const end = after(later, now);
          const again = accrueWorkshop({ since: run.since, now: end, ...mill, inputs: left });
          const total = Math.floor((first + later) / mill.cycleMinutes);
          expect(run.cycles + again.cycles).toBeLessThanOrEqual(total);
          for (const { perCycle, available } of left)
            expect(again.cycles * perCycle).toBeLessThanOrEqual(available);
        },
      ),
    );
  });

  it('refuse des quantités invalides', () => {
    const base = { since: T0, now: after(60), ...mill };
    for (const bad of [0, -1, 1.5])
      expect(() => accrueWorkshop({ ...base, inputs: [{ perCycle: bad, available: 1 }] })).toThrow(
        RangeError,
      );
    for (const bad of [-1, 0.5])
      expect(() => accrueWorkshop({ ...base, inputs: [{ perCycle: 1, available: bad }] })).toThrow(
        RangeError,
      );
  });
});
