import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocateHousing,
  curveBps,
  employmentRateBps,
  equilibriumWage,
  housingShortageBps,
  laborSupply,
  lodgingPrice,
} from './labor';

const curve = fc
  .record({
    a: fc.integer({ min: 0, max: 100_000 }),
    b: fc.integer({ min: 0, max: 100_000 }),
    slopeBps: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 100_000 })),
  })
  .map(({ a, b, slopeBps }) => ({ minBps: Math.min(a, b), maxBps: Math.max(a, b), slopeBps }));
const base = fc.oneof(fc.constantFrom(0, 1, 7), fc.integer({ min: 0, max: 1_000_000_000 }));
const count = fc.oneof(fc.constantFrom(0, 1), fc.integer({ min: 0, max: 100_000_000 }));
const neutral = { minBps: 10_000, maxBps: 10_000, slopeBps: 0 };
const ceilShare = (amount: number, bps: number) =>
  Number((BigInt(amount) * BigInt(bps) + 9_999n) / 10_000n);

describe('offre de travail d’une cité (#258)', () => {
  it('exemples : part de chaque classe travailleuse, à l’habitant inférieur ; sans classe, sans limite', () => {
    const population = new Map([
      ['thetes', 6_001],
      ['zeugites', 2_500],
    ]);
    const of = (id: string) => population.get(id) ?? 0;
    expect(laborSupply(of, {})).toBeNull();
    expect(laborSupply(of, { thetes: 5_000 })).toBe(3_000);
    expect(laborSupply(of, { thetes: 5_000, zeugites: 2_000 })).toBe(3_500);
    // Une classe sans population (ou retirée) n'offre personne ; une part nulle non plus.
    expect(laborSupply(of, { hippeis: 10_000, zeugites: 0 })).toBe(0);
    for (const bad of [-1, 10_001, 0.5])
      expect(() => laborSupply(of, { thetes: bad })).toThrow(RangeError);
    expect(() => laborSupply(() => -1, { thetes: 1 })).toThrow(RangeError);
  });

  it('croissante en population comme en part, jamais plus que la population', () => {
    fc.assert(
      fc.property(count, fc.integer({ min: 0, max: 10_000 }), (people, share) => {
        const supply = laborSupply(() => people, { a: share }) ?? Number.NaN;
        expect(supply).toBeLessThanOrEqual(people);
        expect(supply).toBe(Math.floor((people * share) / 10_000));
        expect(laborSupply(() => people + 1, { a: share })).toBeGreaterThanOrEqual(supply);
        if (share < 10_000)
          expect(laborSupply(() => people, { a: share + 1 })).toBeGreaterThanOrEqual(supply);
      }),
    );
  });
});

describe('salaire d’équilibre (#258)', () => {
  it('exemples : de la borne basse au plein emploi, borne haute sous l’emploi', () => {
    const rising = { minBps: 8_000, maxBps: 15_000, slopeBps: 4_000 };
    const wage = (employed: number, supply: number | null) =>
      equilibriumWage({ baseOboles: 10, employed, supply, curve: rising });
    expect(employmentRateBps(0, null)).toBe(0);
    expect(employmentRateBps(5, 10)).toBe(5_000);
    expect(employmentRateBps(11, 10)).toBeNull();
    expect(employmentRateBps(0, 0)).toBe(0);
    expect(employmentRateBps(1, 0)).toBeNull();
    // Offre sans limite : taux nul, borne basse ×0,8.
    expect(wage(1_000, null)).toBe(8);
    expect(wage(0, 100)).toBe(8);
    // À mi-emploi ×1,0 ; au plein emploi ×1,2 ; au-delà, la borne haute ×1,5.
    expect(wage(50, 100)).toBe(10);
    expect(wage(100, 100)).toBe(12);
    expect(wage(101, 100)).toBe(15);
    // Population tombée à zéro avec des employés : borne haute.
    expect(wage(3, 0)).toBe(15);
    // Arrondi à l'obole supérieure : 7 × 0,8 = 5,6 → 6.
    expect(equilibriumWage({ baseOboles: 7, employed: 0, supply: 9, curve: rising })).toBe(6);
    // Configuration neutre : le salaire de base, quel que soit l'emploi.
    for (const [employed, supply] of [
      [0, null],
      [5, 10],
      [11, 10],
    ] as const)
      expect(equilibriumWage({ baseOboles: 7, employed, supply, curve: neutral })).toBe(7);
    expect(() => curveBps({ minBps: 2, maxBps: 1, slopeBps: 0 }, 0)).toThrow(RangeError);
    expect(() => curveBps(neutral, 10_001)).toThrow(RangeError);
  });

  it('croissant avec l’emploi, décroissant avec l’offre, toujours dans ses bornes', () => {
    fc.assert(
      fc.property(base, count, fc.option(count, { nil: null }), curve, (b, employed, supply, c) => {
        const wage = (e: number, s: number | null) =>
          equilibriumWage({ baseOboles: b, employed: e, supply: s, curve: c });
        const now = wage(employed, supply);
        expect(now).toBeGreaterThanOrEqual(ceilShare(b, c.minBps));
        expect(now).toBeLessThanOrEqual(ceilShare(b, c.maxBps));
        expect(wage(employed + 1, supply)).toBeGreaterThanOrEqual(now);
        if (supply !== null) {
          expect(wage(employed, supply + 1)).toBeLessThanOrEqual(now);
          // Plus d'employés que l'offre : la borne haute, exactement.
          expect(wage(supply + 1, supply)).toBe(ceilShare(b, c.maxBps));
        }
        // Une offre sans limite vaut le taux nul : la borne basse, avec la pente du taux nul.
        expect(wage(employed, null)).toBe(ceilShare(b, c.minBps));
      }),
    );
  });
});

