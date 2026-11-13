import { randomUUID } from 'node:crypto';
import { createDb } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { testConfig } from './test-config';
import { createRateLimiter, unlimited } from './rate-limit';

// Tests d'intégration de la route de commandes contre Supabase local, avec la commande d'exemple `house.rename`.
// Les garanties du registre lui-même (verrou, isolation, annulation) sont testées dans registry.integration.test.ts.
const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
const app = createApp({
  db,
  verifyToken: async (token) => (token.length === 36 ? token : null),
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
const WORLD_ID = '01900000-0000-7000-8000-000000000001';
const users: string[] = [];
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

/** Crée un compte et sa maison ; rend le compte, la maison et son nom. */
async function newHouse() {
  const [userId, name] = [randomUUID(), `Maison ${letters()}`];
  await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
    db,
  );
  const house = await db
    .insertInto('game.houses')
    .values({ world_id: WORLD_ID, user_id: userId, name, blazon: '{}' })
    .returning('id')
    .executeTakeFirstOrThrow();
  users.push(userId);
  return { userId, houseId: house.id, name };
}

const rename = (
  userId: string,
  name: unknown,
  key: string | null = randomUUID(),
  command = 'house.rename',
) =>
  app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${userId}`,
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify({ name }),
  });

const nameOf = async (houseId: string) =>
  (
    await db
      .selectFrom('game.houses')
      .select('name')
      .where('id', '=', houseId)
      .executeTakeFirstOrThrow()
  ).name;
const logOf = (userId: string) =>
  db
    .selectFrom('game.command_log')
    .select(['status', 'error_code', 'idempotency_key'])
    .where('user_id', '=', userId)
    .orderBy('id')
    .execute();
const eventsOf = (houseId: string) =>
  db
    .selectFrom('game.domain_events')
    .select(['type', 'payload'])
    .where(sql<boolean>`payload->>'houseId' = ${houseId}`)
    .execute();

afterAll(async () => {
  await sql`delete from game.houses where user_id = any(${users}::uuid[])`.execute(db);
  await sql`delete from auth.users where id = any(${users}::uuid[])`.execute(db);
  await db.destroy();
});

describe('cadre de commandes : house.rename de bout en bout', () => {
  it('renomme, journalise et émet un événement dans la même transaction', async () => {
    const house = await newHouse();
    const next = `Renommée ${letters()}`;
    const res = await rename(house.userId, next);
    expect(res.status).toBe(200);
    expect(res.headers.get('Idempotent-Replay')).toBe('false');
    expect(await res.json()).toEqual({ ok: true, data: { houseId: house.houseId, name: next } });
    expect(await nameOf(house.houseId)).toBe(next);
    expect(await logOf(house.userId)).toMatchObject([{ status: 'ok', error_code: null }]);
    expect(await eventsOf(house.houseId)).toEqual([
      {
        type: 'HouseRenamed',
        payload: { houseId: house.houseId, previousName: house.name, name: next },
      },
    ]);
  });

  it('rejouer avec la même clé rend la même réponse et ne produit qu’un effet', async () => {
    const house = await newHouse();
    const [first, key] = [`Première ${letters()}`, randomUUID()];
    const original = await rename(house.userId, first, key);
    // Entre-temps la maison change encore de nom : un rejeu ne doit pas réappliquer l'ancien.
    const second = `Seconde ${letters()}`;
    expect((await rename(house.userId, second)).status).toBe(200);

    const replay = await rename(house.userId, first, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replay')).toBe('true');
    expect(await replay.json()).toEqual(await original.json());
    expect(await nameOf(house.houseId)).toBe(second);
    expect(await eventsOf(house.houseId)).toHaveLength(2);
    expect(await logOf(house.userId)).toHaveLength(2);
  });

  it('erreur métier : aucun effet, ligne « rejected », même réponse au rejeu', async () => {
    const [house, other] = [await newHouse(), await newHouse()];
    const key = randomUUID();
    const res = await rename(house.userId, other.name.toUpperCase(), key);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: { code: 'HOUSE_NAME_TAKEN' } });
    expect(await nameOf(house.houseId)).toBe(house.name);
    expect(await eventsOf(house.houseId)).toEqual([]);
    expect(await logOf(house.userId)).toMatchObject([
      { status: 'rejected', error_code: 'HOUSE_NAME_TAKEN' },
    ]);

    const replay = await rename(house.userId, other.name.toUpperCase(), key);
    expect([replay.status, replay.headers.get('Idempotent-Replay'), await replay.json()]).toEqual([
      409,
      'true',
      body,
    ]);
  });

  it('entrée invalide, compte sans maison, commande inconnue, clé absente ou mal formée', async () => {
    const house = await newHouse();
    const invalid = await rename(house.userId, 'X1');
    expect([invalid.status, await invalid.json()]).toMatchObject([
      400,
      { error: { code: 'VALIDATION_FAILED', fields: ['name'] } },
    ]);

    const homeless = randomUUID();
    const none = await rename(homeless, `Errante ${letters()}`);
    expect([none.status, await none.json()]).toMatchObject([
      404,
      { error: { code: 'HOUSE_NOT_FOUND' } },
    ]);

    const unknown = await rename(house.userId, 'Abc', randomUUID(), 'house.burn');
    expect([unknown.status, await unknown.json()]).toMatchObject([
      404,
      { error: { code: 'COMMAND_NOT_FOUND' } },
    ]);

    for (const key of [null, 'court', 'clé avec espace']) {
      const res = await rename(house.userId, `Sans clé ${letters()}`, key);
      expect([res.status, await res.json()]).toMatchObject([
        400,
        { error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } },
      ]);
    }
    expect(await nameOf(house.houseId)).toBe(house.name);
  });

  it('erreur inattendue : rien n’est écrit, la trace n’a pas de clé, et la même clé peut être retentée', async () => {
    const house = await newHouse();
    const [next, key] = [`Reprise ${letters()}`, randomUUID()];
    await sql`alter table game.domain_events add constraint test_always_fails check (false) not valid`.execute(
      db,
    );
    try {
      const res = await rename(house.userId, next, key);
      expect([res.status, await res.json()]).toMatchObject([500, { error: { code: 'INTERNAL' } }]);
    } finally {
      await sql`alter table game.domain_events drop constraint test_always_fails`.execute(db);
    }
    expect(await nameOf(house.houseId)).toBe(house.name);
    expect(await logOf(house.userId)).toMatchObject([{ status: 'failed', idempotency_key: null }]);

    const retry = await rename(house.userId, next, key);
    expect([retry.status, retry.headers.get('Idempotent-Replay')]).toEqual([200, 'false']);
    expect(await nameOf(house.houseId)).toBe(next);
  });

  it('exige un jeton valide : sans jeton ou avec un jeton refusé, 401, aucun effet, aucun journal', async () => {
    const house = await newHouse();
    const headers = { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() };
    const body = JSON.stringify({ name: `Volée ${letters()}` });
    for (const authorization of [undefined, 'Bearer refusé', house.userId]) {
      const res = await app.request('/api/commands/house.rename', {
        method: 'POST',
        headers: authorization ? { ...headers, authorization } : headers,
        body,
      });
      expect([res.status, await res.json()]).toMatchObject([
        401,
        { error: { code: 'UNAUTHENTICATED' } },
      ]);
    }
    expect([await nameOf(house.houseId), await logOf(house.userId)]).toEqual([house.name, []]);
  });

  it('traduit un nom refusé par la base seule en erreur de validation', async () => {
    const house = await newHouse();
    // U+1C89 : lettre connue de Node 22 mais pas de la base.
    const res = await rename(house.userId, 'Ab\u{1C89}cd');
    expect([res.status, await res.json()]).toMatchObject([
      400,
      { error: { code: 'VALIDATION_FAILED', fields: ['name'] } },
    ]);
  });

  it('deux renommages simultanés du même compte s’enchaînent : l’ancien nom du second est le nom du premier', async () => {
    const house = await newHouse();
    const names = [`Premier ${letters()}`, `Second ${letters()}`];
    const responses = await Promise.all(names.map((name) => rename(house.userId, name)));
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    const events = (await eventsOf(house.houseId)).map(
      (event) => event.payload as { previousName: string; name: string },
    );
    expect(events).toHaveLength(2);
    // Chaîne de noms sans trou : départ → l'un → l'autre.
    const first = events.find((event) => event.previousName === house.name);
    const second = events.find((event) => event.previousName === first?.name);
    expect([first, second].every(Boolean)).toBe(true);
    expect(await nameOf(house.houseId)).toBe(second?.name);
  });

  it('renommer vers le nom actuel réussit sans événement ; une commande inconnue rend 404 même sans clé', async () => {
    const house = await newHouse();
    expect((await rename(house.userId, house.name)).status).toBe(200);
    expect(await eventsOf(house.houseId)).toEqual([]);
    const unknown = await rename(house.userId, 'Abc', null, 'house.burn');
    expect([unknown.status, await unknown.json()]).toMatchObject([
      404,
      { error: { code: 'COMMAND_NOT_FOUND' } },
    ]);
  });

  it('corps trop gros : 413, sans lecture ni journal', async () => {
    const house = await newHouse();
    const res = await rename(house.userId, 'x'.repeat(20_000));
    expect([res.status, await res.json()]).toMatchObject([
      413,
      { error: { code: 'VALIDATION_FAILED' } },
    ]);
    expect(await logOf(house.userId)).toEqual([]);
  });

  it('limite le débit par compte et par commande, sans rien exécuter ni journaliser au-delà', async () => {
    const rateLimiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const limited = createApp({
      db,
      verifyToken: async (token) => token,
      rateLimiter,
      loadConfig: testConfig,
    });
    const [house, other] = [await newHouse(), await newHouse()];
    const send = (userId: string, command = 'house.rename') =>
      limited.request(`/api/commands/${command}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${userId}`,
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify({ name: `Rapide ${letters()}` }),
      });
    // Une commande inconnue ne consomme aucun quota et ne crée aucun compteur.
    for (let attempt = 0; attempt < 5; attempt++)
      expect((await send(house.userId, `house.unknown${attempt}`)).status).toBe(404);
    expect(rateLimiter.size()).toBe(0);

    const responses = [
      await send(house.userId),
      await send(house.userId),
      await send(house.userId),
    ];
    expect(responses.map((res) => res.status)).toEqual([200, 200, 429]);
    expect(await responses[2]?.json()).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
    expect(Number(responses[2]?.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await logOf(house.userId)).toHaveLength(2);
    // Ni une autre commande du même compte, ni un autre compte ne sont pénalisés.
    expect((await send(house.userId, 'house.create')).status).not.toBe(429);
    expect((await send(other.userId)).status).toBe(200);
    expect(rateLimiter.size()).toBe(3);
  });
});
