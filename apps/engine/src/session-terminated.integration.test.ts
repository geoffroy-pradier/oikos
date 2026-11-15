import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl, type Db } from '@oikos/db';
import { dailyCloseAt, gameDayAt, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runDailyClose, type CloseStep } from './close';
import { runTick, type TickStep } from './tick';

// Une session de base fermée pendant un tick ou une clôture (redémarrage, bascule) ne fait échouer que ce
// passage : le moteur reste vivant, rien n'est validé, et le passage suivant rejoue le même tick ou la
// même clôture, une seule fois (ticket #136).
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const loader = createConfigLoader(db);
let active: LoadedConfig;
beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await loader.at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

async function newWorld() {
  const id = randomUUID();
  await sql`insert into game.worlds (id, slug, name) values (${id}, ${`s-${id.slice(0, 12)}`}, 'Coupure')`.execute(
    owner,
  );
  return id;
}

/** Laisse un effet en base, puis fait fermer sa session par une autre connexion si `cut` est vrai. */
async function effectThenCut(trx: Db, worldId: string, cut: boolean) {
  await sql`insert into game.domain_events (type, payload) values ('SessionProbe', ${JSON.stringify({ worldId })}::jsonb)`.execute(
    trx,
  );
  if (!cut) return;
  const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
  await sql`select pg_terminate_backend(${pid.rows[0]?.pid ?? 0})`.execute(owner);
  await sql`select 1`.execute(trx);
}
const effects = async (worldId: string) =>
  Number(
    (
      await sql<{ n: string }>`select count(*) as n from game.domain_events
        where type = 'SessionProbe' and payload->>'worldId' = ${worldId}`.execute(db)
    ).rows[0]?.n,
  );

it('tick interrompu par la fermeture de sa session : rien de validé, rejoué une fois au passage suivant', async () => {
  const worldId = await newWorld();
  const { tickMinutes } = active.config.clock;
  const index = tickIndexAt(new Date(), tickMinutes) + 1;
  const scheduledAt = tickStart(index, tickMinutes);
  const step = (cut: boolean): TickStep => ({
    name: 'probe',
    run: async ({ trx }) => (await effectThenCut(trx, worldId, cut), {}),
  });
  const request = (cut: boolean) => ({
    worldId,
    index,
    scheduledAt,
    config: loader,
    steps: [step(cut)],
    now: () => new Date(scheduledAt.getTime() + 1000),
  });

  await expect(runTick(db, request(true))).rejects.toThrow();
  expect(await effects(worldId)).toBe(0);
  expect((await runTick(db, request(false))).status).toBe('done');
  expect((await runTick(db, request(false))).status).toBe('skipped');
  expect(await effects(worldId)).toBe(1);
  const runs = await db
    .selectFrom('telemetry.tick_runs')
    .select('status')
    .where('world_id', '=', worldId)
    .orderBy('id')
    .execute();
  expect(runs.map((run) => run.status)).toEqual(['failed', 'done', 'skipped']);
});

it('clôture interrompue par la fermeture de sa session : rien de validé, rejouée une fois', async () => {
  const worldId = await newWorld();
  const { clock } = active.config;
  // Une clôture passée : la base refuse d'en enregistrer une avant son heure.
  const gameDay = gameDayAt(new Date(), clock) - 1;
  const closeAt = dailyCloseAt(gameDay, clock);
  const step = (cut: boolean): CloseStep => ({
    name: 'probe',
    run: async ({ trx }) => (await effectThenCut(trx, worldId, cut), {}),
  });
  const request = (cut: boolean) => ({
    worldId,
    gameDay,
    closeAt,
    // La version en vigueur aujourd'hui, même si elle a été activée après l'instant de cette clôture.
    config: { at: async () => active },
    steps: [step(cut)],
    now: new Date(),
  });

  await expect(runDailyClose(db, request(true))).rejects.toThrow();
  expect(await effects(worldId)).toBe(0);
  expect((await runDailyClose(db, request(false))).status).toBe('done');
  expect((await runDailyClose(db, request(false))).status).toBe('skipped');
  expect(await effects(worldId)).toBe(1);
});