describe('prix de l’hébergement chez les PNJ (#258)', () => {
  it('exemples : monte avec la pénurie, nul sans prix de base', () => {
    const scarce = { minBps: 10_000, maxBps: 30_000, slopeBps: 10_000 };
    const price = (workers: number, unhoused: number) =>
      lodgingPrice({ baseOboles: 5, workers, unhoused, curve: scarce });
    expect(housingShortageBps(0, 0)).toBe(0);
    expect(housingShortageBps(4, 1)).toBe(2_500);
    expect(price(0, 0)).toBe(5);
    expect(price(4, 1)).toBe(7); // 5 × 1,25 = 6,25 → 7
    expect(price(4, 4)).toBe(10);
    expect(lodgingPrice({ baseOboles: 0, workers: 4, unhoused: 4, curve: scarce })).toBe(0);
    expect(() => housingShortageBps(1, 2)).toThrow(RangeError);
  });

  it('croissant avec les non logés, borné', () => {
    fc.assert(
      fc.property(
        base,
        count,
        fc.integer({ min: 0, max: 10_000 }),
        curve,
        (b, workers, part, c) => {
          const unhoused = Math.floor((workers * part) / 10_000);
          const price = lodgingPrice({ baseOboles: b, workers, unhoused, curve: c });
          expect(price).toBeGreaterThanOrEqual(ceilShare(b, c.minBps));
          expect(price).toBeLessThanOrEqual(ceilShare(b, c.maxBps));
          if (unhoused < workers)
            expect(
              lodgingPrice({ baseOboles: b, workers, unhoused: unhoused + 1, curve: c }),
            ).toBeGreaterThanOrEqual(price);
        },
      ),
    );
  });
});

describe('logements attribués aux sites (#258)', () => {
  it('exemples : les plus anciens d’abord, chacun jusqu’à ses travailleurs', () => {
    const sites = [
      { siteId: 'a', workers: 3 },
      { siteId: 'b', workers: 0 },
      { siteId: 'c', workers: 4 },
    ];
    expect(allocateHousing(5, sites)).toEqual([
      { siteId: 'a', workers: 3, housed: 3, unhoused: 0 },
      { siteId: 'b', workers: 0, housed: 0, unhoused: 0 },
      { siteId: 'c', workers: 4, housed: 2, unhoused: 2 },
    ]);
    expect(allocateHousing(0, sites).map((site) => site.unhoused)).toEqual([3, 0, 4]);
    expect(allocateHousing(100, sites).every((site) => site.unhoused === 0)).toBe(true);
    const twice = { siteId: 'a', workers: 1 };
    expect(() => allocateHousing(1, [twice, twice])).toThrow('each site is housed once');
    expect(() => allocateHousing(-1, sites)).toThrow(RangeError);
  });

  it('conservation : logés et non logés font les travailleurs ; jamais plus de logés que de logements', () => {
    const sites = fc.uniqueArray(
      fc.record({ siteId: fc.uuid(), workers: fc.integer({ min: 0, max: 20 }) }),
      { maxLength: 8, selector: (site) => site.siteId },
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), sites, (units, listed) => {
        const housed = allocateHousing(units, listed);
        const workers = listed.reduce((sum, site) => sum + site.workers, 0);
        const total = housed.reduce((sum, site) => sum + site.housed, 0);
        expect(total).toBe(Math.min(units, workers));
        for (const site of housed) expect(site.housed + site.unhoused).toBe(site.workers);
        // Un site plus récent n'est logé que si tous les plus anciens le sont.
        const firstShort = housed.findIndex((site) => site.unhoused > 0);
        if (firstShort >= 0)
          for (const later of housed.slice(firstShort + 1)) expect(later.housed).toBe(0);
        // Un logement de plus ne déloge personne.
        const more = allocateHousing(units + 1, listed);
        more.forEach((site, index) =>
          expect(site.housed).toBeGreaterThanOrEqual(housed[index]?.housed ?? 0),
        );
      }),
    );
  });
});
