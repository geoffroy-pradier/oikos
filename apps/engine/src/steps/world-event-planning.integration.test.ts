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
import { runDailyClose, type CloseStep } from '../close';
import { CLOSE_STEPS } from '../close-steps';
import { fallbackOracle } from '../oracle/compose';
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
// Délai différent de celui de la configuration initiale : un délai écrit en dur dans l'étape se verrait.
const LEAD = 5;
if (initial.worldEvents.planningLeadDays === LEAD)
  throw new Error('LEAD must differ from the initial config');
// Certitude pour les quatre modèles : chaque jour planifié a ses quatre événements.
const certainly = (planningLeadDays: number): GameConfig => ({
  ...initial,
  worldEvents: {
    planningLeadDays,
    models: {
      drought: certain(drought),
      good_year: certain(good_year),
      storm: certain(storm),
      caravan: certain(caravan),
    },
  },
});
const sure = certainly(LEAD);
let active: LoadedConfig;
const TODAY = gameDayAt(new Date(), clock);
const close = (
  worldId: string,
  given: GameConfig,
  steps: readonly CloseStep[] = [worldEventPlanning],
  gameDay = TODAY,
) =>
  runDailyClose(db, {
    worldId,
    gameDay,
    closeAt: dailyCloseAt(gameDay, clock),
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

const FOUR = ['kalliste', 'elaia', 'ampelos', 'halos'];
/** Un monde de graine `seed` et ses cités (les quatre premières de la configuration, sauf mention). */
async function newWorld(seed: string, slugs = FOUR) {
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
  it('clôtures complètes (toutes les étapes) : planifiées au délai, rien de plus à la clôture rejouée', async () => {
    const worldId = await newWorld(randomUUID());
    const all = ['drought', 'good_year', 'storm', 'caravan'];
    const yesterday = await close(worldId, sure, CLOSE_STEPS, TODAY - 1);
    expect([yesterday.status, yesterday.summary['worldEventPlanning']]).toEqual([
      'done',
      { startDay: TODAY - 1 + LEAD, planned: 4, models: all },
    ]);
    const today = await close(worldId, sure, CLOSE_STEPS);
    expect([today.status, today.summary['worldEventPlanning']]).toEqual([
      'done',
      { startDay: TODAY + LEAD, planned: 4, models: all },
    ]);
    const events = await eventsOf(worldId);
    expect(events.map((event) => [event.planned_day, event.start_day]).sort()).toEqual(
      [
        ...Array<number[]>(4).fill([TODAY - 1, TODAY - 1 + LEAD]),
        ...Array<number[]>(4).fill([TODAY, TODAY + LEAD]),
      ].sort(),
    );
    // Rejouée, la clôture du jour est ignorée et rend le résumé enregistré : aucun événement de plus.
    const again = await close(worldId, sure, CLOSE_STEPS);
    expect([again.status, again.summary['worldEventPlanning']]).toEqual([
      'skipped',
      today.summary['worldEventPlanning'],
    ]);
    expect(await eventsOf(worldId)).toEqual(events);
  });

  it('clôture rattrapée en retard (délai d’un jour) : elle réussit, sans l’événement déjà commencé', async () => {
    const worldId = await newWorld(randomUUID());
    const nextDay = certainly(1);
    // La clôture d'hier, jouée maintenant : son jour planifié (aujourd'hui) a déjà commencé selon la base.
    const late = await close(worldId, nextDay, CLOSE_STEPS, TODAY - 1);
    expect([late.status, late.summary['worldEventPlanning']]).toEqual([
      'done',
      { startDay: TODAY, planned: 0, models: [] },
    ]);
    expect(Object.keys(late.summary)).toEqual(CLOSE_STEPS.map((step) => step.name));
    expect(await eventsOf(worldId)).toEqual([]);
    // Celle d'aujourd'hui, à l'heure, planifie demain.
    const onTime = await close(worldId, nextDay, CLOSE_STEPS);
    expect(onTime.summary['worldEventPlanning']).toMatchObject({ startDay: TODAY + 1, planned: 4 });
    expect((await eventsOf(worldId)).map((event) => event.start_day)).toEqual(
      Array<number>(4).fill(TODAY + 1),
    );
  });

  it('probabilités nulles : aucun événement, résumé de même forme', async () => {
    // La configuration initiale tire ses événements au hasard depuis #668 : ses probabilités sont mises à zéro ici.
    const never = <T extends { probabilityBps: number }>(model: T): T => ({
      ...model,
      probabilityBps: 0,
    });
    const silent: GameConfig = {
      ...initial,
      worldEvents: {
        planningLeadDays: initial.worldEvents?.planningLeadDays ?? NaN,
        models: {
          drought: never(drought),
          good_year: never(good_year),
          storm: never(storm),
          caravan: never(caravan),
        },
      },
    };
    const worldId = await newWorld(randomUUID());
    expect((await close(worldId, silent)).summary).toEqual({
      worldEventPlanning: {
        startDay: TODAY + (initial.worldEvents?.planningLeadDays ?? NaN),
        planned: 0,
        models: [],
      },
    });
    expect(await eventsOf(worldId)).toEqual([]);
  });

  it('sans section worldEvents : aucun événement, jour planifié nul', async () => {
    const worldId = await newWorld(randomUUID());
    const older = structuredClone(sure);
    delete older.worldEvents;
    expect((await close(worldId, older)).summary).toEqual({
      worldEventPlanning: { startDay: null, planned: 0, models: [] },
    });
    expect(await eventsOf(worldId)).toEqual([]);
  });

  it('planifie le jour situé au délai, aux instants de ses clôtures, tiré de la graine de ce jour', async () => {
    const seed = randomUUID();
    const worldId = await newWorld(seed);
    const startDay = TODAY + LEAD;
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
      cities: FOUR,
      routes: sure.ships.routes
        .map((route) => route.cities)
        .filter((pair) => pair.every((slug) => FOUR.includes(slug))),
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

  it('chaque événement a son oracle de repli, choisi par sa graine, écrit dans la transaction de la clôture', async () => {
    const worldId = await newWorld(randomUUID());
    const twice = { ...worldEventPlanning, name: 'again' };
    await close(worldId, sure, [worldEventPlanning, twice]);
    const oracles = await owner
      .selectFrom('game.oracles as o')
      .innerJoin('game.world_events as e', 'e.id', 'o.event_id')
      .select(['e.model', 'e.good_id', 'e.seed', 'e.created_at as planned_at', 'o.created_at'])
      .select(['o.world_id', 'o.text_fr', 'o.text_en', 'o.source', 'o.rewritten_at'])
      .where('e.world_id', '=', worldId)
      .orderBy('e.model')
      .execute();
    // Une seule fois par événement, même quand l'étape repasse.
    expect(oracles.map((oracle) => oracle.model)).toEqual([
      'caravan',
      'drought',
      'good_year',
      'storm',
    ]);
    for (const oracle of oracles) {
      const { model, good_id: goodId, seed } = oracle;
      expect({ ...oracle, texts: { fr: oracle.text_fr, en: oracle.text_en } }).toMatchObject({
        world_id: worldId,
        source: 'fallback',
        rewritten_at: null,
        created_at: oracle.planned_at,
        texts: fallbackOracle({ model, goodId, seed }),
      });
    }
  });

  it('une clôture en échec après la planification n’écrit ni événement ni oracle', async () => {
    const worldId = await newWorld(randomUUID());
    const failing: CloseStep = {
      name: 'failing',
      run: () => Promise.reject(new Error('panne après la planification')),
    };
    await expect(close(worldId, sure, [worldEventPlanning, failing])).rejects.toThrow('panne');
    expect(await eventsOf(worldId)).toEqual([]);
    const oracles = await owner
      .selectFrom('game.oracles')
      .select('id')
      .where('world_id', '=', worldId)
      .execute();
    expect(oracles).toEqual([]);
  });

  it('rejouée : rien n’est planifié deux fois, ni par la clôture, ni par l’étape seule', async () => {
    const worldId = await newWorld(randomUUID());
    // L'étape jouée deux fois dans la même clôture : la seconde passe ne planifie rien.
    const twice = { ...worldEventPlanning, name: 'again' };
    const outcome = await close(worldId, sure, [worldEventPlanning, twice]);
    expect(outcome.summary['again']).toEqual({ startDay: TODAY + LEAD, planned: 0, models: [] });
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
    const slugs = ['kalliste', 'elaia', 'atlantis'];
    // Graines fixes, retenues pour le jour planifié (qui suit la date du test) parce que, sans les filtres, elles
    // tireraient la cité inconnue, ou une route vers une cité absente du monde : la régression se verrait.
    const unfiltered = (seed: string) =>
      planWorldEvents({
        daySeed: eventDaySeed(seed, TODAY + LEAD),
        startDay: TODAY + LEAD,
        models: sure.worldEvents?.models ?? {},
        cities: slugs,
        routes: sure.ships.routes.map((route) => route.cities),
      });
    const candidates = Array.from({ length: 32 }, (_, index) => `filtre-des-cites-${index}`);
    const onUnknownCity = candidates.find((seed) =>
      unfiltered(seed).some((event) => event.cityId === 'atlantis'),
    );
    const onAbsentRoute = candidates.find((seed) =>
      unfiltered(seed).some(
        (event) =>
          event.model === 'storm' && `${event.cityId} ${event.otherCityId}` !== 'elaia kalliste',
      ),
    );
    expect([onUnknownCity, onAbsentRoute]).not.toContain(undefined);
    for (const seed of new Set([onUnknownCity ?? '', onAbsentRoute ?? ''])) {
      const worldId = await newWorld(seed, slugs);
      expect((await close(worldId, sure)).summary['worldEventPlanning']).toMatchObject({
        planned: 4,
      });
      const events = await eventsOf(worldId);
      expect(events).toHaveLength(4);
      for (const event of events) expect(['kalliste', 'elaia']).toContain(event.city);
      const tempest = events.find((event) => event.model === 'storm');
      expect([tempest?.city, tempest?.other]).toEqual(['elaia', 'kalliste']);
    }
  });

  it('douze cités (#707) : la tempête se tire parmi toutes les routes de la configuration, nouvelles comprises', async () => {
    const slugs = initial.cities.map((city) => city.id);
    const key = (a: string | null, b: string | null) => [a, b].sort().join(' ');
    const configured = new Set(initial.ships.routes.map(({ cities: [a, b] }) => key(a, b)));
    const drawn = new Set<string>();
    // Seize mondes aux graines fixes : chacun a sa tempête, certaine, sur l'une des 23 routes.
    for (let index = 0; index < 16; index += 1) {
      const worldId = await newWorld(`tempetes-de-l-archipel-${index}`, slugs);
      await close(worldId, sure);
      const storms = (await eventsOf(worldId)).filter((event) => event.model === 'storm');
      expect(storms).toHaveLength(1);
      for (const storm of storms) drawn.add(key(storm.city, storm.other));
    }
    for (const route of drawn) expect(configured).toContain(route);
    // Les six routes des quatre premières cités ne sont pas les seules tirées.
    const fourRoutes = (route: string) => route.split(' ').every((slug) => FOUR.includes(slug));
    expect([...drawn].some((route) => !fourRoutes(route))).toBe(true);
  });
});
