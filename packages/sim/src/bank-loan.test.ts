import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bankLendable,
  bankRequiredReserve,
  collectDueLoans,
  loanInterest,
  splitLoanRepayment,
} from './index';

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

  it('du décaissement au solde, la monnaie passe du coffre à l’emprunteur et revient, sans se créer ni se perdre', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 366 }),
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.array(
          fc.record({ income: fc.bigInt({ min: 0n, max: 10n ** 11n }), repay: fc.boolean() }),
          {
            maxLength: 40,
          },
        ),
        (principal, rateBps, termDays, cash, days) => {
          const interest = loanInterest(principal, rateBps, termDays);
          let vault = principal;
          let treasury = cash;
          let outstanding = principal + interest;
          let interestDue = interest;
          // Décaissement : le principal passe du coffre à la trésorerie.
          vault -= principal;
          treasury += principal;
          // Hors des revenus que la trésorerie reçoit d'ailleurs, coffre et trésorerie gardent leur somme.
          const base = vault + treasury;
          let income = 0n;
          for (const day of days) {
            treasury += day.income;
            income += day.income;
            if (outstanding === 0n) break;
            // Un remboursement de la maison, ou le prélèvement de la clôture sur ce que la trésorerie couvre.
            const [taken] = day.repay
              ? (() => {
                  const amount = treasury < outstanding ? treasury : outstanding;
                  if (amount === 0n) return [{ interest: 0n, principal: 0n, outstanding }];
                  const split = splitLoanRepayment(amount, interestDue);
                  return [{ ...split, outstanding: outstanding - amount }];
                })()
              : collectDueLoans(treasury, [{ id: 'l', outstanding, interestDue }]);
            if (!taken) throw new Error('one loan, one share');
            expect(taken.interest <= interestDue).toBe(true);
            // Intérêts d'abord : aucun principal tant qu'il reste des intérêts.
            if (taken.principal > 0n) expect(taken.interest).toBe(interestDue);
            const paid = taken.interest + taken.principal;
            treasury -= paid;
            vault += paid;
            interestDue -= taken.interest;
            outstanding -= paid;
            expect(taken.outstanding).toBe(outstanding);
            expect(treasury >= 0n && outstanding >= 0n).toBe(true);
            expect(vault + treasury).toBe(base + income);
          }
          if (outstanding === 0n) expect(vault).toBe(principal + interest);
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
