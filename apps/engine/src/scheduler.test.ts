import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dueTicks, MAX_CATCH_UP_TICKS } from './scheduler';

describe('dueTicks', () => {
  it('un monde neuf commence au tick en cours', () => {
    expect(dueTicks(null, 500)).toEqual([500]);
  });

  it('rien à jouer quand le tick en cours l’est déjà, ou si l’horloge recule', () => {
    expect(dueTicks(500, 500)).toEqual([]);
    expect(dueTicks(500, 498)).toEqual([]);
  });

  it('rattrape les ticks manqués, dans l’ordre', () => {
    expect(dueTicks(500, 503)).toEqual([501, 502, 503]);
  });

  it('borne le rattrapage et reprend au passage suivant, sans sauter de tick', () => {
    const first = dueTicks(0, 100);
    expect(first).toHaveLength(MAX_CATCH_UP_TICKS);
    expect(first[0]).toBe(1);
    expect(dueTicks(first.at(-1) ?? 0, 100)[0]).toBe(MAX_CATCH_UP_TICKS + 1);
  });

  it('propriété : suite contiguë commençant juste après le dernier tick joué, jamais au-delà du tick en cours', () => {
    fc.assert(
      fc.property(
        fc.nat(10_000),
        fc.nat(10_000),
        fc.integer({ min: 1, max: 50 }),
        (last, current, limit) => {
          const due = dueTicks(last, current, limit);
          expect(due.length).toBeLessThanOrEqual(limit);
          due.forEach((index, position) => expect(index).toBe(last + 1 + position));
          if (due.length > 0) expect(due.at(-1)).toBeLessThanOrEqual(current);
          if (current > last && due.length < limit) expect(due.at(-1)).toBe(current);
        },
      ),
    );
  });
});
