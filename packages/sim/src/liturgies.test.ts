import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seasonOfGameDay } from './clock';
import { designateLiturgies, liturgyDue, liturgyGenre, type LiturgyCandidate } from './liturgies';

const rules = fc
  .record({
    dueShareBps: fc.integer({ min: 1, max: 10_000 }),
    minDue: fc.integer({ min: 1, max: 1_000_000 }),
    span: fc.integer({ min: 0, max: 1_000_000 }),
  })
  .map(({ dueShareBps, minDue, span }) => ({ dueShareBps, minDue, maxDue: minDue + span }));
const wealth = fc.bigInt({ min: -(2n ** 40n), max: 2n ** 62n });

describe('dû d’une liturgie (#719)', () => {
  it('exemples : part arrondie à l’obole supérieure, bornes, fortune nulle', () => {
    const r = { dueShareBps: 500, minDue: 10, maxDue: 1_000 };
    expect(liturgyDue(10_000n, r)).toBe(500n);
    expect(liturgyDue(10_001n, r)).toBe(501n); // 500,05 → 501
    expect(liturgyDue(19_999n, r)).toBe(1_000n); // 999,95 → 1 000
    expect(liturgyDue(20_001n, r)).toBe(1_000n); // plafond
    expect(liturgyDue(100n, r)).toBe(10n); // 5 → plancher
    expect(liturgyDue(0n, r)).toBe(10n);
    expect(liturgyDue(-5_000n, r)).toBe(10n);
    expect(liturgyDue(1n, { dueShareBps: 1, minDue: 1, maxDue: 1 })).toBe(1n);
    expect(() => liturgyDue(1n, { dueShareBps: 1, minDue: 2, maxDue: 1 })).toThrow(RangeError);
  });

  it('propriété : dans ses bornes, et la part exacte arrondie vers le haut quand elle y est', () => {
    fc.assert(
      fc.property(wealth, rules, (w, r) => {
        const due = liturgyDue(w, r);
        expect(due >= BigInt(r.minDue) && due <= BigInt(r.maxDue)).toBe(true);
        const exact = w * BigInt(r.dueShareBps); // dû × 10 000, avant arrondi
        if (due > BigInt(r.minDue) && due < BigInt(r.maxDue)) {
          expect(due * 10_000n >= exact).toBe(true);
          expect((due - 1n) * 10_000n < exact).toBe(true);
        }
      }),
    );
  });

  it('propriété : croissant avec la fortune', () => {
    fc.assert(
      fc.property(wealth, fc.bigInt({ min: 0n, max: 2n ** 40n }), rules, (w, more, r) => {
        expect(liturgyDue(w + more, r) >= liturgyDue(w, r)).toBe(true);
      }),
    );
  });

  it('propriété : jamais plus que la fortune quand elle atteint le dû minimal', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 62n }), rules, (extra, r) => {
        const w = BigInt(r.minDue) + extra;
        expect(liturgyDue(w, r) <= w).toBe(true);
      }),
    );
  });
});

const candidate = fc.record({
  houseId: fc.constantFrom('h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'),
  cityId: fc.constantFrom('c1', 'c2', 'c3'),
  wealth: fc.bigInt({ min: 0n, max: 50n }),
  seniority: fc.integer({ min: 0, max: 3 }),
});
const candidates = fc.uniqueArray(candidate, { selector: (c) => c.houseId, maxLength: 10 });
const designation = fc.record({
  housesPerCity: fc.integer({ min: 0, max: 4 }),
  wealthFloor: fc.integer({ min: 0, max: 50 }),
});
/** `a` passe avant `b` dans le classement d'une cité. */
const ahead = (a: LiturgyCandidate, b: LiturgyCandidate) =>
  a.wealth !== b.wealth
    ? a.wealth > b.wealth
    : a.seniority !== b.seniority
      ? a.seniority < b.seniority
      : a.houseId < b.houseId;

