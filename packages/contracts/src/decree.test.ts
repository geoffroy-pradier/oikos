import { describe, expect, it } from 'vitest';
import {
  boundedDecreeParamsSchemas,
  cityProposeDecreeInputSchema,
  cityVoteDecreeInputSchema,
  decreeSpendingOboles,
  type DecreeModelBounds,
} from './decree';
import { domainEventSchema } from './events';

const CITY = '01900000-0000-7000-8000-000000000101';
const HOUSE = '01900000-0000-7000-8000-0000000000a1';
const DECREE = '01900000-0000-7000-8000-0000000000d1';
const BOUNDS: DecreeModelBounds = {
  market_tax_rate: { minRateBps: 200, maxRateBps: 1000 },
  port_dues: { minCoefficientBps: 5000, maxCoefficientBps: 20_000 },
  public_works: { minOboles: 600, maxOboles: 60_000 },
  festival: {
    minOboles: 300,
    maxOboles: 30_000,
    minDays: 1,
    maxDays: 7,
    goodIds: ['bread', 'wine', 'fish'],
    maxGoods: 2,
  },
};
const fields = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

describe('city.proposeDecree : entrée dans les plafonds techniques', () => {
  it('un modèle du catalogue et ses seuls paramètres ; un modèle inconnu est refusé', () => {
    const tax = { model: 'market_tax_rate', params: { rateBps: 600 } };
    expect(cityProposeDecreeInputSchema.parse(tax)).toEqual(tax);
    const parse = (input: unknown) => cityProposeDecreeInputSchema.safeParse(input).success;
    expect(parse({ model: 'embargo', params: {} })).toBe(false);
    expect(parse({ model: 'market_tax_rate', params: { rateBps: 600, extra: 1 } })).toBe(false);
    expect(parse({ model: 'market_tax_rate', params: { rateBps: 5001 } })).toBe(false);
    expect(parse({ model: 'market_tax_rate', params: { rateBps: 6.5 } })).toBe(false);
    expect(parse({ model: 'public_works', params: { amountOboles: 0 } })).toBe(false);
    expect(parse({ ...tax, author: HOUSE })).toBe(false);
    const festival = {
      model: 'festival',
      params: { amountOboles: 1, days: 1, goodIds: ['bread'] },
    };
    expect(parse(festival)).toBe(true);
    expect(parse({ ...festival, params: { ...festival.params, goodIds: [] } })).toBe(false);
    expect(
      parse({ ...festival, params: { ...festival.params, goodIds: ['bread', 'bread'] } }),
    ).toBe(false);
  });
});

describe('paramètres bornés par la configuration en vigueur', () => {
  const schemas = boundedDecreeParamsSchemas(BOUNDS);

  it('bornes incluses ; hors bornes, le champ fautif est nommé', () => {
    expect(
      fields(schemas.market_tax_rate?.safeParse({ rateBps: 200 }) ?? { success: false }),
    ).toEqual([]);
    expect(
      fields(schemas.market_tax_rate?.safeParse({ rateBps: 1000 }) ?? { success: false }),
    ).toEqual([]);
    expect(
      fields(schemas.market_tax_rate?.safeParse({ rateBps: 199 }) ?? { success: false }),
    ).toEqual(['rateBps']);
    expect(
      fields(schemas.market_tax_rate?.safeParse({ rateBps: 1001 }) ?? { success: false }),
    ).toEqual(['rateBps']);
    expect(
      fields(schemas.port_dues?.safeParse({ coefficientBps: 4999 }) ?? { success: false }),
    ).toEqual(['coefficientBps']);
    expect(
      fields(schemas.public_works?.safeParse({ amountOboles: 60_001 }) ?? { success: false }),
    ).toEqual(['amountOboles']);
  });

  it('fête : montant, durée et biens admis, pas plus que maxGoods, chacun une fois', () => {
    const festival = schemas.festival;
    if (!festival) throw new Error('festival expected');
    const params = { amountOboles: 300, days: 7, goodIds: ['bread', 'wine'] };
    expect(festival.parse(params)).toEqual(params);
    expect(fields(festival.safeParse({ ...params, days: 8 }))).toEqual(['days']);
    expect(fields(festival.safeParse({ ...params, amountOboles: 299 }))).toEqual(['amountOboles']);
    expect(fields(festival.safeParse({ ...params, goodIds: ['bread', 'olive_oil'] }))).toEqual([
      'goodIds.1',
    ]);
    expect(fields(festival.safeParse({ ...params, goodIds: ['bread', 'wine', 'fish'] }))).toEqual([
      'goodIds',
    ]);
    expect(fields(festival.safeParse({ ...params, goodIds: ['wine', 'wine'] }))).toEqual([
      'goodIds',
    ]);
  });

  it('un modèle absent de la configuration est fermé : aucun schéma', () => {
    const only = boundedDecreeParamsSchemas({ public_works: BOUNDS.public_works });
    expect(Object.keys(only)).toEqual(['public_works']);
    expect(Object.keys(boundedDecreeParamsSchemas({}))).toEqual([]);
  });

  it('dépense d’un décret : le montant des grands travaux et des fêtes, rien pour un taux', () => {
    expect(decreeSpendingOboles({ model: 'market_tax_rate', params: { rateBps: 500 } })).toBe(0);
    expect(decreeSpendingOboles({ model: 'port_dues', params: { coefficientBps: 500 } })).toBe(0);
    expect(decreeSpendingOboles({ model: 'public_works', params: { amountOboles: 700 } })).toBe(
      700,
    );
    expect(
      decreeSpendingOboles({
        model: 'festival',
        params: { amountOboles: 400, days: 2, goodIds: ['bread'] },
      }),
    ).toBe(400);
  });
});

