import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  publishVersion,
  scheduleActivation,
  type GameConfig,
} from '@oikos/config';
import { createDb } from '@oikos/db';
import { tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dryRunTick, runTick, type TickRequest, type TickStep } from './tick';

// Tests d'intégration du moteur contre Supabase local. Chaque test travaille dans un monde qui lui est propre.
const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
const loader = createConfigLoader(db);
let scheduledAt: Date;
let index: number;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  const { config } = await loader.at(new Date());
  // Le prochain tick : sur une base neuve, la configuration vient d'être activée et n'était pas encore
  // en vigueur au début du tick en cours.
  index = tickIndexAt(new Date(), config.clock.tickMinutes) + 1;
  scheduledAt = tickStart(index, config.clock.tickMinutes);
});
afterAll(() => db.destroy());

async function newWorld(): Promise<string> {
  const id = randomUUID();
  await sql`insert into game.worlds (id, slug, name) values (${id}, ${`t-${id.slice(0, 12)}`}, 'Test')`.execute(
    db,
  );
  return id;
}

/** Étape d'essai : tire trois nombres et laisse un effet en base (un événement de domaine). */
const probe = (worldId: string): TickStep => ({
  name: 'probe',
  async run({ trx, rng, config }) {
    const draws = [rng.int(1, 1000), rng.int(1, 1000), rng.int(1, 1000)];
    await sql`insert into game.domain_events (type, payload) values ('TickProbe', ${JSON.stringify({ worldId, draws })}::jsonb)`.execute(
      trx,
    );
    return { draws, tickMinutes: config.clock.tickMinutes };
  },
});
const effectsOf = async (worldId: string) =>
  (
    await sql<{
      payload: { draws: number[] };
    }>`select payload from game.domain_events where type = 'TickProbe' and payload->>'worldId' = ${worldId} order by seq`.execute(
      db,
    )
  ).rows;
const runsOf = async (worldId: string) =>
  await db
    .selectFrom('telemetry.tick_runs')
    .select(['status', 'error', 'duration_ms'])
    .where('world_id', '=', worldId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
const request = (
  worldId: string,
  steps: TickStep[],
  extra: Partial<TickRequest> = {},
): TickRequest => ({
  worldId,
  index,
  scheduledAt,
  loadConfig: loader.at,
  steps,
  ...extra,
});

describe('exécution d’un tick', () => {
  it('joue le tick, enregistre graine, version de configuration, résumé et durée', async () => {
    const worldId = await newWorld();
    const outcome = await runTick(db, request(worldId, [probe(worldId)]));
    expect(outcome.status).toBe('done');
    expect(outcome.seed).toMatch(/^[0-9a-f]{32}$/);

    const tick = await db
      .selectFrom('game.ticks')
      .selectAll()
      .where('world_id', '=', worldId)
      .executeTakeFirstOrThrow();
    const active = await loader.at(scheduledAt);
    expect(tick).toMatchObject({
      index: String(index),
      seed: outcome.seed,
      config_version_id: active.id,
      summary: { probe: { draws: (await effectsOf(worldId))[0]?.payload.draws } },
    });
    expect(tick.scheduled_at.getTime()).toBe(scheduledAt.getTime());
    const runs = await runsOf(worldId);
    expect(runs).toMatchObject([{ status: 'done', error: null }]);
    expect(runs[0]?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('même graine, même état : même résultat ; une autre graine en donne un autre', async () => {
    const worldId = await newWorld();
    const steps = [probe(worldId)];
    const first = await dryRunTick(db, request(worldId, steps), 'graine-contestee-0001');
    const second = await dryRunTick(db, request(worldId, steps), 'graine-contestee-0001');
    expect(second).toEqual(first);
    expect(await dryRunTick(db, request(worldId, steps), 'graine-contestee-0002')).not.toEqual(
      first,
    );
    // Un essai à blanc ne laisse aucune trace.
    expect(await effectsOf(worldId)).toEqual([]);

    // Le tick réellement joué avec cette graine donne exactement le résultat de l'essai à blanc.
    const played = await runTick(
      db,
      request(worldId, steps, { newSeed: () => 'graine-contestee-0001' }),
    );
    expect(played.summary).toEqual(first);
  });

  it('un tick qui échoue ne laisse aucun effet et est repris sans double effet', async () => {
    const worldId = await newWorld();
    let attempts = 0;
    const flaky: TickStep = {
      name: 'flaky',
      async run() {
        attempts += 1;
        if (attempts === 1) throw new Error('panne simulée');
        return {};
      },
    };
    // La panne survient après que la première étape a écrit son effet.
    const steps = [probe(worldId), flaky];
    await expect(runTick(db, request(worldId, steps))).rejects.toThrow('panne simulée');
    expect(await effectsOf(worldId)).toEqual([]);
    expect(
      await db.selectFrom('game.ticks').select('index').where('world_id', '=', worldId).execute(),
    ).toEqual([]);

    expect((await runTick(db, request(worldId, steps))).status).toBe('done');
    // Rejoué une fois de plus (file de tâches qui redélivre) : rien n'est refait.
    const again = await runTick(db, request(worldId, steps));
    expect(again.status).toBe('skipped');
    expect(await effectsOf(worldId)).toHaveLength(1);
    expect(again.summary).toMatchObject({
      probe: { draws: (await effectsOf(worldId))[0]?.payload.draws },
    });
    expect((await runsOf(worldId)).map((run) => [run.status, run.error])).toEqual([
      ['failed', 'panne simulée'],
      ['done', null],
      ['skipped', null],
    ]);
  });

  it('deux moteurs sur le même tick : un seul l’applique', async () => {
    const worldId = await newWorld();
    const outcomes = await Promise.all(
      [1, 2, 3].map(() => runTick(db, request(worldId, [probe(worldId)]))),
    );
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      'done',
      'skipped',
      'skipped',
    ]);
    expect(new Set(outcomes.map((outcome) => outcome.seed)).size).toBe(1);
    expect(await effectsOf(worldId)).toHaveLength(1);
  });

  it('un tick lit une seule version de configuration, celle active à son instant de jeu', async () => {
    const worldId = await newWorld();
    const seen: unknown[] = [];
    const observe: TickStep = {
      name: 'observe',
      async run({ config }) {
        seen.push(config);
        // Une nouvelle version publiée et activée pendant le tick ne le concerne pas.
        if (seen.length === 1) {
          const variant = structuredClone(INITIAL_CONFIG) as GameConfig;
          variant.clock.seasonDays = 14;
          const published = await publishVersion(db, variant, { note: 'pendant le tick' });
          if (!published.ok) throw new Error(published.errors.join('; '));
          await scheduleActivation(db, published.version.id);
        }
        return { seasonDays: config.clock.seasonDays };
      },
    };
    const before = await loader.at(scheduledAt);
    const outcome = await runTick(db, request(worldId, [observe, observe]));
    expect(seen[0]).toBe(seen[1]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(outcome.configVersionId).toBe(before.id);
    expect(outcome.summary).toEqual({ observe: { seasonDays: before.config.clock.seasonDays } });
    // Remet la configuration d'origine en vigueur pour les autres suites de tests.
    await scheduleActivation(db, before.id);
  });

  it('refuse un indice qui ne correspond pas à l’instant de jeu', async () => {
    const worldId = await newWorld();
    await expect(runTick(db, request(worldId, [], { index: index + 1 }))).rejects.toThrow(
      /does not match/,
    );
    expect((await runsOf(worldId)).map((run) => run.status)).toEqual(['failed']);
  });
});
