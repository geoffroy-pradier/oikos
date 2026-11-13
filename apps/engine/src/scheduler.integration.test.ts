import { randomUUID } from 'node:crypto';
import {
  ConfigError,
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
} from '@oikos/config';
import { createDb } from '@oikos/db';
import { tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceAllWorlds, advanceWorld } from './scheduler';
import type { TickStep } from './tick';

const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
const loader = createConfigLoader(db);
let tickMinutes: number;
let first: number;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  tickMinutes = (await loader.at(new Date())).config.clock.tickMinutes;
  // Premier tick dont le début est postérieur à l'activation de la configuration (base neuve).
  first = tickIndexAt(new Date(), tickMinutes) + 1;
});
afterAll(() => db.destroy());

async function newWorld(): Promise<string> {
  const id = randomUUID();
  await sql`insert into game.worlds (id, slug, name) values (${id}, ${`s-${id.slice(0, 12)}`}, 'Test')`.execute(
    db,
  );
  return id;
}
const at = (index: number, offsetMs = 1000) =>
  new Date(tickStart(index, tickMinutes).getTime() + offsetMs);
const playedOf = async (worldId: string) =>
  (
    await db
      .selectFrom('game.ticks')
      .select('index')
      .where('world_id', '=', worldId)
      .orderBy('index')
      .execute()
  ).map((row) => Number(row.index));

describe('avance d’un monde', () => {
  it('joue le tick en cours, puis rattrape les suivants dans l’ordre, sans jamais rejouer', async () => {
    const worldId = await newWorld();
    const order: number[] = [];
    const steps: TickStep[] = [
      { name: 'order', run: async ({ index }) => (order.push(index), {}) },
    ];
    const advance = (now: Date) => advanceWorld(db, { worldId, now, config: loader, steps });

    expect(await advance(at(first))).toEqual([first]);
    expect(await advance(at(first, 5 * 60_000))).toEqual([]);
    expect(await advance(at(first + 3))).toEqual([first + 1, first + 2, first + 3]);
    expect(order).toEqual([first, first + 1, first + 2, first + 3]);
    expect(await playedOf(worldId)).toEqual(order);
    // Le passage suivant repart du dernier tick joué, pas du premier.
    expect(await advance(at(first + 4))).toEqual([first + 4]);
    // Un moteur seul ne retente jamais un tick déjà joué.
    const skipped = await db
      .selectFrom('telemetry.tick_runs')
      .select('tick_index')
      .where('world_id', '=', worldId)
      .where('status', '=', 'skipped')
      .execute();
    expect(skipped).toEqual([]);
  });

  it('monde neuf sans configuration en vigueur au début du tick en cours : commence au tick suivant', async () => {
    const worldId = await newWorld();
    const before = {
      at: async () => Promise.reject(new ConfigError('No active configuration')),
      byId: loader.byId,
    };
    const calls: Date[] = [];
    const config = {
      at: async (instant: Date) => (
        calls.push(instant),
        calls.length === 1 ? loader.at(at(first)) : before.at()
      ),
      byId: loader.byId,
    };
    expect(await advanceWorld(db, { worldId, now: at(first), config, steps: [] })).toEqual([]);
    expect(await playedOf(worldId)).toEqual([]);
    expect(
      await advanceWorld(db, { worldId, now: at(first + 1), config: loader, steps: [] }),
    ).toEqual([first + 1]);
  });

  it('un tick en échec arrête le rattrapage ; il est repris au passage suivant, jamais sauté', async () => {
    const worldId = await newWorld();
    let failures = 1;
    const steps: TickStep[] = [
      {
        name: 'flaky',
        async run({ index }) {
          if (index === first + 1 && failures-- > 0) throw new Error('panne simulée');
          return {};
        },
      },
    ];
    const advance = (now: Date) => advanceWorld(db, { worldId, now, config: loader, steps });
    expect(await advance(at(first))).toEqual([first]);
    await expect(advance(at(first + 2))).rejects.toThrow('panne simulée');
    expect(await playedOf(worldId)).toEqual([first]);
    expect(await advance(at(first + 2))).toEqual([first + 1, first + 2]);
  });

  it('deux moteurs en même temps : chaque tick une seule fois, dans l’ordre', async () => {
    const worldId = await newWorld();
    const steps: TickStep[] = [
      {
        name: 'effect',
        async run({ trx, index }) {
          await sql`insert into game.domain_events (type, payload) values ('TickProbe', ${JSON.stringify({ worldId, index })}::jsonb)`.execute(
            trx,
          );
          return {};
        },
      },
    ];
    const advance = (index: number) =>
      advanceWorld(db, { worldId, now: at(index), config: loader, steps });
    // Monde en retard de quatre ticks, puis trois moteurs réellement simultanés.
    await advance(first);
    const engines = await Promise.all([advance(first + 4), advance(first + 4), advance(first + 4)]);
    const due = [first + 1, first + 2, first + 3, first + 4];
    // Chaque tick est joué par un moteur et un seul.
    expect(engines.flat().sort((a, b) => a - b)).toEqual(due);
    const effects = await sql<{
      index: number;
    }>`select (payload->>'index')::int as index from game.domain_events where type = 'TickProbe' and payload->>'worldId' = ${worldId} order by seq`.execute(
      db,
    );
    expect(effects.rows.map((row) => row.index)).toEqual([first, ...due]);
    const runs = await db
      .selectFrom('telemetry.tick_runs')
      .select('status')
      .where('world_id', '=', worldId)
      .where('status', '=', 'done')
      .execute();
    expect(runs).toHaveLength(5);
  });

  it('tous les mondes avancent ; l’échec de l’un n’arrête pas les autres et il est rapporté', async () => {
    const [good, bad] = [await newWorld(), await newWorld()];
    const steps: TickStep[] = [
      {
        name: 'selective',
        async run({ worldId }) {
          if (worldId === bad) throw new Error('monde en panne');
          return {};
        },
      },
    ];
    const results = await advanceAllWorlds(db, { now: at(first), config: loader, steps });
    const byWorld = new Map(results.map((result) => [result.worldId, result]));
    expect(byWorld.get(good)).toEqual({ worldId: good, played: [first] });
    expect(byWorld.get(bad)).toEqual({ worldId: bad, played: [], error: 'monde en panne' });
    expect([await playedOf(good), await playedOf(bad)]).toEqual([[first], []]);
  });
});