describe('city.voteDecree et événements des décrets', () => {
  it('un vote pour ou contre, rien d’autre', () => {
    expect(cityVoteDecreeInputSchema.safeParse({ decreeId: DECREE, approve: true }).success).toBe(
      true,
    );
    expect(cityVoteDecreeInputSchema.safeParse({ decreeId: DECREE, approve: 'yes' }).success).toBe(
      false,
    );
    expect(
      cityVoteDecreeInputSchema.safeParse({ decreeId: DECREE, approve: false, houseId: HOUSE })
        .success,
    ).toBe(false);
  });

  it('les événements se relisent tels qu’ils sont écrits ; le vote ne dit pas le choix', () => {
    const events = [
      {
        type: 'DecreeProposed',
        payload: {
          decreeId: DECREE,
          cityId: CITY,
          houseId: HOUSE,
          decree: { model: 'festival', params: { amountOboles: 400, days: 2, goodIds: ['bread'] } },
          votingClosesAt: '2026-11-19T03:00:00.000Z',
        },
      },
      { type: 'DecreeVoteCast', payload: { decreeId: DECREE, cityId: CITY, houseId: HOUSE } },
      ...(['DecreeAdopted', 'DecreeRejected'] as const).map((type) => ({
        type,
        payload: {
          decreeId: DECREE,
          cityId: CITY,
          model: 'public_works',
          votesFor: 3,
          votesAgainst: 1,
          electorate: 10,
          quorumReached: true,
        },
      })),
      {
        type: 'DecreeApplied',
        payload: {
          decreeId: DECREE,
          cityId: CITY,
          decree: { model: 'market_tax_rate', params: { rateBps: 900 } },
          inForceBps: 600,
        },
      },
    ];
    for (const event of events) {
      const written = JSON.parse(JSON.stringify(event)) as unknown;
      expect(domainEventSchema.parse(written)).toEqual(event);
    }
    const withChoice = { ...events[1], payload: { ...events[1]?.payload, approve: true } };
    expect(domainEventSchema.safeParse(withChoice).success).toBe(false);
    // Une valeur en vigueur se dit en points de base entiers, positifs, au plus ×10.
    const applied = events.at(-1);
    for (const inForceBps of [-1, 1.5, 100_001])
      expect(
        domainEventSchema.safeParse({ ...applied, payload: { ...applied?.payload, inForceBps } })
          .success,
      ).toBe(false);
    // Une valeur en vigueur pour un décret de taux, et pour lui seul : une dépense (#263) n'en a pas.
    const spending = { model: 'public_works', params: { amountOboles: 600 } };
    const payload = (decree: unknown, inForceBps?: number) => ({
      type: 'DecreeApplied',
      payload: {
        decreeId: DECREE,
        cityId: CITY,
        decree,
        ...(inForceBps === undefined ? {} : { inForceBps }),
      },
    });
    expect(domainEventSchema.safeParse(payload(spending)).success).toBe(true);
    expect(domainEventSchema.safeParse(payload(spending, 600)).success).toBe(false);
    const rate = { model: 'market_tax_rate', params: { rateBps: 900 } };
    expect(domainEventSchema.safeParse(payload(rate)).success).toBe(false);
  });
});
