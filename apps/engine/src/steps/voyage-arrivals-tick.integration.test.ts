import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type LoadedConfig,
} from '@oikos/config';
import { tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceWorld } from '../scheduler';
import { runTick, type TickRequest } from '../tick';
import { TICK_STEPS } from '../tick-steps';
import {
  arrive,
  conservation,
  currentTick,
  db,
  newHouse,
  newWorld,
  owner,
  sail,
  stocks,
  TICK_MINUTES,
  voyageState,
  type World,
} from './voyage-arrivals.integration-fixtures';

// Arrivée des voyages dans le tick du moteur (#253) : cas limites, rejeu, moteurs concurrents, panne.
let active: LoadedConfig;
beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const config = { at: async () => active, byId: async () => active };
/** Le tick `index` du monde, avec toutes les étapes du moteur, à l'heure présente. */
const tickOf = (world: World, index: number): TickRequest => ({
  worldId: world.worldId,
  index,
  scheduledAt: tickStart(index, TICK_MINUTES),
  config,
  steps: TICK_STEPS,
  now: () => new Date(),
});
const summaries = async (world: World) =>
  (
    await db
      .selectFrom('game.ticks')
      .select(['index', 'summary'])
      .where('world_id', '=', world.worldId)
      .orderBy('index')
      .execute()
  ).map((tick) => [
    Number(tick.index),
    (tick.summary as Record<string, unknown>)['voyageArrivals'],
  ]);

describe('arrivée des voyages : cas limites', () => {
  it('un navire sur lest, désarmé en mer, accoste sans rien décharger et reste désarmé', async () => {
    const world = await newWorld();
    const { houseId, shipIds } = await newHouse(world);
    const shipId = shipIds[0] ?? '';
    const tick = currentTick();
    const voyageId = await sail(world, houseId, shipId, new Date(tick.getTime() - 60_000));
    await sql`update game.ships set laid_up_at = now() where id = ${shipId}`.execute(owner);

    expect(await arrive(world, tick)).toEqual({ voyages: 1, units: 0 });
    const state = await voyageState(voyageId);
    expect(state).toMatchObject({ arrived_at: tick, docked_city_id: world.elaia });
    expect(state.laid_up_at).not.toBeNull();
    expect(state.events.map((event) => event.payload)).toMatchObject([{ cargo: [] }]);
    expect(await stocks(world, houseId)).toEqual({
      kalliste: { olive_oil: 50, wheat: 100 },
      elaia: {},
    });
  });

  it('deux navires d’une maison déchargent le même bien dans le même stock ; un autre monde attend', async () => {
    const [world, other] = [await newWorld(), await newWorld()];
    const [here, there] = [await newHouse(world, 2), await newHouse(other)];
    const tick = currentTick();
    const hour = new Date(tick.getTime() - 3_600_000);
    const [one, two] = here.shipIds as [string, string];
    await sail(world, here.houseId, one, hour, { wheat: 1 });
    await sail(world, here.houseId, two, tick, { wheat: 2, olive_oil: 3 });
    const theirs = await sail(other, there.houseId, there.shipIds[0] ?? '', hour, { wheat: 1 });

    expect(await arrive(world, tick)).toEqual({ voyages: 2, units: 6 });
    expect((await stocks(world, here.houseId)).elaia).toEqual({ olive_oil: 3, wheat: 3 });
    expect((await voyageState(theirs)).arrived_at).toBeNull();
    expect(await conservation(world)).toBe(true);
  });
});

