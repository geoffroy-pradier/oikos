import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  publishVersion,
  scheduleActivation,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { createRng, isDailyClose, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dryRunTick, runTick, type TickRequest, type TickStep } from './tick';

// Tests d'intégration du moteur contre Supabase local. Chaque test travaille dans un monde qui lui est propre.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const loader = createConfigLoader(db);
let active: LoadedConfig;
let index: number;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  const now = new Date();
  const { tickMinutes } = (await loader.at(now)).config.clock;
  // Un tick à venir : sur une base neuve, la configuration vient d'être activée et n'était pas encore en
  // vigueur au début du tick en cours. L'horloge injectée (`now`) fait comme si son heure était venue.
  // Deux ticks plus loin plutôt qu'un : l'activation d'essai du rejeu s'annule alors avant son échéance,
  // ce que la base n'accepte qu'à plus d'une minute de celle-ci.
  index = tickIndexAt(now, tickMinutes) + 2;
  // La version attendue est celle du tick joué, pas celle de maintenant : une version programmée pour la
  // clôture par un autre fichier de tests (`admin.scheduleConfig`) peut entrer en vigueur entre les deux (#354).
  active = await loader.at(tickStart(index, tickMinutes));
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

async function newWorld(): Promise<string> {
  const id = randomUUID();
  await sql`insert into game.worlds (id, slug, name) values (${id}, ${`t-${id.slice(0, 12)}`}, 'Test')`.execute(
    owner,
  );
  return id;
}

