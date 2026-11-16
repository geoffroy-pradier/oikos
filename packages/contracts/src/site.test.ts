import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import {
  siteAcquireInputSchema,
  siteCollectedSchema,
  siteRestartedSchema,
  siteRestartInputSchema,
  upkeepSettledSchema,
} from './site';

const HOUSE = '01900000-0000-7000-8000-0000000000a1';
const [FIELD, QUARRY] = [
  '01900000-0000-7000-8000-0000000003f1',
  '01900000-0000-7000-8000-0000000003f2',
];

describe('UpkeepSettled', () => {
  // Une clôture : le champ est payé (38 d'entretien, 28 de salaires), la carrière reste impayée (75
  // d'entretien, sans salaire) et s'arrête ; un site sans tarif à l'arrêt repart sans payer.
  const field = { siteId: FIELD, oboles: 66, upkeepOboles: 38, wagesOboles: 28 };
  const quarry = { siteId: QUARRY, oboles: 75, upkeepOboles: 75, wagesOboles: 0 };
  const settled = {
    type: 'UpkeepSettled' as const,
    payload: {
      houseId: HOUSE,
      gameDay: 20_771,
      paidOboles: 66,
      upkeepOboles: 38,
      wagesOboles: 28,
      paid: [field],
      unpaid: [quarry],
      halted: [QUARRY],
      resumed: ['01900000-0000-7000-8000-0000000003f3'],
    },
  };

  it('aller-retour : l’événement se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const written = JSON.parse(JSON.stringify(upkeepSettledSchema.parse(settled))) as unknown;
    expect(upkeepSettledSchema.parse(written)).toEqual(settled);
    expect(domainEventSchema.parse(written)).toEqual(settled);
    // Une maison dont rien n'a été payé, ni arrêté : listes vides, montant nul.
    const nothing = {
      ...settled,
      payload: {
        ...settled.payload,
        paidOboles: 0,
        upkeepOboles: 0,
        wagesOboles: 0,
        paid: [],
        halted: [],
        resumed: [],
      },
    };
    expect(domainEventSchema.parse(nothing)).toEqual(nothing);
  });

  it('rejette un montant négatif ou fractionnaire, un jour invalide, un identifiant mal formé, un champ en trop ou manquant', () => {
    const { payload } = settled;
    const broken = [
      { ...payload, paidOboles: -1 },
      { ...payload, paidOboles: 1.5 },
      { ...payload, gameDay: -1 },
      { ...payload, paid: [{ ...field, oboles: -66 }] },
      { ...payload, unpaid: [{ ...quarry, siteId: 'champ' }] },
      // Des parts qui ne font pas le tout : par site, par nature, ou pour la maison.
      { ...payload, unpaid: [{ ...quarry, wagesOboles: 1 }] },
      { ...payload, paid: [{ ...field, wagesOboles: 27, oboles: 65 }] },
      { ...payload, paidOboles: 67, wagesOboles: 29 },
      { ...payload, upkeepOboles: 28, wagesOboles: 38 },
      (({ wagesOboles: _wages, ...rest }) => rest)(payload),
      { ...payload, paid: [{ siteId: FIELD, oboles: 66 }] },
      { ...payload, halted: ['carrière'] },
      { ...payload, houseId: 'maison' },
      { ...payload, userId: HOUSE },
      { ...payload, paid: [{ ...field, note: 'en retard' }] },
      (({ resumed: _resumed, ...rest }) => rest)(payload),
    ];
    for (const candidate of broken) {
      expect(upkeepSettledSchema.safeParse({ ...settled, payload: candidate }).success).toBe(false);
      expect(domainEventSchema.safeParse({ ...settled, payload: candidate }).success).toBe(false);
    }
    expect(domainEventSchema.safeParse({ ...settled, type: 'UpkeepPaid' }).success).toBe(false);
  });
});
describe('UpkeepSettled, navires compris (#252)', () => {
  const ship = (n: number) => `01900000-0000-7000-8000-0000000004f${n}`;
  const settled = {
    type: 'UpkeepSettled' as const,
    payload: {
      houseId: HOUSE,
      gameDay: 20_771,
      paidOboles: 25,
      upkeepOboles: 0,
      wagesOboles: 0,
      paid: [],
      unpaid: [],
      halted: [],
      resumed: [],
      ships: {
        upkeepOboles: 25,
        paid: [{ shipId: ship(1), oboles: 25 }],
        unpaid: [{ shipId: ship(2), oboles: 40 }],
        laidUp: [ship(2)],
        rearmed: [ship(1)],
      },
    },
  };

  it('se relit tel qu’il est écrit ; l’entretien des navires payés entre dans le total', () => {
    const written = JSON.parse(JSON.stringify(settled)) as unknown;
    expect(domainEventSchema.parse(written)).toEqual(settled);
    const payload = settled.payload;
    for (const changed of [
      { ...payload, paidOboles: 0 },
      { ...payload, ships: { ...payload.ships, upkeepOboles: 24 } },
      { ...payload, ships: { ...payload.ships, laidUp: ['navire'] } },
      { ...payload, ships: { ...payload.ships, sunk: [] } },
    ])
      expect(upkeepSettledSchema.safeParse({ ...settled, payload: changed }).success).toBe(false);
  });
});

