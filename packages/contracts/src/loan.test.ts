import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { loanBorrowFromTempleInputSchema, loanDisbursedSchema } from './loan';

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

  it('LoanDisbursed se relit par l’union, du seul temple', () => {
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
  });
});
