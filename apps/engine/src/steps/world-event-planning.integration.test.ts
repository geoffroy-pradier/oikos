import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt, planWorldEvents } from '@oikos/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose } from '../close';
import { CLOSE_STEPS } from '../close-steps';
import { eventDaySeed, worldEventPlanning } from './world-event-planning';

// Planification des événements du monde à la clôture (#267), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = initial.clock;
if (!initial.worldEvents) throw new Error('worldEvents expected in the initial config');
const certain = <T extends { probabilityBps: number }>(model: T): T => ({
  ...model,
  probabilityBps: 10_000,
});
const { drought, good_year, storm, caravan } = initial.worldEvents.models;
if (!drought || !good_year || !storm || !caravan) throw new Error('four models expected');
// Certitude pour les quatre modèles : chaque jour planifié a ses quatre événements.
const sure: GameConfig = {
  ...initial,
  worldEvents: {
    planningLeadDays: 3,
    models: {
      drought: certain(drought),
      good_year: certain(good_year),
      storm: certain(storm),
      caravan: certain(caravan),
    },
  },
};
let active: LoadedConfig;
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, given: GameConfig, steps = [worldEventPlanning]) =>
  runDailyClose(db, {
    worldId,
    gameDay: TODAY,
    closeAt: dailyCloseAt(TODAY, clock),
    config: { at: async () => ({ ...active, config: given }) },
    steps,
    now: new Date(),
  });
const eventsOf = (worldId: string) =>
  owner
    .selectFrom('game.world_events as e')
    .innerJoin('game.cities as c', 'c.id', 'e.city_id')
    .leftJoin('game.cities as o', 'o.id', 'e.other_city_id')
    .select([
      'e.model',
      'c.slug as city',
      'o.slug as other',
      'e.good_id',
      'e.planned_day',
      'e.start_day',
      'e.end_day',
      'e.starts_at',
      'e.ends_at',
      'e.magnitude_bps',
      'e.seed',
    ])
    .where('e.world_id', '=', worldId)
    .orderBy('e.model')
    .execute();

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Un monde de graine `seed` et ses cités (les quatre de la configuration, sauf mention). */
async function newWorld(seed: string, slugs = ['kalliste', 'elaia', 'ampelos', 'halos']) {
  const worldId = randomUUID();
  await owner
    .insertInto('game.worlds')
    .values({ id: worldId, slug: `ev-${worldId.slice(0, 12)}`, name: 'Événements', seed })
    .execute();
  await owner
    .insertInto('game.cities')
    .values(slugs.map((slug) => ({ world_id: worldId, slug, name: slug })))
    .execute();
  return worldId;
}

describe('planification des événements du monde à la clôture (#267)', () => {
  it('est jouée par la clôture, avant l’entretien', () => {
    expect(CLOSE_STEPS).toContain(worldEventPlanning);
    expect(CLOSE_STEPS.indexOf(worldEventPlanning)).toBeLessThan(CLOSE_STEPS.length - 1);
  });

  it('probabilités nulles de la configuration initiale : aucun événement', async () => {
    const worldId = await newWorld(randomUUID());
    expect((await close(worldId, initial)).summary).toEqual({
      worldEventPlanning: { planned: 0 },
    });
    expect(await eventsOf(worldId)).toEqual([]);
  });

  it('planifie le jour situé au délai, aux instants de ses clôtures, tiré de la graine de ce jour', async () => {
    const seed = randomUUID();
    const worldId = await newWorld(seed);
    const startDay = TODAY + 3;
    const outcome = await close(worldId, sure);
    expect(outcome.summary).toEqual({
      worldEventPlanning: {
        startDay,
        planned: 4,
        models: ['drought', 'good_year', 'storm', 'caravan'],
      },
    });
    const events = await eventsOf(worldId);
    const daySeed = eventDaySeed(seed, startDay);
    expect(daySeed).toMatch(/^[0-9a-f]{64}$/);
    // Exactement ce que tire la simulation pure de la graine du jour, sur les cités et routes du monde.
    const expected = planWorldEvents({
      daySeed,
      startDay,
      models: sure.worldEvents?.models ?? {},
      cities: ['kalliste', 'elaia', 'ampelos', 'halos'],
      routes: sure.ships.routes.map((route) => route.cities),
    });
    expect(
      events.map((event) => ({
        model: event.model,
        cityId: event.city,
        otherCityId: event.other,
        goodId: event.good_id,
        startDay: event.start_day,
        endDay: event.end_day,
        magnitudeBps: event.magnitude_bps,
      })),
    ).toEqual([...expected].sort((a, b) => (a.model < b.model ? -1 : 1)));
    for (const event of events) {
      expect([event.planned_day, event.seed]).toEqual([TODAY, daySeed]);
      expect(event.starts_at).toEqual(dailyCloseAt(event.start_day, clock));
      expect(event.ends_at).toEqual(dailyCloseAt(event.end_day, clock));
    }
  });

  it('rejouée : rien n’est planifié deux fois, ni par la clôture, ni par l’étape seule', async () => {
    const worldId = await newWorld(randomUUID());
    // L'étape jouée deux fois dans la même clôture : la seconde passe ne planifie rien.
    const twice = { ...worldEventPlanning, name: 'again' };
    const outcome = await close(worldId, sure, [worldEventPlanning, twice]);
    expect(outcome.summary['again']).toEqual({ startDay: TODAY + 3, planned: 0, models: [] });
    const once = await eventsOf(worldId);
    expect(once).toHaveLength(4);
    // La clôture rejouée est ignorée ; un autre tirage du même jour n'y changerait rien.
    expect((await close(worldId, sure)).status).toBe('skipped');
    expect(await eventsOf(worldId)).toEqual(once);
  });

  it('même graine, mêmes événements ; une autre graine, d’autres tirages', async () => {
    const seed = randomUUID();
    const [a, b] = [await newWorld(seed), await newWorld(seed)];
    await close(a, sure);
    await close(b, sure);
    const strip = (rows: Awaited<ReturnType<typeof eventsOf>>) =>
      rows.map(({ model, city, other, good_id, start_day, end_day, magnitude_bps, seed }) => ({
        model,
        city,
        other,
        good_id,
        start_day,
        end_day,
        magnitude_bps,
        seed,
      }));
    expect(strip(await eventsOf(b))).toEqual(strip(await eventsOf(a)));
    // Sur huit autres graines, au moins une change les tirages (ampleurs, portées ou durées).
    const others = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const worldId = await newWorld(randomUUID());
        await close(worldId, sure);
        return JSON.stringify(strip(await eventsOf(worldId)).map(({ seed: _, ...rest }) => rest));
      }),
    );
    const mine = JSON.stringify(strip(await eventsOf(a)).map(({ seed: _, ...rest }) => rest));
    expect(others.some((other) => other !== mine)).toBe(true);
  });

  it('ne tire que sur les cités du monde connues de la configuration, et les routes entre elles', async () => {
    const worldId = await newWorld(randomUUID(), ['kalliste', 'elaia', 'atlantis']);
    await close(worldId, sure);
    const events = await eventsOf(worldId);
    for (const event of events) expect(['kalliste', 'elaia']).toContain(event.city);
    const tempest = events.find((event) => event.model === 'storm');
    expect([tempest?.city, tempest?.other]).toEqual(['elaia', 'kalliste']);
  });
});
