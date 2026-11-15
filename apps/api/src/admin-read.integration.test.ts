import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { ADMIN_ROLES, type AdminRole } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createTelemetry } from './telemetry';
import { createRateLimiter, unlimited } from './rate-limit';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Tests d'intégration des lectures du back-office, contre Supabase local (base partagée avec les autres
// suites : les compteurs globaux sont vérifiés par différence).
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const telemetry = createTelemetry(db);
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  telemetry,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

async function newUser(role?: AdminRole, grantedBy: string | null = null): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  if (role)
    await owner
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
const ROUTES = [
  'me',
  'vigie',
  'config/versions',
  'economy',
  `config/versions/${TEST_CONFIG.id}`,
  'audit',
  'roles',
];

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
            .concat('audit', 'roles')
            .map((route) => get(user, route)),
        )
      ).map((reply) => reply.status);
    // Ordre : me, vigie, config/versions, audit, roles.
    expect(await allowed(users.root)).toEqual([200, 200, 200, 200, 200]);
    expect(await allowed(users.designer)).toEqual([200, 200, 200, 403, 403]);
    expect(await allowed(users.observer)).toEqual([200, 200, 200, 200, 403]);
    expect(await allowed(users.moderator)).toEqual([200, 403, 403, 403, 403]);
    // Chaque rôle du contrat, un compte chacun : trois lisent les tableaux de bord, deux le journal, un
    // seul la liste des rôles.
    const matrix: Record<string, number[]> = {};
    for (const role of ADMIN_ROLES) {
      matrix[role] = await allowed(await newUser(role, role === 'super_admin' ? null : users.root));
    }
    expect(matrix).toEqual({
      super_admin: [200, 200, 200, 200, 200],
      game_designer: [200, 200, 200, 403, 403],
      community_manager: [200, 403, 403, 403, 403],
      moderator: [200, 403, 403, 403, 403],
      support: [200, 403, 403, 403, 403],
      observer: [200, 200, 200, 200, 403],
    });
    // Un chemin que personne n'a déclaré n'est ouvert à aucun rôle.
    expect((await get(users.root, 'inconnu')).status).toBe(403);
    expect((await get(users.moderator, 'me')).body.data).toEqual({ role: 'moderator' });
    expect((await get(users.moderator, `config/versions/${TEST_CONFIG.id}`)).status).toBe(403);
  });

  it('un rôle retiré perd l’accès à la requête suivante', async () => {
    const former = await newUser('observer', users.root);
    expect((await get(former, 'vigie')).status).toBe(200);
    await owner.deleteFrom('admin.roles').where('user_id', '=', former).execute();
    expect((await get(former, 'vigie')).status).toBe(403);
  });
});

