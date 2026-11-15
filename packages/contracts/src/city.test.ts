import { describe, expect, it } from 'vitest';
import { archonElectedSchema, citizenshipGrantedSchema } from './city';
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

describe('élection de l’archonte', () => {
  it('ArchonElected se relit tel qu’il est écrit ; dates ISO, bulletins entiers positifs ou nuls', () => {
    const elected = {
      type: 'ArchonElected' as const,
      payload: {
        electionId: '01900000-0000-7000-8000-0000000005e1',
        cityId: CITY,
        houseId: HOUSE,
        votes: 0,
        termStartsAt: '2026-11-16T03:00:00.000Z',
        termEndsAt: '2026-12-14T03:00:00.000Z',
      },
    };
    const written = JSON.parse(JSON.stringify(elected)) as unknown;
    expect(archonElectedSchema.parse(written)).toEqual(elected);
    expect(domainEventSchema.parse(written)).toEqual(elected);
    const bad = (patch: Record<string, unknown>) =>
      domainEventSchema.safeParse({ ...elected, payload: { ...elected.payload, ...patch } })
        .success;
    expect(bad({ votes: -1 })).toBe(false);
    expect(bad({ termEndsAt: 'demain' })).toBe(false);
  });
});
