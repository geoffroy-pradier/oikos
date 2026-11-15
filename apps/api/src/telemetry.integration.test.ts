import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import type { AdminRole } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createRateLimiter, unlimited } from './rate-limit';
import { adminRouteTemplate, createTelemetry } from './telemetry';
import { testConfig, testVerifier } from './test-config';

// Refus avant exécution et lectures du back-office, contre Supabase local. Les compteurs sont par heure
// et partagés : chaque test compte dans une heure qui lui est propre, loin dans le futur.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

async function newUser(role?: AdminRole, grantedBy: string | null = null): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  if (role) {
    await owner
      .insertInto('admin.roles')
      .values({ user_id: id, role, granted_by: grantedBy })
      .execute();
  }
  return id;
}
const users = {} as Record<'root' | 'moderator' | 'player', string>;
beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  users.root = await newUser('super_admin');
  users.moderator = await newUser('moderator', users.root);
  users.player = await newUser();
});

/** Une application dont l'horloge de télémétrie est figée dans une heure propre au test. */
function isolated(rateLimiter = unlimited) {
  const hour = new Date(
    Date.UTC(2200 + Math.floor(Math.random() * 500), 0, 1, 0) +
      Math.floor(Math.random() * 8000) * 3_600_000,
  );
  const telemetry = createTelemetry(db, () => new Date(hour.getTime() + 59 * 60_000));
  const app = createApp({
    db,
    telemetry,
    verifyToken: testVerifier,
    rateLimiter,
    loadConfig: testConfig,
  });
  const counted = async () =>
    Object.fromEntries(
      (
        await owner
          .selectFrom('telemetry.api_refusals')
          .select(['kind', 'reason', 'count'])
          .where('bucket', '=', hour)
          .execute()
      ).map((row) => [`${row.kind}:${row.reason}`, Number(row.count)]),
    );
  const command = (token: string | null, name: string, body: unknown) =>
    app.request(`/api/commands/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': randomUUID(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const read = (token: string | null, path: string) =>
    app.request(`/api/admin/${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  return { telemetry, counted, command, read };
}
const readsOf = (userId: string) =>
  owner
    .selectFrom('telemetry.admin_reads')
    .select(['admin_role', 'route', 'status'])
    .where('user_id', '=', userId)
    .orderBy('id')
    .execute();

describe('refus avant exécution', () => {
  it('compte par nature et par raison, sans rien écrire avant le passage périodique', async () => {
    const { telemetry, counted, command, read } = isolated(
      createRateLimiter({ limit: 1, windowMs: 60_000 }),
    );
    const rename = { name: 'Compteurs' };
    for (const token of [null, 'pas-un-jeton', ''])
      expect((await command(token, 'house.rename', rename)).status).toBe(401);
    expect((await read(null, 'vigie')).status).toBe(401);
    expect((await command(users.player, 'house.rename', { name: 'x'.repeat(20_000) })).status).toBe(
      413,
    );
    // Débit : une commande admise, les deux suivantes refusées ; de même pour une lecture d'administration.
    expect((await command(users.player, 'house.rename', rename)).status).not.toBe(429);
    expect((await command(users.player, 'house.rename', rename)).status).toBe(429);
    expect((await command(users.player, 'house.rename', rename)).status).toBe(429);
    const reader = await newUser('observer', users.root);
    expect((await read(`aal2:${reader}`, 'me')).status).toBe(200);
    expect((await read(`aal2:${reader}`, 'me')).status).toBe(429);
    // Lectures d'administration refusées : compte sans rôle, puis rôle sans second facteur.
    expect((await read(`aal2:${users.player}`, 'vigie')).status).toBe(403);
    expect((await read(users.root, 'vigie')).status).toBe(403);
    // Ne sont pas des refus d'entrée : commande inconnue, refus métier, commande d'administration
    // refusée (celle-ci est au journal des commandes).
    expect((await command(users.moderator, 'nope.nope', {})).status).toBe(404);
    expect((await command(`aal2:${users.moderator}`, 'admin.publishConfig', {})).status).toBe(403);

    expect(await counted()).toEqual({});
    await telemetry.flush();
    const expected = {
      'command:unauthenticated': 3,
      'admin_read:unauthenticated': 1,
      'command:payload_too_large': 1,
      'command:rate_limited': 2,
      'admin_read:rate_limited': 1,
      'admin_read:forbidden': 2,
    };
    expect(await counted()).toEqual(expected);
    // Un passage sans nouveau refus n'ajoute rien ; un refus de plus s'ajoute au compteur de l'heure.
    await telemetry.flush();
    expect(await counted()).toEqual(expected);
    await command(null, 'house.rename', rename);
    await telemetry.flush();
    expect(await counted()).toEqual({ ...expected, 'command:unauthenticated': 4 });
  });

  it('une écriture en échec n’est pas perdue : le passage suivant la reprend, une seule fois', async () => {
    const { telemetry, counted, command } = isolated();
    await command(null, 'house.rename', {});
    await command(null, 'house.rename', {});
    // Une exécution interrompue a pu laisser la contrainte : on repart d'une table saine.
    await sql`alter table telemetry.api_refusals drop constraint if exists test_always_fails`.execute(
      owner,
    );
    await sql`alter table telemetry.api_refusals add constraint test_always_fails check (false) not valid`.execute(
      owner,
    );
    try {
      await telemetry.flush();
      expect(await counted()).toEqual({});
    } finally {
      await sql`alter table telemetry.api_refusals drop constraint test_always_fails`.execute(
        owner,
      );
    }
    await telemetry.flush();
    await telemetry.flush();
    expect(await counted()).toEqual({ 'command:unauthenticated': 2 });
  });
});

describe('lectures du back-office', () => {
  it('chaque lecture d’un compte admis est tracée avec son rôle, son gabarit de route et son issue', async () => {
    const { read } = isolated();
    const root = `aal2:${users.root}`;
    await read(root, 'me');
    await read(root, 'vigie');
    await read(root, 'config/versions');
    await read(root, `config/versions/${randomUUID()}`);
    await read(root, 'audit?limit=5&before=pas-un-identifiant');
    await read(root, 'inconnue');
    await read(root, `${'x'.repeat(120)}/<script>`);
    expect(await readsOf(users.root)).toEqual([
      { admin_role: 'super_admin', route: '/api/admin/me', status: 200 },
      { admin_role: 'super_admin', route: '/api/admin/vigie', status: 200 },
      { admin_role: 'super_admin', route: '/api/admin/config/versions', status: 200 },
      { admin_role: 'super_admin', route: '/api/admin/config/versions/:id', status: 404 },
      // Les paramètres de la requête ne sont jamais recopiés.
      { admin_role: 'super_admin', route: '/api/admin/audit', status: 400 },
      // Un chemin qui n'est pas une route connue n'est jamais recopié, même bien formé.
      { admin_role: 'super_admin', route: '/api/admin/:unknown', status: 403 },
      { admin_role: 'super_admin', route: '/api/admin/:unknown', status: 403 },
    ]);
  });

  it('un rôle insuffisant est tracé et compté ; un compte sans rôle ou sans second facteur n’est que compté', async () => {
    const { telemetry, counted, read } = isolated();
    expect((await read(`aal2:${users.moderator}`, 'vigie')).status).toBe(403);
    expect((await read(`aal2:${users.player}`, 'vigie')).status).toBe(403);
    expect((await read(users.moderator, 'me')).status).toBe(403);
    expect(await readsOf(users.moderator)).toEqual([
      { admin_role: 'moderator', route: '/api/admin/vigie', status: 403 },
    ]);
    expect(await readsOf(users.player)).toEqual([]);
    await telemetry.flush();
    expect(await counted()).toEqual({ 'admin_read:forbidden': 3 });
  });

  it('la Vigie rend les refus et les lectures des dernières 24 heures', async () => {
    // Horloge réelle : la fenêtre de la Vigie est celle de la base.
    const telemetry = createTelemetry(db);
    const app = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: unlimited,
      loadConfig: testConfig,
    });
    const vigie = async () => {
      const res = await app.request('/api/admin/vigie', {
        headers: { authorization: `Bearer aal2:${users.root}` },
      });
      const { data } = (await res.json()) as {
        data: { refusals24h: Record<string, number>; adminReads24h: number };
      };
      return data;
    };
    const before = await vigie();
    for (let n = 0; n < 3; n += 1)
      await app.request('/api/commands/house.rename', { method: 'POST' });
    for (let n = 0; n < 2; n += 1) {
      await app.request('/api/commands/house.rename', {
        method: 'POST',
        headers: { authorization: `Bearer ${users.player}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(20_000) }),
      });
    }
    await app.request('/api/admin/me', {
      headers: { authorization: `Bearer aal2:${users.player}` },
    });
    await telemetry.flush();
    const after = await vigie();
    expect(after.refusals24h['unauthenticated']).toBe(
      (before.refusals24h['unauthenticated'] ?? 0) + 3,
    );
    expect(after.refusals24h['forbidden']).toBe((before.refusals24h['forbidden'] ?? 0) + 1);
    expect(after.refusals24h['payloadTooLarge']).toBe(
      (before.refusals24h['payloadTooLarge'] ?? 0) + 2,
    );
    expect(after.refusals24h['rateLimited']).toBe(before.refusals24h['rateLimited'] ?? 0);
    expect(Object.keys(after.refusals24h).sort()).toEqual([
      'forbidden',
      'payloadTooLarge',
      'rateLimited',
      'unauthenticated',
    ]);
    // La lecture « avant » elle-même a été tracée : au moins une de plus.
    expect(after.adminReads24h).toBeGreaterThanOrEqual(before.adminReads24h + 1);
  });
});

it('le gabarit d’une route remplace les identifiants et ne recopie pas un chemin inattendu', () => {
  expect(adminRouteTemplate('/api/admin/config/versions')).toBe('/api/admin/config/versions');
  expect(adminRouteTemplate('/api/admin/roles')).toBe('/api/admin/roles');
  expect(adminRouteTemplate('/api/admin/economy')).toBe('/api/admin/economy');
  expect(
    adminRouteTemplate('/api/admin/config/versions/01900000-0000-7000-8000-000000000001'),
  ).toBe('/api/admin/config/versions/:id');
  for (const odd of [
    '/api/admin',
    '/api/admin/',
    '/api/admin/inconnue',
    '/api/admin/me/plus',
    '/api/admin/a b',
    '/api/other/x',
  ])
    expect(adminRouteTemplate(odd)).toBe('/api/admin/:unknown');
});
