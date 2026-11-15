import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { shipAcquiredSchema, shipAcquireInputSchema } from './ship';

describe('ship.acquire', () => {
  it('classe et prix vu : obligatoires, prix entier et positif, aucun autre champ', () => {
    const ok = (input: unknown) => shipAcquireInputSchema.safeParse(input).success;
    expect(ok({ classId: 'coaster', expectedCostOboles: 2400 })).toBe(true);
    expect(ok({ classId: 'coaster' })).toBe(false);
    for (const expectedCostOboles of [0, -1, 2.5, '2400', Number.NaN])
      expect([expectedCostOboles, ok({ classId: 'coaster', expectedCostOboles })]).toEqual([
        expectedCostOboles,
        false,
      ]);
    expect(ok({ classId: 'Galère', expectedCostOboles: 1 })).toBe(false);
    expect(ok({ classId: 'coaster', expectedCostOboles: 1, houseId: 'x' })).toBe(false);
  });

  it('ShipAcquired se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const acquired = {
      type: 'ShipAcquired' as const,
      payload: {
        shipId: '01900000-0000-7000-8000-0000000003f1',
        houseId: '01900000-0000-7000-8000-0000000000a1',
        cityId: '01900000-0000-7000-8000-000000000101',
        classId: 'round_ship',
        costOboles: 6000,
      },
    };
    const written = JSON.parse(JSON.stringify(acquired)) as unknown;
    expect(shipAcquiredSchema.parse(written)).toEqual(acquired);
    expect(domainEventSchema.parse(written)).toEqual(acquired);
    expect(
      domainEventSchema.safeParse({ ...acquired, payload: { ...acquired.payload, costOboles: 0 } })
        .success,
    ).toBe(false);
  });
});
