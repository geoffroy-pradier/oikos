import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { charisDecay, offeringCharis, type CharisRates } from './charis';

const DEMETER: CharisRates = { charisPerObole: 1, charisPerUnit: { wheat: 6, bread: 15 } };
const charis = fc.oneof(
  fc.constantFrom(0, 1, 99, 100, 9_999, 10_000, Number.MAX_SAFE_INTEGER),
  fc.nat(),
  fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
);
const bps = fc.oneof(
  fc.constantFrom(0, 1, 100, 9_999, 10_000),
  fc.integer({ min: 0, max: 10_000 }),
);

describe('Charis d’une offrande (#265)', () => {
  it('exemples : monnaie et biens au taux du dieu, refus de ce qu’il n’accepte pas', () => {
    expect(offeringCharis(DEMETER, { oboles: 40, goods: [] })).toEqual({ ok: true, charis: 40 });
    expect(
      offeringCharis(DEMETER, {
        oboles: 5,
        goods: [
          { goodId: 'wheat', quantity: 10 },
          { goodId: 'bread', quantity: 2 },
        ],
      }),
    ).toEqual({ ok: true, charis: 95 });
    expect(offeringCharis(DEMETER, { oboles: 0, goods: [] })).toEqual({ ok: true, charis: 0 });
    // Un bien sans taux, même avec de la monnaie acceptée, fait refuser toute l'offrande.
    expect(
      offeringCharis(DEMETER, { oboles: 5, goods: [{ goodId: 'fish', quantity: 1 }] }),
    ).toEqual({ ok: false, refused: { kind: 'good', goodId: 'fish' } });
    // Un bien nommé comme une propriété d'objet n'a pas de taux pour autant.
    expect(
      offeringCharis(DEMETER, { oboles: 0, goods: [{ goodId: 'toString', quantity: 1 }] }),
    ).toEqual({ ok: false, refused: { kind: 'good', goodId: 'toString' } });
    const moneyless = { ...DEMETER, charisPerObole: 0 };
    expect(offeringCharis(moneyless, { oboles: 1, goods: [] })).toEqual({
      ok: false,
      refused: { kind: 'oboles' },
    });
    // Sans monnaie, un dieu qui la refuse accepte encore les biens.
    expect(
      offeringCharis(moneyless, { oboles: 0, goods: [{ goodId: 'wheat', quantity: 1 }] }),
    ).toEqual({ ok: true, charis: 6 });
  });

  it('additive : offrir en deux fois rapporte exactement autant qu’en une', () => {
    const quantity = fc.integer({ min: 1, max: 1_000_000 });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        quantity,
        quantity,
        (perObole, perUnit, oboles, more, wheat, extra) => {
          const rates = { charisPerObole: perObole, charisPerUnit: { wheat: perUnit || 1 } };
          const whole = offeringCharis(rates, {
            oboles: oboles + more,
            goods: [{ goodId: 'wheat', quantity: wheat + extra }],
          });
          const first = offeringCharis(rates, {
            oboles,
            goods: [{ goodId: 'wheat', quantity: wheat }],
          });
          const second = offeringCharis(rates, {
            oboles: more,
            goods: [{ goodId: 'wheat', quantity: extra }],
          });
          if (perObole === 0 && oboles + more > 0) {
            expect(whole).toEqual({ ok: false, refused: { kind: 'oboles' } });
            return;
          }
          if (!whole.ok || !first.ok || !second.ok)
            throw new Error('an accepted offering was refused');
          expect(whole.charis).toBe(first.charis + second.charis);
          expect(whole.charis).toBe(perObole * (oboles + more) + (perUnit || 1) * (wheat + extra));
          expect(Number.isSafeInteger(whole.charis)).toBe(true);
        },
      ),
    );
  });

  it('refuse les entrées invalides et un gain au-delà des entiers sûrs, sans l’arrondir', () => {
    for (const bad of [-1, 0.5, Number.NaN])
      expect(() => offeringCharis(DEMETER, { oboles: bad, goods: [] })).toThrow(RangeError);
    for (const bad of [0, -1, 0.5])
      expect(() =>
        offeringCharis(DEMETER, { oboles: 0, goods: [{ goodId: 'wheat', quantity: bad }] }),
      ).toThrow(RangeError);
    const twice = [
      { goodId: 'wheat', quantity: 1 },
      { goodId: 'wheat', quantity: 1 },
    ];
    expect(() => offeringCharis(DEMETER, { oboles: 0, goods: twice })).toThrow(RangeError);
    const rich = { charisPerObole: 1_000_000, charisPerUnit: {} };
    expect(offeringCharis(rich, { oboles: 9_007_199_254, goods: [] })).toEqual({
      ok: true,
      charis: 9_007_199_254_000_000,
    });
    expect(() => offeringCharis(rich, { oboles: 9_007_199_255, goods: [] })).toThrow(RangeError);
  });
});

describe('déclin quotidien de la Charis (#265)', () => {
  it('exemples : arrondi vers zéro, rien à zéro ni sous le seuil d’une unité', () => {
    expect(charisDecay(1_000, 100)).toBe(10);
    expect(charisDecay(1_099, 100)).toBe(10);
    expect(charisDecay(100, 100)).toBe(1);
    expect(charisDecay(99, 100)).toBe(0);
    expect(charisDecay(0, 100)).toBe(0);
    expect(charisDecay(5_000, 0)).toBe(0);
    expect(charisDecay(5_000, 10_000)).toBe(5_000);
    expect(charisDecay(Number.MAX_SAFE_INTEGER, 10_000)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('jamais plus que la Charis, jamais négatif, exact, monotone', () => {
    fc.assert(
      fc.property(charis, bps, (before, rate) => {
        const lost = charisDecay(before, rate);
        expect(Number.isSafeInteger(lost)).toBe(true);
        expect(lost).toBeGreaterThanOrEqual(0);
        expect(lost).toBeLessThanOrEqual(before);
        // Arrondi vers zéro : la perte exacte est dans [lost, lost + 1[.
        const exact = BigInt(before) * BigInt(rate);
        expect(BigInt(lost) * 10_000n <= exact && exact < BigInt(lost + 1) * 10_000n).toBe(true);
        // Plus de Charis ou un déclin plus fort ne font jamais perdre moins.
        if (before < Number.MAX_SAFE_INTEGER)
          expect(charisDecay(before + 1, rate)).toBeGreaterThanOrEqual(lost);
        if (rate < 10_000) expect(charisDecay(before, rate + 1)).toBeGreaterThanOrEqual(lost);
      }),
    );
  });

  it('refuse une Charis négative ou non entière, un déclin hors de 0 à 10 000', () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => charisDecay(bad, 100)).toThrow(RangeError);
    for (const bad of [-1, 10_001, 0.5]) expect(() => charisDecay(100, bad)).toThrow(RangeError);
  });
});
