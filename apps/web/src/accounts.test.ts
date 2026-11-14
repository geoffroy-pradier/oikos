import { describe, expect, it, vi } from 'vitest';
import { parseBalanceSheet, parseIncomeStatement, parseValuedStocks, sortRows } from './accounts';

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
    // La valeur n'est pas quantité × prix (40 × 7 = 280) : d'une obole, ou parce que la quantité diffère.
    [{ ...priced, value: 281 }],
    [{ ...priced, quantity: 41 }],
    [priced, { ...priced, good_id: '' }],
  ])('ligne illisible ou incohérente (%j) : stocks inconnus, jamais « aucun stock »', (raw) => {
    expect(parseValuedStocks(raw)).toBeNull();
  });

  it('date admise par le schéma mais illisible pour le navigateur : stocks inconnus', () => {
    const parse = vi.spyOn(Date, 'parse').mockReturnValue(Number.NaN);
    try {
      expect(parseValuedStocks([priced])).toBeNull();
      expect(parseValuedStocks([unpriced])).toHaveLength(1);
    } finally {
      parse.mockRestore();
    }
  });
});

describe('tri des tableaux de comptes', () => {
  // Tableau gelé : un tri en place lèverait une erreur au lieu de passer inaperçu.
  const rows = Object.freeze([
    { name: 'Blé', value: 30 },
    { name: 'Argile', value: null },
    { name: 'Vin', value: 280 },
    { name: 'Écorce', value: 30 },
    { name: 'Sel', value: null },
  ]);
  const names = (sorted: typeof rows) => sorted.map((row) => row.name);

  it('nombres dans les deux sens : sans valeur à la fin, ordre reçu gardé à égalité', () => {
    const byValue = (descending: boolean) =>
      names(sortRows(rows, (r) => r.value, descending, 'fr'));
    expect(byValue(true)).toEqual(['Vin', 'Blé', 'Écorce', 'Argile', 'Sel']);
    expect(byValue(false)).toEqual(['Blé', 'Écorce', 'Vin', 'Argile', 'Sel']);
    expect(names(rows)).toEqual(['Blé', 'Argile', 'Vin', 'Écorce', 'Sel']);
  });

  it('textes dans l’ordre de la langue : « Écorce » entre « Blé » et « Sel », pas après « Vin »', () => {
    const byName = (descending: boolean) => names(sortRows(rows, (r) => r.name, descending, 'fr'));
    expect(byName(false)).toEqual(['Argile', 'Blé', 'Écorce', 'Sel', 'Vin']);
    expect(byName(true)).toEqual(['Vin', 'Sel', 'Écorce', 'Blé', 'Argile']);
  });
});

describe('compte de résultat lu par le client', () => {
  const operating = { sales: 160, purchases: -40, taxes: -8, upkeep: -30, operating_result: 82 };
  const beyond = { acquisitions: -600, grants: 3000, other: 0, non_operating: 2400 };
  const sums = { ...operating, ...beyond, cash_change: 2482, escrow_change: 12 };
  const day = { ...sums, game_day: 20_771 };
  const season = { ...sums, first_game_day: 20_766, last_game_day: 20_772 };

  const period = (firstDay: number | null, lastDay: number | null) => [
    { ...sums, firstDay, lastDay },
  ];

  it('un jour est une période d’un jour, une saison va de son premier à son dernier jour', () => {
    expect(parseIncomeStatement([day])).toMatchObject(period(20_771, 20_771));
    expect(parseIncomeStatement([season])).toMatchObject(period(20_766, 20_772));
    expect(parseIncomeStatement([])).toEqual([]);
  });

  it('horloge inconnue : période sans jour, montants gardés', () => {
    const lost = { ...season, first_game_day: null, last_game_day: null };
    expect(parseIncomeStatement([{ ...day, game_day: null }])).toMatchObject(period(null, null));
    expect(parseIncomeStatement([lost])).toMatchObject(period(null, null));
  });

  it.each([
    null,
    [sums],
    [{ ...day, game_day: 1.5 }],
    [{ ...day, sales: '160' }],
    [{ ...day, escrow_change: undefined }],
    [{ ...day, upkeep: 2 ** 53 }],
    // Totaux qui ne tombent pas juste : exploitation, hors exploitation, variation de la monnaie.
    [{ ...day, operating_result: 83, cash_change: 2483 }],
    [{ ...day, non_operating: 2401, cash_change: 2483 }],
    [{ ...day, cash_change: 2481 }],
    [{ ...season, last_game_day: null }],
    [{ ...season, first_game_day: 20_773 }],
    [day, { ...day, taxes: 0 }],
  ])(
    'ligne illisible ou compte faux (%j) : résultat inconnu, jamais « aucun mouvement »',
    (raw) => {
      expect(parseIncomeStatement(raw)).toBeNull();
    },
  );
});
