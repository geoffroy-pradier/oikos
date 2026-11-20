import { describe, expect, it } from 'vitest';
import {
  boundedDecreeParamsSchemas,
  cityProposeDecreeInputSchema,
  decreeSpendingOboles,
} from './decree';
import { domainEventSchema } from './events';
import { cityCastOstraconInputSchema } from './ostracism';

const CITY = '01900000-0000-7000-8000-000000000101';
const HOUSE = '01900000-0000-7000-8000-0000000000a1';
const OSTRACISM = '01900000-0000-7000-8000-0000000000e1';
const RULES = { votingDays: 3, quorumBps: 3000, ostracismDays: 7, intervalDays: 28 };

describe('ostracisme (6.4 ; #722)', () => {
  it('un décret sans paramètre, ouvert seulement si la configuration le règle ; aucune dépense', () => {
    const decree = { model: 'ostracism', params: {} } as const;
    expect(cityProposeDecreeInputSchema.parse(decree)).toEqual(decree);
    expect(
      cityProposeDecreeInputSchema.safeParse({ ...decree, params: { houseId: HOUSE } }).success,
    ).toBe(false);
    expect(boundedDecreeParamsSchemas({}).ostracism).toBeUndefined();
    expect(boundedDecreeParamsSchemas({ ostracism: RULES }).ostracism?.parse({})).toEqual({});
    expect(decreeSpendingOboles(decree)).toBe(0);
  });

  it('un bulletin nomme une maison, rien d’autre', () => {
    const ostracon = { ostracismId: OSTRACISM, houseId: HOUSE };
    expect(cityCastOstraconInputSchema.parse(ostracon)).toEqual(ostracon);
    expect(
      cityCastOstraconInputSchema.safeParse({ ...ostracon, houseId: 'Aristide' }).success,
    ).toBe(false);
    expect(cityCastOstraconInputSchema.safeParse({ ...ostracon, weight: 2 }).success).toBe(false);
  });

  it('les événements se relisent tels qu’écrits ; le bulletin ne dit pas le nom inscrit', () => {
    const events = [
      {
        type: 'OstracismOpened',
        payload: {
          ostracismId: OSTRACISM,
          decreeId: OSTRACISM,
          cityId: CITY,
          votingClosesAt: '2026-11-23T03:00:00.000Z',
          quorumBps: 3000,
          ostracismDays: 7,
        },
      },
      { type: 'OstraconCast', payload: { ostracismId: OSTRACISM, cityId: CITY, houseId: HOUSE } },
      {
        type: 'OstracismTallied',
        payload: {
          ostracismId: OSTRACISM,
          cityId: CITY,
          outcome: 'tie',
          ballots: 4,
          electorate: 10,
          quorumReached: true,
        },
      },
      {
        type: 'HouseOstracized',
        payload: {
          ostracismId: OSTRACISM,
          cityId: CITY,
          houseId: HOUSE,
          ostraca: 3,
          endsAt: '2026-11-30T03:00:00.000Z',
          vacatedOfficeId: null,
        },
      },
    ];
    for (const event of events)
      expect(domainEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
    const named = { ...events[1], payload: { ...events[1]?.payload, targetHouseId: HOUSE } };
    expect(domainEventSchema.safeParse(named).success).toBe(false);
    const unknown = { ...events[2], payload: { ...events[2]?.payload, outcome: 'exiled' } };
    expect(domainEventSchema.safeParse(unknown).success).toBe(false);
  });
});
