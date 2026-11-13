import { randomUUID } from 'node:crypto';
import type { AdminRole } from '@oikos/contracts';
import { createDb } from '@oikos/db';
import { nextDailyClose } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Tests d'intégration des commandes d'administration de la configuration, contre Supabase local.
const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
const app = createApp({
  db,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => db.destroy());

async function newUser(role?: AdminRole, grantedBy: string | null = null): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(db);
  if (role) {
    await db
      .insertInto('admin.roles')
      .values({ user_id: id, role, granted_by: grantedBy })
      .execute();
  }
  return id;
}
let root: string;
let designer: string;
beforeAll(async () => {
  root = await newUser('super_admin');
  designer = await newUser('game_designer', root);
});

/** Envoie une commande ; `aal2` ouvre une session à double authentification. */
const send = async (
  user: string,
  command: string,
  body: unknown,
  { aal2 = true, key = randomUUID() as string } = {},
) => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${aal2 ? 'aal2:' : ''}${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      data?: { versionId: string; number: number; activateAt: string };
      error?: { code: string; fields?: string[] };
    },
  };
};
const candidate = (grantOboles: number) => ({
  ...TEST_CONFIG.config,
  starting: { ...TEST_CONFIG.config.starting, grantOboles },
});
const versionsBy = (userId: string) =>
  db
    .selectFrom('config.versions')
    .select(['id', 'number', 'note', 'payload'])
    .where('created_by', '=', userId)
    .execute();
const logOf = (userId: string) =>
  db
    .selectFrom('game.command_log')
    .select(['command', 'status', 'error_code'])
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
const activeAt = async (instant: Date) =>
  (await sql<{ id: string }>`select config.active_version_at(${instant}) as id`.execute(db)).rows[0]
    ?.id;

describe('accès aux commandes d’administration', () => {
  it('refuse un compte sans rôle, un rôle insuffisant et une session sans second facteur ; le refus est journalisé', async () => {
    const [player, observer] = [await newUser(), await newUser('observer', root)];
    const input = { config: candidate(3100), note: 'tentative' };
    for (const [user, options] of [
      [player, {}],
      [observer, {}],
      [designer, { aal2: false }],
      [root, { aal2: false }],
    ] as const) {
      expect(await send(user, 'admin.publishConfig', input, options)).toMatchObject({
        status: 403,
        body: { ok: false, error: { code: 'FORBIDDEN' } },
      });
      expect(
        await send(user, 'admin.scheduleConfig', { versionId: TEST_CONFIG.id }, options),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'FORBIDDEN' } },
      });
    }
    expect([...(await versionsBy(player)), ...(await versionsBy(observer))]).toEqual([]);
    expect(await logOf(player)).toEqual([
      { command: 'admin.publishConfig', status: 'rejected', error_code: 'FORBIDDEN' },
      { command: 'admin.scheduleConfig', status: 'rejected', error_code: 'FORBIDDEN' },
    ]);
  });

  it('un rôle retiré cesse d’agir à la commande suivante', async () => {
    const former = await newUser('game_designer', root);
    expect((await send(former, 'admin.publishConfig', { config: candidate(3200) })).status).toBe(
      200,
    );
    await db.deleteFrom('admin.roles').where('user_id', '=', former).execute();
    expect((await send(former, 'admin.publishConfig', { config: candidate(3300) })).status).toBe(
      403,
    );
    expect(await versionsBy(former)).toHaveLength(1);
  });

  it('sans jeton, rien n’est exécuté', async () => {
    const res = await app.request('/api/commands/admin.publishConfig', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ config: candidate(3100) }),
    });
    expect(res.status).toBe(401);
  });
});

