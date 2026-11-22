import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import {
  LOAN_STATUSES,
  loanBorrowFromTempleInputSchema,
  loanDisbursedSchema,
  loanRepayInputSchema,
} from './loan';

describe('prêts du temple (#724)', () => {
  it('loan.borrowFromTemple : principal positif, durée et taux vu entiers et bornés', () => {
    const input = { principal: 1_000, termDays: 7, expectedRateBps: 1_000 };
    expect(loanBorrowFromTempleInputSchema.parse(input)).toEqual(input);
    const bad = (patch: Record<string, unknown>) =>
      loanBorrowFromTempleInputSchema.safeParse({ ...input, ...patch }).success;
    for (const patch of [
      { principal: 0 },
      { principal: 1.5 },
      { principal: Number.MAX_SAFE_INTEGER + 1 },
      { termDays: 0 },
      { termDays: 367 },
      { expectedRateBps: -1 },
      { expectedRateBps: 10_001 },
      { houseId: '01900000-0000-7000-8000-0000000724a1' },
    ])
      expect(bad(patch), JSON.stringify(patch)).toBe(false);
    expect(bad({ expectedRateBps: 0, termDays: 366 })).toBe(true);
  });

  it('loan.repay : un prêt et un montant positif', () => {
    const input = { loanId: '01900000-0000-7000-8000-0000000724c1', amount: 1 };
    expect(loanRepayInputSchema.parse(input)).toEqual(input);
    expect(loanRepayInputSchema.safeParse({ ...input, amount: 0 }).success).toBe(false);
    expect(loanRepayInputSchema.safeParse({ ...input, loanId: 'x' }).success).toBe(false);
  });

  it('LoanDisbursed et LoanRepaid se relisent par l’union ; états fermés', () => {
    const disbursed = {
      type: 'LoanDisbursed' as const,
      payload: {
        loanId: '01900000-0000-7000-8000-0000000724c1',
        houseId: '01900000-0000-7000-8000-0000000724a1',
        lender: 'temple' as const,
        principal: 1_000,
        rateBps: 1_000,
        termDays: 7,
        interest: 2,
        outstanding: 1_002,
        dueDay: 20_790,
        dueAt: '2026-11-28T03:00:00.000Z',
      },
    };
    expect(domainEventSchema.parse(disbursed)).toEqual(disbursed);
    expect(
      loanDisbursedSchema.safeParse({
        ...disbursed,
        payload: { ...disbursed.payload, lender: 'bank' },
      }).success,
    ).toBe(false);
    const repaid = {
      type: 'LoanRepaid' as const,
      payload: {
        loanId: disbursed.payload.loanId,
        houseId: disbursed.payload.houseId,
        interest: 2,
        principal: 998,
        outstanding: 2,
        status: 'active' as const,
      },
    };
    expect(domainEventSchema.parse(repaid)).toEqual(repaid);
    expect(
      domainEventSchema.safeParse({ ...repaid, payload: { ...repaid.payload, status: 'gone' } })
        .success,
    ).toBe(false);
    expect(LOAN_STATUSES).toEqual(['active', 'repaid', 'defaulted']);
  });

  it('prélèvement et défaut de la clôture (#725) : parts non nulles ensemble, Timè perdue positive', () => {
    const loanId = '01900000-0000-7000-8000-000000000725';
    const houseId = '01900000-0000-7000-8000-0000000007a5';
    const collected = {
      type: 'LoanCollected' as const,
      payload: {
        loanId,
        houseId,
        interest: 5,
        principal: 0,
        outstanding: 95,
        status: 'active' as const,
        gameDay: 9,
      },
    };
    expect(domainEventSchema.parse(collected)).toEqual(collected);
    const nothing = { ...collected.payload, interest: 0 };
    expect(domainEventSchema.safeParse({ ...collected, payload: nothing }).success).toBe(false);
    const defaulted = {
      type: 'LoanDefaulted' as const,
      payload: {
        loanId,
        houseId,
        lender: 'temple' as const,
        outstanding: 95,
        honorLost: 0,
        gameDay: 9,
      },
    };
    expect(domainEventSchema.parse(defaulted)).toEqual(defaulted);
    // Un prêt de banque passe en défaut avec sa saisie (#729).
    const bankDefault = {
      ...defaulted,
      payload: { ...defaulted.payload, lender: 'bank' as const },
    };
    expect(domainEventSchema.parse(bankDefault)).toEqual(bankDefault);
    for (const patch of [
      { outstanding: 0 },
      { honorLost: -1 },
      { gameDay: -1 },
      { lender: 'guild' },
    ])
      expect(
        domainEventSchema.safeParse({ ...defaulted, payload: { ...defaulted.payload, ...patch } })
          .success,
        JSON.stringify(patch),
      ).toBe(false);
  });
});
