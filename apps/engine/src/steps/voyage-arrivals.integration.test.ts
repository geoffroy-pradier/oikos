import { afterAll, describe, expect, it } from 'vitest';
import {
  arrive,
  conservation,
  currentTick,
  db,
  give,
  newHouse,
  newWorld,
  owner,
  sail,
  stocks,
  TICK_MINUTES,
  voyageState,
} from './voyage-arrivals.integration-fixtures';

// Arrivée des voyages par le moteur (#253), contre Supabase local. Chaque test a son monde.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

describe('arrivée des voyages par le moteur', () => {
  it('décharge chaque voyage échu dans la cité d’arrivée, daté du tick, et y met le navire à quai', async () => {
    const world = await newWorld();
    const [alice, bob] = [await newHouse(world, 2), await newHouse(world)];
    // Un bien que la configuration ne connaît pas (retiré) se décharge comme les autres.
    await give(world, alice.houseId, world.kalliste, 'murex', 5);
    await give(world, alice.houseId, world.elaia, 'olive_oil', 4);
    const tick = currentTick(1);
    const at = (ms: number) => new Date(tick.getTime() + ms);
    const [first, late] = alice.shipIds as [string, string];
    const due = await sail(world, alice.houseId, first, at(-3_600_000), {
      wheat: 30,
      olive_oil: 20,
      murex: 5,
    });
    const notYet = await sail(world, alice.houseId, late, at(1), { wheat: 10 });
    const exact = await sail(world, bob.houseId, bob.shipIds[0] ?? '', tick, { wheat: 7 });

    expect(await arrive(world, tick)).toEqual({ voyages: 2, units: 62 });
    expect(await stocks(world, alice.houseId)).toEqual({
      kalliste: { olive_oil: 30, wheat: 60 },
      elaia: { murex: 5, olive_oil: 24, wheat: 30 },
    });
    expect(await stocks(world, bob.houseId)).toEqual({
      kalliste: { olive_oil: 50, wheat: 93 },
      elaia: { wheat: 7 },
    });
    const arrived = await voyageState(due);
    expect(arrived).toMatchObject({
      arrived_at: tick,
      docked_city_id: world.elaia,
      laid_up_at: null,
    });
    expect(arrived.events).toEqual([
      {
        command_id: null,
        payload: {
          voyageId: due,
          shipId: first,
          houseId: alice.houseId,
          fromCityId: world.kalliste,
          toCityId: world.elaia,
          arrivesAt: at(-3_600_000).toISOString(),
          arrivedAt: tick.toISOString(),
          cargo: [
            { goodId: 'murex', quantity: 5 },
            { goodId: 'olive_oil', quantity: 20 },
            { goodId: 'wheat', quantity: 30 },
          ],
        },
      },
    ]);
    // Échu à l'instant exact du tick : déchargé. Une milliseconde après : en mer jusqu'au tick suivant.
    expect(await voyageState(exact)).toMatchObject({
      arrived_at: tick,
      docked_city_id: world.elaia,
    });
    expect(await voyageState(notYet)).toEqual({
      arrives_at: at(1),
      arrived_at: null,
      docked_city_id: null,
      laid_up_at: null,
      events: [],
    });
    expect(await conservation(world)).toBe(true);

    // Le tick suivant ne décharge que le voyage resté en mer, daté de lui, et rien deux fois.
    const next = at(TICK_MINUTES * 60_000);
    expect(await arrive(world, next)).toEqual({ voyages: 1, units: 10 });
    expect((await stocks(world, alice.houseId)).elaia).toEqual({
      murex: 5,
      olive_oil: 24,
      wheat: 40,
    });
    expect(await voyageState(notYet)).toMatchObject({
      arrived_at: next,
      docked_city_id: world.elaia,
    });
    expect((await voyageState(due)).events).toHaveLength(1);
    expect(await arrive(world, next)).toEqual({ voyages: 0, units: 0 });
    expect(await conservation(world)).toBe(true);
  });
});
