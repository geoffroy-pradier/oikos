import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import {
  propertyBuyListedInputSchema,
  propertyEndLeaseInputSchema,
  propertyLeaseInputSchema,
  propertyListForSaleInputSchema,
  propertyOfferLeaseInputSchema,
  propertyWithdrawOfferInputSchema,
} from './property-market';

const PROPERTY = '01900000-0000-7000-8000-0000000004f1';
const HOUSE = '01900000-0000-7000-8000-0000000000a1';
const OTHER = '01900000-0000-7000-8000-0000000000b1';

describe('offres, baux et revente : entrées', () => {
  it.each([
    ['property.offerLease', propertyOfferLeaseInputSchema, 'rentOboles'],
    ['property.listForSale', propertyListForSaleInputSchema, 'priceOboles'],
    ['property.lease', propertyLeaseInputSchema, 'expectedRentOboles'],
    ['property.buyListed', propertyBuyListedInputSchema, 'expectedPriceOboles'],
  ] as const)(
    '%s : bien et montant entier, positif, borné, aucun autre champ',
    (_, schema, field) => {
      const ok = (input: unknown) => schema.safeParse(input).success;
      expect(ok({ propertyId: PROPERTY, [field]: 1 })).toBe(true);
      expect(ok({ propertyId: PROPERTY, [field]: 1_000_000_000 })).toBe(true);
      for (const amount of [0, -1, 2.5, '40', 1_000_000_001, Number.NaN])
        expect([amount, ok({ propertyId: PROPERTY, [field]: amount })]).toEqual([amount, false]);
      expect(ok({ propertyId: PROPERTY })).toBe(false);
      expect(ok({ propertyId: 'maison-3', [field]: 1 })).toBe(false);
      expect(ok({ propertyId: PROPERTY, [field]: 1, houseId: HOUSE })).toBe(false);
    },
  );

  it('retrait d’une offre par le bien, fin d’un bail par le bail : rien d’autre', () => {
    expect(propertyWithdrawOfferInputSchema.safeParse({ propertyId: PROPERTY }).success).toBe(true);
    expect(
      propertyWithdrawOfferInputSchema.safeParse({ propertyId: PROPERTY, kind: 'sale' }).success,
    ).toBe(false);
    expect(propertyEndLeaseInputSchema.safeParse({ leaseId: PROPERTY }).success).toBe(true);
    expect(propertyEndLeaseInputSchema.safeParse({ leaseId: PROPERTY, by: 'tenant' }).success).toBe(
      false,
    );
  });
});

describe('offres, baux et revente : événements', () => {
  const lease = {
    leaseId: PROPERTY,
    propertyId: PROPERTY,
    landlordHouseId: HOUSE,
    tenantHouseId: OTHER,
  };
  const events = [
    {
      type: 'PropertyOffered',
      payload: {
        listingId: PROPERTY,
        propertyId: PROPERTY,
        houseId: HOUSE,
        kind: 'lease',
        cityId: OTHER,
        priceOboles: 40,
      },
    },
    {
      type: 'PropertyOfferWithdrawn',
      payload: { listingId: PROPERTY, propertyId: PROPERTY, houseId: HOUSE, kind: 'sale' },
    },
    { type: 'LeaseStarted', payload: { ...lease, cityId: OTHER, rentOboles: 40 } },
    { type: 'LeaseEndRequested', payload: { ...lease, requestedBy: 'tenant' } },
    { type: 'LeaseEnded', payload: { ...lease, reason: 'unpaid', gameDay: 20_400 } },
    {
      type: 'PropertySold',
      payload: {
        propertyId: PROPERTY,
        listingId: PROPERTY,
        cityId: OTHER,
        sizeId: 'townhouse',
        sellerHouseId: HOUSE,
        buyerHouseId: OTHER,
        priceOboles: 5_000,
        netOboles: 4_750,
        burnedOboles: 125,
        treasuryOboles: 125,
      },
    },
  ];

  it.each(events.map((event) => [event.type, event] as const))(
    '%s se relit tel qu’il est écrit par l’union',
    (_, event) => {
      const written = JSON.parse(JSON.stringify(event)) as unknown;
      expect(domainEventSchema.parse(written)).toEqual(event);
    },
  );

  it('refuse un événement incohérent', () => {
    const [offered, , , requested, ended, sold] = events as [
      (typeof events)[number],
      unknown,
      unknown,
      (typeof events)[number],
      (typeof events)[number],
      (typeof events)[number],
    ];
    const parses = (event: { type: string; payload: object }, patch: object) =>
      domainEventSchema.safeParse({ ...event, payload: { ...event.payload, ...patch } }).success;
    expect(parses(offered, { kind: 'auction' })).toBe(false);
    expect(parses(requested, { requestedBy: 'city' })).toBe(false);
    expect(parses(ended, { reason: 'seized' })).toBe(false);
    // Le net et la taxe font le prix, à l'obole près.
    expect(parses(sold, { netOboles: 4_749 })).toBe(false);
    expect(parses(sold, { burnedOboles: -1, treasuryOboles: 251 })).toBe(false);
  });
});
