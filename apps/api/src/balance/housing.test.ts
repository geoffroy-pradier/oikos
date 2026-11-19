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
  sizeId: 'townhouse',
  lot: 1,
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
        { propertyId: 'a', sizeId: 'townhouse', lot: 1, units: 4, rentOboles: 40 },
        { propertyId: 'b', sizeId: 'townhouse', lot: 2, units: 4, rentOboles: 30 },
        { propertyId: 'c', sizeId: 'townhouse', lot: 3, units: 4, rentOboles: 48 },
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
        leases: [{ propertyId: 'big', sizeId: 'tenement', lot: 1, units: 16, rentOboles: 49 }],
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

  it('départage les ex aequo par taille puis lot, jamais par identifiant ni par ordre reçu', () => {
    // Identifiants dans l'ordre inverse des lots : un tri par identifiant choisirait l'autre bien.
    const leases = [
      { propertyId: 'b', sizeId: 'townhouse', lot: 2, units: 4, rentOboles: 30 },
      { propertyId: 'z', sizeId: 'townhouse', lot: 1, units: 4, rentOboles: 30 },
    ];
    for (const order of [leases, [...leases].reverse()])
      expect(
        chooseTenancy({ unhoused: 4, lodging: 12, leases: order, vacant: [], spendable: 0 }),
      ).toEqual({ kind: 'lease', propertyId: 'z', rentOboles: 30 });
    const vacant = [townhouse('b', { lot: 2 }), townhouse('z', { lot: 1 })];
    for (const order of [vacant, [...vacant].reverse()])
      expect(
        chooseTenancy({ unhoused: 4, lodging: 36, leases: [], vacant: order, spendable: 3000 }),
      ).toMatchObject({ kind: 'buy', propertyId: 'z' });
  });

  it('ne fait rien sans travailleur sans logement', () => {
    expect(
      chooseTenancy({
        unhoused: 0,
        lodging: 36,
        leases: [{ propertyId: 'a', sizeId: 'townhouse', lot: 1, units: 4, rentOboles: 1 }],
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
      townhouse('tenement', {
        sizeId: 'tenement',
        units: 16,
        priceOboles: 9000,
        upkeepOboles: 20,
      }),
    ];
    expect(chooseInvestment({ lodging: 36, vacant, spendable: 20_000 })).toMatchObject({
      propertyId: 'tenement',
    });
    expect(chooseInvestment({ lodging: 36, vacant, spendable: 5000 })).toMatchObject({
      propertyId: 't',
    });
    expect(chooseInvestment({ lodging: 7, vacant, spendable: 20_000 })).toBeUndefined();
  });

  it('entre biens de même gain, achète le premier lot de la taille, quel que soit son identifiant', () => {
    const vacant = [
      townhouse('b', { lot: 3 }),
      townhouse('z', { lot: 2 }),
      townhouse('m', { lot: 4 }),
    ];
    for (const order of [vacant, [...vacant].reverse()])
      expect(chooseInvestment({ lodging: 36, vacant: order, spendable: 5000 })).toMatchObject({
        propertyId: 'z',
      });
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
  // Identifiants sans rapport avec la place des biens : seuls la taille et le lot les ordonnent.
  const owned = [
    { id: 'a', sizeId: 'townhouse', lot: 3, units: 4, leased: false },
    { id: 'c', sizeId: 'townhouse', lot: 1, units: 4, leased: false },
    { id: 'b', sizeId: 'tenement', lot: 1, units: 16, leased: true },
    { id: 'd', sizeId: 'townhouse', lot: 7, units: 4, leased: false },
  ];

  it('garde, par taille puis lot, de quoi loger les travailleurs ; le reste est à louer', () => {
    expect(spareProperties(owned, 5)).toEqual(['d']);
    expect(spareProperties(owned, 4)).toEqual(['a', 'd']);
    expect(spareProperties(owned, 0)).toEqual(['c', 'a', 'd']);
  });

  it('loge dans le même bien quel que soit l’ordre reçu, entre tailles comme entre lots', () => {
    const mixed = [
      { id: 'z', sizeId: 'townhouse', lot: 2, units: 4, leased: false },
      { id: 'y', sizeId: 'tenement', lot: 5, units: 16, leased: false },
      { id: 'x', sizeId: 'townhouse', lot: 1, units: 4, leased: false },
    ];
    for (const order of [mixed, [...mixed].reverse()])
      expect(spareProperties(order, 4)).toEqual(['x', 'z']);
  });

  it('ne propose pas un bien déjà loué, ni ne le compte dans le logement de la maison', () => {
    expect(spareProperties(owned, 100)).toEqual([]);
  });
});
