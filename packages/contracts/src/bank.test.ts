import { describe, expect, it } from 'vitest';
import { bankFoundInputSchema } from './bank';
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

  it('BankFounded se relit par l’union', () => {
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
    expect(domainEventSchema.parse(founded)).toEqual(founded);
  });
});
