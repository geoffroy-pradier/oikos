import { createConfigLoader, ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { tickIndexAt, tickStart, voyageLoss } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTick } from '../tick';
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

// Pertes en mer à l'arrivée (4.6, #730), contre Supabase local : tirage, journal des stocks, événements, rejeu.
beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Mouvements de sortie de `in_transit` du voyage : vers quel stock ou quelle extrémité, et combien. */
const outOfTransit = async (voyageId: string) =>
  (
    await sql<{ good_id: string; quantity: string; to_system: string | null; kind: string }>`
      select good_id, quantity, to_system, kind from game.stock_ledger
      where voyage_id = ${voyageId} and from_system = 'in_transit' order by good_id`.execute(owner)
  ).rows;
const lossesOf = async (voyageId: string) =>
  (
    await owner
      .selectFrom('game.domain_events')
      .select(['command_id', 'payload'])
      .where('type', '=', 'CargoLostAtSea')
      .where(sql<boolean>`payload->>'voyageId' = ${voyageId}`)
      .execute()
  ).map((event) => ({ command_id: event.command_id, payload: event.payload }));
const seedOf = async ({ worldId }: World) =>
  (
    await owner
      .selectFrom('game.worlds')
      .select('seed')
      .where('id', '=', worldId)
      .executeTakeFirstOrThrow()
  ).seed;

describe('pertes en mer à l’arrivée (#730)', () => {
  it('risque plein : toute la cargaison passe à lost_at_sea, le navire accoste à vide ; sans risque, tout est déchargé', async () => {
    const world = await newWorld();
    const { houseId, shipIds } = await newHouse(world, 3);
    const [lost, safe, ballast] = shipIds as [string, string, string];
    const tick = currentTick(1);
    const due = new Date(tick.getTime() - 60_000);
    const lostVoyage = await sail(world, houseId, lost, due, { wheat: 30, olive_oil: 10 }, 10_000);
    const safeVoyage = await sail(world, houseId, safe, due, { wheat: 20 });
    const ballastVoyage = await sail(world, houseId, ballast, due, {}, 10_000);

    expect(await arrive(world, tick)).toEqual({
      voyages: 3,
      units: 20,
      lostVoyages: 1,
      lostUnits: 40,
    });
    expect(await stocks(world, houseId)).toEqual({
      kalliste: { wheat: 50, olive_oil: 40 },
      elaia: { wheat: 20 },
    });
    expect(await outOfTransit(lostVoyage)).toEqual([
      { good_id: 'olive_oil', quantity: '10', to_system: 'lost_at_sea', kind: 'voyage.loss' },
      { good_id: 'wheat', quantity: '30', to_system: 'lost_at_sea', kind: 'voyage.loss' },
    ]);
    expect(await outOfTransit(safeVoyage)).toEqual([
      { good_id: 'wheat', quantity: '20', to_system: null, kind: 'voyage.arrival' },
    ]);
    // Le navire n'est pas perdu : il est à quai à Elaia, son arrivée datée du tick.
    const state = await voyageState(lostVoyage);
    expect([state.arrived_at, state.docked_city_id]).toEqual([tick, world.elaia]);
    expect(state.events.map((event) => event.payload)).toEqual([
      expect.objectContaining({ voyageId: lostVoyage, cargo: [] }),
    ]);
    expect(await lossesOf(lostVoyage)).toEqual([
      {
        command_id: null,
        payload: {
          voyageId: lostVoyage,
          shipId: lost,
          houseId,
          fromCityId: world.kalliste,
          toCityId: world.elaia,
          arrivedAt: tick.toISOString(),
          lossRiskBps: 10_000,
          cargo: [
            { goodId: 'olive_oil', quantity: 10 },
            { goodId: 'wheat', quantity: 30 },
          ],
        },
      },
    ]);
    // Un navire sur lest n'a rien à perdre, un voyage sans risque ne perd rien : pas d'événement de perte.
    expect([...(await lossesOf(ballastVoyage)), ...(await lossesOf(safeVoyage))]).toEqual([]);
    expect((await voyageState(ballastVoyage)).docked_city_id).toBe(world.elaia);
    expect(await conservation(world)).toBe(true);
  });

  it('risque partiel : chaque voyage suit le tirage de sa graine, perd tout ou rien', async () => {
    const world = await newWorld();
    const { houseId, shipIds } = await newHouse(world, 12);
    const tick = currentTick(1);
    const voyages = [];
    for (const shipId of shipIds)
      voyages.push(
        await sail(world, houseId, shipId, new Date(tick.getTime() - 60_000), { wheat: 5 }, 5_000),
      );
    await arrive(world, tick);
    const worldSeed = await seedOf(world);
    for (const voyageId of voyages) {
      const expected = voyageLoss({ worldSeed, voyageId, riskBps: 5_000 });
      expect((await outOfTransit(voyageId)).map((line) => line.to_system)).toEqual([
        expected ? 'lost_at_sea' : null,
      ]);
      expect(await lossesOf(voyageId)).toHaveLength(expected ? 1 : 0);
    }
    const lost = voyages.filter((voyageId) => voyageLoss({ worldSeed, voyageId, riskBps: 5_000 }));
    expect((await stocks(world, houseId)).elaia).toEqual(
      lost.length === voyages.length ? {} : { wheat: 5 * (voyages.length - lost.length) },
    );
    expect(await conservation(world)).toBe(true);
  });

  it('arrivée rejouée, par le même tick ou par deux moteurs : une seule perte', async () => {
    const world = await newWorld();
    const { houseId, shipIds } = await newHouse(world);
    const index = tickIndexAt(new Date(), TICK_MINUTES) - 1;
    const voyageId = await sail(
      world,
      houseId,
      shipIds[0] ?? '',
      tickStart(index, TICK_MINUTES),
      { wheat: 30 },
      10_000,
    );
    const active = await createConfigLoader(db).at(new Date());
    const request = {
      worldId: world.worldId,
      index,
      scheduledAt: tickStart(index, TICK_MINUTES),
      config: { at: async () => active, byId: async () => active },
      steps: TICK_STEPS,
      now: () => new Date(),
    };
    const both = await Promise.all([runTick(db, request), runTick(db, request)]);
    expect(both.map((outcome) => outcome.status).sort()).toEqual(['done', 'skipped']);
    expect((await runTick(db, request)).status).toBe('skipped');
    // L'étape rejouée seule, au tick suivant, ne trouve plus rien à perdre ni à décharger.
    expect(await arrive(world, currentTick())).toEqual({ voyages: 0, units: 0 });
    expect(await outOfTransit(voyageId)).toEqual([
      { good_id: 'wheat', quantity: '30', to_system: 'lost_at_sea', kind: 'voyage.loss' },
    ]);
    expect(await lossesOf(voyageId)).toHaveLength(1);
    expect((await voyageState(voyageId)).events).toHaveLength(1);
    expect((await stocks(world, houseId)).elaia).toEqual({});
    expect(await conservation(world)).toBe(true);
  });
});
