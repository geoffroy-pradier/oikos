import { randomUUID } from 'node:crypto';
import { fakeProvider, memoryStore, type FakeReply } from '@oikos/ai';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  validateConfig,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose } from '../close';
import { worldEventPlanning } from '../steps/world-event-planning';
import { rewriteOracles } from './task';

// Réécriture des oracles de la Pythie après la clôture (#270), contre Supabase local. Chaque test a son monde, dont
// une clôture planifie, avec certitude, un événement de chaque modèle et son oracle de repli.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const loaded = validateConfig(INITIAL_CONFIG);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const initial = loaded.config;
const models = initial.worldEvents?.models ?? {};
const sure: GameConfig = {
  ...initial,
  worldEvents: {
    planningLeadDays: 3,
    models: Object.fromEntries(
      Object.entries(models).map(([model, rules]) => [model, { ...rules, probabilityBps: 10_000 }]),
    ),
  },
};
const withAi = (enabled: boolean, given: GameConfig = sure): GameConfig => ({
  ...given,
  ai: {
    ...given.ai,
    budgetMicroEurosPerActivePlayerMonth: 1_000,
    expectedActivePlayers: 100,
    usages: { ...given.ai.usages, oracle: { ...given.ai.usages.oracle, enabled, model: 'fake' } },
  },
});
let active: LoadedConfig;
const TODAY = gameDayAt(new Date(), initial.clock);
const reply = (fr: string, en: string) => ({
  text: JSON.stringify({ fr, en }),
  inputTokens: 5,
  outputTokens: 5,
});
const GOOD = reply('Le ciel se taira.', 'The sky will fall silent.');

async function newWorld() {
  const worldId = randomUUID();
  await owner
    .insertInto('game.worlds')
    .values({
      id: worldId,
      slug: `or-${worldId.slice(0, 12)}`,
      name: 'Oracles',
      seed: randomUUID(),
    })
    .execute();
  await owner
    .insertInto('game.cities')
    .values(
      ['kalliste', 'elaia', 'ampelos', 'halos'].map((slug) => ({
        world_id: worldId,
        slug,
        name: slug,
      })),
    )
    .execute();
  await runDailyClose(db, {
    worldId,
    gameDay: TODAY,
    closeAt: dailyCloseAt(TODAY, initial.clock),
    config: { at: async () => ({ ...active, config: sure }) },
    steps: [worldEventPlanning],
    now: new Date(),
  });
  return worldId;
}
function run(worldId: string, replies: FakeReply[], given = withAi(true)) {
  const provider = fakeProvider(replies);
  const store = memoryStore();
  const config = { at: () => Promise.resolve({ ...active, config: given }) };
  const done = rewriteOracles(db, worldId, { now: new Date(), config, provider, store });
  return { done, provider, store };
}
const oraclesOf = (worldId: string) =>
  owner
    .selectFrom('game.oracles as o')
    .innerJoin('game.world_events as e', 'e.id', 'o.event_id')
    .select(['e.model', 'o.text_fr', 'o.text_en', 'o.source', 'o.rewrite_outcome'])
    .where('o.world_id', '=', worldId)
    .orderBy('e.starts_at')
    .orderBy('o.id')
    .execute();

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

describe('réécriture des oracles après la clôture (#270)', () => {
  it('IA coupée, ou version sans Pythie : rien n’est essayé, les oracles de repli restent', async () => {
    const worldId = await newWorld();
    const before = await oraclesOf(worldId);
    expect(before.map((oracle) => [oracle.source, oracle.rewrite_outcome])).toEqual(
      Array.from({ length: 4 }, () => ['fallback', null]),
    );
    const older = structuredClone(withAi(true));
    delete older.oracle;
    for (const given of [withAi(false), older]) {
      const off = run(worldId, [GOOD], given);
      expect(await off.done).toEqual({ attempted: 0, rewritten: 0 });
      expect(off.provider.requests).toHaveLength(0);
      expect(off.store.calls).toHaveLength(0);
    }
    expect(await oraclesOf(worldId)).toEqual(before);
  });

  it('IA active : chaque oracle est essayé une fois ; une sortie rejetée laisse le repli, et n’est pas réessayée', async () => {
    const worldId = await newWorld();
    const before = await oraclesOf(worldId);
    const first = run(worldId, [
      GOOD,
      reply('Dans 3 jours, la terre aura soif.', 'In three days the earth will thirst.'),
      reply('La mer de Kallistè grondera.', 'The sea will roar.'),
      new Error('provider down'),
    ]);
    expect(await first.done).toEqual({ attempted: 4, rewritten: 1 });
    expect(first.store.calls.map((call) => call.outcome)).toEqual([
      'ok',
      'invalid',
      'invalid',
      'error',
    ]);
    const after = await oraclesOf(worldId);
    expect(after[0]).toMatchObject({
      text_fr: 'Le ciel se taira.',
      text_en: 'The sky will fall silent.',
      source: 'ai',
      rewrite_outcome: 'ok',
    });
    for (const [index, outcome] of [
      [1, 'invalid'],
      [2, 'invalid'],
      [3, 'error'],
    ] as const)
      expect(after[index]).toEqual({ ...before[index], rewrite_outcome: outcome });
    // Le modèle n'a reçu ni cité, ni ampleur, ni jour : seulement la nature de l'événement, son bien et le repli.
    for (const request of first.provider.requests)
      expect(request.data).not.toMatch(/kalliste|elaia|ampelos|halos/i);

    const again = run(worldId, [GOOD]);
    expect(await again.done).toEqual({ attempted: 0, rewritten: 0 });
    expect(again.provider.requests).toHaveLength(0);
    expect(await oraclesOf(worldId)).toEqual(after);
  });

  it('un événement commencé n’est plus essayé', async () => {
    const worldId = await newWorld();
    // Les événements du monde commencent dans quelques jours : la base est avancée en les déplaçant, garde levée.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.world_events disable trigger world_events_immutable`.execute(trx);
      await sql`update game.world_events set starts_at = now() - interval '1 minute' where world_id = ${worldId}`.execute(
        trx,
      );
      await sql`alter table game.world_events enable trigger world_events_immutable`.execute(trx);
    });
    const late = run(worldId, [GOOD]);
    expect(await late.done).toEqual({ attempted: 0, rewritten: 0 });
    expect(late.provider.requests).toHaveLength(0);
  });

  it('deux moteurs ensemble n’appellent l’IA qu’une fois par oracle', async () => {
    const worldId = await newWorld();
    const slow = () => new Promise<typeof GOOD>((resolve) => setTimeout(() => resolve(GOOD), 100));
    const engines = [run(worldId, []), run(worldId, [])];
    for (const { provider } of engines)
      provider.complete = (request) => (provider.requests.push(request), slow());
    const results = await Promise.all(engines.map((engine) => engine.done));
    expect(results.reduce((sum, result) => sum + result.attempted, 0)).toBe(4);
    expect(engines.reduce((sum, engine) => sum + engine.provider.requests.length, 0)).toBe(4);
    expect((await oraclesOf(worldId)).every((oracle) => oracle.source === 'ai')).toBe(true);
  });
});
