import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { voyageArrivedSchema, voyageDepartedSchema, voyageDepartInputSchema } from './voyage';

const SHIP = '01900000-0000-7000-8000-0000000003f1';
const [KALLISTE, ELAIA] = [
  '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000103',
];

describe('voyage.depart', () => {
  const input = {
    shipId: SHIP,
    fromCityId: KALLISTE,
    toCityId: ELAIA,
    cargo: [{ goodId: 'wheat', quantity: 120 }],
    expectedCostOboles: 0,
  };
  const ok = (patch: Record<string, unknown>) =>
    voyageDepartInputSchema.safeParse({ ...input, ...patch }).success;

  it('navire, cités, cargaison et coût vu : tous obligatoires, aucun autre champ', () => {
    expect(ok({})).toBe(true);
    expect(ok({ cargo: [] })).toBe(true);
    for (const key of Object.keys(input))
      expect([key, ok({ [key]: undefined })]).toEqual([key, false]);
    expect(ok({ houseId: SHIP })).toBe(false);
    expect(ok({ toCityId: 'elaia' })).toBe(false);
  });

  it('coût vu entier positif ou nul (paramètres neutres : un départ ne coûte rien)', () => {
    expect(ok({ expectedCostOboles: 71 })).toBe(true);
    for (const expectedCostOboles of [-1, 2.5, '0', Number.NaN])
      expect([expectedCostOboles, ok({ expectedCostOboles })]).toEqual([expectedCostOboles, false]);
  });

  it('cargaison : quantités entières positives, chaque bien une fois, au plus cinquante lignes', () => {
    for (const quantity of [0, -3, 1.5, 1_000_001])
      expect([quantity, ok({ cargo: [{ goodId: 'wheat', quantity }] })]).toEqual([quantity, false]);
    expect(ok({ cargo: [{ goodId: 'Blé', quantity: 1 }] })).toBe(false);
    expect(
      ok({
        cargo: [
          { goodId: 'wheat', quantity: 1 },
          { goodId: 'wheat', quantity: 2 },
        ],
      }),
    ).toBe(false);
    expect(ok({ cargo: [{ goodId: 'wheat', quantity: 1, reserved: 1 }] })).toBe(false);
    const goods = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ goodId: `good_${i}`, quantity: 1 }));
    expect(ok({ cargo: goods(50) })).toBe(true);
    expect(ok({ cargo: goods(51) })).toBe(false);
  });

  it('VoyageDeparted se relit tel qu’il est écrit ; ses parts du droit de port font le tout', () => {
    const departed = {
      type: 'VoyageDeparted' as const,
      payload: {
        voyageId: '01900000-0000-7000-8000-0000000004f1',
        shipId: SHIP,
        houseId: '01900000-0000-7000-8000-0000000000a1',
        fromCityId: KALLISTE,
        toCityId: ELAIA,
        departedAt: '2026-11-15T10:00:00.000Z',
        arrivesAt: '2026-11-15T14:00:00.000Z',
        cargo: [{ goodId: 'wheat', quantity: 120 }],
        provisionsOboles: 30,
        portDues: { oboles: 41, burned: 21, treasury: 20 },
      },
    };
    const written = JSON.parse(JSON.stringify(departed)) as unknown;
    expect(voyageDepartedSchema.parse(written)).toEqual(departed);
    expect(domainEventSchema.parse(written)).toEqual(departed);
    const payload = departed.payload;
    for (const changed of [
      { ...payload, portDues: { oboles: 41, burned: 21, treasury: 21 } },
      { ...payload, toCityId: KALLISTE },
      { ...payload, provisionsOboles: -1 },
    ])
      expect(domainEventSchema.safeParse({ ...departed, payload: changed }).success).toBe(false);
  });
});

describe('VoyageArrived', () => {
  const arrived = {
    type: 'VoyageArrived' as const,
    payload: {
      voyageId: '01900000-0000-7000-8000-0000000004f1',
      shipId: SHIP,
      houseId: '01900000-0000-7000-8000-0000000000a1',
      fromCityId: KALLISTE,
      toCityId: ELAIA,
      arrivesAt: '2026-11-15T14:00:00.000Z',
      arrivedAt: '2026-11-15T14:10:00.000Z',
      cargo: [{ goodId: 'wheat', quantity: 120 }],
    },
  };

  it('se relit tel qu’il est écrit, cargaison vide comprise (navire sur lest)', () => {
    const written = JSON.parse(JSON.stringify(arrived)) as unknown;
    expect(voyageArrivedSchema.parse(written)).toEqual(arrived);
    expect(domainEventSchema.parse(written)).toEqual(arrived);
    const ballast = { ...arrived, payload: { ...arrived.payload, cargo: [] } };
    expect(domainEventSchema.parse(ballast)).toEqual(ballast);
  });

  it('daté de son échéance ou après, entre deux cités, avec des quantités entières positives', () => {
    const payload = arrived.payload;
    const parses = (changed: Record<string, unknown>) =>
      domainEventSchema.safeParse({ ...arrived, payload: { ...payload, ...changed } }).success;
    expect(parses({ arrivedAt: payload.arrivesAt })).toBe(true);
    for (const changed of [
      { arrivedAt: '2026-11-15T13:59:59.999Z' },
      { toCityId: KALLISTE },
      { cargo: [{ goodId: 'wheat', quantity: 0 }] },
      { arrivedAt: undefined },
      { worldId: KALLISTE },
    ])
      expect([changed, parses(changed)]).toEqual([changed, false]);
  });
});
