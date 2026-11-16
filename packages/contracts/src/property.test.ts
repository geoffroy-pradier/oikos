import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import {
  propertyBoughtSchema,
  propertyBuyInputSchema,
  propertyRenovatedSchema,
  propertyRenovateInputSchema,
} from './property';

const PROPERTY = '01900000-0000-7000-8000-0000000004f1';

describe('property.buy', () => {
  it('bien et prix vu : obligatoires, prix entier et positif, aucun autre champ', () => {
    const ok = (input: unknown) => propertyBuyInputSchema.safeParse(input).success;
    expect(ok({ propertyId: PROPERTY, expectedPriceOboles: 3000 })).toBe(true);
    expect(ok({ propertyId: PROPERTY })).toBe(false);
    expect(ok({ propertyId: 'maison-3', expectedPriceOboles: 3000 })).toBe(false);
    for (const expectedPriceOboles of [0, -1, 2.5, '3000', Number.NaN])
      expect([expectedPriceOboles, ok({ propertyId: PROPERTY, expectedPriceOboles })]).toEqual([
        expectedPriceOboles,
        false,
      ]);
    expect(ok({ propertyId: PROPERTY, expectedPriceOboles: 1, houseId: PROPERTY })).toBe(false);
  });

  it('PropertyBought se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const bought = {
      type: 'PropertyBought' as const,
      payload: {
        propertyId: PROPERTY,
        houseId: '01900000-0000-7000-8000-0000000000a1',
        cityId: '01900000-0000-7000-8000-000000000101',
        sizeId: 'townhouse',
        priceOboles: 3000,
      },
    };
    const written = JSON.parse(JSON.stringify(bought)) as unknown;
    expect(propertyBoughtSchema.parse(written)).toEqual(bought);
    expect(domainEventSchema.parse(written)).toEqual(bought);
    expect(
      domainEventSchema.safeParse({ ...bought, payload: { ...bought.payload, priceOboles: 0 } })
        .success,
    ).toBe(false);
  });
});

describe('property.renovate', () => {
  const valid = {
    propertyId: PROPERTY,
    expectedCostOboles: 300,
    expectedGoods: [
      { goodId: 'wood', quantity: 20 },
      { goodId: 'clay', quantity: 30 },
    ],
  };
  const ok = (input: unknown) => propertyRenovateInputSchema.safeParse(input).success;

  it('bien et coût vu, en oboles et en biens : obligatoires, chaque bien une fois, aucun autre champ', () => {
    expect(ok(valid)).toBe(true);
    expect(ok({ ...valid, expectedGoods: [] })).toBe(true);
    expect(ok({ propertyId: PROPERTY, expectedCostOboles: 300 })).toBe(false);
    for (const expectedCostOboles of [0, -1, 2.5, '300'])
      expect(ok({ ...valid, expectedCostOboles })).toBe(false);
    expect(ok({ ...valid, expectedGoods: [{ goodId: 'wood', quantity: 0 }] })).toBe(false);
    expect(
      ok({
        ...valid,
        expectedGoods: [
          { goodId: 'wood', quantity: 1 },
          { goodId: 'wood', quantity: 2 },
        ],
      }),
    ).toBe(false);
    expect(ok({ ...valid, houseId: PROPERTY })).toBe(false);
  });

  it('PropertyRenovated se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const renovated = {
      type: 'PropertyRenovated' as const,
      payload: {
        propertyId: PROPERTY,
        houseId: '01900000-0000-7000-8000-0000000000a1',
        cityId: '01900000-0000-7000-8000-000000000101',
        sizeId: 'townhouse',
        costOboles: 300,
        goods: [{ goodId: 'clay', quantity: 30 }],
        conditionBefore: 2_500,
      },
    };
    const written = JSON.parse(JSON.stringify(renovated)) as unknown;
    expect(propertyRenovatedSchema.parse(written)).toEqual(renovated);
    expect(domainEventSchema.parse(written)).toEqual(renovated);
    const over = { ...renovated, payload: { ...renovated.payload, conditionBefore: 10_001 } };
    expect(domainEventSchema.safeParse(over).success).toBe(false);
  });
});