/** Étape d'essai : tire trois nombres et laisse un effet en base (un événement de domaine). */
const probe = (worldId: string, name = 'probe'): TickStep => ({
  name,
  async run({ trx, rng }) {
    const draws = [rng.int(1, 1000), rng.int(1, 1000), rng.int(1, 1000)];
    await sql`insert into game.domain_events (type, payload) values ('TickProbe', ${JSON.stringify({ worldId, draws })}::jsonb)`.execute(
      trx,
    );
    return { draws };
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
const ticksOf = (worldId: string) =>
  db.selectFrom('game.ticks').selectAll().where('world_id', '=', worldId).execute();
const runsOf = (worldId: string) =>
  db
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
): TickRequest => {
  const tick = extra.index ?? index;
  const scheduledAt = tickStart(tick, active.config.clock.tickMinutes);
  return {
    worldId,
    index: tick,
    scheduledAt,
    config: loader,
    steps,
    now: () => new Date(scheduledAt.getTime() + 1000),
    ...extra,
  };
};

describe('exécution d’un tick', () => {
  it('joue le tick, enregistre graine, version de configuration, résumé et durée réelle', async () => {
    const worldId = await newWorld();
    const slow: TickStep = {
      name: 'slow',
      run: () => new Promise((resolve) => setTimeout(() => resolve({}), 60)),
    };
    const outcome = await runTick(db, request(worldId, [probe(worldId), slow]));
    expect(outcome.status).toBe('done');
    expect(outcome.seed).toMatch(/^[0-9a-f]{32}$/);

    const [tick] = await ticksOf(worldId);
    expect(tick).toMatchObject({
      index: String(index),
      seed: outcome.seed,
      config_version_id: active.id,
      summary: { probe: { draws: (await effectsOf(worldId))[0]?.payload.draws }, slow: {} },
    });
    expect(tick?.scheduled_at.getTime()).toBe(
      tickStart(index, active.config.clock.tickMinutes).getTime(),
    );
    const runs = await runsOf(worldId);
    expect(runs).toMatchObject([{ status: 'done', error: null }]);
    expect(runs[0]?.duration_ms).toBeGreaterThanOrEqual(50);
  });

  it('un tick lit une seule version de configuration : celle de son instant de jeu, demandée une fois', async () => {
    const worldId = await newWorld();
    const asked: Date[] = [];
    const config = {
      at: async (instant: Date) => (asked.push(instant), active),
      byId: loader.byId,
    };
    const seen: unknown[] = [];
    const observe = (name: string): TickStep => ({
      name,
      run: async ({ config: given }) => (seen.push(given), {}),
    });
    const tick = request(worldId, [observe('a'), observe('b')], { config });
    const outcome = await runTick(db, tick);
    expect(asked).toEqual([tick.scheduledAt]);
    expect(seen).toEqual([active.config, active.config]);
    expect(seen[0]).toBe(seen[1]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(outcome.configVersionId).toBe(active.id);
  });

  it('même graine, même état, même version : même résultat, même après un changement de configuration', async () => {
    const worldId = await newWorld();
    const versioned: TickStep = {
      name: 'versioned',
      run: async ({ rng, config }) => ({
        draw: rng.int(1, 1000),
        seasonDays: config.clock.seasonDays,
      }),
    };
    const tick = request(worldId, [probe(worldId), versioned]);
    const first = await dryRunTick(db, tick, { seed: 'graine-contestee-0001' });
    expect(await dryRunTick(db, tick, { seed: 'graine-contestee-0001' })).toEqual(first);
    expect(await dryRunTick(db, tick, { seed: 'graine-contestee-0002' })).not.toEqual(first);
    // Un essai à blanc ne laisse aucune trace.
    expect([await effectsOf(worldId), await ticksOf(worldId), await runsOf(worldId)]).toEqual([
      [],
      [],
      [],
    ]);

    const played = await runTick(db, { ...tick, newSeed: () => 'graine-contestee-0001' });
    expect(played.summary).toEqual(first);

    // Une autre version devient active pour cet instant : le rejeu avec la version enregistrée ne bouge pas.
    // Programmée à l'instant du tick, elle l'emporte sur toute activation antérieure ou de même échéance ;
    // annulée ensuite, elle ne laisse aucune version en vigueur que d'autres tests n'attendraient pas.
    const variant = structuredClone(INITIAL_CONFIG) as GameConfig;
    variant.clock.seasonDays = 14;
    const published = await publishVersion(db, variant, { note: 'après le tick' });
    if (!published.ok) throw new Error(published.errors.join('; '));
    await scheduleActivation(db, published.version.id, tick.scheduledAt);
    try {
      const replay = { seed: played.seed, configVersionId: played.configVersionId };
      expect(await dryRunTick(db, tick, replay)).toEqual(played.summary);
      expect(await dryRunTick(db, tick, { seed: played.seed })).not.toEqual(played.summary);
    } finally {
      await sql`insert into config.activation_cancellations (activation_id, cancelled_by)
        select id, ${randomUUID()} from config.activations where version_id = ${published.version.id}`.execute(
        db,
      );
    }
    expect((await loader.at(tick.scheduledAt)).id).toBe(active.id);
  });

  it('les étapes partagent un seul aléa : chacune poursuit la suite de la précédente', async () => {
    const worldId = await newWorld();
    const draw = (name: string): TickStep => ({
      name,
      run: async ({ rng }) => ({ draw: rng.int(1, 1_000_000) }),
    });
    const outcome = await runTick(
      db,
      request(worldId, [draw('a'), draw('b')], { newSeed: () => 'graine-partagee-0001' }),
    );
    const reference = createRng('graine-partagee-0001');
    expect(outcome.summary).toEqual({
      a: { draw: reference.int(1, 1_000_000) },
      b: { draw: reference.int(1, 1_000_000) },
    });
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
    expect([await effectsOf(worldId), await ticksOf(worldId)]).toEqual([[], []]);

    expect((await runTick(db, request(worldId, steps))).status).toBe('done');
    // Rejoué une fois de plus (file de tâches qui redélivre) : rien n'est refait, même résumé.
    const again = await runTick(db, request(worldId, steps));
    expect(again.status).toBe('skipped');
    expect(await effectsOf(worldId)).toHaveLength(1);
    expect(again.summary).toEqual({
      probe: { draws: (await effectsOf(worldId))[0]?.payload.draws },
      flaky: {},
    });
    expect((await runsOf(worldId)).map((run) => [run.status, run.error])).toEqual([
      ['failed', 'panne simulée'],
      ['done', null],
      ['skipped', null],
    ]);
  });

  it('un échec à la validation de la transaction n’enregistre pas le tick', async () => {
    const worldId = await newWorld();
    // Une écriture de monnaie sans ligne est refusée à la validation (contrôle différé du grand livre).
    const unbalanced: TickStep = {
      name: 'unbalanced',
      async run({ trx }) {
        await sql`insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test')`.execute(
          trx,
        );
        return {};
      },
    };
    await expect(runTick(db, request(worldId, [probe(worldId), unbalanced]))).rejects.toThrow(
      /not balanced/,
    );
    expect([await effectsOf(worldId), await ticksOf(worldId)]).toEqual([[], []]);
    expect((await runsOf(worldId)).map((run) => run.status)).toEqual(['failed']);
  });

  it('plus de ticks simultanés que de connexions : tous se terminent, chaque tick une seule fois', async () => {
    const worlds = await Promise.all(Array.from({ length: 12 }, () => newWorld()));
    const slow = (worldId: string): TickStep => ({
      name: 'slow',
      async run(context) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return probe(worldId).run(context);
      },
    });
    const shared = worlds[0] as string;
    const outcomes = await Promise.all([
      ...worlds.map((worldId) => runTick(db, request(worldId, [slow(worldId)]))),
      ...Array.from({ length: 12 }, () => runTick(db, request(shared, [slow(shared)]))),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'done')).toHaveLength(12);
    expect(outcomes.filter((outcome) => outcome.status === 'skipped')).toHaveLength(12);
    for (const worldId of worlds) expect(await effectsOf(worldId)).toHaveLength(1);
  });

  it('enregistre la clôture quotidienne et la bascule de saison du tick', async () => {
    const worldId = await newWorld();
    const clock = active.config.clock;
    let close = index;
    while (!isDailyClose(close, clock)) close += 1;
    const flags: TickStep = {
      name: 'flags',
      run: async ({ dailyClose, seasonSwitch }) => ({ dailyClose, seasonSwitch }),
    };
    for (const tick of [close, close + 1])
      await runTick(db, request(worldId, [flags], { index: tick }));
    const rows = (await ticksOf(worldId)).sort((a, b) => Number(a.index) - Number(b.index));
    expect(
      rows.map((row) => [
        row.daily_close,
        (row.summary as { flags: { dailyClose: boolean } }).flags.dailyClose,
      ]),
    ).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it('signale un rattrapage : un tick joué après la fin de son intervalle, borne comprise', async () => {
    const worldId = await newWorld();
    const late: TickStep = { name: 'late', run: async ({ catchUp }) => ({ catchUp }) };
    const minutes = active.config.clock.tickMinutes;
    // Dernière milliseconde de l'intervalle : à l'heure ; premier instant du tick suivant : rattrapé.
    const played = [];
    for (const [tick, delay] of [
      [index, minutes * 60_000 - 1],
      [index + 1, minutes * 60_000],
      [index + 2, 0],
    ] as const) {
      const due = request(worldId, [late], { index: tick });
      const now = () => new Date(due.scheduledAt.getTime() + delay);
      played.push((await runTick(db, { ...due, now })).summary);
    }
    expect(played).toEqual([
      { late: { catchUp: false } },
      { late: { catchUp: true } },
      { late: { catchUp: false } },
    ]);
  });

  it('refuse un tick avant son heure, un instant mal aligné, un indice invalide, deux étapes de même nom', async () => {
    const worldId = await newWorld();
    const tick = request(worldId, []);
    await expect(
      runTick(db, { ...tick, now: () => new Date(tick.scheduledAt.getTime() - 1) }),
    ).rejects.toThrow(/not due/);
    await expect(
      runTick(db, {
        ...tick,
        scheduledAt: new Date(tick.scheduledAt.getTime() + 1000),
        now: () => new Date(8.64e15),
      }),
    ).rejects.toThrow(/does not start/);
    await expect(runTick(db, { ...tick, index: index + 1 })).rejects.toThrow(/does not start/);
    await expect(runTick(db, { ...tick, index: 1.5 })).rejects.toThrow(RangeError);
    await expect(runTick(db, request(worldId, [probe(worldId), probe(worldId)]))).rejects.toThrow(
      /Duplicate/,
    );
    expect([await ticksOf(worldId), await effectsOf(worldId)]).toEqual([[], []]);
    expect((await runsOf(worldId)).map((run) => run.status)).toEqual([
      'failed',
      'failed',
      'failed',
      'failed',
    ]);
  });

  it('un échec de télémétrie ne change pas l’issue d’un tick validé', async () => {
    const worldId = await newWorld();
    await sql`alter table telemetry.tick_runs add constraint test_always_fails check (false) not valid`.execute(
      owner,
    );
    try {
      expect((await runTick(db, request(worldId, [probe(worldId)]))).status).toBe('done');
    } finally {
      await sql`alter table telemetry.tick_runs drop constraint test_always_fails`.execute(owner);
    }
    expect([
      (await ticksOf(worldId)).length,
      (await effectsOf(worldId)).length,
      await runsOf(worldId),
    ]).toEqual([1, 1, []]);
  });
});
