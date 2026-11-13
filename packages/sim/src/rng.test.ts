import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

const draws = (seed: string, count = 50) => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
};

describe('aléa déterministe', () => {
  it('une même graine rend toujours la même suite : un tick est rejouable', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        expect(draws(seed)).toEqual(draws(seed));
      }),
    );
  });

  it('la suite est figée d’une version à l’autre du code (valeurs de référence)', () => {
    const rng = createRng('oikos:tick:1');
    const sample = [
      rng.int(1, 6),
      rng.int(1, 6),
      rng.int(1, 6),
      rng.int(0, 999),
      rng.pick(['a', 'b', 'c']),
    ];
    expect(sample).toMatchInlineSnapshot(`
      [
        5,
        1,
        5,
        438,
        "c",
      ]
    `);
  });

  it('deux graines différentes, même voisines, donnent des suites différentes', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(draws(a, 8)).not.toEqual(draws(b, 8));
      }),
    );
    expect(draws('tick:1', 4)).not.toEqual(draws('tick:2', 4));
  });

  it('next reste dans [0, 1) et int dans ses bornes, comprises', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: -1000, max: 1000 }),
        fc.nat(1000),
        (seed, min, span) => {
          const rng = createRng(seed);
          for (let i = 0; i < 20; i++) {
            const value = rng.next();
            expect(value >= 0 && value < 1).toBe(true);
            const drawn = rng.int(min, min + span);
            expect(Number.isInteger(drawn) && drawn >= min && drawn <= min + span).toBe(true);
          }
        },
      ),
    );
  });

  it('est à peu près uniforme : chaque face d’un dé sort entre 15 % et 18,5 % du temps', () => {
    const die = createRng('uniformité');
    const faces = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i++) {
      const face = die.int(0, 5);
      faces[face] = (faces[face] ?? 0) + 1;
    }
    for (const count of faces) {
      expect(count / 60_000).toBeGreaterThan(0.15);
      expect(count / 60_000).toBeLessThan(0.185);
    }
  });

  it('refuse un intervalle invalide ou une liste vide', () => {
    const rng = createRng('x');
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
    // Au-delà de 2^32 valeurs, le tirage serait faux en silence (jamais d'impair, par exemple) : refusé.
    expect(() => rng.int(0, 2 ** 32)).toThrow(RangeError);
    expect(() => rng.int(0, 2 ** 40)).toThrow(RangeError);
    expect(() => rng.int(-(2 ** 31), 2 ** 31 - 1)).not.toThrow();
    expect(rng.int(7, 7)).toBe(7);
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
