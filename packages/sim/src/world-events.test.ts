import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planWorldEvents, type PlanningInput, type WorldEventRules } from './world-events';

const rules = (probabilityBps: number, extra: Partial<WorldEventRules> = {}): WorldEventRules => ({
  probabilityBps,
  minDays: 1,
  maxDays: 3,
  minMagnitudeBps: 2_000,
  maxMagnitudeBps: 4_000,
  ...extra,
});
const CITIES = ['kalliste', 'elaia', 'ampelos', 'halos'];
const ROUTES: [string, string][] = [
  ['kalliste', 'elaia'],
  ['halos', 'ampelos'],
];
const input = (models: PlanningInput['models'], daySeed = 'graine:100'): PlanningInput => ({
  daySeed,
  startDay: 100,
  models,
  cities: CITIES,
  routes: ROUTES,
});
const ALL = {
  drought: rules(10_000),
  good_year: rules(10_000),
  storm: rules(10_000),
  caravan: rules(10_000, { goodIds: ['wine', 'cloth'] }),
};

describe('planification des événements d’un jour', () => {
  it('probabilité nulle ou modèle absent : aucun tirage, aucun événement', () => {
    expect(planWorldEvents(input({}))).toEqual([]);
    expect(
      planWorldEvents(
        input({ drought: rules(0), good_year: rules(0), storm: rules(0), caravan: rules(0) }),
      ),
    ).toEqual([]);
  });

  it('certitude : un événement par modèle, dans l’ordre du catalogue, aux portées de leur modèle', () => {
    const planned = planWorldEvents(input(ALL));
    expect(planned.map((event) => event.model)).toEqual([
      'drought',
      'good_year',
      'storm',
      'caravan',
    ]);
    const [drought, , storm, caravan] = planned;
    expect(CITIES).toContain(drought?.cityId);
    expect([drought?.otherCityId, drought?.goodId]).toEqual([null, null]);
    // Une route est rangée dans l'ordre des identifiants, quel que soit son sens dans la configuration.
    expect([
      ['elaia', 'kalliste'],
      ['ampelos', 'halos'],
    ]).toContainEqual([storm?.cityId, storm?.otherCityId]);
    expect(['wine', 'cloth']).toContain(caravan?.goodId);
  });

  it('sans portée possible : pas de tempête sans route, pas de caravane sans bien', () => {
    const planned = planWorldEvents({
      ...input({ ...ALL, caravan: rules(10_000, { goodIds: [] }) }),
      routes: [],
    });
    expect(planned.map((event) => event.model)).toEqual(['drought', 'good_year']);
    expect(planWorldEvents({ ...input(ALL), cities: [], routes: [] })).toEqual([]);
  });

  it('même graine, mêmes événements ; l’ordre des cités et des routes données n’y change rien', () => {
    const once = planWorldEvents(input(ALL, 'monde-a:7'));
    expect(planWorldEvents(input(ALL, 'monde-a:7'))).toEqual(once);
    expect(
      planWorldEvents({
        ...input(ALL, 'monde-a:7'),
        cities: [...CITIES].reverse(),
        routes: [
          ['ampelos', 'halos'],
          ['elaia', 'kalliste'],
        ],
      }),
    ).toEqual(once);
  });

  it('changer un modèle ne change pas les tirages des autres', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.integer({ min: 0, max: 10_000 }), (seed, p) => {
        const alone = planWorldEvents(input({ storm: rules(5_000) }, seed));
        const withOthers = planWorldEvents(
          input(
            { drought: rules(p), storm: rules(5_000), caravan: rules(p, { goodIds: ['wine'] }) },
            seed,
          ),
        );
        expect(withOthers.filter((event) => event.model === 'storm')).toEqual(alone);
      }),
    );
  });

  it('propriétés : durée, ampleur et portée dans leurs bornes', () => {
    const bounds = fc
      .record({
        a: fc.integer({ min: 1, max: 30 }),
        b: fc.integer({ min: 1, max: 30 }),
        c: fc.integer({ min: 0, max: 10_000 }),
        d: fc.integer({ min: 0, max: 10_000 }),
        p: fc.integer({ min: 0, max: 10_000 }),
      })
      .map(({ a, b, c, d, p }) =>
        rules(p, {
          minDays: Math.min(a, b),
          maxDays: Math.max(a, b),
          minMagnitudeBps: Math.min(c, d),
          maxMagnitudeBps: Math.max(c, d),
        }),
      );
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 100_000 }), bounds, (seed, day, r) => {
        const models = { drought: r, good_year: r, storm: r, caravan: { ...r, goodIds: ['wine'] } };
        for (const event of planWorldEvents({ ...input(models, seed), startDay: day })) {
          expect(event.startDay).toBe(day);
          expect(event.endDay - event.startDay).toBeGreaterThanOrEqual(r.minDays);
          expect(event.endDay - event.startDay).toBeLessThanOrEqual(r.maxDays);
          expect(event.magnitudeBps).toBeGreaterThanOrEqual(r.minMagnitudeBps);
          expect(event.magnitudeBps).toBeLessThanOrEqual(r.maxMagnitudeBps);
          expect(CITIES).toContain(event.cityId);
          if (event.otherCityId !== null) expect(CITIES).toContain(event.otherCityId);
        }
      }),
    );
  });

  it('fréquence : sur 4 000 jours, la part des jours à sécheresse suit la probabilité', () => {
    const days = Array.from({ length: 4_000 }, (_, day) => `monde:${day}`);
    const share = (probabilityBps: number) =>
      days.filter((seed) => planWorldEvents(input({ drought: rules(probabilityBps) }, seed)).length)
        .length / days.length;
    expect(share(1)).toBeLessThan(0.005);
    expect(Math.abs(share(1_000) - 0.1)).toBeLessThan(0.02);
    expect(Math.abs(share(5_000) - 0.5)).toBeLessThan(0.03);
    expect(share(10_000)).toBe(1);
  });
});
