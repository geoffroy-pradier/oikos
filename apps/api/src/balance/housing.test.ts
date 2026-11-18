import { describe, expect, it } from 'vitest';
import {
  chooseInvestment,
  chooseTenancy,
  renovationDue,
  rentOf,
  spareProperties,
  type Vacant,
} from './housing';

// Décisions de la stratégie de logement du banc (#282) : fonctions pures, sans base.
const townhouse = (propertyId: string, over: Partial<Vacant> = {}): Vacant => ({
  propertyId,
  units: 4,
  priceOboles: 3000,
  upkeepOboles: 6,
  ...over,
});

describe('chooseTenancy', () => {
  it('loue un logement dont le loyer est sous l’hébergement économisé, au plus fort gain', () => {
    const move = chooseTenancy({
      unhoused: 4,
      lodging: 12,
      leases: [
        { propertyId: 'a', units: 4, rentOboles: 40 },
        { propertyId: 'b', units: 4, rentOboles: 30 },
        { propertyId: 'c', units: 4, rentOboles: 48 },
      ],
      vacant: [townhouse('v')],
      spendable: 10_000,
    });
    expect(move).toEqual({ kind: 'lease', propertyId: 'b', rentOboles: 30 });
  });

  it('ne compte que les travailleurs sans logement : un grand bien loué pour quatre n’économise que quatre nuits', () => {
    expect(
      chooseTenancy({
        unhoused: 4,
        lodging: 12,
        leases: [{ propertyId: 'big', units: 16, rentOboles: 49 }],
        vacant: [],
        spendable: 0,
      }),
    ).toBeUndefined();
  });

  it('achète quand aucun bail ne convient, si l’économie sur l’horizon dépasse le prix et l’entretien', () => {
    const input = { unhoused: 4, lodging: 36, leases: [], vacant: [townhouse('v')] };
    expect(chooseTenancy({ ...input, spendable: 3000 })).toEqual({
      kind: 'buy',
      propertyId: 'v',
      priceOboles: 3000,
    });
    // Monnaie disponible insuffisante, ou hébergement trop bon marché pour amortir le bien : rien.
    expect(chooseTenancy({ ...input, spendable: 2999 })).toBeUndefined();
    expect(chooseTenancy({ ...input, lodging: 8, spendable: 3000 })).toBeUndefined();
  });

  it('ne fait rien sans travailleur sans logement', () => {
    expect(
      chooseTenancy({
        unhoused: 0,
        lodging: 36,
        leases: [{ propertyId: 'a', units: 4, rentOboles: 1 }],
        vacant: [townhouse('v')],
        spendable: 10_000,
      }),
    ).toBeUndefined();
  });
});

describe('chooseInvestment et loyer', () => {
  it('le loyer est une part de l’hébergement économisé, arrondie à l’obole inférieure', () => {
    expect(rentOf(4, 12)).toBe(38);
    expect(rentOf(16, 36)).toBe(460);
  });

  it('un propriétaire achète le bien le plus rentable de l’horizon, et rien quand l’hébergement est bon marché', () => {
    const vacant = [
      townhouse('t'),
      townhouse('tenement', { units: 16, priceOboles: 9000, upkeepOboles: 20 }),
    ];
    expect(chooseInvestment({ lodging: 36, vacant, spendable: 20_000 })).toMatchObject({
      propertyId: 'tenement',
    });
    expect(chooseInvestment({ lodging: 36, vacant, spendable: 5000 })).toMatchObject({
      propertyId: 't',
    });
    expect(chooseInvestment({ lodging: 7, vacant, spendable: 20_000 })).toBeUndefined();
  });
});

describe('renovationDue', () => {
  it('rénove trois jours d’usure avant le seuil d’habitabilité', () => {
    expect(renovationDue(3901, 300, 3000)).toBe(false);
    expect(renovationDue(3900, 300, 3000)).toBe(false);
    expect(renovationDue(3899, 300, 3000)).toBe(true);
    expect(renovationDue(10_000, 0, 3000)).toBe(false);
  });
});

describe('spareProperties', () => {
  const owned = [
    { id: 'c', units: 4, leased: false },
    { id: 'a', units: 4, leased: false },
    { id: 'b', units: 16, leased: true },
    { id: 'd', units: 4, leased: false },
  ];

  it('garde, par identifiant, de quoi loger les travailleurs ; le reste est à louer', () => {
    expect(spareProperties(owned, 5)).toEqual(['d']);
    expect(spareProperties(owned, 4)).toEqual(['c', 'd']);
    expect(spareProperties(owned, 0)).toEqual(['a', 'c', 'd']);
  });

  it('ne propose pas un bien déjà loué, ni ne le compte dans le logement de la maison', () => {
    expect(spareProperties(owned, 100)).toEqual([]);
  });
});