describe('limitation de débit des lectures', () => {
  it('au-delà de la limite, la requête est refusée avec le délai d’attente', async () => {
    const limited = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
      loadConfig: testConfig,
    });
    const call = () =>
      limited.request('/api/admin/me', {
        headers: { authorization: `Bearer aal2:${users.observer}` },
      });
    expect([(await call()).status, (await call()).status]).toEqual([200, 200]);
    const refused = await call();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('accès', () => {
  it('liste les comptes qui portent un rôle, du plus ancien au plus récent, et suit les commandes de rôle', async () => {
    const [guest, later] = [await newUser(), await newUser()];
    const known = [users.root, users.designer, guest, later, users.player];
    type Row = { userId: string; role: string; grantedBy: string | null; grantedAt: string };
    // Base partagée avec les autres suites : seuls les comptes de ce test sont comparés.
    const list = async () => {
      const all = (await get(users.root, 'roles')).body.data.roles as Row[];
      expect(all.map((row) => row.grantedAt)).toEqual(all.map((row) => row.grantedAt).sort());
      return all.filter((row) => known.includes(row.userId));
    };
    await command(users.root, 'admin.grantRole', { userId: guest, role: 'support' });
    await command(users.root, 'admin.grantRole', { userId: later, role: 'moderator' });
    const granted = await owner
      .selectFrom('admin.roles')
      .select('granted_at')
      .where('user_id', '=', guest)
      .executeTakeFirstOrThrow();
    // Ni adresse ni autre champ du compte : exactement ces quatre champs. Un compte sans rôle est absent.
    expect(await list()).toEqual([
      { userId: users.root, role: 'super_admin', grantedBy: null, grantedAt: expect.any(String) },
      {
        userId: users.designer,
        role: 'game_designer',
        grantedBy: users.root,
        grantedAt: expect.any(String),
      },
      {
        userId: guest,
        role: 'support',
        grantedBy: users.root,
        grantedAt: granted.granted_at.toISOString(),
      },
      { userId: later, role: 'moderator', grantedBy: users.root, grantedAt: expect.any(String) },
    ]);
    // Rôle remplacé, rôle retiré : la lecture suivante le montre.
    await command(users.root, 'admin.grantRole', { userId: guest, role: 'observer' });
    await command(users.root, 'admin.revokeRole', { userId: later });
    expect((await list()).map((row) => [row.userId, row.role])).toEqual([
      [users.root, 'super_admin'],
      [users.designer, 'game_designer'],
      [guest, 'observer'],
    ]);
  });
});

describe('Vigie', () => {
  it('montre le réglage qui lève la double validation, désactivé par défaut', async () => {
    expect((await get(users.observer, 'vigie')).body.data.selfReviewAllowed).toBe(false);
    const lenient = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: unlimited,
      loadConfig: testConfig,
      settings: { allowSelfReview: true },
    });
    const reply = await lenient.request('/api/admin/vigie', {
      headers: { authorization: `Bearer aal2:${users.observer}` },
    });
    expect(((await reply.json()) as Reply['body']).data.selfReviewAllowed).toBe(true);
  });

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
    // Programmée par un autre compte que son auteur : la revue par une seconde personne (15.2).
    const scheduled = await command(users.root, 'admin.scheduleConfig', {
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
    ).toMatchObject({ activateAt: scheduled?.activateAt, createdBy: users.root });

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
    const entries: { id: string; userId: string }[] = audit.body.data.entries;
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
    // Ordre d'inscription au journal (identifiant croissant dans le temps), pas ordre des heures : l'heure
    // est celle du début de la commande, et deux commandes simultanées peuvent s'inscrire à l'envers.
    const ids = entries.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort().reverse());
    // La configuration soumise n'est pas recopiée dans le journal rendu.
    expect(JSON.stringify(audit.body)).not.toContain('referencePriceOboles');
  });

  it('le journal ne contient que des commandes d’administration, par pages sans trou ni doublon', async () => {
    // Une commande de jeu du même compte, et 120 commandes d'administration écrites dans le même instant.
    const author = randomUUID();
    await sql`
      insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
      select ${author}, case when n = 0 then 'house.rename' else 'admin.publishConfig' end,
             'audit-' || ${author} || '-' || n, '{}', 'ok', '{"ok":true,"data":{"n":1}}', 1
      from generate_series(0, 120) as n`.execute(owner);
    const written = await sql<{ n: string }>`
      select count(*) as n from game.command_log where command like 'admin.%'`.execute(db);

    const seen: { id: string; command: string; userId: string }[] = [];
    let before = '';
    for (let page = 0; page < 1000; page++) {
      const reply = await get(users.root, `audit?limit=100000${before && `&before=${before}`}`);
      const entries = reply.body.data.entries as typeof seen;
      // La page est bornée à 100, quelle que soit la limite demandée.
      expect(entries.length).toBeLessThanOrEqual(100);
      if (entries.length === 0) break;
      seen.push(...entries);
      before = entries.at(-1)?.id ?? '';
    }
    expect(seen.length).toBeGreaterThanOrEqual(Number(written.rows[0]?.n));
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(seen.length);
    expect(seen.filter((entry) => entry.userId === author)).toHaveLength(120);
    expect(seen.every((entry) => entry.command.startsWith('admin.'))).toBe(true);
    // Du plus récent au plus ancien, d'un bout à l'autre.
    const ids = seen.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort().reverse());
    // Sans paramètre : 50 entrées ; une par une : la deuxième page commence juste après la première.
    expect((await get(users.root, 'audit')).body.data.entries).toHaveLength(50);
    const first = (await get(users.root, 'audit?limit=1')).body.data.entries;
    const second = (await get(users.root, `audit?limit=1&before=${first[0].id}`)).body.data.entries;
    expect([first[0].id, second[0].id]).toEqual(ids.slice(0, 2));
  });

  it('refuse des paramètres de pagination mal formés, sans erreur interne', async () => {
    for (const query of [
      'limit=1.5',
      'limit=0',
      'limit=-3',
      'limit=abc',
      'limit=1e3',
      'before=-271821-04-20T00:00:00.000Z',
      'before=2026-01-01T00:00:00Z',
      `before=${'9'.repeat(5000)}`,
    ]) {
      expect(await get(users.root, `audit?${query}`)).toMatchObject({
        status: 400,
        body: { ok: false, error: { code: 'VALIDATION_FAILED' } },
      });
    }
  });

  it('le journal d’audit rend le contexte de chaque commande : session, rôle du moment, version de configuration', async () => {
    const res = await app.request('/api/commands/admin.scheduleConfig', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer aal2:${users.designer}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ versionId: randomUUID() }),
    });
    expect(res.status).toBe(404);
    const audit = await get(users.root, 'audit?limit=100');
    const mine = (audit.body.data.entries as { userId: string }[]).find(
      (entry) => entry.userId === users.designer,
    );
    expect(mine).toMatchObject({
      command: 'admin.scheduleConfig',
      status: 'rejected',
      aal: 'aal2',
      adminRole: 'game_designer',
      configVersionId: TEST_CONFIG.id,
    });
  });
});
