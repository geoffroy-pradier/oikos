import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import type { AdminRole } from '@oikos/contracts';
import { createDb } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Tests d'intégration des lectures du back-office, contre Supabase local (base partagée avec les autres
// suites : les compteurs globaux sont vérifiés par différence).
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
  if (role)
    await db
      .insertInto('admin.roles')
      .values({ user_id: id, role, granted_by: grantedBy })
      .execute();
  return id;
}
const users = {} as Record<'root' | 'designer' | 'observer' | 'moderator' | 'player', string>;
beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  users.root = await newUser('super_admin');
  users.designer = await newUser('game_designer', users.root);
  users.observer = await newUser('observer', users.root);
  users.moderator = await newUser('moderator', users.root);
  users.player = await newUser();
});

interface Reply {
  status: number;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string } };
}
const get = async (user: string | null, path: string, aal2 = true): Promise<Reply> => {
  const res = await app.request(`/api/admin/${path}`, {
    headers: user ? { authorization: `Bearer ${aal2 ? 'aal2:' : ''}${user}` } : {},
  });
  return { status: res.status, body: (await res.json()) as Reply['body'] };
};
const command = async (user: string, name: string, body: unknown) => {
  const res = await app.request(`/api/commands/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer aal2:${user}`,
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return ((await res.json()) as { data?: { versionId: string; activateAt: string } }).data;
};
const ROUTES = ['me', 'vigie', 'config/versions', `config/versions/${TEST_CONFIG.id}`, 'audit'];

describe('accès aux lectures du back-office', () => {
  it('exige un jeton, le second facteur et un rôle', async () => {
    for (const route of ROUTES) {
      expect((await get(null, route)).status).toBe(401);
      expect(await get(users.player, route)).toMatchObject({
        status: 403,
        body: { ok: false, error: { code: 'FORBIDDEN' } },
      });
      expect((await get(users.root, route, false)).status).toBe(403);
    }
  });

  it('ouvre chaque module aux seuls rôles prévus', async () => {
    const allowed = async (user: string) =>
      (
        await Promise.all(
          ROUTES.slice(0, 3)
            .concat('audit')
            .map((route) => get(user, route)),
        )
      ).map((reply) => reply.status);
    // Ordre : me, vigie, config/versions, audit.
    expect(await allowed(users.root)).toEqual([200, 200, 200, 200]);
    expect(await allowed(users.designer)).toEqual([200, 200, 200, 403]);
    expect(await allowed(users.observer)).toEqual([200, 200, 200, 200]);
    expect(await allowed(users.moderator)).toEqual([200, 403, 403, 403]);
    expect((await get(users.moderator, 'me')).body.data).toEqual({ role: 'moderator' });
    expect((await get(users.moderator, `config/versions/${TEST_CONFIG.id}`)).status).toBe(403);
  });

  it('un rôle retiré perd l’accès à la requête suivante', async () => {
    const former = await newUser('observer', users.root);
    expect((await get(former, 'vigie')).status).toBe(200);
    await db.deleteFrom('admin.roles').where('user_id', '=', former).execute();
    expect((await get(former, 'vigie')).status).toBe(403);
  });
});

describe('Vigie', () => {
  it('compte les commandes et montre les ticks récents, échecs compris', async () => {
    const before = (await get(users.observer, 'vigie')).body.data;
    const worldId = randomUUID();
    // Deux insertions distinctes : l'ordre d'affichage suit l'heure d'écriture.
    for (const run of [
      { tick_index: 41, status: 'done', duration_ms: 12, error: null },
      { tick_index: 42, status: 'failed', duration_ms: 9999, error: 'panne' },
    ] as const) {
      await db
        .insertInto('telemetry.tick_runs')
        .values({ world_id: worldId, ...run })
        .execute();
    }
    // Une commande refusée d'un compte encore jamais vu : un compte actif et un refus de plus.
    await command(await newUser(), 'admin.scheduleConfig', { versionId: randomUUID() });

    const after = (await get(users.observer, 'vigie')).body.data;
    expect(after.commands24h.rejected).toBeGreaterThanOrEqual(before.commands24h.rejected + 1);
    expect(after.activeAccounts24h).toBeGreaterThanOrEqual(before.activeAccounts24h + 1);
    expect(after.ticks24h.failed).toBeGreaterThanOrEqual(before.ticks24h.failed + 1);
    expect(after.ticks24h.maxDurationMs).toBeGreaterThanOrEqual(9999);
    expect(after.houses).toBe(
      Number(
        (await sql<{ n: string }>`select count(*) as n from game.houses`.execute(db)).rows[0]?.n,
      ),
    );
    const mine = after.recentTicks.filter((tick: { worldId: string }) => tick.worldId === worldId);
    expect(mine).toMatchObject([
      { tickIndex: 42, status: 'failed', durationMs: 9999, error: 'panne' },
      { tickIndex: 41, status: 'done', durationMs: 12, error: null },
    ]);
    expect(after.recentTicks.length).toBeLessThanOrEqual(20);
    expect(after.queuePending === null || Number.isInteger(after.queuePending)).toBe(true);
  });
});

describe('paramètres et journal d’audit', () => {
  it('liste les versions et les activations, rend le contenu d’une version', async () => {
    const config = {
      ...TEST_CONFIG.config,
      starting: { ...TEST_CONFIG.config.starting, grantOboles: 3210 },
    };
    const published = await command(users.designer, 'admin.publishConfig', {
      config,
      note: 'essai de lecture',
    });
    // Même contenu que la configuration de test : l'activation ne change rien pour les autres suites.
    const harmless = await command(users.designer, 'admin.publishConfig', {
      config: TEST_CONFIG.config,
    });
    const scheduled = await command(users.designer, 'admin.scheduleConfig', {
      versionId: harmless?.versionId,
    });

    const listing = (await get(users.observer, 'config/versions')).body.data;
    const active = await sql<{ id: string }>`select config.active_version_at(now()) as id`.execute(
      db,
    );
    expect(listing.activeVersionId).toBe(active.rows[0]?.id);
    expect(
      listing.versions.find((v: { id: string }) => v.id === published?.versionId),
    ).toMatchObject({ note: 'essai de lecture', createdBy: users.designer });
    const numbers = listing.versions.map((v: { number: number }) => v.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(
      listing.activations.find((a: { versionId: string }) => a.versionId === harmless?.versionId),
    ).toMatchObject({ activateAt: scheduled?.activateAt, createdBy: users.designer });

    const detail = await get(users.designer, `config/versions/${published?.versionId}`);
    expect(detail.body.data).toMatchObject({
      id: published?.versionId,
      note: 'essai de lecture',
      config: { starting: { grantOboles: 3210 } },
    });
    for (const unknown of [randomUUID(), 'pas-un-identifiant']) {
      expect(await get(users.designer, `config/versions/${unknown}`)).toMatchObject({
        status: 404,
        body: { error: { code: 'CONFIG_VERSION_NOT_FOUND' } },
      });
    }
  });

  it('le journal d’audit montre réussites et refus, du plus récent au plus ancien, sans l’entrée', async () => {
    const [author, intruder] = [await newUser('game_designer', users.root), await newUser()];
    const published = await command(author, 'admin.publishConfig', { config: TEST_CONFIG.config });
    await command(intruder, 'admin.publishConfig', { config: TEST_CONFIG.config });

    const audit = await get(users.root, 'audit?limit=100');
    const entries: { userId: string; createdAt: string }[] = audit.body.data.entries;
    expect(entries.find((entry) => entry.userId === author)).toMatchObject({
      command: 'admin.publishConfig',
      status: 'ok',
      errorCode: null,
      result: { versionId: published?.versionId },
    });
    expect(entries.find((entry) => entry.userId === intruder)).toMatchObject({
      command: 'admin.publishConfig',
      status: 'rejected',
      errorCode: 'FORBIDDEN',
      result: null,
    });
    const dates = entries.map((entry) => entry.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
    // La configuration soumise (jusqu'à 512 Ko) n'est pas recopiée dans le journal rendu.
    expect(JSON.stringify(audit.body)).not.toContain('referencePriceOboles');

    // Pagination : une entrée, puis la suivante avec `before`.
    const first = (await get(users.root, 'audit?limit=1')).body.data.entries;
    expect(first).toHaveLength(1);
    const next = (await get(users.root, `audit?limit=1&before=${first[0].createdAt}`)).body.data
      .entries;
    expect(next[0].createdAt < first[0].createdAt).toBe(true);
    expect(
      (await get(users.root, 'audit?limit=100000')).body.data.entries.length,
    ).toBeLessThanOrEqual(100);
  });
});
