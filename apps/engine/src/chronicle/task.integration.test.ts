import { fakeProvider, memoryStore, type FakeReply } from '@oikos/ai';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chronicleWorld, DAY, FINISHED, initial } from './chronicle.integration-fixtures';
import { writeChronicles } from './task';

// Chronique des cités après la clôture (#271), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
let active: LoadedConfig;
const withAi = (enabled: boolean): GameConfig => ({
  ...initial,
  ai: {
    ...initial.ai,
    budgetMicroEurosPerActivePlayerMonth: 1_000,
    expectedActivePlayers: 100,
    usages: { ...initial.ai.usages, chronicle: { ...initial.ai.usages.chronicle, enabled } },
  },
});
function run(worldId: string, replies: FakeReply[] = [], given = withAi(false), now = new Date()) {
  const provider = fakeProvider(replies);
  const store = memoryStore();
  const config = { at: () => Promise.resolve({ ...active, config: given }) };
  const written = writeChronicles(db, worldId, { now, config, provider, store });
  return { written, provider, store };
}
const articles = (worldId: string) =>
  owner
    .selectFrom('game.chronicle_articles as a')
    .innerJoin('game.cities as c', 'c.id', 'a.city_id')
    .select(['c.slug', 'a.game_day', 'a.facts', 'a.text_fr', 'a.text_en', 'a.source'])
    .where('a.world_id', '=', worldId)
    .orderBy('c.slug')
    .execute();

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

describe('chronique des cités après la clôture (#271)', () => {
  it('IA coupée : une chronique de repli par cité, des faits de la seule journée ; rejouer n’écrit rien de plus', async () => {
    const { worldId } = await chronicleWorld(owner, active.id);
    const first = run(worldId);
    expect(await first.written).toBe(2);
    expect(first.provider.requests).toHaveLength(0);
    const [elaia, kalliste] = await articles(worldId);
    expect(kalliste).toMatchObject({ game_day: DAY, source: 'fallback' });
    // La journée elle-même est vérifiée par `readChronicleDay` ; ici, ce qui en arrive dans la chronique.
    expect(kalliste?.facts).toMatchObject({
      goods: [{ goodId: 'wheat', volume: 15, averagePrice: 6 }],
      population: { before: 1203, after: 1191, change: -12 },
      configChange: false,
    });
    expect(kalliste?.text_fr).toContain('La maison Alcméonides est élue archonte avec 3 voix.');
    // La maison introuvable n'est pas nommée.
    expect(kalliste?.text_fr).toContain('Une maison est élue archonte avec 3 voix.');
    expect(kalliste?.text_en).toContain(
      'Wheat, 15 units traded at 6 obols on average (from 6 to 7 obols).',
    );
    expect(elaia?.text_fr).toContain("L'assemblée adopte le décret de fête : 4 pour, 1 contre.");

    const again = run(worldId, [], withAi(true));
    expect(await again.written).toBe(0);
    expect(again.provider.requests).toHaveLength(0);
    expect(await articles(worldId)).toHaveLength(2);
  });

  it('IA active : la réécriture conforme est gardée, celle qui invente un chiffre cède au repli', async () => {
    const { worldId } = await chronicleWorld(owner, active.id);
    const reply = (fr: string, en: string) => ({
      text: JSON.stringify({ fr, en }),
      inputTokens: 5,
      outputTokens: 5,
    });
    // Les cités sont traitées par identifiant court : Elaia, puis Kallistè.
    const { written, store } = run(
      worldId,
      [
        reply('Fête votée, 4 contre 1.', 'Festival voted, 4 to 1.'),
        reply('Le blé à 16 oboles.', 'Wheat at 6 obols.'),
      ],
      withAi(true),
    );
    expect(await written).toBe(2);
    const [elaia, kalliste] = await articles(worldId);
    expect(elaia).toMatchObject({ source: 'ai', text_fr: 'Fête votée, 4 contre 1.' });
    expect(kalliste?.source).toBe('fallback');
    expect(kalliste?.text_fr).toContain("Sur l'agora :");
    expect(store.calls.map((call) => call.outcome)).toEqual(['ok', 'invalid']);
  });

  it('attend la fin de la clôture et son délai ; deux moteurs ensemble n’écrivent qu’une chronique par cité, et n’appellent l’IA qu’une fois par cité', async () => {
    const { worldId } = await chronicleWorld(owner, active.id);
    const settle = initial.chronicle.settleSeconds * 1000;
    expect(
      await run(worldId, [], withAi(false), new Date(FINISHED.getTime() + settle - 1)).written,
    ).toBe(0);
    expect(await articles(worldId)).toHaveLength(0);
    // Un fournisseur lent : sans verrou, le second moteur lirait les cités encore à écrire et rappellerait l'IA.
    const ok = {
      text: JSON.stringify({ fr: 'Calme.', en: 'Calm.' }),
      inputTokens: 1,
      outputTokens: 1,
    };
    const slow = () => new Promise<typeof ok>((resolve) => setTimeout(() => resolve(ok), 200));
    const engines = [run(worldId, [], withAi(true)), run(worldId, [], withAi(true))];
    for (const { provider } of engines)
      provider.complete = (request) => (provider.requests.push(request), slow());
    const both = await Promise.all(engines.map((engine) => engine.written));
    expect(both.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(engines.reduce((sum, engine) => sum + engine.provider.requests.length, 0)).toBe(2);
    expect(await articles(worldId)).toHaveLength(2);
  });

  it('une cité déjà écrite n’est ni réécrite ni comptée : seules les lignes insérées le sont', async () => {
    const { worldId, ids } = await chronicleWorld(owner, active.id);
    const text = {
      facts: '{}',
      text_fr: 'Déjà.',
      text_en: 'Already.',
      source: 'fallback' as const,
    };
    await owner
      .insertInto('game.chronicle_articles')
      .values({ ...text, world_id: worldId, city_id: ids.elaia, game_day: DAY })
      .execute();
    const ok = {
      text: JSON.stringify({ fr: 'Calme.', en: 'Calm.' }),
      inputTokens: 1,
      outputTokens: 1,
    };
    const engine = run(worldId, [ok], withAi(true));
    expect(await engine.written).toBe(1);
    expect(engine.provider.requests).toHaveLength(1);
    expect((await articles(worldId)).map((row) => [row.slug, row.text_fr])).toEqual([
      ['elaia', 'Déjà.'],
      ['kalliste', 'Calme.'],
    ]);
  });
});
