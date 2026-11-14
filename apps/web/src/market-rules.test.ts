import { describe, expect, it } from 'vitest';
import { netProceeds, parseMarketTax, previewSale } from './market-rules';

describe('taxe de marché lue par le client', () => {
  it('lit la taxe en vigueur ; une version publiée avant elle ne taxe rien', () => {
    const tax = { rateBps: 500, burnShareBps: 5000 };
    expect(parseMarketTax({ market_tax: { ...tax, exemptions: [] } })).toEqual(tax);
    expect(parseMarketTax({ market_tax: null })).toEqual({ rateBps: 0, burnShareBps: 10_000 });
  });

  it.each([
    null,
    {},
    { market_tax: {} },
    { market_tax: { rateBps: 500 } },
    { market_tax: { rateBps: '500', burnShareBps: 0 } },
    { market_tax: { rateBps: 2.5, burnShareBps: 0 } },
    { market_tax: { rateBps: 10_001, burnShareBps: 0 } },
    { market_tax: { rateBps: 500, burnShareBps: -1 } },
  ])('ligne absente ou valeur intenable (%j) : taxe inconnue, jamais supposée nulle', (raw) => {
    expect(parseMarketTax(raw)).toBeNull();
  });

  it('net d’une vente : la taxe s’arrondit à l’obole supérieure, échange par échange', () => {
    const tax = { rateBps: 500, burnShareBps: 5000 };
    expect(netProceeds(tax, [{ price: 2, quantity: 80 }])).toBe(152);
    // Trois échanges de 6 oboles paient une obole chacun ; un seul de 18 n'en paierait qu'une.
    const unit = { price: 6, quantity: 1 };
    expect(netProceeds(tax, [unit, unit, unit])).toBe(15);
    expect(netProceeds(tax, [{ price: 6, quantity: 3 }])).toBe(17);
    expect(netProceeds({ rateBps: 0, burnShareBps: 0 }, [unit, unit])).toBe(12);
    expect(netProceeds(tax, [])).toBe(0);
  });

  it('avant une vente : brut, taxe et net d’un échange unique ; rien pour un achat, une taxe nulle ou inconnue, une saisie incomplète', () => {
    const tax = { rateBps: 500, burnShareBps: 5000 };
    expect(previewSale(tax, 'sell', ' 46 ', '30')).toEqual({ gross: 1380, tax: 69, net: 1311 });
    expect(previewSale(tax, 'sell', '1', '1')).toEqual({ gross: 1, tax: 1, net: 0 });
    expect(previewSale(tax, 'buy', '46', '30')).toBeNull();
    expect(previewSale(null, 'sell', '46', '30')).toBeNull();
    expect(previewSale({ rateBps: 0, burnShareBps: 0 }, 'sell', '46', '30')).toBeNull();
    for (const [price, quantity] of [
      ['', '30'],
      ['46', ''],
      ['0', '30'],
      ['4.6', '30'],
      ['1e3', '30'],
      ['-46', '30'],
      ['9007199254740993', '2'],
    ] as const)
      expect(previewSale(tax, 'sell', price, quantity)).toBeNull();
  });
});
