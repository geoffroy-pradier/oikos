import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bankLendable, bankRequiredReserve, collectDueLoans, loanInterest } from './index';

const rules = fc.record({
  minCapitalOboles: fc.integer({ min: 0, max: 1e9 }),
  reserveRatioBps: fc.integer({ min: 0, max: 10_000 }),
});

describe('prêts de banque (#728)', () => {
  it('un prêt dans la limite prêtable garde le coffre à la réserve ; une obole de plus l’entame', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        rules,
        (vault, deposits, reserveRules) => {
          const reserve = bankRequiredReserve(deposits, reserveRules);
          const lendable = bankLendable(vault, reserve);
          expect(lendable >= 0n && lendable <= vault).toBe(true);
          if (lendable > 0n) expect(vault - lendable).toBe(reserve);
          expect(vault - (lendable + 1n) < reserve).toBe(true);
        },
      ),
    );
  });

  it('un coffre à la réserve, ou sous elle, ne prête rien', () => {
    expect(bankLendable(1_000n, 1_000n)).toBe(0n);
    expect(bankLendable(999n, 1_000n)).toBe(0n);
    expect(bankLendable(0n, 0n)).toBe(0n);
    expect(bankLendable(1_001n, 1_000n)).toBe(1n);
  });

  it('les clôtures successives prélèvent, tous prêteurs confondus, dans l’ordre des prêts, jusqu’au reste dû exact', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            principal: fc.bigInt({ min: 1n, max: 10n ** 12n }),
            rateBps: fc.integer({ min: 0, max: 1_000_000 }),
            termDays: fc.integer({ min: 1, max: 366 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 12n }), { minLength: 1, maxLength: 30 }),
        (terms, treasuries) => {
          // Prêts d'une maison, du plus ancien au plus récent, qu'ils viennent du temple ou d'une banque.
          let loans = terms.map((loan, index) => {
            const interest = loanInterest(loan.principal, loan.rateBps, loan.termDays);
            return {
              id: String(index),
              outstanding: loan.principal + interest,
              interestDue: interest,
            };
          });
          const owed = loans.reduce((sum, loan) => sum + loan.outstanding, 0n);
          let [taken, offered] = [0n, 0n];
          for (const treasury of treasuries) {
            const shares = collectDueLoans(treasury, loans);
            const day = shares.reduce((sum, share) => sum + share.interest + share.principal, 0n);
            // Jamais plus que la trésorerie ; un prêt ne reste dû que si elle est vide.
            expect(day <= treasury).toBe(true);
            if (shares.some((share) => share.outstanding > 0n)) expect(day).toBe(treasury);
            for (const [index, share] of shares.entries()) {
              const loan = loans[index];
              if (!loan) throw new Error('one share per loan');
              // Un prêt plus récent ne prend rien tant qu'un plus ancien reste dû.
              if (shares.slice(0, index).some((before) => before.outstanding > 0n))
                expect(share.interest + share.principal).toBe(0n);
              // Intérêts d'abord, jamais plus que ce qui reste dû.
              if (share.principal > 0n) expect(share.interest).toBe(loan.interestDue);
              expect(share.outstanding).toBe(loan.outstanding - share.interest - share.principal);
              expect(share.outstanding >= 0n).toBe(true);
            }
            loans = loans.map((loan, index) => ({
              ...loan,
              outstanding: shares[index]?.outstanding ?? loan.outstanding,
              interestDue: loan.interestDue - (shares[index]?.interest ?? 0n),
            }));
            taken += day;
            offered += treasury;
          }
          // Ce qui est pris, sur toutes les clôtures, est ce que les trésoreries couvrent, au plus le reste dû.
          expect(taken).toBe(owed < offered ? owed : offered);
        },
      ),
    );
  });

  it('l’intérêt est arrondi à l’obole supérieure, nul au taux nul', () => {
    expect(loanInterest(1_000n, 0, 30)).toBe(0n);
    expect(loanInterest(1n, 1, 1)).toBe(1n);
    expect(loanInterest(5_000n, 1_200, 30)).toBe(50n);
    expect(loanInterest(3_000n, 1_200, 30)).toBe(30n);
  });
});