describe('UpkeepSettled, biens immobiliers compris (#256)', () => {
  const property = (n: number) => `01900000-0000-7000-8000-0000000005f${n}`;
  const settled = {
    type: 'UpkeepSettled' as const,
    payload: {
      houseId: HOUSE,
      gameDay: 20_771,
      paidOboles: 12,
      upkeepOboles: 0,
      wagesOboles: 0,
      paid: [],
      unpaid: [],
      halted: [],
      resumed: [],
      properties: {
        upkeepOboles: 12,
        paid: [{ propertyId: property(1), oboles: 12 }],
        unpaid: [{ propertyId: property(2), oboles: 30 }],
        lapsed: [property(2)],
        restored: [property(1)],
      },
    },
  };

  it('se relit tel qu’il est écrit ; l’entretien des biens payés entre dans le total', () => {
    const written = JSON.parse(JSON.stringify(settled)) as unknown;
    expect(domainEventSchema.parse(written)).toEqual(settled);
    const payload = settled.payload;
    for (const changed of [
      { ...payload, paidOboles: 0 },
      { ...payload, properties: { ...payload.properties, upkeepOboles: 11 } },
      { ...payload, properties: { ...payload.properties, lapsed: ['maison'] } },
      { ...payload, properties: { ...payload.properties, seized: [] } },
    ])
      expect(upkeepSettledSchema.safeParse({ ...settled, payload: changed }).success).toBe(false);
  });
});

describe('prix attendu des commandes de site', () => {
  it('facultatif pour un client antérieur ; entier, positif pour une acquisition, nul permis pour une relance', () => {
    const recipeId = 'grow_wheat';
    expect(siteAcquireInputSchema.parse({ recipeId })).toEqual({ recipeId });
    expect(siteAcquireInputSchema.safeParse({ recipeId, expectedCostOboles: 1000 }).success).toBe(
      true,
    );
    for (const expectedCostOboles of [0, -1, 1.5, '1000'])
      expect(siteAcquireInputSchema.safeParse({ recipeId, expectedCostOboles }).success).toBe(
        false,
      );
    expect(siteRestartInputSchema.parse({ siteId: FIELD })).toEqual({ siteId: FIELD });
    expect(
      siteRestartInputSchema.safeParse({ siteId: FIELD, expectedUpkeepOboles: 0 }).success,
    ).toBe(true);
    for (const expectedUpkeepOboles of [-1, 0.5, null])
      expect(
        siteRestartInputSchema.safeParse({ siteId: FIELD, expectedUpkeepOboles }).success,
      ).toBe(false);
  });
});

describe('SiteRestarted', () => {
  it('distingue entretien et salaires payés ; refuse un montant absent, négatif ou fractionnaire', () => {
    const payload = { siteId: FIELD, houseId: HOUSE, upkeepOboles: 30, wagesOboles: 20 };
    const event = { type: 'SiteRestarted' as const, payload };
    expect(domainEventSchema.parse(event)).toEqual(event);
    for (const candidate of [
      (({ wagesOboles: _wages, ...rest }) => rest)(payload),
      { ...payload, wagesOboles: -1 },
      { ...payload, wagesOboles: 0.5 },
    ])
      expect(siteRestartedSchema.safeParse({ ...event, payload: candidate }).success).toBe(false);
  });
});

describe('SiteCollected (#267)', () => {
  const EVENT = '01900000-0000-7000-8000-0000000003e1';
  const collected = {
    type: 'SiteCollected' as const,
    payload: {
      siteId: FIELD,
      houseId: HOUSE,
      cycles: 3,
      inputs: [],
      outputs: [{ goodId: 'wheat', quantity: 108 }],
      eventEffects: [{ eventId: EVENT, goodId: 'wheat', quantity: -12 }],
    },
  };

  it('porte l’écart dû à chaque événement, et peut récolter zéro ; sans écart, pas de liste', () => {
    expect(domainEventSchema.parse(collected)).toEqual(collected);
    const { siteId, houseId, cycles, inputs, outputs } = collected.payload;
    const plain = { siteId, houseId, cycles, inputs, outputs };
    const parched = { ...plain, outputs: [{ goodId: 'wheat', quantity: 0 }] };
    expect(siteCollectedSchema.parse({ ...collected, payload: parched }).payload).toEqual(parched);
    for (const payload of [
      { ...plain, eventEffects: [] },
      { ...plain, eventEffects: [{ eventId: 'x', goodId: 'wheat', quantity: -1 }] },
      { ...plain, eventEffects: [{ eventId: EVENT, goodId: 'wheat', quantity: 0.5 }] },
      { ...plain, outputs: [{ goodId: 'wheat', quantity: -1 }] },
    ])
      expect(siteCollectedSchema.safeParse({ ...collected, payload }).success).toBe(false);
  });

  it('porte la grâce consommée (#266) : un surplus positif, d’un effet de récolte', () => {
    const grace = {
      graceUseId: EVENT,
      graceId: 'demeter_harvest',
      effect: 'blessed_harvest',
      surplus: [{ goodId: 'wheat', quantity: 21 }],
    };
    const blessed = { ...collected, payload: { ...collected.payload, grace } };
    expect(domainEventSchema.parse(blessed)).toEqual(blessed);
    for (const patch of [
      { surplus: [] },
      { surplus: [{ goodId: 'wheat', quantity: 0 }] },
      { effect: 'fair_wind' },
    ])
      expect(
        siteCollectedSchema.safeParse({
          ...collected,
          payload: { ...collected.payload, grace: { ...grace, ...patch } },
        }).success,
      ).toBe(false);
  });
});
