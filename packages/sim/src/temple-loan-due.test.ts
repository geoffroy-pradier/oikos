import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { collectDueLoans, dishonorMark, type LoanStanding } from './temple-loan-due';

const due = (id: string, outstanding: bigint, interestDue: bigint) => ({
  id,
  outstanding,
  interestDue,
});

describe('prélèvement de la clôture sur les prêts échus (#725)', () => {
  it('exemples : en entier, en partie intérêts d’abord, rien sur une trésorerie vide', () => {
    expect(collectDueLoans(1_000n, [due('a', 600n, 50n)])).toEqual([
      { id: 'a', interest: 50n, principal: 550n, outstanding: 0n },
    ]);
    // 30 oboles pour 50 d'intérêts : tout aux intérêts, rien au principal.
    expect(collectDueLoans(30n, [due('a', 600n, 50n)])).toEqual([
      { id: 'a', interest: 30n, principal: 0n, outstanding: 570n },
    ]);
    // Le premier prêt prend tout, le second rien.
    expect(collectDueLoans(100n, [due('a', 100n, 0n), due('b', 40n, 10n)])).toEqual([
      { id: 'a', interest: 0n, principal: 100n, outstanding: 0n },
      { id: 'b', interest: 0n, principal: 0n, outstanding: 40n },
    ]);
    expect(collectDueLoans(0n, [due('a', 7n, 7n)])).toEqual([
      { id: 'a', interest: 0n, principal: 0n, outstanding: 7n },
    ]);
    // Reste dû nul : rien à prendre, même sur une trésorerie pleine.
    expect(collectDueLoans(9n, [due('a', 0n, 0n)])).toEqual([
      { id: 'a', interest: 0n, principal: 0n, outstanding: 0n },
    ]);
    expect(collectDueLoans(9n, [])).toEqual([]);
  });

  it('refuse une trésorerie négative, des intérêts au-delà du reste dû', () => {
    expect(() => collectDueLoans(-1n, [])).toThrow(RangeError);
    expect(() => collectDueLoans(1n, [due('a', 5n, 6n)])).toThrow(RangeError);
    expect(() => collectDueLoans(1n, [due('a', -1n, 0n)])).toThrow(RangeError);
  });

  it('propriété : conservation, au plus la trésorerie et le reste dû, intérêts d’abord, reste dû seulement si vide', () => {
    const loan = fc
      .tuple(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 0n, max: 10n ** 12n }))
      .map(([a, b]) =>
        a < b ? { outstanding: b, interestDue: a } : { outstanding: a, interestDue: b },
      );
    const loanLists = fc
      .array(loan, { maxLength: 6 })
      .map((rows) => rows.map((row, index) => due(`l${index}`, row.outstanding, row.interestDue)));
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 13n }), loanLists, (treasury, loans) => {
        const taken = collectDueLoans(treasury, loans);
        let total = 0n;
        taken.forEach((collected, index) => {
          const before = loans[index];
          if (!before) throw new Error('one collection per loan');
          const amount = collected.interest + collected.principal;
          total += amount;
          expect(collected.id).toBe(before.id);
          expect(collected.interest >= 0n && collected.principal >= 0n).toBe(true);
          // Le reste dû baisse exactement de ce qui est pris : rien ne se crée, rien ne se perd.
          expect(collected.outstanding + amount).toBe(before.outstanding);
          // Intérêts d'abord : aucun principal tant qu'il reste des intérêts.
          expect(collected.principal === 0n || collected.interest === before.interestDue).toBe(
            true,
          );
        });
        expect(total <= treasury).toBe(true);
        const unpaid = taken.some((collected) => collected.outstanding > 0n);
        if (unpaid) expect(total).toBe(treasury);
        else expect(total).toBe(loans.reduce((sum, l) => sum + l.outstanding, 0n));
      }),
    );
  });
});

const standing = (
  status: LoanStanding['status'],
  defaultedDay: number | null = null,
  repaidDay: number | null = null,
): LoanStanding => ({ status, defaultedDay, repaidDay });

describe('marque de déshonneur (#725)', () => {
  it('portée tant qu’un prêt est en défaut, puis jusqu’à la clôture `dishonorDays` jours après le solde', () => {
    expect(dishonorMark([], 100, 28)).toEqual({ dishonored: false, untilDay: null });
    expect(dishonorMark([standing('defaulted', 90)], 100, 28)).toEqual({
      dishonored: true,
      untilDay: null,
    });
    // Soldé le jour 95 : marqué jusqu'au jour 122 compris, levée à la clôture du jour 123.
    const repaid = [standing('repaid', 90, 95)];
    expect(dishonorMark(repaid, 122, 28)).toEqual({ dishonored: true, untilDay: 123 });
    expect(dishonorMark(repaid, 123, 28)).toEqual({ dishonored: false, untilDay: null });
    // Zéro jour : levée au solde.
    expect(dishonorMark(repaid, 95, 0).dishonored).toBe(false);
    expect(dishonorMark(repaid, 94, 0)).toEqual({ dishonored: true, untilDay: 95 });
    // Un prêt soldé sans défaut, un prêt en cours ne marquent pas.
    expect(
      dishonorMark([standing('repaid', null, 95), standing('active')], 96, 28).dishonored,
    ).toBe(false);
    // Un prêt encore en défaut l'emporte sur une marque qui finit.
    expect(dishonorMark([standing('repaid', 80, 85), standing('defaulted', 99)], 100, 28)).toEqual({
      dishonored: true,
      untilDay: null,
    });
    // Deux prêts soldés : la marque finit avec le plus tardif.
    expect(dishonorMark([standing('repaid', 10, 20), standing('repaid', 30, 40)], 50, 28)).toEqual({
      dishonored: true,
      untilDay: 68,
    });
  });

  it('refuse une durée négative ou un jour hors des entiers sûrs', () => {
    expect(() => dishonorMark([], 1, -1)).toThrow(RangeError);
    expect(() => dishonorMark([], 1.5, 0)).toThrow(RangeError);
  });

  it('propriété : la marque finie ne dure pas plus que `dishonorDays` après le dernier solde, et ne revient pas', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .tuple(
              fc.integer({ min: 0, max: 1_000 }),
              fc.integer({ min: 0, max: 100 }),
              fc.boolean(),
            )
            .map(([day, delay, defaulted]) =>
              standing('repaid', defaulted ? day : null, day + delay),
            ),
          { maxLength: 5 },
        ),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 1_200 }),
        (loans, days, gameDay) => {
          const mark = dishonorMark(loans, gameDay, days);
          const ends = loans
            .filter((l) => l.defaultedDay !== null)
            .map((l) => (l.repaidDay ?? 0) + days);
          const last = ends.length > 0 ? Math.max(...ends) : null;
          expect(mark.dishonored).toBe(last !== null && gameDay < last);
          expect(mark.untilDay).toBe(mark.dishonored ? last : null);
          if (!mark.dishonored)
            expect(dishonorMark(loans, gameDay + 1, days).dishonored).toBe(false);
        },
      ),
    );
  });
});
