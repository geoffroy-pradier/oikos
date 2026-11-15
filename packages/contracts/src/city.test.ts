import { describe, expect, it } from 'vitest';
import { citizenshipGrantedSchema } from './city';
import { domainEventSchema } from './events';

const HOUSE = '01900000-0000-7000-8000-0000000000a1';
const CITY = '01900000-0000-7000-8000-000000000101';

describe('citoyenneté', () => {
  it('CitizenshipGranted se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const granted = {
      type: 'CitizenshipGranted' as const,
      payload: { houseId: HOUSE, cityId: CITY, gameDay: 20_407 },
    };
    const written = JSON.parse(JSON.stringify(granted)) as unknown;
    expect(citizenshipGrantedSchema.parse(written)).toEqual(granted);
    expect(domainEventSchema.parse(written)).toEqual(granted);
    const negative = { ...granted, payload: { ...granted.payload, gameDay: -1 } };
    expect(domainEventSchema.safeParse(negative).success).toBe(false);
  });
});
