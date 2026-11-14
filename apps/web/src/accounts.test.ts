import { describe, expect, it } from 'vitest';
import { parseBalanceSheet, parseValuedStocks, sortRows } from './accounts';

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

const priced = {
  city_id: 'kalliste',
  good_id: 'wheat',
  quantity: 40,
  unit_price: 7,
  value: 280,
  priced_at: '2026-11-14T10:00:00.123456+00:00',
};
const unpriced = { ...priced, good_id: 'clay', unit_price: null, value: null, priced_at: null };

describe('stocks valorisés lus par le client', () => {
  it('lit prix, valeur et date ; un stock sans prix observé n’a aucun des trois', () => {
    expect(parseValuedStocks([{ ...priced, house_id: 'h' }, unpriced])).toEqual([
      {
        cityId: 'kalliste',
        goodId: 'wheat',
        quantity: 40,
        unitPrice: 7,
        value: 280,
        pricedAt: Date.UTC(2026, 10, 14, 10, 0, 0, 123),
      },
      {
        cityId: 'kalliste',
        goodId: 'clay',
        quantity: 40,
        unitPrice: null,
        value: null,
        pricedAt: null,
      },
    ]);
    expect(parseValuedStocks([])).toEqual([]);
  });

  it.each([
    null,
    [{ ...priced, quantity: 0 }],
    [{ ...priced, quantity: 1.5 }],
    [{ ...priced, value: null }],
    [{ ...priced, priced_at: null }],
    [{ ...unpriced, value: 280 }],
    [{ ...priced, priced_at: 'hier' }],
    [{ ...priced, value: 2 ** 53 }],
    [priced, { ...priced, good_id: '' }],
  ])('ligne illisible ou incohérente (%j) : stocks inconnus, jamais « aucun stock »', (raw) => {
    expect(parseValuedStocks(raw)).toBeNull();
  });
});

describe('tri des tableaux de comptes', () => {
  const rows = [
    { name: 'Blé', value: 30 },
    { name: 'Argile', value: null },
    { name: 'Vin', value: 280 },
    { name: 'Écorce', value: 30 },
    { name: 'Sel', value: null },
  ];
  const names = (sorted: typeof rows) => sorted.map((row) => row.name);

  it('nombres dans les deux sens : sans valeur à la fin, ordre reçu gardé à égalité', () => {
    const byValue = (descending: boolean) =>
      names(sortRows(rows, (r) => r.value, descending, 'fr'));
    expect(byValue(true)).toEqual(['Vin', 'Blé', 'Écorce', 'Argile', 'Sel']);
    expect(byValue(false)).toEqual(['Blé', 'Écorce', 'Vin', 'Argile', 'Sel']);
    expect(names(rows)[0]).toBe('Blé');
  });

  it('textes dans l’ordre de la langue : « Écorce » entre « Blé » et « Sel », pas après « Vin »', () => {
    const byName = (descending: boolean) => names(sortRows(rows, (r) => r.name, descending, 'fr'));
    expect(byName(false)).toEqual(['Argile', 'Blé', 'Écorce', 'Sel', 'Vin']);
    expect(byName(true)).toEqual(['Vin', 'Sel', 'Écorce', 'Blé', 'Argile']);
  });
});
