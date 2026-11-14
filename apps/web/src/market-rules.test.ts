import { describe, expect, it } from 'vitest';
import { netProceeds, parseMarketTax } from './market-rules';

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
});
