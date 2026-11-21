import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { splitLoanRepayment, templeLoanCap, templeLoanInterest } from './temple-loan';

describe('intérêt d’un prêt du temple (#724)', () => {
  it('exemples : principal × taux × jours ÷ (10 000 × 365), arrondi à l’obole supérieure', () => {
    // 10 000 oboles à 10 % l'an pendant 365 jours : 1 000 tout juste.
    expect(templeLoanInterest(10_000n, 1_000, 365)).toBe(1_000n);
    // 1 000 oboles à 10 % pendant 7 jours : 1,917… arrondi à 2.
    expect(templeLoanInterest(1_000n, 1_000, 7)).toBe(2n);
    // Une obole au plus petit taux, un jour : une obole d'intérêt, jamais zéro.
    expect(templeLoanInterest(1n, 1, 1)).toBe(1n);
    // Taux nul : aucun intérêt.
    expect(templeLoanInterest(5_000n, 0, 28)).toBe(0n);
    // Juste au-dessus d'un entier : 3 650 001 × 1 × 1 ÷ 3 650 000 = 1,000…3, arrondi à 2.
    expect(templeLoanInterest(3_650_001n, 1, 1)).toBe(2n);
    expect(templeLoanInterest(3_650_000n, 1, 1)).toBe(1n);
  });

  it('refuse un principal nul ou négatif, un taux ou une durée hors des entiers admis', () => {
    expect(() => templeLoanInterest(0n, 1_000, 7)).toThrow(RangeError);
    expect(() => templeLoanInterest(-1n, 1_000, 7)).toThrow(RangeError);
    expect(() => templeLoanInterest(1n, -1, 7)).toThrow(RangeError);
    expect(() => templeLoanInterest(1n, 1.5, 7)).toThrow(RangeError);
    expect(() => templeLoanInterest(1n, 1_000, 0)).toThrow(RangeError);
  });

  it('propriété : le plus petit entier dont 3 650 000 fois couvre le produit, croissant en chaque terme', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 366 }),
        (principal, rate, days) => {
          const interest = templeLoanInterest(principal, rate, days);
          const product = principal * BigInt(rate) * BigInt(days);
          expect(interest * 3_650_000n >= product).toBe(true);
          expect((interest - 1n) * 3_650_000n < product).toBe(true);
          expect(interest === 0n).toBe(rate === 0);
          expect(templeLoanInterest(principal + 1n, rate, days) >= interest).toBe(true);
          expect(templeLoanInterest(principal, rate, days + 1) >= interest).toBe(true);
          // Au taux et à la durée les plus hauts, l'intérêt dépasse à peine le principal : le reste dû reste sûr.
          expect(interest <= principal * 2n).toBe(true);
        },
      ),
    );
  });
});

describe('plafond du principal par la Timè (#724)', () => {
  const tiers = [
    { minHonor: -10, maxPrincipal: 100 },
    { minHonor: 0, maxPrincipal: 1_000 },
    { minHonor: 50, maxPrincipal: 5_000 },
  ];
  it('le plafond du plus haut palier atteint, bord compris ; rien sous le premier ni sans palier', () => {
    expect(templeLoanCap(-11, tiers)).toBe(0);
    expect(templeLoanCap(-10, tiers)).toBe(100);
    expect(templeLoanCap(-1, tiers)).toBe(100);
    expect(templeLoanCap(0, tiers)).toBe(1_000);
    expect(templeLoanCap(49, tiers)).toBe(1_000);
    expect(templeLoanCap(50, tiers)).toBe(5_000);
    expect(templeLoanCap(1_000_000, tiers)).toBe(5_000);
    expect(templeLoanCap(0, [])).toBe(0);
    // Plafonds nuls de la configuration initiale.
    expect(templeLoanCap(10_000, [{ minHonor: 0, maxPrincipal: 0 }])).toBe(0);
    expect(() => templeLoanCap(0.5, tiers)).toThrow(RangeError);
  });

  it('propriété : plus de Timè ne prête jamais moins', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), fc.nat(50), (honor, more) => {
        expect(templeLoanCap(honor + more, tiers)).toBeGreaterThanOrEqual(
          templeLoanCap(honor, tiers),
        );
      }),
    );
  });
});

describe('partage d’un remboursement (#724)', () => {
  it('intérêts d’abord, puis le principal', () => {
    expect(splitLoanRepayment(5n, 20n)).toEqual({ interest: 5n, principal: 0n });
    expect(splitLoanRepayment(20n, 20n)).toEqual({ interest: 20n, principal: 0n });
    expect(splitLoanRepayment(21n, 20n)).toEqual({ interest: 20n, principal: 1n });
    expect(splitLoanRepayment(300n, 0n)).toEqual({ interest: 0n, principal: 300n });
    expect(() => splitLoanRepayment(0n, 20n)).toThrow(RangeError);
    expect(() => splitLoanRepayment(1n, -1n)).toThrow(RangeError);
  });

  it('propriété : conservation, et des remboursements successifs paient tous les intérêts avant le principal', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.array(fc.bigInt({ min: 1n, max: 10n ** 9n }), { minLength: 1, maxLength: 20 }),
        (principal, interest, payments) => {
          let [interestDue, principalDue] = [interest, principal];
          for (const wanted of payments) {
            const outstanding = interestDue + principalDue;
            if (outstanding === 0n) break;
            const amount = wanted > outstanding ? outstanding : wanted;
            const split = splitLoanRepayment(amount, interestDue);
            expect(split.interest + split.principal).toBe(amount);
            expect(split.interest >= 0n && split.principal >= 0n).toBe(true);
            // Un principal payé ne laisse aucun intérêt dû.
            if (split.principal > 0n) expect(split.interest).toBe(interestDue);
            interestDue -= split.interest;
            principalDue -= split.principal;
            expect(principalDue >= 0n).toBe(true);
          }
          expect(interestDue >= 0n).toBe(true);
        },
      ),
    );
  });
});
