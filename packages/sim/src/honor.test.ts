import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { honorChange, type HonorBounds } from './honor';

const MAX = Number.MAX_SAFE_INTEGER;
const LIMIT = 1_000_000_000;
const bounds = fc
  .tuple(fc.integer({ min: -LIMIT, max: 0 }), fc.integer({ min: 0, max: LIMIT }))
  .filter(([min, max]) => min < max);
const change = fc.oneof(
  fc.constantFrom(0, 1, -1, LIMIT, -LIMIT),
  fc.integer({ min: -LIMIT, max: LIMIT }),
);
const rules = (min: number, max: number, archon_term: number): HonorBounds => ({
  min,
  max,
  changes: { archon_term },
});

describe('variation de la Timè (#704)', () => {
  it('exemples : la variation du motif, rognée à la borne, nulle à la borne ou sans variation', () => {
    expect(honorChange(0, 'archon_term', rules(-100, 100, 30))).toBe(30);
    expect(honorChange(90, 'archon_term', rules(-100, 100, 30))).toBe(10);
    expect(honorChange(100, 'archon_term', rules(-100, 100, 30))).toBe(0);
    expect(honorChange(-90, 'archon_term', rules(-100, 100, -30))).toBe(-10);
    expect(honorChange(-100, 'archon_term', rules(-100, 100, -30))).toBe(0);
    expect(honorChange(0, 'archon_term', rules(-100, 100, 0))).toBe(0);
    // Bornes resserrées : une Timè au-delà ne gagne plus, mais n'est pas ramenée par un gain.
    expect(honorChange(150, 'archon_term', rules(-100, 100, 30))).toBe(0);
    expect(honorChange(150, 'archon_term', rules(-100, 100, -30))).toBe(-30);
    expect(honorChange(-150, 'archon_term', rules(-100, 100, 30))).toBe(30);
    expect(honorChange(MAX, 'archon_term', rules(-1, 1, -1))).toBe(-1);
    expect(honorChange(-MAX, 'archon_term', rules(-1, 1, 1))).toBe(1);
  });

  it('refuse un motif inconnu, même nommé comme une propriété d’objet, et des valeurs non entières', () => {
    const neutral = rules(-1, 1, 0);
    expect(() => honorChange(0, 'loan_default', neutral)).toThrow(/unknown/);
    expect(() => honorChange(0, 'toString', neutral)).toThrow(/unknown/);
    expect(() => honorChange(0.5, 'archon_term', neutral)).toThrow(/balance/);
    expect(() => honorChange(MAX + 1, 'archon_term', neutral)).toThrow(/balance/);
    expect(() => honorChange(0, 'archon_term', rules(-1, 1, 1.5))).toThrow(/archon_term/);
    expect(() => honorChange(0, 'archon_term', rules(1, 2, 0))).toThrow(/zero/);
  });

  it('une Timè dans ses bornes y reste, quelle que soit la suite des variations', () => {
    fc.assert(
      fc.property(bounds, fc.array(change, { maxLength: 50 }), ([min, max], changes) => {
        let balance = 0;
        for (const value of changes) {
          balance += honorChange(balance, 'archon_term', rules(min, max, value));
          expect(balance).toBeGreaterThanOrEqual(min);
          expect(balance).toBeLessThanOrEqual(max);
        }
      }),
    );
  });

  it('de son signe, jamais plus grande ; exacte tant que la borne n’est pas atteinte', () => {
    fc.assert(
      fc.property(
        bounds,
        change,
        fc.integer({ min: -MAX, max: MAX }),
        ([min, max], value, balance) => {
          const delta = honorChange(balance, 'archon_term', rules(min, max, value));
          expect(Number.isSafeInteger(delta)).toBe(true);
          expect(Math.abs(delta)).toBeLessThanOrEqual(Math.abs(value));
          expect(delta === 0 || Math.sign(delta) === Math.sign(value)).toBe(true);
          if (balance + value >= min && balance + value <= max && balance >= min && balance <= max)
            expect(delta).toBe(value);
          // Hors des bornes, elle ne s'en éloigne jamais.
          if (balance > max) expect(delta).toBeLessThanOrEqual(0);
          if (balance < min) expect(delta).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('nulle quand le motif ne fait rien gagner ni perdre (paramètres neutres)', () => {
    fc.assert(
      fc.property(bounds, fc.integer({ min: -MAX, max: MAX }), ([min, max], balance) => {
        expect(honorChange(balance, 'archon_term', rules(min, max, 0))).toBe(0);
      }),
    );
  });
});
