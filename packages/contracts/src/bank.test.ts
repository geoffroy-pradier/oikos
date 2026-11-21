import { describe, expect, it } from 'vitest';
import {
  bankDepositInputSchema,
  bankFoundInputSchema,
  bankMoveCapitalInputSchema,
  bankSetRatesInputSchema,
  bankWithdrawInputSchema,
} from './bank';
import { domainEventSchema } from './events';

describe('banques de joueurs (#726)', () => {
  it('bank.found : un nom de maison, un capital et un droit vu entiers, nuls admis', () => {
    const input = { name: 'Trapeza Alkmaion', capital: 20_000, expectedCharterFee: 5_000 };
    expect(bankFoundInputSchema.parse(input)).toEqual(input);
    const ok = (patch: Record<string, unknown>) =>
      bankFoundInputSchema.safeParse({ ...input, ...patch }).success;
    for (const patch of [
      { name: 'T' },
      { name: 'Trapeza 1' },
      { capital: -1 },
      { capital: 1.5 },
      { capital: Number.MAX_SAFE_INTEGER + 1 },
      { expectedCharterFee: -1 },
      { expectedCharterFee: undefined },
      { cityId: '01900000-0000-7000-8000-000000000101' },
    ])
      expect(ok(patch), JSON.stringify(patch)).toBe(false);
    expect(ok({ capital: 0, expectedCharterFee: 0 })).toBe(true);
  });

  it('bank.moveCapital : un sens et un montant positif', () => {
    const input = { direction: 'out', amount: 1 };
    expect(bankMoveCapitalInputSchema.parse(input)).toEqual(input);
    for (const patch of [{ amount: 0 }, { amount: 2.5 }, { direction: 'both' }, { bankId: 'x' }])
      expect(bankMoveCapitalInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });

  it('BankFounded et BankCapitalMoved se relisent par l’union', () => {
    const ids = {
      bankId: '01900000-0000-7000-8000-0000000726b1',
      houseId: '01900000-0000-7000-8000-0000000726a1',
    };
    const founded = {
      type: 'BankFounded' as const,
      payload: {
        ...ids,
        cityId: '01900000-0000-7000-8000-000000000101',
        name: 'Trapeza Alkmaion',
        charterFee: 5_000,
        capital: 20_000,
        depositRateBps: 0,
        loanRateBps: 300,
      },
    };
    const moved = {
      type: 'BankCapitalMoved' as const,
      payload: {
        ...ids,
        direction: 'in' as const,
        amount: 10,
        vault: 20_010,
        requiredReserve: 20_000,
      },
    };
    expect(domainEventSchema.parse(founded)).toEqual(founded);
    expect(domainEventSchema.parse(moved)).toEqual(moved);
    expect(
      domainEventSchema.safeParse({ ...moved, payload: { ...moved.payload, amount: 0 } }).success,
    ).toBe(false);
  });

  it('bank.deposit, bank.withdraw, bank.setRates : une banque, un montant positif, des taux entiers (#727)', () => {
    const bankId = '01900000-0000-7000-8000-0000000727b1';
    const deposit = { bankId, amount: 1, expectedRateBps: 0 };
    expect(bankDepositInputSchema.parse(deposit)).toEqual(deposit);
    for (const patch of [
      { amount: 0 },
      { amount: 1.5 },
      { amount: Number.MAX_SAFE_INTEGER + 1 },
      { expectedRateBps: -1 },
      { expectedRateBps: 1_000_001 },
      { expectedRateBps: undefined },
      { bankId: 'x' },
      { houseId: bankId },
    ])
      expect(bankDepositInputSchema.safeParse({ ...deposit, ...patch }).success).toBe(false);
    const withdraw = { bankId, amount: 7 };
    expect(bankWithdrawInputSchema.parse(withdraw)).toEqual(withdraw);
    for (const patch of [{ amount: 0 }, { amount: -7 }, { bankId: undefined }, { rateBps: 1 }])
      expect(bankWithdrawInputSchema.safeParse({ ...withdraw, ...patch }).success).toBe(false);
    const rates = { depositRateBps: 0, loanRateBps: 1_000_000 };
    expect(bankSetRatesInputSchema.parse(rates)).toEqual(rates);
    for (const patch of [{ depositRateBps: 0.5 }, { loanRateBps: -1 }, { bankId }])
      expect(bankSetRatesInputSchema.safeParse({ ...rates, ...patch }).success).toBe(false);
  });

  it('BankDeposited, BankWithdrawn, BankRatesSet et BankInterestCredited se relisent par l’union (#727)', () => {
    const ids = {
      bankId: '01900000-0000-7000-8000-0000000727b1',
      houseId: '01900000-0000-7000-8000-0000000727a1',
    };
    const depositId = '01900000-0000-7000-8000-0000000727d1';
    const events = [
      {
        type: 'BankDeposited' as const,
        payload: { ...ids, depositId, amount: 10, balance: 10, rateBps: 500 },
      },
      { type: 'BankWithdrawn' as const, payload: { ...ids, depositId, amount: 10, balance: 0 } },
      { type: 'BankRatesSet' as const, payload: { ...ids, depositRateBps: 0, loanRateBps: 300 } },
      {
        type: 'BankInterestCredited' as const,
        payload: { ...ids, depositId, interest: 1, rateBps: 500, balance: 7_301, gameDay: 20_000 },
      },
    ];
    for (const event of events) expect(domainEventSchema.parse(event)).toEqual(event);
    // Un intérêt nul ne s'écrit pas ; un solde négatif n'existe pas.
    const [, withdrawn, , credited] = events;
    expect(
      domainEventSchema.safeParse({ ...credited, payload: { ...credited?.payload, interest: 0 } })
        .success,
    ).toBe(false);
    expect(
      domainEventSchema.safeParse({ ...withdrawn, payload: { ...withdrawn?.payload, balance: -1 } })
        .success,
    ).toBe(false);
  });
});
