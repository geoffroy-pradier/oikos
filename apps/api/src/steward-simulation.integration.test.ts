import { simulateRules } from '@oikos/engine';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { db, newPlayer, owner } from './steward.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import { WORLD } from './voyage.integration-fixtures';

// Simulation à blanc des règles proposées (#280), contre Supabase local, par le cœur partagé des opérations. Chaque
// test fonde sa maison : un champ de blé (40 blés par cycle de 240 minutes) et un moulin, dont l'intrant est le blé.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const WHEAT_CYCLE_MS = 240 * 60_000;
/** Fait vieillir le cycle en cours du site, garde de la base levée le temps de l'écrire. */
async function age(siteId: string, cycles: number) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${cycles * WHEAT_CYCLE_MS} milliseconds`}::interval,
      cycle_started_at = cycle_started_at - ${`${cycles * WHEAT_CYCLE_MS} milliseconds`}::interval
      where id = ${siteId}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}
/** Tout ce qu'une opération écrirait pour la maison : stocks, ordres, trésorerie, cycle des sites, journaux. */
const footprint = async (houseId: string, user: string) =>
  (
    await sql<Record<string, unknown>>`select
      (select json_agg(json_build_object('g', good_id, 'q', quantity, 'r', reserved) order by good_id)
         from game.inventories where house_id = ${houseId}) as stocks,
      (select count(*) from game.orders where house_id = ${houseId}) as orders,
      (select json_agg(balance order by id) from game.accounts where house_id = ${houseId}) as balances,
      (select json_agg(cycle_started_at order by id) from game.sites where house_id = ${houseId}) as cycles,
      (select count(*) from game.command_log where user_id = ${user}) as commands,
      (select count(*) from game.domain_events where payload->>'houseId' = ${houseId}) as events`.execute(
      db,
    )
  ).rows[0];

const config = TEST_CONFIG.config;
const collect = { kind: 'collect' } as const;
const holdWheat = { kind: 'sell', goodId: 'wheat', minPriceOboles: 900, keepUnits: 0 } as const;

describe('simulation à blanc des règles proposées', () => {
  it('dit ce que chaque règle ferait maintenant, dans l’ordre, sans rien écrire', async () => {
    const player = await newPlayer();
    await age(player.field, 2);
    const steward = { world_id: WORLD, house_id: player.houseId, site_id: player.field };
    const before = await footprint(player.houseId, player.user);
    const wheat = (before?.['stocks'] as { g: string; q: number }[] | null)?.find(
      (stock) => stock.g === 'wheat',
    );
    const steps = await simulateRules(db, config, steward, [collect, holdWheat]);
    // La vente voit le blé que la récolte vient de produire.
    expect(steps).toEqual([
      {
        position: 0,
        status: 'ok',
        summary: {
          command: 'site.collect',
          cycles: 2,
          outputs: [{ goodId: 'wheat', quantity: 80 }],
        },
      },
      {
        position: 1,
        status: 'ok',
        summary: {
          command: 'market.placeOrder',
          side: 'sell',
          goodId: 'wheat',
          price: 900,
          quantity: Number(wheat?.q ?? 0) + 80,
          traded: 0,
          status: 'open',
        },
      },
    ]);
    expect(await footprint(player.houseId, player.user)).toEqual(before);
    // Rejouée, la simulation rend la même chose : rien n'a bougé.
    expect(await simulateRules(db, config, steward, [collect, holdWheat])).toEqual(steps);
  });

  it('une règle refusée est annulée sans retenir les suivantes ; une règle sans rien à faire est passée', async () => {
    const player = await newPlayer();
    // Un cycle du moulin est écoulé, sans blé à moudre : la récolte est refusée.
    await age(player.mill, 1);
    const steward = { world_id: WORLD, house_id: player.houseId, site_id: player.mill };
    const before = await footprint(player.houseId, player.user);
    const wheat = (before?.['stocks'] as { g: string; q: number }[] | null)?.find(
      (stock) => stock.g === 'wheat',
    );
    const steps = await simulateRules(db, config, steward, [
      collect,
      { kind: 'sell', goodId: 'flour', minPriceOboles: 14, keepUnits: 0 },
      // Il manque une unité au stock visé : un ordre d'une unité, à une obole, que la trésorerie paie.
      { kind: 'buy', goodId: 'wheat', maxPriceOboles: 1, targetUnits: Number(wheat?.q ?? 0) + 1 },
    ]);
    expect(steps).toEqual([
      {
        position: 0,
        status: 'rejected',
        code: 'MISSING_INPUTS',
        summary: { command: 'site.collect' },
      },
      { position: 1, status: 'idle' },
      {
        position: 2,
        status: 'ok',
        summary: expect.objectContaining({
          command: 'market.placeOrder',
          side: 'buy',
          quantity: 1,
        }),
      },
    ]);
    expect(await footprint(player.houseId, player.user)).toEqual(before);
  });

  it('aucune règle : aucune étape, sans verrou tenu ensuite', async () => {
    const player = await newPlayer();
    const steward = { world_id: WORLD, house_id: player.houseId, site_id: player.field };
    expect(await simulateRules(db, config, steward, [])).toEqual([]);
    const { rows } = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(hashtextextended(${`market:${WORLD}`}, 0)) as locked`.execute(
      db,
    );
    expect(rows[0]?.locked).toBe(true);
  });
});
