import { describe, expect, it } from 'vitest';
import { parseBalanceSheet } from './accounts';

const sheet = { treasury: 2990, escrow: 10, stock_value: 280, unpriced_stocks: 1 };

describe('bilan lu par le client', () => {
  it('le total est la trésorerie, le séquestre et les stocks valorisés ; colonnes en plus ignorées', () => {
    expect(parseBalanceSheet({ ...sheet, house_id: 'h' })).toEqual({
      treasury: 2990,
      escrow: 10,
      stockValue: 280,
      unpricedStocks: 1,
      total: 3280,
    });
    const empty = { treasury: 0, escrow: 0, stock_value: 0, unpriced_stocks: 0 };
    expect(parseBalanceSheet(empty)?.total).toBe(0);
  });

  it.each([
    undefined,
    null,
    {},
    { ...sheet, treasury: '2990' },
    { ...sheet, treasury: 0.5 },
    { ...sheet, escrow: null },
    { ...sheet, stock_value: -1 },
    { ...sheet, unpriced_stocks: -1 },
    // Au-delà de 2^53, un montant n'est plus exact : ni une ligne, ni leur somme.
    { ...sheet, treasury: 2 ** 53 },
    { ...sheet, treasury: Number.MAX_SAFE_INTEGER, escrow: 1 },
  ])('ligne absente ou montant intenable (%j) : bilan inconnu, jamais nul', (raw) => {
    expect(parseBalanceSheet(raw)).toBeNull();
  });
});
