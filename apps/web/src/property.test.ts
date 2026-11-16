import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import {
  conditionShare,
  parkBySize,
  parseLeases,
  parseMyProperties,
  parseOffers,
  parsePropertyRules,
} from './property';

const config = INITIAL_CONFIG as GameConfig;
const sizes = parsePropertyRules({ properties: config.properties });

describe('parc de logements (#259)', () => {
  it('parc d’une cité par taille : total et biens encore à vendre ; ligne illisible : échec', () => {
    const rows = [
      { id: 'p1', size_id: 'townhouse', for_sale: true },
      { id: 'p2', size_id: 'townhouse', for_sale: false },
      { id: 'p3', size_id: 'tenement', for_sale: true },
    ];
    expect(parkBySize(rows)).toEqual([
      { sizeId: 'tenement', total: 1, forSale: 1 },
      { sizeId: 'townhouse', total: 2, forSale: 1 },
    ]);
    expect(parkBySize([{ id: 'p1', size_id: 'townhouse' }])).toBeNull();
  });
});

describe('immobilier lu par le client (#259)', () => {
  it('règles : chaque taille de la configuration ; sans section, aucune ; valeur fausse, échec', () => {
    expect([...(sizes?.keys() ?? [])]).toEqual(config.properties.sizes.map((size) => size.id));
    expect(parsePropertyRules({ properties: null })).toEqual(new Map());
    expect(parsePropertyRules(null)).toEqual(new Map());
    const [first] = config.properties.sizes;
    expect(
      parsePropertyRules({
        properties: { ...config.properties, sizes: [{ ...first, purchasePriceOboles: -1 }] },
      }),
    ).toBeNull();
  });

  it('offres : biens de la cité au prix de leur taille, puis offres des maisons', () => {
    const townhouse = sizes?.get('townhouse');
    const offers = parseOffers(
      [
        { id: 'p1', city_id: 'c1', size_id: 'townhouse', lot: 1, for_sale: true, condition: 9000 },
        { id: 'p2', city_id: 'c1', size_id: 'townhouse', lot: 2, for_sale: false, condition: null },
        { id: 'p3', city_id: 'c1', size_id: 'palace', lot: 3, for_sale: true, condition: 10000 },
      ],
      [
        {
          property_id: 'p2',
          city_id: 'c1',
          size_id: 'townhouse',
          lot: 2,
          condition: 8000,
          kind: 'lease',
          price_oboles: 40,
        },
      ],
      sizes ?? new Map(),
    );
    expect(offers).toEqual([
      {
        propertyId: 'p1',
        cityId: 'c1',
        sizeId: 'townhouse',
        lot: 1,
        condition: 9000,
        kind: 'citySale',
        priceOboles: townhouse?.purchasePriceOboles,
      },
      {
        propertyId: 'p2',
        cityId: 'c1',
        sizeId: 'townhouse',
        lot: 2,
        condition: 8000,
        kind: 'lease',
        priceOboles: 40,
      },
    ]);
    expect(parseOffers([{ id: 'p1' }], [], new Map())).toBeNull();
  });

  it('mes biens par cité et lot ; mes baux en cours d’abord, locataire ou propriétaire', () => {
    const mine = parseMyProperties([
      {
        id: 'p2',
        city_id: 'c1',
        size_id: 'townhouse',
        lot: 7,
        condition: 10000,
        upkeep_unpaid_since: null,
      },
      {
        id: 'p1',
        city_id: 'c1',
        size_id: 'tenement',
        lot: 3,
        condition: 4000,
        upkeep_unpaid_since: '2026-11-16T03:00:00Z',
      },
    ]);
    expect(mine?.map((property) => [property.id, property.unpaidSince])).toEqual([
      ['p1', '2026-11-16T03:00:00Z'],
      ['p2', null],
    ]);
    const lease = {
      id: 'l1',
      property_id: 'p1',
      city_id: 'c1',
      size_id: 'townhouse',
      lot: 1,
      tenant_house_id: 'h1',
      rent_oboles: 40,
      end_requested_at: null,
      ended_at: null,
      end_reason: null,
    };
    const leases = parseLeases(
      [
        { ...lease, id: 'l0', ended_at: '2026-11-15T03:00:00Z', end_reason: 'unpaid' },
        { ...lease, end_requested_at: '2026-11-16T10:00:00Z' },
        { ...lease, id: 'l2', lot: 2, tenant_house_id: 'h2' },
      ],
      'h1',
    );
    expect(leases?.map((row) => [row.id, row.asTenant, row.ending, row.endReason])).toEqual([
      ['l1', true, true, null],
      ['l2', false, false, null],
      ['l0', true, false, 'unpaid'],
    ]);
    expect(parseLeases([{ ...lease, rent_oboles: -1 }], 'h1')).toBeNull();
    expect(conditionShare(4567)).toBe(0.45);
  });
});