describe('désignation des maisons les plus riches (#719)', () => {
  it('exemple : par fortune, à égalité par ancienneté puis identifiant, au-dessus du plancher', () => {
    const houses = [
      { houseId: 'b', cityId: 'k', wealth: 500n, seniority: 2 },
      { houseId: 'a', cityId: 'k', wealth: 500n, seniority: 2 },
      { houseId: 'c', cityId: 'k', wealth: 500n, seniority: 1 },
      { houseId: 'd', cityId: 'k', wealth: 900n, seniority: 9 },
      { houseId: 'e', cityId: 'k', wealth: 99n, seniority: 0 },
      { houseId: 'f', cityId: 'h', wealth: 100n, seniority: 0 },
    ];
    const ids = (n: number, floor: number) =>
      designateLiturgies(houses, { housesPerCity: n, wealthFloor: floor }).map((h) => h.houseId);
    expect(ids(3, 100)).toEqual(['f', 'd', 'c', 'a']);
    expect(ids(9, 100)).toEqual(['f', 'd', 'c', 'a', 'b']);
    expect(ids(9, 101)).toEqual(['d', 'c', 'a', 'b']);
    expect(ids(0, 0)).toEqual([]);
    expect(designateLiturgies([], { housesPerCity: 3, wealthFloor: 0 })).toEqual([]);
  });

  it('propriété : au plus N par cité, au plancher, aucune écartée devant une désignée, indépendant de l’ordre', () => {
    fc.assert(
      fc.property(candidates, designation, fc.integer(), (houses, r, shuffle) => {
        const chosen = designateLiturgies(houses, r);
        const reordered = [...houses].sort(
          (a, b) =>
            ((a.houseId.charCodeAt(1) * shuffle) % 7) - ((b.houseId.charCodeAt(1) * shuffle) % 7),
        );
        expect(designateLiturgies(reordered, r)).toEqual(chosen);
        expect(new Set(chosen.map((h) => h.houseId)).size).toBe(chosen.length);
        for (const city of ['c1', 'c2', 'c3']) {
          const inCity = chosen.filter((h) => h.cityId === city);
          expect(inCity.length).toBeLessThanOrEqual(r.housesPerCity);
          const eligible = houses.filter(
            (h) => h.cityId === city && h.wealth >= BigInt(r.wealthFloor),
          );
          expect(inCity.length).toBe(Math.min(r.housesPerCity, eligible.length));
          for (const left of eligible.filter((h) => !inCity.includes(h)))
            for (const taken of inCity) expect(ahead(taken, left)).toBe(true);
        }
        for (const h of chosen) expect(h.wealth >= BigInt(r.wealthFloor)).toBe(true);
      }),
    );
  });
});

describe('genre et saison d’une liturgie (#719)', () => {
  it('le genre est tiré dans la liste, le même pour la même maison et la même saison', () => {
    const genres = ['festival', 'trierarchy', 'choregia'] as const;
    const drawn = new Set<string>();
    for (let house = 0; house < 60; house += 1) {
      const genre = liturgyGenre('graine', 2_900, `h${house}`, genres);
      expect(genres).toContain(genre);
      expect(liturgyGenre('graine', 2_900, `h${house}`, genres)).toBe(genre);
      drawn.add(genre);
    }
    expect(drawn.size).toBe(3);
    expect(liturgyGenre('graine', 1, 'h', ['festival'])).toBe('festival');
  });

  it('saison d’un jour de jeu : elle change le lundi pour des saisons de sept jours', () => {
    // 2026-11-16 (jour 20 773) est un lundi.
    expect(seasonOfGameDay(20_773, 7)).toBe(seasonOfGameDay(20_772, 7) + 1);
    expect(seasonOfGameDay(20_779, 7)).toBe(seasonOfGameDay(20_773, 7));
    expect(seasonOfGameDay(4, 7)).toBe(0);
    expect(seasonOfGameDay(3, 7)).toBe(-1);
  });
});
