import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import type { RateLimiter } from './rate-limit';
import type { AdminRead, RefusalKind, RefusalReason, Telemetry } from './telemetry';
import { newAccount, testConfig, testVerifier } from './test-config';

// Jeton encore valide d'un compte effacé (#565) : après une remise à zéro de la base, ou une suppression, la
// signature tient jusqu'à l'expiration, mais le compte n'existe plus dans `auth.users`. L'API refuse en
// `UNAUTHENTICATED`, avant toute écriture : ni limite de débit, ni journal des commandes, ni erreur interne.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CITY_ID = '01900000-0000-7000-8000-000000000101';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

// Espions : la limite de débit et la télémétrie disent ce que la requête a atteint.
const hits: string[] = [];
const refusals: [RefusalKind, RefusalReason][] = [];
const reads: AdminRead[] = [];
const rateLimiter: RateLimiter = {
  hit: (key) => {
    hits.push(key);
    return { allowed: true };
  },
  size: () => hits.length,
};
const telemetry: Telemetry = {
  refusal: (kind, reason) => void refusals.push([kind, reason]),
  adminRead: (read) => Promise.resolve(void reads.push(read)),
  flush: () => Promise.resolve(),
};
const app = createApp({
  db,
  telemetry,
  verifyToken: testVerifier,
  rateLimiter,
  loadConfig: testConfig,
});
beforeEach(() => {
  hits.length = 0;
  refusals.length = 0;
  reads.length = 0;
});

const suffix = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 8).join('');
/** Compte créé puis effacé, comme par une remise à zéro : son jeton reste signé. */
async function erasedUser(): Promise<string> {
  const id = await newAccount(owner);
  await sql`delete from auth.users where id = ${id}`.execute(owner);
  return id;
}

const command = (token: string, name: string, body: unknown, key: string = randomUUID()) =>
  app.request(`/api/commands/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
const createHouse = (token: string, key?: string) =>
  command(
    token,
    'house.create',
    {
      cityId: CITY_ID,
      name: `Effacée ${suffix()}`,
      blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
    },
    key,
  );
const adminRead = (token: string, path: string) =>
  app.request(`/api/admin/${path}`, { headers: { authorization: `Bearer ${token}` } });

const UNAUTHENTICATED = {
  ok: false,
  error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid token.' },
};
/** Ce que la base garde du compte : lignes du journal des commandes (toutes issues) et maisons. */
async function traces(userId: string) {
  const [log, houses] = await Promise.all([
    db.selectFrom('game.command_log').select('status').where('user_id', '=', userId).execute(),
    db.selectFrom('game.houses').select('id').where('user_id', '=', userId).execute(),
  ]);
  return { log: log.length, houses: houses.length };
}

describe('jeton encore valide d’un compte effacé', () => {
  it('house.create : refus 401 UNAUTHENTICATED, rien d’écrit, pas même une erreur interne', async () => {
    const userId = await erasedUser();
    const response = await createHouse(userId);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHENTICATED);
    expect(await traces(userId)).toEqual({ log: 0, houses: 0 });
    // Refus d'avant le registre : compté comme tout jeton refusé, jamais débité de la limite.
    expect(refusals).toEqual([['command', 'unauthenticated']]);
    expect(hits).toEqual([]);
  });

  it('la même clé renvoyée est refusée de même : aucune clé consommée', async () => {
    const userId = await erasedUser();
    const key = randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await createHouse(userId, key);
      expect(response.status).toBe(401);
      expect(response.headers.get('Idempotent-Replay')).toBeNull();
    }
    expect(await traces(userId)).toEqual({ log: 0, houses: 0 });
  });

  it('un compte effacé en douceur par Supabase Auth est refusé de même', async () => {
    const userId = await newAccount(owner);
    await sql`update auth.users set deleted_at = now() where id = ${userId}`.execute(owner);
    const response = await createHouse(userId);
    expect(response.status).toBe(401);
    expect(await traces(userId)).toEqual({ log: 0, houses: 0 });
  });

  it('commande d’administration à second facteur : 401, et non un refus FORBIDDEN journalisé', async () => {
    const userId = await erasedUser();
    const response = await command(`aal2:${userId}`, 'admin.grantRole', {
      userId,
      role: 'observer',
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHENTICATED);
    expect(await traces(userId)).toEqual({ log: 0, houses: 0 });
  });

  it.each(['me', 'vigie', 'audit'])(
    'lecture d’Olympe /api/admin/%s : 401, ni débit, ni lecture tracée',
    async (path) => {
      const userId = await erasedUser();
      const response = await adminRead(`aal2:${userId}`, path);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(UNAUTHENTICATED);
      expect(refusals).toEqual([['admin_read', 'unauthenticated']]);
      expect(hits).toEqual([]);
      expect(reads).toEqual([]);
      expect(await traces(userId)).toEqual({ log: 0, houses: 0 });
    },
  );

  it('un sujet qui n’est pas un identifiant de compte est refusé sans erreur de la base', async () => {
    const response = await createHouse('x'.repeat(36));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHENTICATED);
  });

  it('témoin : le compte présent fonde sa maison, puis Olympe lui répond FORBIDDEN (aucun rôle)', async () => {
    const userId = await newAccount(owner);
    const created = await createHouse(userId);
    expect(created.status).toBe(200);
    expect(hits).toEqual([`${userId}:house.create`]);
    const me = await adminRead(`aal2:${userId}`, 'me');
    expect(me.status).toBe(403);
    expect(await traces(userId)).toEqual({ log: 1, houses: 1 });
  });
});