describe('arrivée des voyages : rejeu et concurrence', () => {
  it('un tick joué deux fois, ou par deux moteurs à la fois, décharge une seule fois', async () => {
    const world = await newWorld();
    const { houseId, shipIds } = await newHouse(world);
    const index = tickIndexAt(new Date(), TICK_MINUTES) - 1;
    const voyageId = await sail(world, houseId, shipIds[0] ?? '', tickStart(index, TICK_MINUTES), {
      wheat: 30,
    });

    const both = await Promise.all([
      runTick(db, tickOf(world, index)),
      runTick(db, tickOf(world, index)),
    ]);
    expect(both.map((outcome) => outcome.status).sort()).toEqual(['done', 'skipped']);
    expect((await runTick(db, tickOf(world, index))).status).toBe('skipped');
    expect(await summaries(world)).toEqual([[index, { voyages: 1, units: 30 }]]);
    expect((await stocks(world, houseId)).elaia).toEqual({ wheat: 30 });
    expect((await voyageState(voyageId)).events).toHaveLength(1);
    expect(await conservation(world)).toBe(true);
  });

  it('deux moteurs sur deux ticks à la fois : le second ne trouve plus rien à décharger', async () => {
    const world = await newWorld();
    const { houseId, shipIds } = await newHouse(world);
    const tick = currentTick(1);
    await sail(world, houseId, shipIds[0] ?? '', new Date(tick.getTime() - 60_000), { wheat: 30 });

    const results = await Promise.all([arrive(world, tick), arrive(world, currentTick())]);
    expect(results.map((result) => result.voyages).sort()).toEqual([0, 1]);
    expect((await stocks(world, houseId)).elaia).toEqual({ wheat: 30 });
    expect(await conservation(world)).toBe(true);
  });

  it('un voyage verrouillé par une autre transaction est laissé au tick suivant, sans attente', async () => {
    const world = await newWorld();
    const { houseId, shipIds } = await newHouse(world);
    const tick = currentTick();
    const voyageId = await sail(world, houseId, shipIds[0] ?? '', tick, { wheat: 30 });

    await owner.transaction().execute(async (trx) => {
      await sql`select 1 from game.voyages where id = ${voyageId} for update`.execute(trx);
      expect(await arrive(world, tick)).toEqual({ voyages: 0, units: 0 });
    });
    expect((await voyageState(voyageId)).arrived_at).toBeNull();
    expect(await arrive(world, tick)).toEqual({ voyages: 1, units: 30 });
  });
});

describe('arrivée des voyages : panne du moteur', () => {
  it('un voyage échu pendant une panne est déchargé par le premier tick qui suit, daté de lui', async () => {
    const world = await newWorld();
    const { houseId, shipIds } = await newHouse(world);
    const now = tickIndexAt(new Date(), TICK_MINUTES);
    // Dernier tick joué avant la panne : six ticks plus tôt. Le voyage échoit une seconde après le début
    // du troisième tick manqué : c'est le quatrième, le premier qui commence après son échéance, qui le décharge.
    expect((await runTick(db, { ...tickOf(world, now - 6), steps: [] })).status).toBe('done');
    const arrivesAt = new Date(tickStart(now - 3, TICK_MINUTES).getTime() + 1000);
    const voyageId = await sail(world, houseId, shipIds[0] ?? '', arrivesAt, { wheat: 30 });

    expect(
      await advanceWorld(db, {
        worldId: world.worldId,
        // Dans le tick `now`, quel que soit l'instant où le test s'exécute : la liste des ticks joués est fixe.
        now: new Date(tickStart(now, TICK_MINUTES).getTime() + 1),
        config,
        steps: TICK_STEPS,
      }),
    ).toEqual([5, 4, 3, 2, 1, 0].map((back) => now - back));
    expect(await voyageState(voyageId)).toMatchObject({
      arrived_at: tickStart(now - 2, TICK_MINUTES),
      docked_city_id: world.elaia,
    });
    const nothing = { voyages: 0, units: 0 };
    expect(await summaries(world)).toEqual([
      [now - 6, undefined],
      ...[5, 4, 3].map((back) => [now - back, nothing]),
      [now - 2, { voyages: 1, units: 30 }],
      ...[1, 0].map((back) => [now - back, nothing]),
    ]);
    expect((await stocks(world, houseId)).elaia).toEqual({ wheat: 30 });
  });
});
