import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appWithConfig,
  db,
  newShipowner,
  owner,
  send,
  type Shipowner,
} from './voyage.integration-fixtures';
import { planEvent, waitUntil } from './world-events.integration-fixtures';

// Risque de perte fixé au départ (4.6, 7.4, #730), contre Supabase local. Le test a son monde, pour que sa
// tempête ne touche que ses propres maisons.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Kallistè–Elaia : 3 %, majoré de 12 % pendant une tempête ; Kallistè–Halos : 95 %, majoré de 20 % ; autres : nul. */
const risky = (config: GameConfig): GameConfig => ({
  ...config,
  ships: {
    ...config.ships,
    routes: config.ships.routes.map((route) => {
      const pair = [...route.cities].sort().join(' ');
      if (pair === 'elaia kalliste') return { ...route, lossRiskBps: 300, stormLossRiskBps: 1_200 };
      if (pair === 'halos kalliste')
        return { ...route, lossRiskBps: 9_500, stormLossRiskBps: 2_000 };
      return route;
    }),
  },
});
const app = appWithConfig(risky);

async function newWorld(slugs: string[]) {
  const worldId = randomUUID();
  await owner
    .insertInto('game.worlds')
    .values({ id: worldId, slug: `loss-${worldId.slice(0, 12)}`, name: 'Pertes' })
    .execute();
  const rows = await owner
    .insertInto('game.cities')
    .values(slugs.map((slug) => ({ world_id: worldId, slug, name: slug })))
    .returning(['id', 'slug'])
    .execute();
  return { worldId, city: Object.fromEntries(rows.map((row) => [row.slug, row.id])) };
}
const leave = (player: Shipowner, from: string, to: string, key?: string) =>
  send(
    player.user,
    'voyage.depart',
    {
      shipId: player.shipId,
      fromCityId: from,
      toCityId: to,
      cargo: [{ goodId: 'wheat', quantity: 10 }],
      expectedCostOboles: 0,
    },
    key,
    app,
  );
/** Risque gardé avec le voyage, et celui que porte son `VoyageDeparted`. */
async function riskOf(voyageId: string) {
  const voyage = await owner
    .selectFrom('game.voyages')
    .select('loss_risk_bps')
    .where('id', '=', voyageId)
    .executeTakeFirstOrThrow();
  const events = await owner
    .selectFrom('game.domain_events')
    .select('payload')
    .where('type', '=', 'VoyageDeparted')
    .where(sql<boolean>`payload ->> 'voyageId' = ${voyageId}`)
    .execute();
  return {
    stored: voyage.loss_risk_bps,
    announced: events.map((row) => (row.payload as { lossRiskBps?: number }).lossRiskBps),
  };
}

describe('risque de perte fixé au départ (#730)', () => {
  it('celui de la route par temps calme, majoré pendant sa tempête, borné à 10 000 ; nul ailleurs ; rejouer ne le change pas', async () => {
    const { worldId, city } = await newWorld(['kalliste', 'elaia', 'halos', 'ampelos']);
    const [kalliste, elaia, halos, ampelos] = ['kalliste', 'elaia', 'halos', 'ampelos'].map(
      (slug) => city[slug] ?? '',
    );
    const players = await Promise.all(
      Array.from({ length: 5 }, () => newShipowner(kalliste ?? '')),
    );
    const [calm, stormy, capped, calmHalos, safe] = players as [
      Shipowner,
      Shipowner,
      Shipowner,
      Shipowner,
      Shipowner,
    ];
    // Tempêtes sur Kallistè–Elaia (planifiée dans l'autre sens) et Kallistè–Halos, dans 3 s : les départs
    // calmes partent avant elles, même sur une machine lente.
    // Planifiées l'une après l'autre : chacune enregistre la clôture de son jour.
    const storms = [];
    for (const [cityId, otherCityId] of [
      [elaia, kalliste],
      [kalliste, halos],
    ])
      storms.push(
        await planEvent(owner, {
          worldId,
          model: 'storm',
          cityId: cityId ?? '',
          otherCityId: otherCityId ?? '',
          magnitudeBps: 1_000,
          inMs: 3_000,
          lastsMs: 86_400_000,
        }),
      );
    const calmTrip = await leave(calm, kalliste ?? '', elaia ?? '');
    const calmHalosTrip = await leave(calmHalos, kalliste ?? '', halos ?? '');
    for (const storm of storms) await waitUntil(db, storm.startsAt);
    const key = randomUUID();
    const stormyTrip = await leave(stormy, kalliste ?? '', elaia ?? '', key);
    const cappedTrip = await leave(capped, kalliste ?? '', halos ?? '');
    const safeTrip = await leave(safe, kalliste ?? '', ampelos ?? '');
    for (const trip of [calmTrip, calmHalosTrip, stormyTrip, cappedTrip, safeTrip])
      expect(trip.body.ok).toBe(true);

    expect(await riskOf(calmTrip.body.data.voyageId)).toEqual({ stored: 300, announced: [300] });
    expect(await riskOf(calmHalosTrip.body.data.voyageId)).toEqual({
      stored: 9_500,
      announced: [9_500],
    });
    expect(await riskOf(stormyTrip.body.data.voyageId)).toEqual({
      stored: 1_500,
      announced: [1_500],
    });
    expect(await riskOf(cappedTrip.body.data.voyageId)).toEqual({
      stored: 10_000,
      announced: [10_000],
    });
    expect(await riskOf(safeTrip.body.data.voyageId)).toEqual({ stored: 0, announced: [0] });

    // Même clé : le départ n'est pas rejoué, son risque reste celui qu'il a eu.
    const again = await leave(stormy, kalliste ?? '', elaia ?? '', key);
    expect(again.body.data.voyageId).toBe(stormyTrip.body.data.voyageId);
    expect(await riskOf(stormyTrip.body.data.voyageId)).toEqual({
      stored: 1_500,
      announced: [1_500],
    });
  });
});