describe('admin.publishConfig', () => {
  it('crée une version immuable, attribuée, non active ; rejouer la clé ne crée rien de plus', async () => {
    const author = await newUser('game_designer', root);
    const key = randomUUID();
    const input = { config: candidate(3456), note: '  dotation revue  ' };
    const first = await send(author, 'admin.publishConfig', input, { key });
    expect(first.status).toBe(200);
    expect(await send(author, 'admin.publishConfig', input, { key })).toEqual(first);

    const versions = await versionsBy(author);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: first.body.data?.versionId,
      number: first.body.data?.number,
      note: 'dotation revue',
      payload: { starting: { grantOboles: 3456 } },
    });
    // Publier n'active pas : aucune activation ne vise cette version.
    const activations = await db
      .selectFrom('config.activations')
      .select('id')
      .where('version_id', '=', first.body.data?.versionId ?? '')
      .execute();
    expect(activations).toEqual([]);
    const events = await sql<{ payload: unknown }>`
      select payload from game.domain_events
      where type = 'ConfigVersionPublished' and payload->>'publishedBy' = ${author}`.execute(db);
    expect(events.rows).toEqual([
      { payload: { versionId: versions[0]?.id, number: versions[0]?.number, publishedBy: author } },
    ]);
    expect(await logOf(author)).toEqual([
      { command: 'admin.publishConfig', status: 'ok', error_code: null },
    ]);
  });

  it('refuse une configuration invalide, en nommant les champs, sans rien enregistrer', async () => {
    const author = await newUser('super_admin');
    const broken = { ...candidate(3000), market: { npcMaxPriceFactor: 0 } };
    const refused = await send(author, 'admin.publishConfig', { config: broken });
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'CONFIG_INVALID' } } });
    expect(refused.body.error?.fields?.join('\n')).toContain('market.npcMaxPriceFactor');
    // Une configuration complète dépasse la taille d'une commande de jeu : elle est lue quand même.
    const large = { ...candidate(3000), padding: 'x'.repeat(100_000) };
    expect((await send(author, 'admin.publishConfig', { config: large })).status).toBe(409);
    expect((await send(author, 'admin.publishConfig', { config: 'texte' })).status).toBe(400);
    expect(await versionsBy(author)).toEqual([]);
  });
});

describe('admin.scheduleConfig', () => {
  it('programme l’activation à la prochaine clôture quotidienne, pas avant', async () => {
    const author = await newUser('game_designer', root);
    // Même contenu que la configuration de test : l'activation ne change rien pour les autres suites.
    const published = await send(author, 'admin.publishConfig', { config: TEST_CONFIG.config });
    const versionId = published.body.data?.versionId ?? '';
    const before = new Date();
    const scheduled = await send(author, 'admin.scheduleConfig', { versionId });
    expect(scheduled.status).toBe(200);
    const activateAt = new Date(scheduled.body.data?.activateAt ?? 0);
    expect(activateAt.getTime()).toBe(nextDailyClose(before, TEST_CONFIG.config.clock).getTime());

    expect(await activeAt(activateAt)).toBe(versionId);
    expect(await activeAt(new Date(activateAt.getTime() - 1))).not.toBe(versionId);
    const activation = await db
      .selectFrom('config.activations')
      .select(['created_by', 'activate_at'])
      .where('version_id', '=', versionId)
      .executeTakeFirstOrThrow();
    expect(activation).toEqual({ created_by: author, activate_at: activateAt });
    const events = await sql<{ payload: unknown }>`
      select payload from game.domain_events
      where type = 'ConfigActivationScheduled' and payload->>'scheduledBy' = ${author}`.execute(db);
    expect(events.rows).toEqual([
      { payload: { versionId, activateAt: activateAt.toISOString(), scheduledBy: author } },
    ]);
  });

  it('retour arrière : reprogrammer une version antérieure la remet en vigueur à la clôture', async () => {
    const author = await newUser('super_admin');
    const publish = async () =>
      (await send(author, 'admin.publishConfig', { config: TEST_CONFIG.config })).body.data
        ?.versionId ?? '';
    const [older, newer] = [await publish(), await publish()];
    await send(author, 'admin.scheduleConfig', { versionId: newer });
    const back = await send(author, 'admin.scheduleConfig', { versionId: older });
    expect(await activeAt(new Date(back.body.data?.activateAt ?? 0))).toBe(older);
  });

  it('refuse une version inconnue', async () => {
    expect(await send(designer, 'admin.scheduleConfig', { versionId: randomUUID() })).toMatchObject(
      {
        status: 404,
        body: { error: { code: 'CONFIG_VERSION_NOT_FOUND' } },
      },
    );
  });
});
